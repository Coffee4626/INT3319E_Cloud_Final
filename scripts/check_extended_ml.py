"""Real CPU training/artifact/prediction smoke test, run in the pinned ML image."""
import csv
import json
import math
import tempfile
from datetime import date, timedelta
from pathlib import Path
from decimal import Decimal
from app.domain import TrainingRequest
from app.tasks.factory import default_factory


def fixture(task, count=240):
    if task == 'text-classification':
        return 'text,label\n' + '\n'.join(f'{"Sản phẩm tốt giao nhanh hài lòng" if i%2 else "Sản phẩm lỗi giao chậm thất vọng"} đơn hàng {i},{"positive" if i%2 else "negative"}' for i in range(count))
    if task == 'forecasting':
        return 'timestamp,target\n' + '\n'.join(f'{date(2026,1,1)+timedelta(days=i)},{100+i*.2+math.sin(i*2*math.pi/7)*15:.4f}' for i in range(count))
    return 'frequency,spend,tenure\n' + '\n'.join(f'{3+(i%3)*8+math.sin(i)},{100+(i%3)*400+math.cos(i)*35},{6+(i%3)*12+math.sin(i*2)*2}' for i in range(count))


def main():
    results = []
    for name, models, target in [('anomaly-detection',['isolation-forest','lof'],''), ('clustering',['kmeans','minibatch-kmeans'],''), ('text-classification',['lightgbm','extratrees'],'label'), ('forecasting',['lightgbm','extratrees'],'target')]:
        for model in models:
            task = default_factory().create(name)
            data = fixture(name)
            config = {'model':model}
            task.validate_training(TrainingRequest(data,target,name,30,config))
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory); (path/'data.csv').write_text(data)
                metrics = task.train(path/'data.csv',path/'model',{'target':target,'time_limit':30,'config':config})
                loaded = task.load(path/'model')
                payload = {'horizon':3} if name == 'forecasting' else {'rows':[{'text':'Sản phẩm tốt giao nhanh hài lòng'}] if name == 'text-classification' else [{'frequency':3,'spend':100,'tenure':6}]}
                output = task.predict(loaded,task.validate_prediction(payload))
                assert output['predictions']
                result = {'task':name,'model':model,'scores':metrics['evaluation']['scores'],'prediction':output}
                results.append(result); print('PASS',name,model,flush=True)
    Path('/tmp/extended-ml-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))

if __name__ == '__main__': main()
