"""CPU novelty detection and clustering, evaluated without invented label metrics."""
import json
import time
from pathlib import Path

from app.tasks.base import MLTask
from app.task_options import task_config, validate_profile


class UnsupervisedTask(MLTask):
    task_name = ''

    def validate_training(self, request):
        from app.datasets import profile
        validate_profile(self.task_name, '', profile(request.csv), task_config(self.task_name, request.config))

    def train(self, dataset, model_dir, job):
        import joblib
        import numpy as np
        import pandas as pd
        from sklearn.impute import SimpleImputer
        from sklearn.preprocessing import StandardScaler
        from sklearn.pipeline import Pipeline
        from sklearn.ensemble import IsolationForest
        from sklearn.neighbors import LocalOutlierFactor
        from sklearn.cluster import KMeans, MiniBatchKMeans
        from sklearn.metrics import silhouette_score, davies_bouldin_score
        from app.csv_stream import profile_file
        cfg = task_config(self.task_name, json.loads(json.dumps(job.get('config',{}), default=lambda v: int(v) if v == int(v) else float(v))))
        # DynamoDB integers can be Decimal; normalize before validating.
        for key in ('neighbors','clusters'):
            if key in cfg: cfg[key] = int(cfg[key])
        data = pd.read_csv(dataset).apply(pd.to_numeric, errors='raise')
        validate_profile(self.task_name, '', profile_file(dataset), cfg)
        indices = np.random.default_rng(42).permutation(len(data))
        cut = int(len(data)*0.8)
        train, test = data.iloc[indices[:cut]], data.iloc[indices[cut:]]
        if cfg['model'] == 'isolation-forest':
            estimator = IsolationForest(n_estimators=100, contamination=cfg['contamination'], random_state=42, n_jobs=2)
        elif cfg['model'] == 'lof':
            estimator = LocalOutlierFactor(n_neighbors=cfg['neighbors'], contamination=cfg['contamination'], novelty=True, n_jobs=2)
        elif cfg['model'] == 'kmeans':
            estimator = KMeans(n_clusters=cfg['clusters'], n_init=10, max_iter=100, random_state=42)
        else:
            estimator = MiniBatchKMeans(n_clusters=cfg['clusters'], batch_size=128, n_init=3, max_iter=100, random_state=42)
        pipeline = Pipeline([('impute',SimpleImputer(strategy='median')),('scale',StandardScaler()),('model',estimator)])
        from threadpoolctl import threadpool_limits
        started = time.monotonic()
        with threadpool_limits(limits=2): pipeline.fit(train)
        elapsed = time.monotonic()-started
        prediction_started = time.monotonic()
        predictions = pipeline.predict(test)
        if self.task_name == 'anomaly-detection':
            scores = {'outlier_rate':float(np.mean(predictions == -1)),
                      'mean_anomaly_score':float(np.mean(-pipeline.decision_function(test)))}
            metric = 'outlier_rate'; notes = 'No ground-truth anomaly labels; these are diagnostics, not accuracy.'
        else:
            transformed = pipeline[:-1].transform(test)
            scores = {}
            if 1 < len(set(predictions)) < len(test):
                scores = {'silhouette':float(silhouette_score(transformed,predictions,sample_size=min(2000,len(test)),random_state=42)),
                          'davies_bouldin':float(davies_bouldin_score(transformed,predictions))}
            metric = 'silhouette'; notes = 'Internal cluster separation on held-out rows; no ground-truth labels.'
        model_dir.mkdir(parents=True,exist_ok=True)
        joblib.dump({'pipeline':pipeline,'features':list(data.columns),'task':self.task_name,'config':cfg},model_dir/'model.joblib')
        return {'best_model':cfg['model'],'eval_metric':metric,'features':list(data.columns),
                'training_rows':len(train),'total_rows':len(data),'config':cfg,
                'leaderboard':[{'model':cfg['model'],'score_val':scores.get(metric),'fit_time':elapsed,'pred_time_val':time.monotonic()-prediction_started}],
                'evaluation':{'method':'unsupervised_holdout','test_rows':len(test),'scores':scores,'reason':notes}}

    def load(self, model_dir):
        import joblib
        return joblib.load(model_dir/'model.joblib')

    def predict(self, model, rows):
        import numpy as np
        import pandas as pd
        features = model['features']
        if any(any(f not in row for f in features) for row in rows): raise ValueError('Include all trained numeric features')
        try: data = pd.DataFrame(rows)[features].apply(pd.to_numeric,errors='raise')
        except (TypeError,ValueError) as exc: raise ValueError('Features must be numeric or null') from exc
        if np.isinf(data.to_numpy(dtype=float)).any(): raise ValueError('Feature values must be finite')
        pipeline = model['pipeline']; labels = pipeline.predict(data)
        if self.task_name == 'anomaly-detection':
            scores = -pipeline.decision_function(data)
            return {'predictions':[bool(x == -1) for x in labels], 'anomalies':[
                {'is_anomaly':bool(label == -1),'score':float(score),'threshold':0.0} for label,score in zip(labels,scores)]}
        distances = pipeline.transform(data)
        return {'predictions':[int(x) for x in labels], 'clusters':[
            {'cluster':int(label),'distance':float(distances[i,label])} for i,label in enumerate(labels)]}


class AnomalyTask(UnsupervisedTask):
    task_name = 'anomaly-detection'


class ClusteringTask(UnsupervisedTask):
    task_name = 'clustering'
