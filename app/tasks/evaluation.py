"""Reproducible holdout selection, separate from AutoGluon's validation split."""
import random
from collections import defaultdict


def split_indices(labels, problem_type, seed=42):
    if len(labels) < 20:
        return list(range(len(labels))), [], "Cần ít nhất 20 dòng để tách test set."
    rng = random.Random(seed)
    if problem_type in ("binary", "multiclass"):
        groups = defaultdict(list)
        for index, label in enumerate(labels):
            groups[label].append(index)
        if any(len(indices) < 5 for indices in groups.values()):
            return list(range(len(labels))), [], "Mỗi lớp cần ít nhất 5 mẫu để tách test set."
        test = []
        for indices in groups.values():
            rng.shuffle(indices)
            test.extend(indices[:max(1, len(indices) // 5)])
    else:
        test = rng.sample(range(len(labels)), max(2, len(labels) // 5))
    selected = set(test)
    return [i for i in range(len(labels)) if i not in selected], sorted(test), None


def evaluate(predictor, data, target):
    from sklearn.metrics import (accuracy_score, balanced_accuracy_score, confusion_matrix,
                                 f1_score, mean_absolute_error, mean_squared_error, r2_score)
    truth, predicted = data[target], predictor.predict(data.drop(columns=[target]))
    if predictor.problem_type in ("binary", "multiclass"):
        labels = list(predictor.class_labels)
        scores = {"accuracy": accuracy_score(truth, predicted),
                  "balanced_accuracy": balanced_accuracy_score(truth, predicted),
                  "f1_weighted": f1_score(truth, predicted, average="weighted", zero_division=0)}
        # Bound DynamoDB item size for datasets with many distinct classes.
        matrix = ({"labels": [str(x)[:128] for x in labels],
                   "values": confusion_matrix(truth, predicted, labels=labels).tolist()}
                  if len(labels) <= 20 else None)
    else:
        scores = {"mae": mean_absolute_error(truth, predicted),
                  "rmse": mean_squared_error(truth, predicted) ** 0.5,
                  "r2": r2_score(truth, predicted)}
        matrix = None
    return {"scores": {key: float(value) for key, value in scores.items()},
            "confusion_matrix": matrix}
