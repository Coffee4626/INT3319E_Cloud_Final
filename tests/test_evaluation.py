import unittest
from app.tasks.evaluation import split_indices


class EvaluationTests(unittest.TestCase):
    def test_stratified_holdout_is_disjoint_complete_and_reproducible(self):
        labels = ["a"] * 120 + ["b"] * 120
        train, test, reason = split_indices(labels, "binary")
        self.assertIsNone(reason)
        self.assertEqual(len(test), 48)
        self.assertFalse(set(train) & set(test))
        self.assertEqual(set(train) | set(test), set(range(240)))
        self.assertEqual(sum(labels[i] == "a" for i in test), 24)
        self.assertEqual((train, test, reason), split_indices(labels, "binary"))

    def test_regression_holdout_does_not_require_repeated_labels(self):
        train, test, reason = split_indices(list(range(100)), "regression")
        self.assertEqual((len(train), len(test), reason), (80, 20, None))

    def test_small_or_rare_class_data_reports_why_test_is_unavailable(self):
        for labels, problem in (([1, 2], "regression"), (["a"] * 99 + ["b"], "binary")):
            train, test, reason = split_indices(labels, problem)
            self.assertEqual(len(train), len(labels))
            self.assertEqual(test, [])
            self.assertTrue(reason)
