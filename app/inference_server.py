"""Private EC2 HTTP adapter; the deployment key is checked by PredictionService."""
import logging
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app import predict
from app.http import response

# ModelCache replaces its on-disk artifact when switching deployments. Keep
# inference serialized and reject excess traffic instead of racing that cache.
prediction_lock = threading.Lock()
MAX_BODY_BYTES = 1_000_000


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def reply(self, result):
        data = result["body"].encode()
        self.send_response(result["statusCode"])
        for key, value in result["headers"].items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(response(200, {"status": "ready"}) if self.path == "/health"
                   else response(404, {"error": "Not found"}))

    def do_POST(self):
        if not re.fullmatch(r"/predict/[a-f0-9]{32}", self.path):
            self.reply(response(404, {"error": "Not found"}))
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY_BYTES:
                self.reply(response(413, {"error": "Prediction body exceeds 1 MB or is empty"}))
                return
            raw = self.rfile.read(length).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            self.reply(response(400, {"error": "Invalid request body"}))
            return
        if not prediction_lock.acquire(blocking=False):
            self.reply(response(429, {"error": "Inference is busy; retry shortly"}))
            return
        try:
            result = predict.handler({"httpMethod": "POST", "path": self.path,
                                      "headers": dict(self.headers), "body": raw}, None)
        finally:
            prediction_lock.release()
        self.reply(result)

    def log_message(self, fmt, *args):
        # Request paths/status only; never log bodies or deployment credentials.
        logging.info(fmt, *args)


def main():
    if os.getenv("INFERENCE_URL"):
        raise RuntimeError("INFERENCE_URL is for the Lambda proxy, not the inference server")
    logging.basicConfig(level=logging.INFO)
    # Load native dependencies before the health check reports readiness.
    from autogluon.tabular import TabularPredictor  # noqa: F401
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()


if __name__ == "__main__":
    main()
