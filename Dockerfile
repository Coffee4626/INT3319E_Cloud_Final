FROM public.ecr.aws/lambda/python:3.12
RUN dnf install -y libgomp && dnf clean all
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ${LAMBDA_TASK_ROOT}/app
ENV PYTHONUNBUFFERED=1
CMD ["app.predict.handler"]
