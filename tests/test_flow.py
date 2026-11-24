import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from moto import mock_aws

from app import controller, predict, runtime, worker
from app.infrastructure.aws import client, table
from app.services import ModelCache, PredictionService, TrainingService
from app.tasks.base import MLTask
from app.tasks.factory import TaskFactory


class FileTask(MLTask):
    """Lightweight test strategy exercising real artifact storage and dispatch."""

    def __init__(self, name):
        self.name = name
        self.loads = 0

    def validate_training(self, request):
        pass

    def train(self, dataset, model_dir, job):
        assert job["task"] == self.name
        assert dataset.read_text().startswith("x,y")
        model_dir.mkdir()
        (model_dir / "task.txt").write_text(self.name)

    def load(self, model_dir):
        self.loads += 1
        return (model_dir / "task.txt").read_text()

    def predict(self, model, rows):
        assert model == self.name
        return {"predictions": [self.name] * len(rows)}


@mock_aws
class FlowTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "AWS_DEFAULT_REGION": "us-east-1", "BUCKET_NAME": "automl-test",
            "TABLE_NAME": "automl-test", "AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        client.cache_clear()
        table.cache_clear()
        runtime.prediction_service.cache_clear()
        client("s3").create_bucket(Bucket="automl-test")
        client("dynamodb").create_table(
            TableName="automl-test", BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}])
        os.environ["QUEUE_URL"] = client("sqs").create_queue(QueueName="jobs")["QueueUrl"]

    def call(self, path, payload=None, method="POST", handler=controller.handler):
        result = handler({"httpMethod": method, "path": path, "body": json.dumps(payload or {})}, None)
        return result["statusCode"], json.loads(result["body"])

    def submit(self):
        status, job = self.call("/jobs", {"csv": "x,y\n1,2\n2,4\n", "target": "y"})
        self.assertEqual(status, 202)
        return job["job_id"]

    def test_submit_persists_dataset_state_and_queue_message(self):
        job_id = self.submit()
        self.assertEqual(self.call(f"/jobs/{job_id}", method="GET")[1]["status"], "QUEUED")
        stored = client("s3").get_object(Bucket="automl-test", Key=f"datasets/{job_id}.csv")
        self.assertEqual(stored["Body"].read(), b"x,y\n1,2\n2,4\n")
        messages = client("sqs").receive_message(QueueUrl=os.environ["QUEUE_URL"])["Messages"]
        self.assertEqual(messages[0]["Body"], job_id)

    def test_invalid_csv_does_not_enqueue(self):
        self.assertEqual(self.call("/jobs", {"csv": "x\n1", "target": "y"})[0], 400)
        self.assertNotIn("Messages", client("sqs").receive_message(QueueUrl=os.environ["QUEUE_URL"]))

    def test_deploy_requires_completed_job_and_resolves_model(self):
        job_id = self.submit()
        self.assertEqual(self.call("/deploy", {"job_id": job_id})[0], 409)
        table().update_item(Key={"id": job_id}, UpdateExpression="SET #s = :s, model_key = :key",
                            ExpressionAttributeNames={"#s": "status"},
                            ExpressionAttributeValues={":s": "COMPLETED", ":key": "models/test.zip"})
        status, deployment = self.call("/deploy", {"job_id": job_id})
        self.assertEqual(status, 201)
        saved = table().get_item(Key={"id": "deploy#" + deployment["deployment_id"]})["Item"]
        self.assertEqual(saved["model_key"], "models/test.zip")
        self.assertEqual(self.call(deployment["predict_path"], {"rows": []}, handler=predict.handler)[0], 400)

    def test_duplicate_delivery_does_not_steal_active_training(self):
        table().put_item(Item={"id": "active", "status": "TRAINING", "lease_until": int(time.time()) + 60})
        self.assertFalse(worker.process("active"))
        table().put_item(Item={"id": "finished", "status": "COMPLETED"})
        self.assertTrue(worker.process("finished"))

    def test_training_failure_is_saved_and_message_can_be_acknowledged(self):
        job_id = self.submit()
        fake = MagicMock()
        fake.TabularPredictor.return_value.fit.side_effect = ValueError("Invalid target data")
        with patch.dict("sys.modules", {"autogluon": MagicMock(), "autogluon.tabular": fake}):
            with self.assertLogs(level="ERROR"):
                self.assertTrue(worker.process(job_id))
        job = table().get_item(Key={"id": job_id})["Item"]
        self.assertEqual(job["status"], "FAILED")
        self.assertEqual(job["error"], "Invalid target data")

    def test_unknown_task_is_rejected_before_any_aws_write(self):
        status, _ = self.call("/jobs", {"csv": "x,y\n1,2\n2,3", "target": "y", "task": "unknown"})
        self.assertEqual(status, 400)
        self.assertEqual(table().scan()["Count"], 0)
        self.assertEqual(client("s3").list_objects_v2(Bucket="automl-test")["KeyCount"], 0)

    def test_mixed_tasks_train_deploy_and_predict_through_matching_strategy(self):
        factory = TaskFactory()
        strategies = {name: FileTask(name) for name in ("classification", "regression")}
        for name, strategy in strategies.items():
            factory.register(name, lambda strategy=strategy: strategy)
        trainer = TrainingService(runtime.repository(), runtime.artifacts(), factory)
        deployments = {}
        for name in strategies:
            status, submitted = self.call("/jobs", {"csv": "x,y\n1,2\n2,4", "target": "y", "task": name})
            self.assertEqual(status, 202)
            self.assertTrue(trainer.process(submitted["job_id"]))
            job = table().get_item(Key={"id": submitted["job_id"]})["Item"]
            self.assertEqual(job["status"], "COMPLETED")
            self.assertNotIn("lease_owner", job)
            status, deployment = self.call("/deploy", {"job_id": submitted["job_id"]})
            self.assertEqual(status, 201)
            self.assertEqual(deployment["task"], name)
            deployments[name] = deployment["deployment_id"]
        with tempfile.TemporaryDirectory() as folder:
            cache = ModelCache(runtime.artifacts(), Path(folder) / "cache")
            service = PredictionService(runtime.repository(), factory, cache)
            for name in ("classification", "classification", "regression", "classification"):
                self.assertEqual(service.predict(deployments[name], {"rows": [{"x": 1}]}),
                                 {"predictions": [name]})
            self.assertEqual(strategies["classification"].loads, 2)
            self.assertEqual(strategies["regression"].loads, 1)

    def test_expired_worker_cannot_overwrite_new_attempt(self):
        job_id = self.submit()
        repository = runtime.repository()
        self.assertTrue(repository.claim(job_id, "old-worker", 1))
        self.assertTrue(repository.claim(job_id, "new-worker", int(time.time())))
        self.assertFalse(repository.finish(job_id, "old-worker", model_key="stale.zip"))
        self.assertFalse(repository.finish(job_id, "old-worker", error="stale error"))
        self.assertTrue(repository.finish(job_id, "new-worker", model_key="winner.zip"))
        self.assertEqual(repository.get_job(job_id)["model_key"], "winner.zip")

    def test_legacy_job_and_deployment_default_to_tabular(self):
        table().put_item(Item={"id": "legacy", "status": "COMPLETED", "model_key": "old.zip"})
        status, deployment = self.call("/deploy", {"job_id": "legacy"})
        self.assertEqual(status, 201)
        self.assertEqual(deployment["task"], "tabular")
        table().put_item(Item={"id": "deploy#old", "model_key": "old.zip"})
        factory, cache = MagicMock(), MagicMock()
        PredictionService(runtime.repository(), factory, cache).predict("old", {"rows": [{"x": 1}]})
        factory.create.assert_called_once_with("tabular")


if __name__ == "__main__":
    unittest.main()
