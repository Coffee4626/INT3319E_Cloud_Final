# Stratus Studio

The frontend at `http://localhost:3000` uses a light workspace with blue controls,
white surfaces, and dark typography. It includes a landing page, illustrated task
catalog, task-first experiment wizard, model registry, inference playground, and
interactive AWS/data-lineage diagrams. Task selection includes image classification,
semantic segmentation, tabular classification and tabular regression.

## Runtime boundaries

- Experiments, datasets, deployments, evaluation scores, learning curves and
  predictions come from the configured API. No generated experiment/metric/endpoint
  history is injected into the UI.
- The worker supports LightGBM for tabular tasks and MobileNet/ResNet-18/U-Net/DeepLabV3 for images.
  See [image-workflows.md](image-workflows.md) for exact models, formats and limits.
- Wizard files and settings stay in browser memory until the final Start action. It then uploads,
  validates, prepares and submits one job. A synchronous UI guard plus server submission UUID
  prevent duplicate jobs on repeated clicks/retries. Preparing datasets alone never enqueues work.
- Browser ZIP validation checks paths and pairings. The controller validates decoded mask IDs,
  image dimensions, file safety and bounds before taking an immutable snapshot. Workers revalidate.
- Image inference supports local preview, explicit prediction, class probabilities, segmentation
  overlays with opacity control, class coverage and download of the class-ID PNG.
- Image epoch loss and validation metrics are measured on real data. The supplied val split selects
  checkpoints and is labeled as validation, not an independent test split.
- Architecture diagrams describe the pipeline. The resources tab polls authenticated
  `GET /compute` every 10 seconds, including after job completion, for actual ASG
  instance counts and approximate SQS waiting/processing counts. Failed refreshes
  retain the previous values with a stale-data warning. Counts cover shared training
  workers, not inference instances. The infrastructure setup snapshot remains dated.
- Ratio metrics (accuracy, F1, IoU, Dice, precision/recall and AUC) display as percentages;
  loss and regression errors retain their original numeric scale. Stored values are unchanged.
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
CSV, malformed rows/headers, ZIP traversal, split/class layouts, masks and class IDs.

Image provenance is recorded in `frontend/public/tasks/sources.json`. Vision overlays
are SVG illustrations explaining each task, not output from a trained model.
