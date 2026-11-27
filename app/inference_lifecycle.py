"""Idle endpoint retirement and inference stop; never deletes model artifacts."""
import logging
import os
import time
import uuid

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

SYSTEM_ID = 'system#inference'
IDLE_SECONDS = 3 * 86400


class Activity:
    def __init__(self, table, dynamodb):
        self.table, self.ddb = table, dynamodb

    def boot(self, now=None):
        now = int(time.time()) if now is None else now
        self.table.update_item(Key={'id': SYSTEM_ID},
            UpdateExpression='SET #s=:running, last_used_at=:now, busy_until=:zero, policy_started_at=if_not_exists(policy_started_at,:now)',
            ExpressionAttributeNames={'#s': 'state'},
            ExpressionAttributeValues={':running': 'RUNNING', ':now': now, ':zero': 0})

    def begin(self, deployment_id, now=None):
        now = int(time.time()) if now is None else now
        token = uuid.uuid4().hex
        serialize = TypeSerializer().serialize
        def update(key, expression, condition, names, values):
            return {'Update': {'TableName': self.table.name, 'Key': {'id': {'S': key}},
                'UpdateExpression': expression, 'ConditionExpression': condition,
                'ExpressionAttributeNames': names,
                'ExpressionAttributeValues': {k: serialize(v) for k, v in values.items()}}}
        try:
            self.ddb.transact_write_items(TransactItems=[
                update('deploy#'+deployment_id, 'SET last_used_at=:now', '#s=:active',
                       {'#s': 'status'}, {':now': now, ':active': 'ACTIVE'}),
                update(SYSTEM_ID, 'SET last_used_at=:now, busy_until=:until, activity_token=:token',
                       '#s=:running', {'#s': 'state'},
                       {':now': now, ':until': now+120, ':token': token, ':running': 'RUNNING'})])
        except ClientError as exc:
            if exc.response['Error']['Code'] == 'TransactionCanceledException':
                from app.domain import ConflictError
                raise ConflictError('Endpoint revoked or inference is stopping; try again after starting inference.') from exc
            raise
        return token

    def finish(self, token):
        # A failed cleanup retains the 120-second lease, which safely expires.
        self.table.update_item(Key={'id': SYSTEM_ID},
            UpdateExpression='SET last_used_at=:now, busy_until=:zero',
            ConditionExpression='activity_token=:token',
            ExpressionAttributeValues={':now': int(time.time()), ':zero': 0, ':token': token})


def activity():
    from app.infrastructure.aws import client, table
    return Activity(table(), client('dynamodb'))


def sweep(table, ec2, instance_id, now=None):
    now = int(time.time()) if now is None else now
    cutoff = now - IDLE_SECONDS
    state = table.get_item(Key={'id': SYSTEM_ID}, ConsistentRead=True).get('Item')
    if not state or int(state.get('policy_started_at', now)) > cutoff:
        return {'revoked': 0, 'stopped': False, 'reason': 'initial_grace_period'}
    revoked = 0
    args = {'FilterExpression': '#k=:deployment', 'ExpressionAttributeNames': {'#k': 'kind'},
            'ExpressionAttributeValues': {':deployment': 'deployment'}, 'ConsistentRead': True}
    while True:
        page = table.scan(**args)
        for item in page.get('Items', []):
            last = max(int(item.get('created_at', now)), int(item.get('last_used_at', 0)))
            if item.get('status') != 'ACTIVE' or last > cutoff:
                continue
            try:
                table.update_item(Key={'id': item['id']},
                    UpdateExpression='SET #s=:revoked, revoked_at=:now, revoke_reason=:reason',
                    ConditionExpression='#s=:active AND created_at<=:cutoff AND (attribute_not_exists(last_used_at) OR last_used_at<=:cutoff)',
                    ExpressionAttributeNames={'#s': 'status'}, ExpressionAttributeValues={
                        ':revoked': 'REVOKED', ':active': 'ACTIVE', ':now': now, ':cutoff': cutoff,
                        ':reason': 'idle_3_days'})
                revoked += 1
            except ClientError as exc:
                if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise
        if not page.get('LastEvaluatedKey'):
            break
        args['ExclusiveStartKey'] = page['LastEvaluatedKey']
    state = table.get_item(Key={'id': SYSTEM_ID}, ConsistentRead=True).get('Item', {})
    if state.get('state') == 'STOPPED':
        return {'revoked': revoked, 'stopped': False}
    if state.get('state') != 'STOPPING':
        try:
            table.update_item(Key={'id': SYSTEM_ID},
                UpdateExpression='SET #s=:stopping',
                ConditionExpression='#s=:running AND last_used_at<=:cutoff AND busy_until<=:now',
                ExpressionAttributeNames={'#s': 'state'}, ExpressionAttributeValues={
                    ':stopping': 'STOPPING', ':running': 'RUNNING', ':cutoff': cutoff, ':now': now})
        except ClientError as exc:
            if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            return {'revoked': revoked, 'stopped': False}
    # STOPPING is a retryable lock: new inference calls cannot enter while EC2 stops.
    ec2.stop_instances(InstanceIds=[instance_id])
    table.update_item(Key={'id': SYSTEM_ID}, UpdateExpression='SET #s=:stopped, stopped_at=:now',
                      ConditionExpression='#s=:stopping', ExpressionAttributeNames={'#s': 'state'},
                      ExpressionAttributeValues={':stopped': 'STOPPED', ':stopping': 'STOPPING', ':now': now})
    return {'revoked': revoked, 'stopped': True}


def handler(event, context):
    table = boto3.resource('dynamodb').Table(os.environ['TABLE_NAME'])
    result = sweep(table, boto3.client('ec2'), os.environ['INFERENCE_INSTANCE_ID'])
    logging.getLogger().setLevel(logging.INFO)
    logging.info('Inference lifecycle: %s', result)
    return result
