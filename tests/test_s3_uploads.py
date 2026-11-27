import os
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

from app.infrastructure.aws import S3ArtifactStore, client


class UploadEndpointTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {
            "AWS_DEFAULT_REGION": "ap-southeast-2", "AWS_ACCESS_KEY_ID": "test",
            "AWS_SECRET_ACCESS_KEY": "test", "AWS_ENDPOINT_URL": "", "S3_PUBLIC_ENDPOINT": "",
        })
        env.start()
        self.addCleanup(env.stop)
        client.cache_clear()
        self.addCleanup(client.cache_clear)

    def test_cloud_upload_uses_bucket_region(self):
        ticket = S3ArtifactStore(client("s3"), "stratus-test-bucket").presign_upload("data.csv", 1024)
        self.assertEqual(urlparse(ticket["url"]).hostname,
                         "stratus-test-bucket.s3.ap-southeast-2.amazonaws.com")
        self.assertEqual(ticket["fields"]["key"], "data.csv")

    @patch.dict(os.environ, {"S3_PUBLIC_ENDPOINT": "http://localhost:4566"})
    def test_local_upload_preserves_public_endpoint(self):
        ticket = S3ArtifactStore(None, "stratus-test-bucket").presign_upload("data.csv", 1024)
        self.assertEqual(ticket["url"], "http://localhost:4566/stratus-test-bucket")
