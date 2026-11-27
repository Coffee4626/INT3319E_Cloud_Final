import os
import unittest
from unittest.mock import Mock, patch

import boto3
from moto import mock_aws

from app.domain import ConflictError
from app.inference_lifecycle import Activity, sweep, SYSTEM_ID, IDLE_SECONDS


@mock_aws
class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'AWS_DEFAULT_REGION': 'us-east-1', 'AWS_ACCESS_KEY_ID': 'test', 'AWS_SECRET_ACCESS_KEY': 'test'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.ddb = boto3.client('dynamodb')
        self.ddb.create_table(TableName='lifecycle-test', BillingMode='PAY_PER_REQUEST',
            KeySchema=[{'AttributeName':'id','KeyType':'HASH'}], AttributeDefinitions=[{'AttributeName':'id','AttributeType':'S'}])
        self.table = boto3.resource('dynamodb').Table('lifecycle-test')
        self.activity = Activity(self.table, self.ddb)
        self.now = 10 * IDLE_SECONDS
        self.activity.boot(self.now - IDLE_SECONDS - 1)
        self.ec2 = Mock()

    def deployment(self, name='old', age=None, **extra):
        item = dict(id='deploy#'+name, kind='deployment', status='ACTIVE', created_at=self.now-(age or IDLE_SECONDS+10), model_key='models/keep.zip')
        item.update(extra); self.table.put_item(Item=item)
        return item

    def get(self, name):
        return self.table.get_item(Key={'id':name},ConsistentRead=True)['Item']

    def test_idle_endpoints_revoke_and_only_stop_instance_without_deleting_models(self):
        self.deployment()
        result = sweep(self.table, self.ec2, 'i-inference', self.now)
        self.assertEqual(result, {'revoked':1,'stopped':True})
        self.assertEqual(self.get('deploy#old')['model_key'], 'models/keep.zip')
        self.assertEqual(self.get('deploy#old')['revoke_reason'], 'idle_3_days')
        self.ec2.stop_instances.assert_called_once_with(InstanceIds=['i-inference'])
        sweep(self.table, self.ec2, 'i-inference', self.now)
        self.ec2.stop_instances.assert_called_once()

    def test_recent_call_protects_endpoint_and_machine_atomically(self):
        self.deployment()
        token = self.activity.begin('old', self.now-5)
        result = sweep(self.table, self.ec2, 'i-inference', self.now)
        self.assertFalse(result['stopped']); self.assertEqual(result['revoked'],0)
        self.assertEqual(self.get('deploy#old')['status'],'ACTIVE')
        self.activity.finish(token)
        self.assertEqual(self.get(SYSTEM_ID)['busy_until'],0)

    def test_new_endpoints_get_three_days_even_when_global_policy_is_old(self):
        self.deployment('new', age=100)
        self.activity.boot(self.now-100)
        result = sweep(self.table, self.ec2, 'i-inference', self.now)
        self.assertEqual(result['revoked'],0); self.assertFalse(result['stopped'])

    def test_first_rollout_grace_does_not_revoke_legacy_endpoints(self):
        self.table.delete_item(Key={'id':SYSTEM_ID})
        self.activity.boot(self.now)
        self.deployment()
        self.assertEqual(sweep(self.table,self.ec2,'i-inference',self.now)['reason'],'initial_grace_period')
        self.ec2.stop_instances.assert_not_called()

    def test_stopping_lock_rejects_call_without_touching_endpoint_and_start_restores_service(self):
        self.deployment()
        self.table.update_item(Key={'id':SYSTEM_ID}, UpdateExpression='SET #s=:s',
            ExpressionAttributeNames={'#s':'state'},ExpressionAttributeValues={':s':'STOPPING'})
        with self.assertRaises(ConflictError):self.activity.begin('old',self.now)
        self.assertNotIn('last_used_at', self.get('deploy#old'))
        self.activity.boot(self.now)
        self.activity.begin('old', self.now)
        self.assertEqual(self.get(SYSTEM_ID)['state'],'RUNNING')

    def test_revoked_endpoint_cannot_keep_machine_alive(self):
        self.deployment(status='REVOKED')
        before=self.get(SYSTEM_ID)['last_used_at']
        with self.assertRaises(ConflictError): self.activity.begin('old',self.now)
        self.assertEqual(self.get(SYSTEM_ID)['last_used_at'],before)

    def test_failed_stop_retries_and_scan_race_does_not_revoke_recent_call(self):
        self.deployment()
        original_scan=self.table.scan
        def scan(**kwargs):
            result=original_scan(**kwargs)
            self.activity.begin('old',self.now)
            return result
        with patch.object(self.table,'scan',side_effect=scan):
            result=sweep(self.table,self.ec2,'i-inference',self.now)
        self.assertEqual(result['revoked'],0); self.assertFalse(result['stopped'])
        self.table.update_item(Key={'id':SYSTEM_ID}, UpdateExpression='SET #s=:s',
            ExpressionAttributeNames={'#s':'state'},ExpressionAttributeValues={':s':'STOPPING'})
        self.ec2.stop_instances.side_effect=RuntimeError('transient')
        with self.assertRaises(RuntimeError):sweep(self.table,self.ec2,'i-inference',self.now)
        self.assertEqual(self.get(SYSTEM_ID)['state'],'STOPPING')
        self.ec2.stop_instances.side_effect=None
        self.assertTrue(sweep(self.table,self.ec2,'i-inference',self.now)['stopped'])
