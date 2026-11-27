"""Task contracts shared by API validation and workers; no ML imports."""
import re
import math
from datetime import datetime

UNSUPERVISED = {'anomaly-detection', 'clustering'}
EXTENDED = UNSUPERVISED | {'text-classification', 'forecasting'}
CSV_TASKS = {'tabular', 'classification', 'regression'} | EXTENDED
MODELS = {
    'anomaly-detection': ('isolation-forest', 'lof'),
    'clustering': ('kmeans', 'minibatch-kmeans'),
    'text-classification': ('lightgbm', 'extratrees'),
    'forecasting': ('lightgbm', 'extratrees'),
}


def task_config(task, values):
    if not isinstance(values, dict):
        raise ValueError('config must be an object')
    defaults = {'model': MODELS.get(task, ('lightgbm',))[0]}
    if task == 'anomaly-detection': defaults.update(contamination=0.05, neighbors=20)
    if task == 'clustering': defaults.update(clusters=3)
    if task == 'forecasting': defaults.update(lags=7, horizon=7)
    if set(values) - set(defaults): raise ValueError('Unknown configuration for this task')
    cfg = {**defaults, **values}
    if cfg['model'] not in MODELS.get(task, ('lightgbm', 'extratrees', 'randomforest')):
        raise ValueError('Unsupported model for this task')
    for key, low, high in [('neighbors',2,100), ('clusters',2,20), ('lags',2,30), ('horizon',1,30)]:
        if key in cfg and (type(cfg[key]) is not int or not low <= cfg[key] <= high):
            raise ValueError(f'{key} must be an integer from {low} to {high}')
    if 'contamination' in cfg and (type(cfg['contamination']) not in (int,float) or not 0.001 <= cfg['contamination'] <= 0.5):
        raise ValueError('contamination must be from 0.001 to 0.5')
    return cfg


def validate_profile(task, target, profile, cfg):
    columns = profile['columns']
    names = [c['name'] for c in columns]
    if task in EXTENDED and not 30 <= profile['rows'] <= 20000:
        raise ValueError('This task requires 30–20,000 rows')
    if task in UNSUPERVISED:
        if not 2 <= len(columns) <= 50 or any(c['type'] != 'numeric' or c['missing'] >= profile['rows'] for c in columns):
            raise ValueError('Unsupervised tasks require 2–50 numeric feature columns; remove IDs and labels')
        if task == 'clustering' and cfg['clusters'] >= int(profile['rows'] * 0.8):
            raise ValueError('Number of clusters must be smaller than the training set')
        if cfg['model'] == 'lof' and (profile['rows'] > 5000 or cfg['neighbors'] >= int(profile['rows'] * 0.8)):
            raise ValueError('LOF supports at most 5,000 rows and fewer neighbors than training rows')
        return
    selected = next((c for c in columns if c['name'] == target), None)
    if not selected or selected['missing']: raise ValueError('Target values must not be empty')
    if task in ('classification','text-classification') and selected['unique'] < 2:
        raise ValueError('Classification needs at least two distinct target classes')
    if task in ('regression','forecasting') and selected['type'] != 'numeric':
        raise ValueError('Regression/forecast target values must be finite numbers')
    if task == 'text-classification' and (set(names) != {'text','label'} or target != 'label'):
        raise ValueError('Text classification requires text,label columns and label as target')
    if task == 'forecasting':
        if set(names) != {'timestamp','target'} or target != 'target':
            raise ValueError('Forecasting requires timestamp,target columns')
        if profile['rows'] < 3 * cfg['horizon'] + cfg['lags'] + 10:
            raise ValueError('Need at least 3 × horizon + lags + 10 observations')


def parse_timestamp(value):
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)?", str(value)):
            raise ValueError('Use ISO dates or local timestamps without timezone suffix')
        result = datetime.fromisoformat(str(value))
        if result.tzinfo is not None: raise ValueError('Use timestamps without timezone, in a consistent timezone')
        return result
    except (TypeError, ValueError) as exc:
        raise ValueError('Use ISO timestamps in one timezone, without timezone suffix') from exc


def validate_special_rows(task, columns, rows):
    previous = None
    interval = None
    for row in rows:
        if task == 'text-classification':
            text = row[columns.index('text')]
            if not text.strip() or len(text) > 5000:
                raise ValueError('Text must contain 1–5,000 characters per row')
        if task == 'forecasting':
            stamp = parse_timestamp(row[columns.index('timestamp')])
            value = row[columns.index('target')]
            try: valid = math.isfinite(float(value))
            except (TypeError,ValueError): valid = False
            if not valid: raise ValueError('Forecast targets must be finite numbers')
            if previous is not None:
                delta = (stamp-previous).total_seconds()
                if delta <= 0 or (interval is not None and delta != interval):
                    raise ValueError('Timestamps must be strictly increasing with a regular interval')
                interval = delta
            previous = stamp
