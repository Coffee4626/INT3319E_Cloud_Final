"""CPU image training and inference, with reproducible splits and real epoch metrics."""
import base64
import io
import json
import random
import time
import zipfile

from PIL import Image

from app.tasks.base import MLTask
from app.vision_data import decode_prediction, inspect_archive, training_config, open_image

MODEL_NAMES = {"mobilenet-v3": "MobileNet V3 Small", "resnet18": "ResNet-18",
               "unet": "U-Net Small", "deeplab-mobile": "DeepLabV3 MobileNet"}
PALETTE = [(59, 130, 246), (249, 115, 22), (16, 185, 129), (168, 85, 247),
           (236, 72, 153), (234, 179, 8), (6, 182, 212), (99, 102, 241)]


def build_model(model_id, classes, pretrained=False):
    import torch
    from torch import nn
    from torchvision import models

    if model_id == "mobilenet-v3":
        model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT if pretrained else None)
        for parameter in model.features.parameters():
            parameter.requires_grad_(False)
        model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, classes)
    elif model_id == "resnet18":
        model = models.resnet18(weights=models.ResNet18_Weights.DEFAULT if pretrained else None)
        for parameter in model.parameters():
            parameter.requires_grad_(False)
        model.fc = nn.Linear(model.fc.in_features, classes)
    elif model_id == "deeplab-mobile":
        weights = models.segmentation.DeepLabV3_MobileNet_V3_Large_Weights.DEFAULT if pretrained else None
        model = models.segmentation.deeplabv3_mobilenet_v3_large(weights=weights, weights_backbone=None)
        model.aux_classifier = None
        for parameter in model.backbone.parameters():
            parameter.requires_grad_(False)
        model.classifier[-1] = nn.Conv2d(256, classes, 1)
    elif model_id == "unet":
        def block(a, b):
            return nn.Sequential(nn.Conv2d(a, b, 3, padding=1), nn.GroupNorm(4, b), nn.ReLU(),
                                 nn.Conv2d(b, b, 3, padding=1), nn.GroupNorm(4, b), nn.ReLU())

        class SmallUNet(nn.Module):
            def __init__(self):
                super().__init__()
                self.enc1, self.enc2, self.bridge = block(3, 16), block(16, 32), block(32, 64)
                self.dec2, self.dec1, self.out = block(96, 32), block(48, 16), nn.Conv2d(16, classes, 1)

            def forward(self, x):
                a = self.enc1(x)
                b = self.enc2(nn.functional.max_pool2d(a, 2))
                c = self.bridge(nn.functional.max_pool2d(b, 2))
                d = self.dec2(torch.cat((nn.functional.interpolate(c, size=b.shape[-2:], mode="bilinear", align_corners=False), b), 1))
                e = self.dec1(torch.cat((nn.functional.interpolate(d, size=a.shape[-2:], mode="bilinear", align_corners=False), a), 1))
                return self.out(e)

        model = SmallUNet()
    else:
        raise ValueError("Unknown image model")
    return model


def image_tensor(image, size):
    from torchvision.transforms import functional as F
    image = image.convert("RGB").resize((size, size), Image.Resampling.BILINEAR)
    return F.normalize(F.to_tensor(image), [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])


def logits(model, images):
    output = model(images)
    return output["out"] if isinstance(output, dict) else output


def scores_from_matrix(matrix, segmentation):
    import torch
    matrix = matrix.double()
    tp = matrix.diag()
    total = matrix.sum().clamp(min=1)
    accuracy = float(tp.sum() / total)
    union = matrix.sum(1) + matrix.sum(0) - tp
    present = union > 0
    if segmentation:
        return {"pixel_accuracy": accuracy, "miou": float((tp[present] / union[present]).mean()),
                "dice": float((2 * tp[present] / (matrix.sum(1) + matrix.sum(0))[present]).mean())}
    f1 = 2 * tp / (matrix.sum(1) + matrix.sum(0)).clamp(min=1)
    return {"accuracy": accuracy, "f1_macro": float(torch.mean(f1))}


class VisionTask(MLTask):
    task_name = "image-classification"

    def validate_training(self, request):
        training_config(self.task_name, request.config)

    def validate_prediction(self, payload):
        return decode_prediction(payload)

    def train(self, dataset, model_dir, job):
        import torch
        import numpy as np
        from torch import nn
        from torch.utils.data import DataLoader, Dataset

        torch.set_num_threads(2)
        torch.manual_seed(42)
        random.seed(42)
        np.random.seed(42)
        config = json.loads(json.dumps(job.get("config", {}), default=lambda v: int(v) if v == int(v) else float(v)))
        config = training_config(self.task_name, config)
        info = inspect_archive(dataset, self.task_name)
        classes, size = info["classes"], config["image_size"]
        segmentation = self.task_name == "segmentation"
        archive = zipfile.ZipFile(dataset)

        class Images(Dataset):
            def __init__(self, split):
                self.samples, self.training = info["samples"][split], split == "train"

            def __len__(self):
                return len(self.samples)

            def __getitem__(self, index):
                sample = self.samples[index]
                with open_image(archive.read(sample["image"])) as source:
                    image = source.convert("RGB")
                if segmentation:
                    with open_image(archive.read(sample["mask"])) as source:
                        mask = source.resize((size, size), Image.Resampling.NEAREST)
                        target = torch.from_numpy(np.array(mask, dtype=np.int64))
                else:
                    target = torch.tensor(sample["label"], dtype=torch.long)
                image = image_tensor(image, size)
                if self.training and config["augment"] and random.random() < 0.5:
                    image = image.flip(-1)
                    if segmentation:
                        target = target.flip(-1)
                return image, target

        train_loader = DataLoader(Images("train"), batch_size=config["batch_size"], shuffle=True, num_workers=0)
        val_loader = DataLoader(Images("val"), batch_size=config["batch_size"], num_workers=0)
        model = build_model(config["model"], len(classes), pretrained=True)
        optimizer = torch.optim.Adam((p for p in model.parameters() if p.requires_grad), lr=config["learning_rate"])
        criterion = nn.CrossEntropyLoss(ignore_index=255)
        model_dir.mkdir(parents=True, exist_ok=True)
        curves, best_loss, stale, best_matrix, best_prediction_time = [], float("inf"), 0, None, 0.0
        start = time.monotonic()
        deadline = start + int(job["time_limit"])
        stop_reason = "epochs_completed"
        try:
            for epoch in range(1, config["epochs"] + 1):
                model.train()
                # Frozen pretrained encoders and batch-size 1 must not update BatchNorm statistics.
                for module in model.modules():
                    if isinstance(module, nn.modules.batchnorm._BatchNorm):
                        module.eval()
                train_loss, count = 0.0, 0
                for images, targets in train_loader:
                    if segmentation and not (targets != 255).any():
                        continue
                    optimizer.zero_grad(set_to_none=True)
                    loss = criterion(logits(model, images), targets)
                    if not torch.isfinite(loss):
                        raise ValueError("Non-finite training loss; check image masks and learning rate")
                    loss.backward()
                    optimizer.step()
                    train_loss += float(loss.detach()) * len(images)
                    count += len(images)
                    if time.monotonic() >= deadline:
                        stop_reason = "time_limit"
                        break
                if not count:
                    raise ValueError("No labeled pixels remain after resizing; increase image_size")
                model.eval()
                validation_started = time.monotonic()
                validation_loss, val_count = 0.0, 0
                matrix = torch.zeros((len(classes), len(classes)), dtype=torch.int64)
                with torch.inference_mode():
                    for images, targets in val_loader:
                        if segmentation and not (targets != 255).any():
                            continue
                        output = logits(model, images)
                        loss = criterion(output, targets)
                        validation_loss += float(loss) * len(images)
                        val_count += len(images)
                        truth, predicted = targets.flatten(), output.argmax(1).flatten()
                        valid = truth != 255
                        matrix += torch.bincount(truth[valid] * len(classes) + predicted[valid],
                                                 minlength=len(classes) ** 2).reshape(len(classes), len(classes))
                if not val_count or not matrix.sum():
                    raise ValueError("Validation split has no labeled samples after resizing")
                validation_loss /= val_count
                validation_elapsed = time.monotonic() - validation_started
                curves.append({"epoch": epoch, "train": train_loss / count, "validation": validation_loss})
                print(json.dumps({"epoch": epoch, "train_loss": train_loss / count,
                                  "validation_loss": validation_loss, **scores_from_matrix(matrix, segmentation)}), flush=True)
                if validation_loss < best_loss:
                    best_loss, best_matrix, stale = validation_loss, matrix.clone(), 0
                    best_prediction_time = validation_elapsed
                    torch.save(model.state_dict(), model_dir / "weights.pt")
                else:
                    stale += 1
                if time.monotonic() >= deadline:
                    stop_reason = "time_limit"
                    break
                if config["early_stopping"] and stale >= 3:
                    stop_reason = "early_stopping"
                    break
        finally:
            archive.close()
        elapsed = time.monotonic() - start
        metadata = {"task": self.task_name, "model": config["model"], "classes": classes,
                    "image_size": size, "config": config, "format_version": 1}
        (model_dir / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
        scores = scores_from_matrix(best_matrix, segmentation)
        scores["cross_entropy"] = best_loss
        name = MODEL_NAMES[config["model"]]
        metric = "miou" if segmentation else "accuracy"
        return {"best_model": name, "eval_metric": metric, "problem_type": self.task_name,
                "training_rows": info["splits"]["train"], "total_rows": info["rows"],
                "learning_curve_metric": "cross_entropy", "learning_curves": {name: curves},
                "leaderboard": [{"model": name, "score_val": scores[metric], "fit_time": elapsed,
                                 "pred_time_val": best_prediction_time}],
                "epochs_completed": len(curves), "stop_reason": stop_reason, "config": config,
                "evaluation": {"method": "provided_validation", "seed": 42, "test_rows": 0,
                               "validation_rows": info["splits"]["val"], "scores": scores,
                               "confusion_matrix": {"labels": classes, "values": best_matrix.tolist()}}}

    def load(self, model_dir):
        import torch
        torch.set_num_threads(2)
        metadata = json.loads((model_dir / "metadata.json").read_text())
        if metadata["task"] != self.task_name:
            raise ValueError("Artifact task mismatch")
        model = build_model(metadata["model"], len(metadata["classes"]))
        model.load_state_dict(torch.load(model_dir / "weights.pt", map_location="cpu", weights_only=True))
        model.eval()
        return model, metadata

    def predict(self, model, image):
        import torch
        import numpy as np
        network, metadata = model
        with torch.inference_mode():
            output = logits(network, image_tensor(image, metadata["image_size"]).unsqueeze(0))
        labels = metadata["classes"]
        if self.task_name == "image-classification":
            probabilities = output.softmax(1)[0].tolist()
            ranked = sorted(zip(labels, probabilities), key=lambda pair: pair[1], reverse=True)
            return {"task": self.task_name, "predictions": [ranked[0][0]], "label": ranked[0][0],
                    "confidence": ranked[0][1], "probabilities": [{"label": k, "score": v} for k, v in ranked]}
        ids = Image.fromarray(output.argmax(1)[0].numpy().astype(np.uint8)).resize(image.size, Image.Resampling.NEAREST)
        values = np.asarray(ids)
        colors = np.array([PALETTE[i % len(PALETTE)] for i in range(len(labels))], dtype=np.uint8)
        colored = Image.fromarray(colors[values], "RGB")
        def encoded(picture):
            buffer = io.BytesIO()
            picture.save(buffer, format="PNG")
            return base64.b64encode(buffer.getvalue()).decode()
        return {"task": self.task_name, "width": image.width, "height": image.height,
                "mask_base64": encoded(ids), "overlay_base64": encoded(colored),
                "classes": [{"id": i, "label": label, "color": "#%02x%02x%02x" % tuple(colors[i]),
                             "coverage": float((values == i).mean())} for i, label in enumerate(labels)]}


class ImageClassificationTask(VisionTask):
    task_name = "image-classification"


class SegmentationTask(VisionTask):
    task_name = "segmentation"
