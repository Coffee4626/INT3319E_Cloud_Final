# AutoML trên AWS

Bộ khung cho tabular **classification + regression**: CSV → AutoGluon → deploy → predict.
Không có frontend. AutoGluon chỉ cài thêm LightGBM để giữ image nhỏ.

```text
API Gateway ── /jobs, /deploy ── Lambda controller ── SQS ── EC2 Auto Scaling (0–2)
            └─ /predict/{id} ── Lambda predict              │ AutoGluon.fit()
                                    └──────── S3 + DynamoDB ┘
ECR: cùng một image cho Lambda và EC2 · CloudWatch: logs + scale theo SQS
```

```text
app/
  controller.py       # HTTP: submit, status, deploy
  predict.py          # HTTP: predict
  worker.py           # vòng lặp nhận/ack SQS
  domain.py           # request, errors, storage/queue contracts
  services.py         # job lifecycle, training, prediction, model cache
  tasks/              # Factory + Strategy + Template Method cho ML task
  infrastructure/     # DynamoDB repository, S3 và SQS adapters
  runtime.py          # dependency injection: nối services với AWS
infra/                # CloudFormation/SAM: AWS stack + ECR
scripts/deploy.sh     # build amd64, push ECR, deploy stack
scripts/smoke.py      # thử toàn bộ luồng bằng dữ liệu mẫu tự sinh
tests/                # kiểm tra API/state với AWS giả lập
Dockerfile
compose.yaml          # API + worker + LocalStack (S3/SQS/DynamoDB)
```

## Chạy local

Cần Docker Desktop/Engine đang chạy, Compose v2 và Python 3.9+ cho script smoke.
Lần build đầu tải các thư viện ML; trên Apple Silicon sẽ chạy giả lập `amd64`.

```bash
docker compose up --build -d
docker compose logs -f worker  # Ctrl+C để thoát xem log
python3 scripts/smoke.py --task all  # gửi cả classification và regression
docker compose down           # dữ liệu local chỉ phục vụ demo, không persist
```

API local: `http://localhost:8000`, không yêu cầu key. Smoke test sẽ in job ID,
deployment ID và predictions. Nếu API chưa sẵn sàng, chờ service `init` hoàn tất.

## Deploy AWS

Cần AWS CLI v2 đã đăng nhập (`aws configure` hoặc SSO), Docker Buildx và quyền tạo
CloudFormation, IAM, Lambda, API Gateway, ECR, EC2/ASG, S3, SQS, DynamoDB, CloudWatch.
Không cần cài SAM CLI; CloudFormation xử lý SAM template trực tiếp.

1. Chọn default VPC và **public subnets cùng VPC**, có route Internet Gateway.
   Worker nhận public IP để pull ECR/gọi AWS, nhưng security group không mở cổng inbound.
2. Điền biến và deploy:

```bash
export AWS_DEFAULT_REGION=us-east-1
export VPC_ID=vpc-xxxxxxxx
export SUBNET_IDS=subnet-xxxxxxxx,subnet-yyyyyyyy
# Tuỳ chọn: BUDGET_EMAIL=you@example.com (cần quyền AWS Budgets), MAX_WORKERS=2
bash scripts/deploy.sh
```

Script tạo stack `automl-demo-registry`, push image theo digest, rồi tạo `automl-demo`.
Có thể đổi tên qua `STACK_NAME`. Lấy URL/key và chạy thử:

```bash
export API_URL=$(aws cloudformation describe-stacks --stack-name automl-demo \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue | [0]' --output text)
KEY_ID=$(aws cloudformation describe-stacks --stack-name automl-demo \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiKeyId`].OutputValue | [0]' --output text)
export API_KEY=$(aws apigateway get-api-key --api-key "$KEY_ID" --include-value --query value --output text)
python3 scripts/smoke.py --task all
```

## API

AWS yêu cầu header `x-api-key: $API_KEY` cho tất cả route.

| Method / route | JSON body / kết quả |
| --- | --- |
| `POST /jobs` | `{"task":"regression", "csv":"x,y\n1,2\n2,4\n", "target":"y", "time_limit":60}` → `job_id` |
| `GET /jobs/{id}` | `QUEUED → TRAINING → COMPLETED` hoặc `FAILED` kèm `error` |
| `POST /deploy` | `{"job_id":"..."}` → `deployment_id`, `predict_path` |
| `POST /predict/{id}` | `{"rows":[{"x":3}]}` → `{"predictions":[...]}` |

`/deploy` lưu mapping tới model đã train trong DynamoDB; Lambda predict dùng chung
để phục vụ các deployment. Dùng **một API key chung**, chưa tạo key riêng như sơ đồ.
API key phục vụ demo/throttling, chưa có đăng nhập hay phân quyền theo người dùng.

`task`: `classification` (binary/multiclass), `regression` (target số hữu hạn), hoặc
`tabular` (mặc định, AutoGluon tự suy luận như API cũ). CSV cần ít nhất một feature
và hai dòng; demo train nên dùng nhiều dữ liệu hơn. Task được lưu cùng job/deployment
để chọn đúng strategy khi train và predict. Các task dùng chung queue và worker pool.
Xem [kiến trúc và cách thêm task](docs/architecture.md).

## Vận hành & giới hạn demo

- CSV tối đa 1 MB, `time_limit` 10–600 giây, mỗi lần predict tối đa 100 dòng.
- EC2 mặc định `t3.large`, mỗi worker xử lý một job. Job đầu chờ alarm/boot/pull image vài phút.
  ASG tăng theo message chờ, về 0 sau 15 phút không còn message chờ **lẫn đang xử lý**.
- SQS visibility 1 giờ; worker chết thì job được thử lại sau thời gian này.
  Lỗi train được ghi `FAILED`; message nhận quá 3 lần vào DLQ (output `DeadLetterQueueUrl`).
  Bản tối giản chưa tự đồng bộ trạng thái job khi message vào DLQ.
- Xem CloudWatch log groups của hai Lambda và worker; retention 7 ngày.
  Predict có timeout 28 giây; model lớn/cold start có thể vượt giới hạn demo.
- Chỉ cập nhật stack/image khi hàng đợi đã rỗng: rolling update có thể thay EC2 đang train.
  Chỉ load artifact do worker tạo; giữ cùng phiên bản AutoGluon cho train và predict.
- EC2/EBS/public IPv4/ECR và các request AWS có tính phí. `BUDGET_EMAIL` bật cảnh báo
  ngân sách **toàn tài khoản** 10 USD/tháng, gửi khi vượt 80%; không tự dừng tài nguyên.
- Dọn stack: `aws cloudformation delete-stack --stack-name automl-demo`.
  S3 được giữ lại để tránh mất model/CSV; ECR ở stack registry riêng. Sau khi xác nhận
  không cần dữ liệu, xoá object/bucket và image ECR, rồi xoá stack `automl-demo-registry`.

## Kiểm tra code

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
cfn-lint infra/*.yaml
docker compose config --quiet
```

Tests giả lập AWS; kiểm tra train/predict thật bằng `scripts/smoke.py` khi Docker/AWS sẵn sàng.
Tham khảo: [AutoGluon 1.4](https://auto.gluon.ai/1.4/install.html),
[Lambda container](https://docs.aws.amazon.com/lambda/latest/dg/python-image.html),
[SAM API key](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-api-apiusageplan.html).
