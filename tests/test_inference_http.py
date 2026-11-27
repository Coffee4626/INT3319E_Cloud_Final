import base64
import json
import os
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

from app.http import response
from app.inference_proxy import forward
from app.inference_server import Handler, prediction_lock


class InferenceHttpTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.env = patch.dict(os.environ, {"INFERENCE_URL": self.url})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.close_server)
        self.path = "/predict/" + "a" * 32

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def event(self, key="valid"):
        return {"path": self.path, "headers": {"X-Api-Key": key},
                "body": json.dumps({"rows": [{"x": 12}]})}

    def test_proxy_preserves_payload_credentials_and_rejection(self):
        def backend(event, _):
            self.assertEqual(event["path"], self.path)
            self.assertEqual(json.loads(event["body"]), {"rows": [{"x": 12}]})
            if event["headers"].get("X-Api-Key") != "valid":
                return response(401, {"error": "Invalid deployment API key"})
            return response(200, {"predictions": ["low"]})

        with patch("app.inference_server.predict.handler", side_effect=backend):
            event = self.event()
            event["body"] = base64.b64encode(event["body"].encode()).decode()
            event["isBase64Encoded"] = True
            result = forward(event)
            self.assertEqual(result["statusCode"], 200)
            self.assertEqual(json.loads(result["body"])["predictions"], ["low"])
            rejected = forward(self.event("wrong"))
            self.assertEqual(rejected["statusCode"], 401)

    def test_busy_model_cache_rejects_concurrent_requests(self):
        prediction_lock.acquire()
        try:
            result = forward(self.event())
            self.assertEqual(result["statusCode"], 429)
        finally:
            prediction_lock.release()

    def test_server_exposes_no_management_routes_and_limits_body(self):
        for path, headers, expected in [
            ("/jobs", {}, 404),
            (self.path, {"Content-Length": "1000001"}, 413),
        ]:
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(self.url + path, data=b"{}", headers=headers), timeout=3)
            self.assertEqual(caught.exception.code, expected)
        with urlopen(self.url + "/health", timeout=3) as result:
            self.assertEqual(json.load(result), {"status": "ready"})

    @patch("app.inference_proxy.urlopen", side_effect=URLError("connection refused"))
    def test_proxy_reports_unavailable_host_without_internal_details(self, _):
        result = forward(self.event())
        self.assertEqual(result["statusCode"], 503)
        self.assertNotIn("connection refused", result["body"])
