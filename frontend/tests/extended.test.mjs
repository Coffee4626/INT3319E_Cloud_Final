import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultConfig} from '../src/studio/catalog.ts';
import {csvConfig} from '../src/studio/taskConfig.ts';
import {formatMetric} from '../src/studio/metrics.ts';
test('Task-specific CSV settings preserve the selected model and omit unrelated controls',()=>{
 assert.deepEqual(csvConfig(defaultConfig('anomaly-detection')),{model:'isolation-forest',contamination:.05,neighbors:20});
 assert.deepEqual(csvConfig(defaultConfig('clustering')),{model:'kmeans',clusters:3});
 assert.deepEqual(csvConfig({...defaultConfig('forecasting'),modelIds:['extratrees'],horizon:14}),{model:'extratrees',lags:7,horizon:14});
 assert.deepEqual(csvConfig(defaultConfig('text-classification')),{model:'lightgbm'});
});
test('Diagnostic ratios use percent while cluster separation and distances stay numeric',()=>{
 assert.equal(formatMetric('outlier_rate',.05),'5%');
 assert.equal(formatMetric('smape',1.2),'120%');
 assert.equal(formatMetric('silhouette',-.3),'-0.3000');
 assert.equal(formatMetric('davies_bouldin',1.2),'1.2000');
});
