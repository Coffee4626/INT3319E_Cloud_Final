"""One regular series, lag features, chronological holdout, recursive inference."""
import json
import math
from datetime import timedelta

from app.tasks.base import MLTask
from app.task_options import task_config, validate_profile, validate_special_rows, parse_timestamp


def lag_records(values, lags):
    return [{**{f'lag_{j}': float(values[i-j]) for j in range(1, lags+1)}, 'target': float(values[i])}
            for i in range(lags, len(values))]


def recursive_predict(predictor, history, lags, horizon):
    import pandas as pd
    buffer = list(history)
    output = []
    for _ in range(horizon):
        row = {f'lag_{j}': float(buffer[-j]) for j in range(1, lags+1)}
        value = float(predictor.predict(pd.DataFrame([row])).iloc[0])
        if not math.isfinite(value): raise ValueError('Forecast produced a non-finite value')
        output.append(value); buffer.append(value)
    return output


class ForecastingTask(MLTask):
    def validate_training(self, request):
        from app.datasets import profile, read_csv
        cfg = task_config('forecasting', request.config)
        validate_profile('forecasting', request.target, profile(request.csv), cfg)
        columns, data = read_csv(request.csv)
        validate_special_rows('forecasting', columns, data)

    def train(self, dataset, model_dir, job):
        import numpy as np
        import pandas as pd
        from autogluon.tabular import TabularPredictor
        from app.csv_stream import profile_file, rows
        cfg = task_config('forecasting', json.loads(json.dumps(job.get('config', {}), default=lambda v: int(v) if v == int(v) else float(v))))
        validate_profile('forecasting', 'target', profile_file(dataset), cfg)
        source = rows(dataset); columns = next(source)
        validate_special_rows('forecasting', columns, source)
        data = pd.read_csv(dataset)
        values = data.target.astype(float).tolist()
        horizon, lags = cfg['horizon'], cfg['lags']
        # External test is never passed to fit or used as input during recursive evaluation.
        training_values = values[:-horizon]
        frame = pd.DataFrame(lag_records(training_values, lags))
        cut = int(len(frame) * 0.8)
        model_dir.mkdir(parents=True, exist_ok=True)
        predictor = TabularPredictor(label='target', problem_type='regression', path=str(model_dir/'predictor'))
        predictor.fit(frame.iloc[:cut], tuning_data=frame.iloc[cut:], time_limit=int(job['time_limit']),
                      hyperparameters={'GBM': {}} if cfg['model'] == 'lightgbm' else {'XT': {'n_estimators': 100}},
                      fit_weighted_ensemble=False)
        predicted = np.array(recursive_predict(predictor, training_values[-lags:], lags, horizon))
        actual = np.array(values[-horizon:])
        difference = np.abs(actual-predicted)
        denominator = np.abs(actual)+np.abs(predicted)
        smape = np.divide(2*difference, denominator, out=np.zeros_like(difference), where=denominator != 0)
        meta = {**cfg, 'history': values[-lags:], 'last_timestamp': str(data.timestamp.iloc[-1]),
                'interval_seconds': (parse_timestamp(data.timestamp.iloc[1])-parse_timestamp(data.timestamp.iloc[0])).total_seconds()}
        (model_dir/'forecast.json').write_text(json.dumps(meta))
        leaderboard = json.loads(predictor.leaderboard(silent=True).to_json(orient='records'))
        predictor.save_space()
        return {'best_model': predictor.model_best, 'eval_metric': 'rmse', 'features': [f'lag_{j}' for j in range(1,lags+1)],
                'training_rows': cut, 'tuning_rows': len(frame)-cut, 'total_rows': len(data), 'config': cfg,
                'leaderboard': leaderboard,
                'evaluation': {'method': 'chronological_holdout', 'test_rows': horizon,
                               'scores': {'mae': float(difference.mean()), 'rmse': float(np.sqrt(np.mean(difference**2))), 'smape': float(smape.mean())}},
                'forecast_evaluation': [{'timestamp': str(t), 'actual': float(a), 'predicted': float(p)}
                                        for t,a,p in zip(data.timestamp.iloc[-horizon:], actual, predicted)]}

    def load(self, model_dir):
        from autogluon.tabular import TabularPredictor
        return {'predictor': TabularPredictor.load(str(model_dir/'predictor')), 'meta': json.loads((model_dir/'forecast.json').read_text())}

    def validate_prediction(self, payload):
        horizon = payload.get('horizon', 7)
        if type(horizon) is not int or not 1 <= horizon <= 30: raise ValueError('horizon must be an integer from 1 to 30')
        history = payload.get('history')
        if history is not None:
            if not isinstance(history,list) or not 2 <= len(history) <= 5000 or any(not isinstance(r,dict) or set(r) != {'timestamp','target'} for r in history):
                raise ValueError('history must contain 2–5,000 timestamp,target observations')
            validate_special_rows('forecasting', ['timestamp','target'], ([r['timestamp'],r['target']] for r in history))
        return {'horizon': horizon, 'history': history}

    def predict(self, model, payload):
        meta = model['meta']; history = payload.get('history')
        if history:
            if len(history) < meta['lags']: raise ValueError('History must contain at least as many observations as lags')
            interval = (parse_timestamp(history[1]['timestamp'])-parse_timestamp(history[0]['timestamp'])).total_seconds()
            if interval != meta['interval_seconds']: raise ValueError('History interval must match the training series')
            values = [float(r['target']) for r in history][-meta['lags']:]
            stamp = parse_timestamp(history[-1]['timestamp'])
        else:
            values = meta['history']; stamp = parse_timestamp(meta['last_timestamp'])
        predictions = recursive_predict(model['predictor'], values, meta['lags'], payload['horizon'])
        return {'predictions': predictions, 'forecasts': [
            {'timestamp': (stamp+timedelta(seconds=meta['interval_seconds']*(i+1))).isoformat(), 'value': value}
            for i,value in enumerate(predictions)], 'horizon': payload['horizon']}
