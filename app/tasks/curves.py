"""Bound actual AutoGluon learning curves for DynamoDB and the studio chart."""
import math


def serialize_curves(model_data, metric, max_points=120):
    """Keep original boosting-round indices while sampling long histories.

    AutoGluon 1.4 format: [eval_set_names, metric_names, metric/set/round values].
    https://auto.gluon.ai/1.4/api/autogluon.tabular.TabularPredictor.learning_curves.html
    """
    result = {}
    for model, curve in model_data.items():
        sets, metrics, values = curve
        if metric not in metrics or "train" not in sets or "val" not in sets:
            continue
        series = values[metrics.index(metric)]
        train, validation = series[sets.index("train")], series[sets.index("val")]
        count = min(len(train), len(validation))
        if not count:
            continue
        indices = (list(range(count)) if count <= max_points else
                   sorted({round(i * (count - 1) / (max_points - 1)) for i in range(max_points)}))
        points = []
        for index in indices:
            tr, val = float(train[index]), float(validation[index])
            if math.isfinite(tr) and math.isfinite(val):
                points.append({"epoch": index + 1, "train": tr, "validation": val})
        if points:
            result[model] = points
    return result
