"""Exercise train -> poll -> deploy -> predict against local or AWS API."""
import argparse
import json
import os
import time
from urllib.request import Request, urlopen

base = os.getenv("API_URL", "http://localhost:8000").rstrip("/")


def request(path, payload=None):
    headers = {"Content-Type": "application/json"}
    if os.getenv("API_KEY"):
        headers["x-api-key"] = os.environ["API_KEY"]
    req = Request(base + path, data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
    with urlopen(req, timeout=60) as result:
        return json.load(result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", choices=["tabular", "classification", "regression", "all"], default="regression")
    args = parser.parse_args()
    tasks = ["classification", "regression"] if args.task == "all" else [args.task]
    jobs = []
    # Submit every task first to exercise mixed workloads on the shared queue.
    for task in tasks:
        labels = [("low" if i < 60 else "high") if task == "classification" else 2 * i + i % 3
                  for i in range(120)]
        csv_text = "x,y\n" + "".join(f"{i},{label}\n" for i, label in enumerate(labels))
        job = request("/jobs", {"csv": csv_text, "target": "y", "task": task, "time_limit": 30})
        jobs.append((task, job["job_id"]))
        print(task, "job:", job["job_id"], flush=True)
    deadline = time.monotonic() + 1800  # Allow EC2 boot + first image pull.
    for task, job_id in jobs:
        while time.monotonic() < deadline:
            status = request("/jobs/" + job_id)
            if status["status"] == "FAILED":
                raise SystemExit(status)
            if status["status"] == "COMPLETED":
                break
            time.sleep(10)
        else:
            raise SystemExit("Timed out; inspect worker logs and SQS/DLQ")
        deployment = request("/deploy", {"job_id": job_id})
        result = request(deployment["predict_path"], {"rows": [{"x": 12}, {"x": 95}]})
        assert len(result["predictions"]) == 2, result
        if task == "classification":
            assert all(value in ("low", "high") for value in result["predictions"]), result
        else:
            assert all(isinstance(value, (int, float)) for value in result["predictions"]), result
        print(task, "deployment:", deployment["deployment_id"], result, flush=True)
