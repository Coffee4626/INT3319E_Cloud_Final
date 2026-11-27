"""Tiny deterministic image datasets used by contract and real-runtime smoke tests."""
import io
import json
import zipfile

from PIL import Image, ImageDraw


def png(image):
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def vision_zip(task, count=4):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        if task == "segmentation":
            archive.writestr("classes.json", json.dumps(["background", "object"]))
        for split in ("train", "val"):
            for i in range(count if split == "train" else 2):
                if task == "segmentation":
                    image = Image.new("RGB", (64, 64), (20, 30, 70))
                    mask = Image.new("L", image.size, 0)
                    box = (8 + i, 12, 48 + i, 52)
                    ImageDraw.Draw(image).rectangle(box, fill=(240, 120, 20))
                    ImageDraw.Draw(mask).rectangle(box, fill=1)
                    archive.writestr(f"images/{split}/{i}.png", png(image))
                    archive.writestr(f"masks/{split}/{i}.png", png(mask))
                else:
                    for label, color in (("red", (230, 25 + i, 25)), ("blue", (25, 25 + i, 230))):
                        image = Image.new("RGB", (64, 64), color)
                        ImageDraw.Draw(image).ellipse((10 + i, 15, 40, 45), fill="white")
                        archive.writestr(f"{split}/{label}/{i}.png", png(image))
    return out.getvalue()
