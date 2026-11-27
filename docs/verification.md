# Kiểm chứng implementation

Đã chạy trong môi trường local của repository ngày 27/11/2026:

| Kiểm tra | Kết quả |
| --- | --- |
| `python -m unittest discover -s tests -v` | 32 tests pass |
| `cfn-lint infra/*.yaml` | Pass cho backend, frontend, network và ECR |
| `bash -n scripts/deploy.sh` | Pass |
| `npm run build` | TypeScript + Vite production build pass |
| Docker build `linux/amd64` | AutoGluon import check + pip check pass |
| Smoke classification | Upload → profile → preprocess → SQS/worker → S3 model → deploy → predictions `low`, `high` |
| Smoke regression | Cùng luồng trên, trả số hữu hạn cho hai input rows |
| Key sai | Prediction trả 401 |
| Lambda RIE | Cold và warm invocation pass trong container read-only, Docker memory limit 2 GiB |
| UI Chrome | Landing, dashboard, upload mẫu, profile/preprocess, validation/test metrics và confusion matrix hoạt động |
| Test holdout | Stratified split disjoint/reproducible; 48/240 dòng test; classification accuracy/F1 1.0, regression MAE 7.22 / RMSE 11.66 / R² 0.994 trên dữ liệu synthetic smoke |

Moto tests kiểm tra owner isolation, pagination, API key rotation/revocation, auth required, cancel/retry,
lease ownership, DLQ giữ active lease, archive traversal, metadata bounds và các task validation.

LocalStack giả lập S3/SQS/DynamoDB; model training/inference sử dụng AutoGluon/LightGBM thật.
Lambda Runtime Interface Emulator xác minh runtime handler/image, không mô phỏng đầy đủ điều kiện AWS.
Số memory trong log REPORT của emulator không phải phép đo RAM AWS thực tế.

Đã deploy AWS thật tại ap-southeast-2: VPC, ECR/runtime image, private S3, DynamoDB/GSI/PITR,
SQS/DLQ, IAM worker, launch template, ASG min=0/desired=0/max=2 và CloudWatch alarms.
Stack backend và frontend ở UPDATE_COMPLETE theo chế độ triển khai từng giai đoạn.

Account hiện chặn EC2 (quota 0 vCPU), Lambda (AccessDenied) và CloudFront (account verification).
API/Cognito/Lambda và CloudFront được giữ tắt trong template; frontend local dùng LocalStack.
Chưa xác minh cloud API authentication, ASG 0→N→0, train trên EC2 hay Lambda inference thật,
CloudFront propagation, budget email, latency dưới tải và chi phí thực tế.
Support case 179576527600876 đã gửi. Xem [deployment-status.md](deployment-status.md) để tiếp tục.

Các lỗi phát hiện và đã sửa trong kiểm thử: chuyển kiểu Decimal khi ghi lại DynamoDB/retry,
reserved attribute `metrics`, dependency `typing_extensions` thiếu trong AutoGluon minimal image,
Nginx giữ IP container cũ sau recreate. Không dùng dữ liệu/model giả để thay thế smoke ML thật.
