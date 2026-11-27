"""Image dataset contracts shared by upload validation and training. No torch imports."""
import base64
import binascii
import io
import json
import zipfile
from pathlib import PurePosixPath

from PIL import Image, UnidentifiedImageError

VISION_TASKS = {"image-classification", "segmentation"}
MAX_ZIP_BYTES = 50_000_000
MAX_EXPANDED_BYTES = 200_000_000
MAX_IMAGE_PIXELS = 16_000_000
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MODELS = {"image-classification": {"mobilenet-v3", "resnet18"},
          "segmentation": {"unet", "deeplab-mobile"}}


def training_config(task, values):
    if not isinstance(values, dict):
        raise ValueError("config must be an object")
    defaults = {"model": "mobilenet-v3" if task == "image-classification" else "unet",
                "epochs": 5, "batch_size": 4, "learning_rate": 0.001,
                "image_size": 128, "augment": True, "early_stopping": True}
    if set(values) - set(defaults):
        raise ValueError("Unknown image training setting")
    result = {**defaults, **values}
    if not isinstance(result["model"], str) or result["model"] not in MODELS[task]:
        raise ValueError("Unsupported model for this image task")
    for name, low, high in (("epochs", 1, 100), ("batch_size", 1, 16), ("image_size", 64, 256)):
        if type(result[name]) is not int or not low <= result[name] <= high:
            raise ValueError(f"{name} must be an integer from {low} to {high}")
    if result["image_size"] % 32:
        raise ValueError("image_size must be a multiple of 32")
    rate = result["learning_rate"]
    if type(rate) not in (int, float) or not 0.00001 <= rate <= 0.01:
        raise ValueError("learning_rate must be between 0.00001 and 0.01")
    for name in ("augment", "early_stopping"):
        if type(result[name]) is not bool:
            raise ValueError(f"{name} must be a boolean")
    return result


def open_image(data):
    try:
        image = Image.open(io.BytesIO(data))
        if image.format not in ("JPEG", "PNG", "WEBP") or image.width * image.height > MAX_IMAGE_PIXELS:
            raise ValueError("Use JPEG, PNG or WebP images up to 16 megapixels")
        if min(image.size) < 8:
            raise ValueError("Images must be at least 8 × 8 pixels")
        if getattr(image, "n_frames", 1) != 1:
            raise ValueError("Animated images are not supported")
        return image
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ValueError("Invalid image file") from exc


def decode_prediction(payload):
    encoded = payload.get("image_base64")
    if not isinstance(encoded, str) or not 1 <= len(encoded) <= 900_000:
        raise ValueError("image_base64 must contain a JPEG, PNG or WebP up to 675 KB")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("image_base64 is not valid base64") from exc
    try:
        with open_image(data) as source:
            # Keep inference output and its JSON response bounded.
            source.thumbnail((1024, 1024))
            return source.convert("RGB")
    except OSError as exc:
        raise ValueError("Cannot decode image") from exc


def inspect_archive(path, task):
    if task not in VISION_TASKS:
        raise ValueError("Unsupported image task")
    if path.stat().st_size > MAX_ZIP_BYTES:
        raise ValueError("Image ZIP limit: 50 MB")
    try:
        return _inspect(path, task)
    except (zipfile.BadZipFile, RuntimeError, OSError, UnicodeError, SyntaxError) as exc:
        raise ValueError("Invalid or unreadable image ZIP") from exc


def _inspect(path, task):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 5000 or sum(e.file_size for e in entries) > MAX_EXPANDED_BYTES:
            raise ValueError("ZIP limit: 5,000 entries and 200 MB after extraction")
        names = set()
        for entry in entries:
            p = PurePosixPath(entry.filename)
            if (p.is_absolute() or ".." in p.parts or "\\" in entry.filename
                    or not p.parts or entry.flag_bits & 1
                    or (entry.external_attr >> 16) & 0o170000 == 0o120000
                    or entry.filename in names or entry.file_size > 5_000_000):
                raise ValueError("ZIP contains unsafe, duplicate, encrypted or oversized files")
            names.add(entry.filename)
        files = {e.filename for e in entries if not e.is_dir()
                 and not e.filename.startswith("__MACOSX/") and not PurePosixPath(e.filename).name.startswith(".")}
        samples = {"train": [], "val": []}
        if task == "image-classification":
            for name in sorted(files):
                p = PurePosixPath(name)
                if p.suffix.lower() not in EXTENSIONS or len(p.parts) != 3 or p.parts[0] not in samples:
                    raise ValueError("Classification ZIP requires train/<class>/<image> and val/<class>/<image>")
                samples[p.parts[0]].append({"image": name, "label": p.parts[1]})
            labels = sorted({s["label"] for s in samples["train"]})
            if not 2 <= len(labels) <= 100 or any(len(label) > 100 for label in labels):
                raise ValueError("Classification requires 2–100 classes with names up to 100 characters")
            if set(labels) != {s["label"] for s in samples["val"]}:
                raise ValueError("Every class must appear in both train and val")
            for split in samples.values():
                for sample in split:
                    sample["label"] = labels.index(sample["label"])
        else:
            if "classes.json" not in files:
                raise ValueError('Segmentation requires classes.json, e.g. ["background", "object"]')
            try:
                labels = json.loads(archive.read("classes.json"))
            except (ValueError, UnicodeError) as exc:
                raise ValueError("Invalid classes.json") from exc
            if (not isinstance(labels, list) or not 2 <= len(labels) <= 32
                    or any(not isinstance(x, str) or not x.strip() or len(x) > 100 for x in labels)
                    or len(set(labels)) != len(labels)):
                raise ValueError("classes.json must contain 2–32 unique class names; list index is pixel ID")
            expected = {"classes.json"}
            for name in sorted(files):
                p = PurePosixPath(name)
                if len(p.parts) == 3 and p.parts[0] == "images" and p.parts[1] in samples and p.suffix.lower() in EXTENSIONS:
                    mask = f"masks/{p.parts[1]}/{p.stem}.png"
                    if mask not in files or mask in expected:
                        raise ValueError("Each image requires a unique matching masks/<split>/<stem>.png")
                    expected.update((name, mask))
                    samples[p.parts[1]].append({"image": name, "mask": mask})
            if expected != files:
                raise ValueError("Use images/train, images/val and matching masks/train, masks/val only")
        if not samples["train"] or not samples["val"]:
            raise ValueError("Both train and val must contain images")
        pixels = 0
        for sample in samples["train"] + samples["val"]:
            with open_image(archive.read(sample["image"])) as image:
                size = image.size
                pixels += image.width * image.height
                if pixels > 150_000_000:
                    raise ValueError("Dataset limit: 150 megapixels in total; resize images before uploading")
                image.verify()
            if "mask" in sample:
                with open_image(archive.read(sample["mask"])) as mask:
                    if mask.format != "PNG" or mask.mode not in ("L", "P") or mask.size != size:
                        raise ValueError("Masks must be 8-bit grayscale/palette PNGs matching image dimensions")
                    colors = mask.getcolors(256) or []
                    if not colors or any(value != 255 and value >= len(labels) for _, value in colors):
                        raise ValueError("Mask pixels must be class IDs 0..N-1, or 255 (ignored)")
                    if all(value == 255 for _, value in colors):
                        raise ValueError("A mask must include at least one labeled pixel")
        return {"rows": sum(map(len, samples.values())), "columns": [], "preview": [],
                "missing_cells": 0, "duplicates": 0, "size_bytes": path.stat().st_size,
                "format": "image-zip", "task": task, "classes": labels,
                "splits": {k: len(v) for k, v in samples.items()}, "samples": samples}


def public_profile(info):
    return {k: v for k, v in info.items() if k != "samples"}
