import os
import shutil
import tempfile
import zipfile
from functools import lru_cache
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from app.domain import QueueMessage

# Leave time for a replacement worker to claim an expired lease after redelivery.
VISIBILITY_SECONDS = 3600
LEASE_SECONDS = 3500


@lru_cache
def client(service):
    return boto3.client(service, endpoint_url=os.getenv("AWS_ENDPOINT_URL"))


@lru_cache
def table():
    return boto3.resource("dynamodb", endpoint_url=os.getenv("AWS_ENDPOINT_URL")).Table(
        os.environ["TABLE_NAME"])


class DynamoJobRepository:
    def __init__(self, state_table):
        self.table = state_table

    def get_job(self, job_id):
        item = self.table.get_item(Key={"id": job_id}, ConsistentRead=True).get("Item")
        return item if item and "status" in item else None

    def create_job(self, job):
        self.table.put_item(Item=job, ConditionExpression="attribute_not_exists(id)")

    def submission_failed(self, job_id):
        self._conditional_update(
            Key={"id": job_id}, UpdateExpression="SET #s = :failed",
            ConditionExpression="#s = :queued",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":failed": "FAILED", ":queued": "QUEUED"})

    def claim(self, job_id, owner, now):
        return self._conditional_update(
            Key={"id": job_id},
            UpdateExpression="SET #s = :running, lease_until = :lease, lease_owner = :owner",
            ConditionExpression="#s = :queued OR (#s = :running AND lease_until < :now)",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":running": "TRAINING", ":queued": "QUEUED",
                                       ":lease": now + LEASE_SECONDS, ":now": now, ":owner": owner})

    def finish(self, job_id, owner, *, model_key=None, error=None):
        field, value = ("error", error[:1000]) if error is not None else ("model_key", model_key)
        return self._conditional_update(
            Key={"id": job_id},
            UpdateExpression="SET #s = :status, #result = :value REMOVE lease_owner, lease_until",
            ConditionExpression="#s = :running AND lease_owner = :owner",
            ExpressionAttributeNames={"#s": "status", "#result": field},
            ExpressionAttributeValues={":status": "FAILED" if error is not None else "COMPLETED",
                                       ":running": "TRAINING", ":owner": owner, ":value": value})

    def _conditional_update(self, **kwargs):
        try:
            self.table.update_item(**kwargs)
            return True
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise

    def get_deployment(self, deployment_id):
        return self.table.get_item(Key={"id": f"deploy#{deployment_id}"}, ConsistentRead=True).get("Item")

    def create_deployment(self, deployment):
        self.table.put_item(Item=deployment, ConditionExpression="attribute_not_exists(id)")


class S3ArtifactStore:
    def __init__(self, s3, bucket):
        self.s3, self.bucket = s3, bucket

    def save_csv(self, key, csv):
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=csv.encode())

    def download(self, key, path):
        self.s3.download_file(self.bucket, key, str(path))

    def upload_model(self, key, directory):
        with tempfile.TemporaryDirectory() as folder:
            archive = shutil.make_archive(str(Path(folder) / "model"), "zip", directory)
            self.s3.upload_file(archive, self.bucket, key)

    def extract_model(self, key, directory):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "model.zip"
            self.download(key, archive)
            with zipfile.ZipFile(archive) as model:
                model.extractall(directory)


class SQSJobQueue:
    def __init__(self, sqs, url):
        self.sqs, self.url = sqs, url

    def enqueue(self, job_id):
        self.sqs.send_message(QueueUrl=self.url, MessageBody=job_id)

    def receive(self):
        result = self.sqs.receive_message(QueueUrl=self.url, WaitTimeSeconds=20,
                                         MaxNumberOfMessages=1, VisibilityTimeout=VISIBILITY_SECONDS)
        return [QueueMessage(item["Body"], item["ReceiptHandle"]) for item in result.get("Messages", [])]

    def acknowledge(self, message):
        self.sqs.delete_message(QueueUrl=self.url, ReceiptHandle=message.receipt)
