import type { RunConfig } from './catalog';
export function csvConfig(form: RunConfig) {
  return {model: form.modelIds[0],
    ...(form.taskId === 'anomaly-detection' ? {contamination: form.contamination, neighbors: form.neighbors} : {}),
    ...(form.taskId === 'clustering' ? {clusters: form.clusters} : {}),
    ...(form.taskId === 'forecasting' ? {lags: form.lags, horizon: form.horizon} : {}),
  };
}
