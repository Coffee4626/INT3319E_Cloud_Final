#!/usr/bin/env python3
"""Run inside the production Docker image: actual CPU fit, save, load and inference."""
import base64
import io
import json
import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from PIL import Image
from vision_fixtures import vision_zip, png
from app.tasks.factory import default_factory


def main():
    for task_name, model_id in (("image-classification", "mobilenet-v3"),
                               ("image-classification", "resnet18"),
                               ("segmentation", "unet"), ("segmentation", "deeplab-mobile")):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            dataset, output = root / "images.zip", root / "model"
            dataset.write_bytes(vision_zip(task_name))
            task = default_factory().create(task_name)
            metrics = task.train(dataset, output, {"time_limit": 30, "config": {
                "model": model_id, "epochs": 2, "batch_size": 2, "image_size": 64}})
            assert metrics["evaluation"]["method"] == "provided_validation"
            assert metrics["evaluation"]["test_rows"] == 0
            assert all(math.isfinite(v) for v in metrics["evaluation"]["scores"].values())
            assert len(metrics["learning_curves"][metrics["best_model"]]) >= 1
            model = task.load(output)
            image = Image.new("RGB", (80, 48), (230, 25, 25))
            prediction = task.predict(model, task.validate_prediction({"image_base64": base64.b64encode(png(image)).decode()}))
            if task_name == "image-classification":
                assert prediction["label"] in ("red", "blue")
                assert abs(sum(p["score"] for p in prediction["probabilities"]) - 1) < 1e-5
            else:
                mask = Image.open(io.BytesIO(base64.b64decode(prediction["mask_base64"])))
                assert mask.size == (80, 48)
                assert {value for _, value in mask.getcolors()} <= {0, 1}
                assert abs(sum(c["coverage"] for c in prediction["classes"]) - 1) < 1e-5
            print(json.dumps({"task": task_name, "model": model_id, "scores": metrics["evaluation"]["scores"],
                              "epochs": metrics["epochs_completed"], "artifact_bytes": (output / "weights.pt").stat().st_size,
                              "inference": "passed"}), flush=True)


if __name__ == "__main__":
    main()
