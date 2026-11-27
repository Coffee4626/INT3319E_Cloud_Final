# Stratus — Cloud AutoML Studio

Ứng dụng full stack cho **CSV/ZIP ảnh → preprocess → train trên EC2 Auto Scaling → deploy → predict**.
Frontend React + TypeScript, backend Python, hạ tầng AWS khai báo bằng CloudFormation/SAM.

**Trạng thái AWS đã triển khai:** [docs/deployment-status.md](docs/deployment-status.md).
Backend đã được triển khai trong account mới `866160682379`, region Sydney: S3, DynamoDB, SQS, ECR, EC2 Auto Scaling, Lambda, API Gateway và Cognito.
Frontend đang dùng Cloudflare: xem **[cách nối backend AWS](docs/cloudflare-backend.md)**.
URL: **https://int3319e-cloud-final.binhyb2.workers.dev**. Cấu hình public đã trỏ tới API/Cognito mới.
Phương án này không cần CloudFront. Xem trạng thái kiểm thử thực tế trong tài liệu triển khai.

## Chạy ngay trên máy

Cần Docker Desktop/Engine + Compose v2. Trên Apple Silicon, image ML chạy `linux/amd64`.

```bash
docker compose up --build -d --wait
```

Mở **http://localhost:3000**. Chọn Tạo thí nghiệm → Phân loại dữ liệu bảng → LightGBM → Dùng dữ liệu mẫu,
chọn cột `churn`, tiền xử lý rồi Bắt đầu huấn luyện.
Sau khi hoàn thành, chọn **Triển khai mô hình → Chạy dự đoán**. Có thể dùng CSV riêng.

- Frontend: http://localhost:3000
- API: http://localhost:8000
- LocalStack: http://localhost:4566 (S3, SQS, DynamoDB)
- Local không yêu cầu đăng nhập; prediction luôn cần key của deployment.
- LocalStack mô phỏng lưu trữ/hàng đợi; model được AutoGluon/LightGBM huấn luyện và dự đoán thật.
- EC2 Auto Scaling, Cognito, CloudFront và CloudWatch chỉ hoạt động khi triển khai lên AWS.
- Môi trường local phục vụ phát triển; `docker compose down` xóa state LocalStack khi container bị tạo lại.

```bash
python3 scripts/smoke.py --task all  # upload/preprocess/train/deploy/predict thật, hai bài toán
# Tùy chọn: kiểm tra chính Lambda image trong filesystem chỉ đọc + giới hạn RAM 2 GB
docker compose --profile lambda up -d inference
python3 scripts/lambda_smoke.py
docker compose --profile lambda stop inference
# Xem tiến trình
docker compose logs -f worker
# Dừng local
docker compose down
```

## Deploy AWS

Hướng dẫn đầy đủ: **[docs/aws-setup.md](docs/aws-setup.md)**, gồm tài khoản/quyền, region,
network, Cognito, build/push ECR, xác minh Auto Scaling, logs, chi phí và dọn tài nguyên.
Chạy `python3 scripts/check_aws.py` sau khi đăng nhập CLI để kiểm tra quyền Lambda và quota EC2.

```bash
aws configure sso
aws sso login --profile your-profile
export AWS_PROFILE=your-profile
export AWS_DEFAULT_REGION=ap-southeast-2
export STACK_NAME=stratus-automl
export MAX_WORKERS=1
export WORKER_INSTANCE_TYPE=m7i-flex.large
export FRONTEND_ORIGIN=https://int3319e-cloud-final.binhyb2.workers.dev
export CONTROL_MEMORY_MB=512
export PREDICT_MEMORY_MB=512
export INFERENCE_MODE=ec2
export INFERENCE_INSTANCE_TYPE=m7i-flex.large
# Không bắt buộc: export BUDGET_EMAIL=you@example.com
bash scripts/deploy.sh
```

Script tự tạo VPC hai public subnet nếu không truyền `VPC_ID` và `SUBNET_IDS`, build image **amd64**,
push ECR theo digest, deploy backend rồi xuất `/config.js`. Khi đặt `FRONTEND_ORIGIN` như trên,
frontend được Cloudflare deploy từ Git; bỏ biến này nếu muốn script tạo/publish CloudFront + S3.
AWS CLI v2, Docker Buildx, Node.js 22+, npm và Python 3.10+ cần có trên máy deploy.
Không cần SAM CLI. AWS tài khoản thật có phát sinh phí; script không tự chạy khi bạn mở repository.

## Chức năng

| Phần | Đã triển khai |
| --- | --- |
| Landing + workspace | Giao diện tiếng Việt, responsive, trạng thái loading/error/empty, navigation |
| Đăng nhập AWS | Cognito Hosted UI, OAuth code + PKCE, refresh token, đăng xuất |
| Dataset | Presigned S3 upload, profile cột, preview, thiếu/trùng, thư viện phân trang |
| Tiền xử lý | Chọn target/features, trim chuỗi, chuẩn hóa giá trị thiếu, bỏ trùng/thiếu target, bản mới bất biến |
| Huấn luyện | Dữ liệu bảng: AutoGluon/LightGBM. Ảnh: MobileNet, ResNet-18, U-Net, DeepLabV3; loss, validation metrics và confusion matrix |
| Job lifecycle | Theo dõi trạng thái, hủy khi chờ, retry tạo job mới, lease owner, heartbeat, xử lý DLQ |
| Scaling | EC2 ASG 0–N theo SQS; bảo vệ worker đang train; về 0 sau 15 phút idle |
| Deployment | Mapping model trong DynamoDB, kiểm tra image digest, key riêng chỉ lưu SHA-256 |
| Inference | API Gateway → Lambda proxy → EC2 riêng trong VPC; image ECR, model S3, cache, API key; tối đa 100 rows hoặc một ảnh base64 |
| Playground | Gửi JSON/ảnh, xem predictions/latency, xác suất, mặt nạ overlay, mẫu cURL, xoay key và thu hồi endpoint |
| Hạ tầng | IAM roles, private S3 + CloudFront OAC, DynamoDB PITR, encrypted SQS/EBS, CloudWatch, budget tùy chọn |
| Kiểm thử | Unit/integration Moto, smoke ML thật, TypeScript build, CloudFormation lint, GitHub CI |

## Cấu trúc

```text
frontend/            React + TypeScript + Vite, Nginx container
app/
  controller.py      Routes upload/dataset/job/deployment
  datasets.py        CSV profiling & preprocessing
  services.py        Job, train, deploy, predict, cache
  tasks/             Strategy/Factory cho các bài toán tabular
  infrastructure/    S3, SQS, DynamoDB adapters
  predict.py         Inference HTTP handler và xác thực key
  worker.py          SQS polling + instance scale-in protection
  inference_proxy.py Lambda chuyển tiếp đến EC2 trong VPC
  inference_server.py HTTP adapter riêng cho inference trên EC2
  dlq.py             Đồng bộ job hết retry sang FAILED
  local.py           HTTP adapter + bootstrap LocalStack
infra/
  template.yaml      SAM backend + Cognito + EC2 ASG + alarms/budget
  frontend.yaml      Private S3 + CloudFront HTTPS
  registry.yaml      ECR immutable tags
  network.yaml       VPC, hai public subnet, Internet Gateway
scripts/
  deploy.sh          Build/push/deploy toàn bộ AWS
  write_config.py    Tạo public runtime config từ stack outputs
  smoke.py           Kiểm tra ML end-to-end thật
  lambda_smoke.py    Kiểm tra cold/warm inference qua Lambda runtime emulator
```

## API

Chi tiết payload: **[docs/api.md](docs/api.md)**. Các route quản trị yêu cầu Cognito ID token ở AWS;
`POST /predict/{id}` yêu cầu `X-Api-Key` riêng của endpoint, không dùng Cognito token.

| Method | Route | Chức năng |
| --- | --- | --- |
| GET | `/health` | Kiểm tra API |
| POST | `/uploads` | Cấp presigned POST upload CSV |
| POST | `/datasets/{id}/complete` | Profile + chụp bản dữ liệu bất biến |
| GET | `/datasets`, `/datasets/{id}` | Danh sách / chi tiết dataset |
| POST | `/datasets/{id}/preprocess` | Tạo bản dữ liệu đã xử lý |
| POST / GET | `/jobs` | Tạo / liệt kê thí nghiệm |
| GET | `/jobs/{id}` | Trạng thái, metrics, lỗi |
| POST | `/jobs/{id}/cancel`, `/jobs/{id}/retry` | Hủy job chờ / thử lại |
| POST | `/deploy` | Tạo endpoint + key |
| GET | `/deployments`, `/deployments/{id}` | Danh sách / chi tiết endpoint |
| POST | `/deployments/{id}/key` | Thay key, vô hiệu key cũ |
| DELETE | `/deployments/{id}` | Thu hồi endpoint |
| POST | `/predict/{id}` | Dự đoán một batch rows |

## Phát triển

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
cfn-lint infra/*.yaml
docker compose config --quiet
bash -n scripts/deploy.sh

cd frontend
npm ci
npm run dev       # http://localhost:5173, proxy /api -> :8000
npm run build
```

## Phạm vi và giới hạn

- Giao diện cung cấp phân loại ảnh, phân đoạn ngữ nghĩa, phân loại và hồi quy dữ liệu bảng.
  [Hướng dẫn ảnh, cấu hình và inference](docs/image-workflows.md). ZIP ảnh tối đa 200 MB.
  Wizard giữ tệp trên thiết bị: chỉ bấm Bắt đầu huấn luyện mới upload, chuẩn bị dữ liệu và tạo job.
  Biểu đồ hạ tầng mô tả kiến trúc; không tự suy diễn số máy đang chạy từ trạng thái job.
- CSV UTF-8, tối đa 10 MB / 100.000 rows / 200 cột, header ≤128 ký tự; upload trực tiếp S3.
  API inline cũ (`POST /jobs` kèm `csv`) vẫn hỗ trợ, giới hạn 1 MB.
- Tiền xử lý không fit mean/median/encoder trên toàn bộ dataset. AutoGluon xử lý feature trong train;
  khoảng 20% dữ liệu được giữ riêng trước khi fit để đánh giá test (seed 42, stratified với classification).
  Dataset dưới 20 dòng hoặc có lớp dưới 5 mẫu chỉ có validation và hiển thị lý do không tách test.
  Random split không phù hợp để đo tổng quát hóa cho dữ liệu thời gian hoặc nhiều dòng cùng một thực thể.
- Model image là runtime dùng chung cho worker và Lambda theo sơ đồ. Artifact model nằm ở S3;
  deploy không build một Docker image riêng cho từng model. Chỉ model từ worker của hệ thống mới được load.
- `time_limit` 10–600 giây là ngân sách fit mềm, không phải hard timeout cho toàn bộ job.
  Bài toán ảnh dùng thư mục val để chọn checkpoint và báo chỉ số, chưa có test độc lập.
- Production dùng `INFERENCE_MODE=ec2`: một máy 2 vCPU / 8 GB luôn chạy để phục vụ endpoint; worker train co giãn 0–1.
  Lambda proxy chờ tối đa 25 giây; model ≤1 GB uncompressed và body dự đoán ≤1 MB.
  EC2 xử lý một request mỗi lần để bảo vệ cache; request đồng thời trả 429 để client thử lại.
  Đây là một máy inference, chưa có cân bằng tải/HA. Có thể chọn `INFERENCE_MODE=lambda` khi quota memory/CPU phù hợp.
- Mỗi process cache một model; luân phiên nhiều deployment gây reload. Không có cam kết latency production.
- Khi đổi image digest, runtime từ chối model cũ để tránh lệch dependency. Cần retrain/redeploy model;
  dừng submit và đợi queue rỗng trước khi upgrade stack.
- Dashboard đếm trên trang gần nhất (30 records mỗi loại), hiển thị chú thích khi có trang tiếp theo.
- Local không phải môi trường multi-user an toàn. AWS dùng Cognito + owner checks cho mỗi tài nguyên;
  quyền truy cập prediction là bearer key, cần giữ ở backend của ứng dụng khách.
- API rate limit ở Gateway là best effort; không có billing quota theo user, thanh toán, custom domain,
  GPU, time-series, NLP, object detection hoặc instance segmentation.

Tham khảo thiết kế và nguồn AWS: [docs/architecture.md](docs/architecture.md).
