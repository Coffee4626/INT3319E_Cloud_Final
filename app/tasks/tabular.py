import csv
import io
import json
import math
import logging
from abc import abstractmethod

from app.tasks.base import MLTask


class TabularTask(MLTask):
    """Template Method: shared pipeline with task-specific target rules."""

    def validate_training(self, request):
        reader = csv.DictReader(io.StringIO(request.csv), strict=True)
        try:
            columns = reader.fieldnames or []
            if (request.target not in columns or len(columns) < 2
                    or len(set(columns)) != len(columns) or any(not name.strip() for name in columns)):
                raise ValueError("CSV needs unique headers, a target column, and at least one feature")
            labels = []
            for row in reader:
                if None in row or any(value is None for value in row.values()):
                    raise ValueError("CSV rows must match the header width")
                label = row[request.target].strip()
                if not label:
                    raise ValueError("Target values must not be empty")
                labels.append(label)
        except csv.Error as exc:
            raise ValueError(f"Invalid CSV: {exc}") from exc
        if len(labels) < 2:
            raise ValueError("CSV needs at least two data rows")
        self.validate_labels(labels)

    def validate_labels(self, labels):
        pass

    @abstractmethod
    def problem_type(self, labels):
        """Return an AutoGluon problem type, or None for automatic detection."""

    def train(self, dataset, model_dir, job):
        from autogluon.tabular import TabularDataset, TabularPredictor
        from app.tasks.evaluation import evaluate, split_indices

        data = TabularDataset(str(dataset))
        problem_type = self.problem_type(data[job["target"]])
        if problem_type is None:
            from autogluon.core.utils import infer_problem_type
            problem_type = infer_problem_type(data[job["target"]], silent=True)
        train_indices, test_indices, reason = split_indices(list(data[job["target"]]), problem_type)
        predictor = TabularPredictor(label=job["target"], path=str(model_dir),
                                     problem_type=problem_type)
        curve_metric = "root_mean_squared_error" if problem_type == "regression" else "log_loss"
        predictor.fit(data.iloc[train_indices], time_limit=int(job["time_limit"]),
                      hyperparameters={"GBM": {}}, fit_weighted_ensemble=False,
                      learning_curves={"metrics": [curve_metric], "use_error": True})
        leaderboard = json.loads(predictor.leaderboard(silent=True).to_json(orient="records"))
        metrics = {"leaderboard": leaderboard, "best_model": predictor.model_best,
                   "eval_metric": predictor.eval_metric.name, "problem_type": predictor.problem_type,
                   "features": predictor.feature_metadata_in.get_features(), "training_rows": len(train_indices),
                   "total_rows": len(data),
                   "evaluation": {"method": "holdout_20_percent", "seed": 42,
                                  "test_rows": len(test_indices), "reason": reason}}
        if test_indices:
            metrics["evaluation"].update(evaluate(predictor, data.iloc[test_indices], job["target"]))
        # Curves come from actual LightGBM boosting rounds; never synthesize them.
        try:
            from app.tasks.curves import serialize_curves
            _, model_curves = predictor.learning_curves()
            metrics["learning_curves"] = serialize_curves(model_curves, curve_metric)
            metrics["learning_curve_metric"] = curve_metric
        except (ValueError, TypeError, KeyError, IndexError, AttributeError):
            logging.getLogger(__name__).warning("Learning curves unavailable for this run", exc_info=True)
        predictor.save_space()
        return metrics

    def load(self, model_dir):
        from autogluon.tabular import TabularPredictor

        return TabularPredictor.load(str(model_dir))

    def predict(self, model, rows):
        import pandas as pd

        features = model.feature_metadata_in.get_features()
        missing = {feature for row in rows for feature in features if feature not in row}
        if missing:
            raise ValueError(f"Missing features: {', '.join(sorted(missing))}")
        predictions = model.predict(pd.DataFrame(rows))
        return {"predictions": json.loads(predictions.to_json(orient="values"))}


class AutoTabularTask(TabularTask):
    def problem_type(self, labels):
        return None


class ClassificationTask(TabularTask):
    def validate_labels(self, labels):
        if len(set(labels)) < 2:
            raise ValueError("Classification needs at least two distinct target classes")

    def problem_type(self, labels):
        count = len(set(labels))
        if count < 2:
            raise ValueError("Classification needs at least two distinct target classes")
        return "binary" if count == 2 else "multiclass"


class RegressionTask(TabularTask):
    def validate_labels(self, labels):
        try:
            valid = all(math.isfinite(float(value)) for value in labels)
        except (ValueError, OverflowError):
            valid = False
        if not valid:
            raise ValueError("Regression target values must be finite numbers")

    def problem_type(self, labels):
        return "regression"
