import base64
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

from app.vision_data import inspect_archive, decode_prediction, training_config
from vision_fixtures import vision_zip, png


class VisionContracts(unittest.TestCase):
    def test_archive_above_200_mb_is_rejected_before_opening(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "large.zip"
            with path.open("wb") as stream:
                stream.truncate(200_000_001)
            with self.assertRaisesRegex(ValueError, "200 MB"):
                inspect_archive(path, "image-classification")

    def inspect(self, data, task="segmentation"):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "data.zip"
            path.write_bytes(data)
            return inspect_archive(path, task)

    def rewrite(self, data, replacements):
        out = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as old, zipfile.ZipFile(out, "w") as new:
            for name in old.namelist():
                if name not in replacements:
                    new.writestr(name, old.read(name))
            for name, value in replacements.items():
                if value is not None:
                    new.writestr(name, value)
        return out.getvalue()

    def test_real_images_and_masks_have_distinct_training_and_validation_splits(self):
        for task in ("image-classification", "segmentation"):
            info = self.inspect(vision_zip(task), task)
            self.assertEqual(len(info["classes"]), 2)
            self.assertGreater(info["splits"]["train"], 0)
            self.assertGreater(info["splits"]["val"], 0)
            self.assertFalse(set(s["image"] for s in info["samples"]["train"]) &
                             set(s["image"] for s in info["samples"]["val"]))

    def test_missing_wrong_size_rgb_and_out_of_range_masks_rejected(self):
        data = vision_zip("segmentation")
        for value in (None, png(Image.new("L", (32, 32))), png(Image.new("RGB", (64, 64))),
                      png(Image.new("L", (64, 64), 4)), png(Image.new("L", (64, 64), 255))):
            with self.subTest(value=bool(value)), self.assertRaises(ValueError):
                self.inspect(self.rewrite(data, {"masks/train/0.png": value}))

    def test_bad_classes_and_invalid_images_rejected(self):
        data = vision_zip("segmentation")
        for value in ("bad JSON", json.dumps(["x", "x"]), json.dumps({"0": "x"})):
            with self.assertRaises(ValueError):
                self.inspect(self.rewrite(data, {"classes.json": value}))
        with self.assertRaises(ValueError):
            self.inspect(self.rewrite(data, {"images/train/0.png": b"not an image"}))

    def test_path_traversal_symlinks_duplicate_entries_and_zip_bombs_rejected(self):
        data = vision_zip("segmentation")
        with self.assertRaises(ValueError):
            self.inspect(self.rewrite(data, {"../outside": b"bad"}))
        for malicious in (zipfile.ZipInfo("link"), zipfile.ZipInfo("huge")):
            out = io.BytesIO()
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
                if malicious.filename == "link":
                    malicious.external_attr = 0o120777 << 16
                    archive.writestr(malicious, b"/etc/passwd")
                else:
                    archive.writestr(malicious, b"0" * 5_000_001)
            with self.assertRaises(ValueError):
                self.inspect(out.getvalue())

    def test_classification_requires_each_class_in_validation(self):
        data = vision_zip("image-classification")
        data = self.rewrite(data, {"val/blue/0.png": None, "val/blue/1.png": None})
        with self.assertRaises(ValueError):
            self.inspect(data, "image-classification")

    def test_prediction_rejects_urls_malformed_or_oversized_payloads(self):
        for payload in ({"url": "http://169.254.169.254/"}, {"image_base64": "??"},
                        {"image_base64": "A" * 900_001}, {"image_base64": base64.b64encode(b"bad").decode()}):
            with self.assertRaises(ValueError):
                decode_prediction(payload)
        encoded = base64.b64encode(png(Image.new("RGB", (2000, 1000)))).decode()
        result = decode_prediction({"image_base64": encoded})
        self.assertEqual(result.size, (1024, 512))

    def test_config_rejects_unbounded_or_unknown_models_and_nonfinite_rates(self):
        for config in ({"model": "../../code"}, {"epochs": 0}, {"batch_size": 500},
                       {"image_size": 65}, {"learning_rate": float("nan")}, {"augment": "true"},
                       {"learning_rate": True}, {"shell": "command"}):
            with self.assertRaises(ValueError):
                training_config("image-classification", config)
