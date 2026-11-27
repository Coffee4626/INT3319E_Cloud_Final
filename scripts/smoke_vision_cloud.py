"""Authenticated end-to-end image smoke through the deployed API and AWS workers.

Set API_URL and ID_TOKEN. Creates four small training jobs and endpoints (incurs compute).
Does not print tokens, deployment keys or encoded images.
"""
import base64
import io
import json
import math
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from PIL import Image
from vision_fixtures import vision_zip, png
from smoke import request


def upload_zip(task):
    ticket = request("/uploads", {"name": f"verify-{task}.zip", "task": task})
    boundary = "stratus" + uuid.uuid4().hex
    chunks = [f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
              for key, value in ticket["upload"]["fields"].items()]
    chunks.extend((f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="images.zip"\r\nContent-Type: application/zip\r\n\r\n'.encode(),
                   vision_zip(task), f'\r\n--{boundary}--\r\n'.encode()))
    req = Request(ticket["upload"]["url"], data=b"".join(chunks),
                  headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    with urlopen(req, timeout=60) as result:
        assert result.status in (200, 201, 204)
    complete = request(f'/datasets/{ticket["dataset_id"]}/complete', {})
    assert complete["profile"]["format"] == "image-zip"
    return request(f'/datasets/{ticket["dataset_id"]}/preprocess', {})


def main():
    initial = {j["id"] for j in request("/jobs")["items"]}
    datasets = {task: upload_zip(task) for task in ("image-classification", "segmentation")}
    assert {j["id"] for j in request("/jobs")["items"]} == initial
    print("Upload/validate/preprocess both image tasks: PASS; no jobs created", flush=True)
    jobs = []
    for task, model in (("image-classification", "mobilenet-v3"), ("image-classification", "resnet18"),
                        ("segmentation", "unet"), ("segmentation", "deeplab-mobile")):
        payload = {"dataset_id": datasets[task]["dataset_id"], "task": task, "name": f"Verification {model}",
                   "time_limit": 30, "submission_id": str(uuid.uuid4()),
                   "config": {"model": model, "epochs": 2, "batch_size": 2, "image_size": 64}}
        job = request("/jobs", payload)
        again = request("/jobs", payload)
        assert again["job_id"] == job["job_id"]
        jobs.append((task, model, job["job_id"]))
        print(model, "queued:", job["job_id"], flush=True)
    records = []
    deadline = time.monotonic() + int(os.getenv("SMOKE_TIMEOUT", "1800"))
    for task, model, job_id in jobs:
        last = None
        while time.monotonic() < deadline:
            job = request("/jobs/" + job_id)
            if job["status"] != last:
                print(model, job["status"], flush=True)
                last = job["status"]
            if job["status"] == "FAILED":
                raise RuntimeError(job.get("error"))
            if job["status"] == "COMPLETED":
                break
            time.sleep(5)
        else:
            raise RuntimeError("Timed out waiting for image workers")
        metrics = job["metrics"]
        assert metrics["evaluation"]["method"] == "provided_validation"
        assert metrics["evaluation"]["test_rows"] == 0
        assert all(math.isfinite(v) for v in metrics["evaluation"]["scores"].values())
        assert metrics["learning_curves"][metrics["best_model"]]
        deployment = request("/deploy", {"job_id": job_id})
        payload = {"image_base64": base64.b64encode(png(Image.new("RGB", (80, 48), (230, 25, 25)))).decode()}
        latencies, result = [], None
        for _ in range(2):
            start = time.monotonic()
            value = request(deployment["predict_path"], payload, key=deployment["api_key"])
            latencies.append(round((time.monotonic() - start) * 1000))
            if result is not None:
                assert value == result
            result = value
        if task == "segmentation":
            mask = Image.open(io.BytesIO(base64.b64decode(result["mask_base64"])))
            assert mask.size == (80, 48)
            assert {v for _, v in mask.getcolors()} <= {0, 1}
            assert abs(sum(c["coverage"] for c in result["classes"]) - 1) < 1e-6
        else:
            assert result["label"] in ("red", "blue")
            assert abs(sum(p["score"] for p in result["probabilities"]) - 1) < 1e-5
        for invalid, key, status in ((payload, "invalid-key", "401"), ({"image_base64": "bad"}, deployment["api_key"], "400")):
            try:
                request(deployment["predict_path"], invalid, key=key)
            except RuntimeError as exc:
                assert str(exc).startswith(status), str(exc)
            else:
                raise AssertionError("Invalid input or key was accepted")
        record = {"model": model, "task": task, "job_id": job_id,
                  "deployment_id": deployment["deployment_id"], "scores": metrics["evaluation"]["scores"],
                  "first_warm_ms": latencies, "epochs": metrics["epochs_completed"]}
        records.append(record)
        print(json.dumps(record), flush=True)
        print(model, "train/evaluate/deploy/cold+warm inference/invalid key/invalid image: PASS", flush=True)
    if os.getenv("SMOKE_RESULT"):
        Path(os.environ["SMOKE_RESULT"]).write_text(json.dumps(records, indent=2))


if __name__ == "__main__":
    main()
