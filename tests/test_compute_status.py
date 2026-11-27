import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import yaml


class ComputeStatusTests(unittest.TestCase):
    def setUp(self):
        template = yaml.load(Path("infra/template.yaml").read_text(), Loader=yaml.BaseLoader)
        self.namespace = {}
        exec(template["Resources"]["ComputeStatus"]["Properties"]["InlineCode"], self.namespace)
        self.event = {"requestContext": {"authorizer": {"claims": {"sub": "invited-user"}}}}
        self.env = patch.dict(os.environ, {"ALLOWED_ORIGIN": "https://studio.test", "WORKER_GROUP": "workers", "QUEUE_URL": "queue"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_anonymous_request_never_reads_aws(self):
        with patch("boto3.client") as client:
            self.assertEqual(self.namespace["handler"]({}, None)["statusCode"], 401)
            client.assert_not_called()

    def test_live_counts_distinguish_starting_and_in_service_without_instance_details(self):
        scaling, sqs = Mock(), Mock()
        scaling.describe_auto_scaling_groups.return_value = {"AutoScalingGroups": [{
            "DesiredCapacity": 2, "MaxSize": 3,
            "Instances": [{"LifecycleState": "Pending", "InstanceId": "private-id"}, {"LifecycleState": "InService"}]}]}
        sqs.get_queue_attributes.return_value = {"Attributes": {
            "ApproximateNumberOfMessages": "4", "ApproximateNumberOfMessagesNotVisible": "1"}}
        with patch("boto3.client", side_effect=[scaling, sqs]):
            result = self.namespace["handler"](self.event, None)
        data = json.loads(result["body"])
        self.assertEqual(data["workers"]["starting"], 1)
        self.assertEqual(data["workers"]["in_service"], 1)
        self.assertEqual(data["queue"], {"waiting": 4, "processing": 1})
        self.assertNotIn("private-id", result["body"])
        self.assertEqual(result["headers"]["Cache-Control"], "no-store")

    def test_unavailable_monitoring_does_not_report_zero_workers(self):
        with patch("boto3.client", side_effect=RuntimeError("unavailable")), self.assertLogs(level="ERROR"):
            result = self.namespace["handler"](self.event, None)
        self.assertEqual(result["statusCode"], 503)
        self.assertNotIn("workers", json.loads(result["body"]))
