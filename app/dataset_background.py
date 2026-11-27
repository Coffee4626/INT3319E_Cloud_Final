"""Self-invoked Lambda processing for large CSVs, with owner-scoped polling records."""
import json
import logging
import os
import time
import uuid

from app import runtime
from app.infrastructure.aws import client
from app.vision_data import VISION_TASKS


def start(service, dataset_id, operation, options=None):
    original = service.get(dataset_id)
    if original.get('task') in VISION_TASKS or not os.getenv('AWS_LAMBDA_FUNCTION_NAME'):
        return None
    if operation == 'complete':
        if original['status'] in ('READY', 'PROCESSING'):
            return original
        size = service.artifacts.s3.head_object(Bucket=service.artifacts.bucket, Key=original['upload_key'])['ContentLength']
        if size > 200_000_000:
            raise ValueError('CSV limit: 200 MB')
        if size <= 10_000_000:
            return None
        item = dict(original)
    else:
        if original['status'] != 'READY' or original['profile']['size_bytes'] <= 10_000_000:
            return None
        result_id = uuid.uuid4().hex
        item = dict(id=f'dataset#{result_id}', dataset_id=result_id, owner=service.owner,
                    kind='dataset', name=original['name'], source_id=dataset_id, prepared=False)
    token = uuid.uuid4().hex
    item.update(status='PROCESSING', processing_started=int(time.time()), processing_token=token)
    item.pop('error', None)
    service.repository.put_record(item)
    try:
        client('lambda').invoke(FunctionName=os.environ['AWS_LAMBDA_FUNCTION_NAME'], InvocationType='Event',
            Payload=json.dumps(dict(dataset_operation=operation, owner=service.owner, dataset_id=dataset_id,
                                    result_id=item['dataset_id'], token=token, options=options or {})).encode())
    except Exception:
        item.update(status='FAILED', error='Cannot schedule dataset processing; retry the upload.')
        service.repository.put_record(item)
        raise
    return item


def run(event):
    service = runtime.dataset_service(event['owner'])
    item = service.get(event['result_id'])
    if item.get('processing_token') != event['token'] or item['status'] != 'PROCESSING':
        return  # Ignore duplicate/obsolete deliveries.
    try:
        if event['dataset_operation'] == 'complete':
            service.complete(event['dataset_id'])
        elif event['dataset_operation'] == 'preprocess':
            service.preprocess(event['dataset_id'], event['options'], result_id=event['result_id'])
        else:
            raise ValueError('Unknown dataset operation')
    except Exception as exc:
        logging.exception('Background dataset processing failed')
        item.update(status='FAILED', error=str(exc)[:500] if isinstance(exc, ValueError)
                    else 'Dataset processing failed; check CloudWatch logs.')
        service.repository.put_record(item)


def expire(item):
    if item.get('status') == 'PROCESSING' and time.time() - int(item.get('processing_started', 0)) > 1200:
        # A timed-out Lambda cannot update its own record. Return a recoverable terminal state.
        return {**item, 'status': 'FAILED', 'error': 'Dataset processing timed out; upload again to retry.'}
    return item
