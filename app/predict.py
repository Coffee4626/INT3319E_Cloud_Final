from app import runtime
from app.http import api, body, response


@api
def handler(event, context):
    deployment_id = event["path"].rstrip("/").split("/")[-1]
    return response(200, runtime.prediction_service().predict(deployment_id, body(event)))
