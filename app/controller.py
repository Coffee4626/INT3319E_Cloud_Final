from app import runtime
from app.http import api, body, response


@api
def handler(event, context):
    method, path = event["httpMethod"], event["path"]
    service = runtime.job_service()
    if method == "GET" and path.startswith("/jobs/"):
        return response(200, service.get(path.split("/")[-1]))
    if method == "POST" and path == "/jobs":
        return response(202, service.submit(body(event)))
    if method == "POST" and path == "/deploy":
        return response(201, service.deploy(body(event).get("job_id")))
    return response(404, {"error": "Route not found"})
