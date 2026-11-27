import tempfile
import unittest
from pathlib import Path
from app.domain import TrainingRequest
from app.task_options import task_config, validate_special_rows
from app.tasks.factory import default_factory
from app.tasks.forecasting import lag_records
from app.csv_stream import prepare_file
from scripts.check_extended_ml import fixture

class ExtendedTasksTests(unittest.TestCase):
    def test_all_contracts_accept_representative_data(self):
        for task, target in [('anomaly-detection',''),('clustering',''),('text-classification','label'),('forecasting','target')]:
            request = TrainingRequest.parse(dict(csv=fixture(task),target=target,task=task))
            default_factory().create(task).validate_training(request)

    def test_no_label_preparation_keeps_all_features(self):
        with tempfile.TemporaryDirectory() as folder:
            source, out = Path(folder)/'source.csv', Path(folder)/'out.csv'
            source.write_text(fixture('clustering'))
            report, profile = prepare_file(source,out,{'target':''},'clustering')
            self.assertEqual(report['output_rows'],240)
            self.assertEqual(len(profile['columns']),3)
            with self.assertRaises(ValueError): prepare_file(source,out,{'target':''},'classification')

    def test_configs_reject_wrong_models_nonfinite_and_unbounded_work(self):
        for task,cfg in [('anomaly-detection',{'contamination':float('nan')}),('anomaly-detection',{'neighbors':2.5}),
                         ('clustering',{'clusters':True}),('clustering',{'model':'lightgbm'}),('forecasting',{'horizon':31}),('forecasting',{'lags':1}),('classification',{'unknown':1})]:
            with self.subTest(task=task,cfg=cfg), self.assertRaises(ValueError): task_config(task,cfg)

    def test_unsupervised_rejects_text_labels_and_too_few_rows(self):
        for text in ['x,y\n1,2\n3,4',fixture('text-classification')]:
            with self.assertRaises(ValueError): default_factory().create('anomaly-detection').validate_training(TrainingRequest(text,'','anomaly-detection'))

    def test_forecast_requires_regular_ordered_finite_series(self):
        for data in [[['2026-01-01',1],['2026-01-01',2]], [['2026-01-01',1],['2026-01-03',2],['2026-01-04',3]], [['2026-01-01',float('inf')]], [['2026-01-01Z',2]]]:
            with self.assertRaises(ValueError): validate_special_rows('forecasting',['timestamp','target'],data)

    def test_forecast_lags_only_include_past_values(self):
        records = lag_records([10,20,30,40],2)
        self.assertEqual(records,[{'lag_1':20.,'lag_2':10.,'target':30.},{'lag_1':30.,'lag_2':20.,'target':40.}])

    def test_forecast_prediction_contract_bounds_and_history(self):
        task = default_factory().create('forecasting')
        self.assertEqual(task.validate_prediction({'horizon':3}),{'horizon':3,'history':None})
        for payload in [{'horizon':0},{'horizon':True},{'horizon':31},{'history':[]},{'history':[{'timestamp':'2026-01-01','target':1}]*2}]:
            with self.assertRaises(ValueError): task.validate_prediction(payload)

    def test_text_requires_nonempty_bounded_text(self):
        for value in ['', 'x'*5001]:
            with self.assertRaises(ValueError): validate_special_rows('text-classification',['text','label'],[[value,'a']])
