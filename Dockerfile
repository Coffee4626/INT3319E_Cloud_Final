FROM public.ecr.aws/lambda/python:3.12
RUN dnf install -y libgomp && dnf clean all
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "from autogluon.tabular import TabularPredictor" \
    && pip check
RUN pip install --no-cache-dir torch==2.10.0 torchvision==0.25.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip check
ENV TORCH_HOME=/opt/torch-cache
# Pin and bake pretrained weights so workers never download models during a job.
RUN python -c "from torchvision import models; models.mobilenet_v3_small(weights='DEFAULT'); models.resnet18(weights='DEFAULT'); models.segmentation.deeplabv3_mobilenet_v3_large(weights='DEFAULT')" \
    && chmod -R a+rX /opt/torch-cache
COPY app ${LAMBDA_TASK_ROOT}/app
ENV PYTHONUNBUFFERED=1
ENV MPLCONFIGDIR=/tmp/matplotlib XDG_CACHE_HOME=/tmp/cache
CMD ["app.predict.handler"]
