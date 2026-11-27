import math
import unittest
from app.tasks.curves import serialize_curves


class CurveTests(unittest.TestCase):
    def test_selects_metric_and_sets_by_name_not_position(self):
        data = {"LightGBM": [["val", "train"], ["accuracy", "log_loss"],
                              [[[.8, .9], [.9, 1]], [[.5, .3], [.4, .2]]]]}
        self.assertEqual(serialize_curves(data, "log_loss"), {"LightGBM": [
            {"epoch": 1, "train": .4, "validation": .5},
            {"epoch": 2, "train": .2, "validation": .3}]})

    def test_bounds_storage_preserving_first_last_and_real_round_indices(self):
        values = list(range(10000))
        data = {"LightGBM": [["train", "val"], ["rmse"], [[values, values]]]}
        points = serialize_curves(data, "rmse")["LightGBM"]
        self.assertEqual(len(points), 120)
        self.assertEqual((points[0]["epoch"], points[-1]["epoch"]), (1, 10000))
        for p in points:
            self.assertEqual(p["train"], p["epoch"] - 1)

    def test_omits_missing_validation_and_nonfinite_values(self):
        data = {"A": [["train"], ["loss"], [[[1, 2]]]],
                "B": [["train", "val"], ["loss"], [[[1, math.inf], [2, 3]]]]}
        self.assertEqual(serialize_curves(data, "loss"), {
            "B": [{"epoch": 1, "train": 1., "validation": 2.}]})
