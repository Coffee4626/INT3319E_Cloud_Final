"""Lambda proxy request/response translation."""
import base64
import json
import logging
from decimal import Decimal
from functools import wraps

from app.domain import ConflictError, NotFoundError


def body(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Body must be a JSON object")
    return value


def response(status, value):
    return {"statusCode": status, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(value, default=lambda v: float(v) if isinstance(v, Decimal) else str(v))}


def api(fn):
    @wraps(fn)
    def wrapped(event, context):
        try:
            return fn(event, context)
        except NotFoundError as exc:
            return response(404, {"error": str(exc)})
        except ConflictError as exc:
            return response(409, {"error": str(exc)})
        except ValueError as exc:
            return response(400, {"error": str(exc)})
        except Exception:
            logging.exception("Request failed")
            return response(500, {"error": "Internal error; check CloudWatch logs"})
    return wrapped
