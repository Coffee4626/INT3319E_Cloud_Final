import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMetric } from "../src/studio/metrics.ts";

test("Ratio metrics display percentages across cards and model scores", () => {
  for (const metric of ["accuracy", "f1_macro", "miou", "dice", "pixel_accuracy"])
    assert.equal(formatMetric(metric, 1), "100%");
  assert.equal(formatMetric("accuracy", 0.8732), "87,32%");
  assert.equal(formatMetric("f1", 0), "0%");
});
test("Losses and unbounded regression metrics keep their numeric scale", () => {
  assert.equal(formatMetric("cross_entropy", 0.000076), "0.0001");
  assert.equal(formatMetric("r2", -0.2), "-0.2000");
  assert.equal(formatMetric("rmse", 12.3), "12.3000");
  assert.equal(formatMetric("accuracy", NaN), "—");
  assert.equal(formatMetric("accuracy", undefined), "—");
});
