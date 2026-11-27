"""Bounded cloud verification. Requires a dedicated temporary Cognito user.

Creates four 240-row jobs, tests deploy/inference and 72 total load requests
(concurrency 1/2/4). Deletes only this test user's records and artifact versions.
Never stores tokens or deployment keys in the evidence output.
"""
import base64
import concurrent.futures
import json
import os
import statistics
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import boto3
from smoke import request, base
from check_extended_ml import fixture


def session():
    c = json.loads(subprocess.run(['aws','configure','export-credentials','--format','process'],capture_output=True,text=True,check=True).stdout)
    return boto3.Session(region_name=os.environ['AWS_DEFAULT_REGION'],aws_access_key_id=c['AccessKeyId'],aws_secret_access_key=c['SecretAccessKey'],aws_session_token=c['SessionToken'])


def upload(task):
    name = f'extended-check-{task}.csv'
    ticket = request('/uploads',{'name':name,'task':task})
    boundary = 'stratus'+uuid.uuid4().hex
    chunks = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k,v in ticket['upload']['fields'].items()]
    chunks += [f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: text/csv\r\n\r\n{fixture(task)}\r\n--{boundary}--\r\n']
    with urlopen(Request(ticket['upload']['url'],data=''.join(chunks).encode(),headers={'Content-Type':f'multipart/form-data; boundary={boundary}'},method='POST'),timeout=60) as response:
        assert response.status in (200,201,204)
    data = request('/datasets/'+ticket['dataset_id']+'/complete',{})
    assert data['profile']['rows'] == 240
    target = 'label' if task == 'text-classification' else 'target' if task == 'forecasting' else ''
    clean = request('/datasets/'+data['dataset_id']+'/preprocess',{'target':target,'drop_duplicates':False})
    return request('/jobs',{'dataset_id':clean['dataset_id'],'task':task,'time_limit':30,'name':f'Extended cloud check: {task}'})


def timed_call(deployment, payload):
    start = time.perf_counter(); status = 0; count = 0
    try:
        req = Request(base+deployment['predict_path'],data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-Api-Key':deployment['api_key']},method='POST')
        with urlopen(req,timeout=35) as response:
            status=response.status; output=json.load(response); count=len(output.get('predictions',[]))
    except HTTPError as error:
        status=error.code; error.read()
    except (TimeoutError,OSError): status=0
    return {'status':status,'latency_ms':round((time.perf_counter()-start)*1000,2),'predictions':count}


def percentile(values, p):
    values=sorted(values); position=(len(values)-1)*p; lower=int(position)
    return round(values[lower]+(values[min(lower+1,len(values)-1)]-values[lower])*(position-lower),2)


def main():
    output=Path(os.environ.get('EVIDENCE_PATH','Cloud_Report/evidence/extended-cloud.json'))
    output.parent.mkdir(parents=True,exist_ok=True)
    aws=session(); cf=aws.client('cloudformation'); stack=cf.describe_stacks(StackName='stratus-automl')['Stacks'][0]
    outputs={x['OutputKey']:x['OutputValue'] for x in stack['Outputs']}
    table=aws.resource('dynamodb').Table(outputs['TableName']); s3=aws.client('s3'); asg=aws.client('autoscaling')
    token=os.environ['ID_TOKEN'].split('.')[1]; claims=json.loads(base64.urlsafe_b64decode(token+'='*(-len(token)%4)))
    owner=claims['sub']
    # Guard against ever running cleanup under the real user's account.
    if not claims.get('email','').endswith('@example.invalid'): raise RuntimeError('Use a dedicated temporary verification user')
    evidence={'started_at':datetime.now(timezone.utc).isoformat(),'region':aws.region_name,'client':'macOS client in Vietnam; HTTPS over public Internet',
              'fixture':'Deterministic synthetic 240 rows per task, seed/formulas in scripts/check_extended_ml.py; functional checks, not a quality benchmark',
              'runtime':'AutoGluon Tabular 1.4.0, torch 2.10 CPU, m7i-flex.large inference', 'jobs':[],'scaling':[],'load':[]}
    deployments=[]
    try:
        jobs=[(name,upload(name)['job_id']) for name in ['anomaly-detection','clustering','text-classification','forecasting']]
        print('Four jobs submitted through upload/preprocess/API',flush=True)
        deadline=time.monotonic()+1200; pending=dict(jobs)
        while pending:
            group=asg.describe_auto_scaling_groups(AutoScalingGroupNames=['stratus-automl-workers'])['AutoScalingGroups'][0]
            evidence['scaling'].append({'at':datetime.now(timezone.utc).isoformat(),'desired':group['DesiredCapacity'],'instances':len(group['Instances'])})
            for task,job_id in list(pending.items()):
                job=request('/jobs/'+job_id)
                if job['status']=='FAILED': raise RuntimeError(task+': '+job.get('error','unknown training failure'))
                if job['status']=='COMPLETED':
                    evidence['jobs'].append({'task':task,'job_id':job_id,'metrics':job['metrics'],'created_at':job.get('created_at'),'started_at':job.get('started_at'),'finished_at':job.get('finished_at')})
                    del pending[task]; print('Completed',task,flush=True)
            if time.monotonic()>deadline: raise TimeoutError('Training did not finish within 20 minutes')
            if pending: time.sleep(10)
        for task,job_id in jobs:
            deployment=request('/deploy',{'job_id':job_id}); deployments.append(deployment)
            payload={'horizon':3} if task=='forecasting' else {'rows':[{'text':'Sản phẩm tốt giao nhanh hài lòng'}] if task=='text-classification' else [{'frequency':3,'spend':100,'tenure':6}]}
            cold=timed_call(deployment,payload); warm=timed_call(deployment,payload)
            assert cold['status']==200 and warm['status']==200 and warm['predictions']==(3 if task=='forecasting' else 1),(task,cold,warm)
            record=next(x for x in evidence['jobs'] if x['task']==task); record.update(first_request=cold,warm_request=warm)
            bad=timed_call({**deployment,'api_key':'invalid-test-key'},payload); assert bad['status']==401
            print('Inference and API-key check passed:',task,flush=True)
            if task not in ('anomaly-detection','text-classification'): continue
            for concurrency in (1,2,4):
                start=time.perf_counter()
                with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
                    measurements=list(pool.map(lambda _:timed_call(deployment,payload),range(12)))
                elapsed=time.perf_counter()-start; latencies=[r['latency_ms'] for r in measurements]; successful=[r['latency_ms'] for r in measurements if r['status']==200]
                phase={'task':task,'concurrency':concurrency,'requests':12,'duration_s':round(elapsed,3),'throughput_rps':round(12/elapsed,3),
                       'statuses':{str(s):sum(r['status']==s for r in measurements) for s in sorted({r['status'] for r in measurements})},
                       'p50_ms':percentile(latencies,.5),'p95_ms':percentile(latencies,.95),
                       'success_p95_ms':percentile(successful,.95) if successful else None,'measurements':measurements}
                evidence['load'].append(phase); print('Load',task,'concurrency',concurrency,phase['statuses'],'p95',phase['p95_ms'],flush=True)
        evidence['status']='PASS'
    except Exception as error:
        evidence['status']='FAILED'; evidence['error']=str(error); raise
    finally:
        evidence['finished_at']=datetime.now(timezone.utc).isoformat()
        output.write_text(json.dumps(evidence,ensure_ascii=False,indent=2,default=lambda v:int(v) if v==int(v) else float(v)))
        for deployment in deployments:
            request('/deployments/'+deployment['deployment_id'],method='DELETE')
        # CLI login credentials are short-lived; refresh before cleanup.
        cleanup_aws = session()
        table = cleanup_aws.resource('dynamodb').Table(outputs['TableName'])
        s3 = cleanup_aws.client('s3')
        from boto3.dynamodb.conditions import Attr
        records=[]; query={'FilterExpression':Attr('owner').eq(owner)}
        while True:
            page=table.scan(**query); records.extend(page['Items'])
            if not page.get('LastEvaluatedKey'): break
            query['ExclusiveStartKey']=page['LastEvaluatedKey']
        # Never remove artifacts of jobs still running; leave failed run evidence for diagnosis.
        if any(r.get('status') in ('QUEUED','TRAINING') for r in records):
            print('Cleanup deferred: a verification job is still active.',flush=True)
        else:
            keys={r[k] for r in records for k in ('upload_key','dataset_key','model_key') if r.get(k)}
            for key in keys:
                for page in s3.get_paginator('list_object_versions').paginate(Bucket=outputs['BucketName'],Prefix=key):
                    versions=[{'Key':v['Key'],'VersionId':v['VersionId']} for field in ('Versions','DeleteMarkers') for v in page.get(field,[]) if v['Key']==key]
                    if versions: s3.delete_objects(Bucket=outputs['BucketName'],Delete={'Objects':versions,'Quiet':True})
            with table.batch_writer() as batch:
                for record in records: batch.delete_item(Key={'id':record['id']})
            print('Temporary test records and artifact versions removed.',flush=True)

if __name__=='__main__': main()
