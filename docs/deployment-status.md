# Trạng thái triển khai thực tế — 27/11/2026

Project **Cloud Computing Finals**, account `080665850368`, region **ap-southeast-2 (Sydney)**.
Region đã được xác minh trong AWS Settings → Project → Additional info.

## Phần đã chạy được

- Frontend tại **http://localhost:3000**: landing, upload CSV, profile/preprocess, train,
  kết quả validation + test set riêng, deploy endpoint và inference playground.
- Model AutoGluon/LightGBM thật, LocalStack cho S3/SQS/DynamoDB khi chạy local.
- 32 tests pass; build frontend, CloudFormation lint và Lambda RIE cold/warm pass.
- Classification và regression smoke pass, có test metrics từ 48/240 dòng holdout.

## Tài nguyên AWS thật đã tạo

| Stack | Trạng thái | Nội dung |
| --- | --- | --- |
| `stratus-automl-network` | CREATE_COMPLETE | VPC, hai public subnet, Internet Gateway, routes |
| `stratus-automl-registry` | CREATE_COMPLETE | ECR immutable tags; image amd64 AutoGluon đã push |
| `stratus-automl` | UPDATE_COMPLETE | S3, DynamoDB/GSI/PITR, SQS/DLQ, EC2 launch template/ASG, IAM, CloudWatch |
| `stratus-automl-web` | UPDATE_COMPLETE | Bucket frontend private, encryption, HTTPS-only policy |

Backend đang đặt `EnableApi=false`; frontend stack `EnableHosting=false`.
Đây là triển khai theo giai đoạn, **chưa phải ứng dụng cloud hoạt động đầy đủ**.
API Gateway, Cognito, controller/predict/DLQ Lambda và CloudFront chưa được bật.
Budget email chưa cấu hình. Frontend local vẫn kết nối LocalStack, không giả làm API AWS.

ASG `stratus-automl-workers`: **Min=0, Desired=0, Max=2**, `t3.large` (2 vCPU, 8 GiB RAM).
Chưa có EC2 chạy. Policies tăng 1 theo queue và về 0 sau khi queue/in-flight rỗng 15 phút.
Chưa xác minh được chu kỳ EC2 0→N→0 hay inference Lambda thật vì các hạn chế dưới đây.

Resource IDs chính:

- VPC: `vpc-0fd7ddacc97723d84`
- Subnets: `subnet-051a418ba21c29ca9`, `subnet-0278c570f1a9e0b0d`
- Data bucket: `stratus-automl-databucket-jtzakrfsv2mq`
- DynamoDB: `stratus-automl-StateTable-34KAEHDEAY5E`
- Job queue: `stratus-automl-JobQueue-C5XH3Vl8hD8O`
- DLQ: `stratus-automl-DeadLetterQueue-w4TTMVaanB6T`
- Frontend bucket: `stratus-automl-web-webbucket-yexgf1lrkfki`
- ECR repository: `stratus-automl-registry-registry-i8s7whs6toxz`
- Runtime digest: `sha256:94528cc76d1e47855140fa675d9288563a78f86262ff30f761fd89a111abbf21`

## Hạn chế cần AWS xử lý

1. EC2 Standard On-Demand quota `L-1216C47A` đang **0 vCPU**. Hai t3.large cần 4 vCPU.
   Yêu cầu 4 bị từ chối vì AWS default=5; yêu cầu 6 qua cả CLI và Console đều bị
   `Unable to perform this operation. Please contact AWS Support`.
2. CloudFront trả 403: **Your account must be verified before you can add new CloudFront resources**.
3. Lambda trả `AccessDeniedException`, bao gồm CreateFunction, ListFunctions và GetAccountSettings.
   Nguyên nhân cụ thể chưa được AWS xác nhận; đã gửi để họ kiểm tra cùng account restrictions.

Support case **179576527600876**, Account and billing → Account Activation → Account Verification,
đã gửi theo xác nhận của người dùng, kèm tin bổ sung Lambda đã được người dùng duyệt riêng.
Trạng thái cuối đã quan sát: **Unassigned**. AWS sẽ hướng dẫn bước xác minh; chủ project Bình
cần thực hiện nếu AWS yêu cầu thông tin chủ tài khoản. Không nâng cấp Paid Plan/Support Plan.

Bản nội dung ban đầu: [aws-support-request.txt](aws-support-request.txt).
Mở [AWS Support Center](https://console.aws.amazon.com/support/home) và tìm case ID trên.

## Chạy tiếp sau khi AWS mở quyền

AWS CLI phiên hiện tại được giải nén từ bộ cài AWS chính thức đã xác minh chữ ký, nằm trong `/tmp`.
Profile và credential cache tạm cũng ở `/tmp/stratus-aws-session`, không nằm trong Git.
Trong cùng máy/phiên có thể dùng:

```bash
source /tmp/stratus-aws-session/env.sh
python3 scripts/check_aws.py
```

Nếu thư mục tạm không còn, cài AWS CLI v2.32+ rồi:

```bash
aws login --profile stratus-deploy --region ap-southeast-2
export AWS_PROFILE=stratus-deploy
export AWS_DEFAULT_REGION=ap-southeast-2
export STACK_NAME=stratus-automl
python3 scripts/check_aws.py
```

Sau khi Lambda truy cập được, quota EC2 đủ và AWS đã xác nhận mở CloudFront:

```bash
export STACK_NAME=stratus-automl
export AWS_DEFAULT_REGION=ap-southeast-2
export MAX_WORKERS=2
export WORKER_INSTANCE_TYPE=t3.large
ENABLE_API=true bash scripts/deploy.sh
```

Script cập nhật các stack hiện hữu, bật CloudFront và API, publish frontend rồi in URL.
Tiếp tục tạo Cognito user và chạy smoke/scaling theo [aws-setup.md](aws-setup.md).
Nếu chỉ Lambda đã mở còn CloudFront chưa mở, có thể deploy API với
`FRONTEND_ORIGIN=http://localhost:3000 ENABLE_API=true bash scripts/deploy.sh`;
serve `frontend/dist` tại origin đó, hoặc mount `frontend/dist/config.js` vào Nginx frontend local.
Không tự đặt `local:true` để bỏ Cognito khi dùng API cloud.

## Tài nguyên giữ lại từ lần triển khai thất bại

S3 và DynamoDB đã được giữ nguyên và import lại vào stack hiện tại, không tạo bản trùng.
Hai Lambda sau bị AccessDenied cả khi tạo/xóa, nên chưa xác nhận được chúng thực sự tồn tại:
`stratus-automl-Predict-urzix9ItUxog`, `stratus-automl-DlqProcessor-iOZZWCX4ZcFV`.
Hai IAM roles liên quan đã được retain để không làm mất khả năng kiểm tra:
`stratus-automl-PredictRole-Th28I92oKyJc`, `stratus-automl-DlqProcessorRole-YDgWWxX05wLI`.
Sau khi Lambda được mở, kiểm tra và dọn những tài nguyên cũ này nếu không còn dùng;
chúng không thuộc stack hiện tại. Không xóa bucket/table dữ liệu để xử lý lỗi deployment.
