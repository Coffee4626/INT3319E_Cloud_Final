const ratios = new Set([
  "accuracy", "balanced_accuracy", "pixel_accuracy", "f1", "f1_macro", "f1_micro",
  "f1_weighted", "precision", "precision_macro", "precision_weighted", "recall",
  "recall_macro", "recall_weighted", "roc_auc", "miou", "dice",
]);

export function formatMetric(name: string | undefined, value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return ratios.has(name || "")
    ? `${(value * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`
    : value.toFixed(4);
}
