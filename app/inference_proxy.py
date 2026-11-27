"""Small Lambda bridge to the private EC2 inference service."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from app.http import body, response


def forward(event):
    deployment_id = event["path"].rstrip("/").split("/")[-1]
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    request = Request(os.environ["INFERENCE_URL"].rstrip("/") + "/predict/" + quote(deployment_id, safe=""),
                      data=json.dumps(body(event)).encode(), method="POST",
                      headers={"Content-Type": "application/json", "X-Api-Key": headers.get("x-api-key", "")})
    try:
        with urlopen(request, timeout=25) as result:
            return response(result.status, json.load(result))
    except HTTPError as exc:
        return response(exc.code, json.loads(exc.read()))
    except (URLError, TimeoutError, OSError):
        return response(503, {"error": "Inference is temporarily unavailable; retry shortly"})
