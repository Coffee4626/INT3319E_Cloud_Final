# Stratus Studio

The frontend at `http://localhost:3000` uses a light workspace with blue controls,
white surfaces, and dark typography. It includes a landing page, illustrated task
catalog, task-first experiment wizard, model registry, inference playground, and
interactive AWS/data-lineage diagrams. Task selection includes image classification,
object detection, semantic segmentation, instance segmentation, tabular classification,
tabular regression, text classification, and time-series forecasting.

## Runtime boundaries

- Experiments, datasets, deployments, evaluation scores, learning curves and
  predictions come from the configured API. No generated experiment/metric/endpoint
  history is injected into the UI.
- The current worker supports AutoGluon / LightGBM classification and regression.
  Other tasks expose model configuration and validate dataset structure; their Train
  action stays unavailable until their runtime is installed. A configuration can be
  downloaded for review.
- CSV profiles and preprocessing use the existing upload/preprocess APIs. ZIP checks
  inspect central-directory paths and annotation pairings, not decoded image or mask
  content. The future task runtime must validate those contents before training.
- Architecture diagrams describe the pipeline. EC2 worker counts remain unavailable
  without telemetry; job status is never used to invent instance counts. The AWS
  setup snapshot is dated, not a live account monitor.
- Learning curves are saved from real LightGBM boosting rounds on new runs (log loss
  for classification and RMSE for regression). Up to 120 actual points are retained
  with original round indices to bound DynamoDB record size. Older jobs without
  histories show an empty state; final metrics remain visible.
- Deployment keys are held in React memory only. Refreshing the page requires the
  existing key or explicitly generating a replacement. Request examples contain a
  placeholder, never the user's key. HTTP latency is measured around the API call.

## Verification

```sh
cd frontend
npm ci
npm test  # Node 22.6+ for built-in TypeScript stripping
npm run build
cd ..
.venv/bin/python -m unittest discover -s tests -q
docker compose up -d --build
.venv/bin/python scripts/smoke.py --task all --timeout 300
```

The smoke test exercises CSV upload, schema/profile, preprocessing, queue/worker
training, real learning curves, holdout evaluation, deployment, prediction and API-key
rejection for classification and regression. Dataset validation tests include quoted
CSV, malformed rows/headers, forecasting order, ZIP traversal, split/class layouts,
and per-image annotation paths.

Image provenance is recorded in `frontend/public/tasks/sources.json`. Vision overlays
are SVG illustrations explaining each task, not output from a trained model.
