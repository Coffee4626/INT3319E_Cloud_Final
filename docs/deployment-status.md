# Trạng thái triển khai thực tế — 27/11/2026

Bản production dùng account **866160682379**, IAM deploy `luusayhello`, region **ap-southeast-2 (Sydney)**.
Tài khoản cũ `080665850368` và các hạn chế/support case của nó được lưu tại
[deployment-previous-account.md](deployment-previous-account.md); không dùng tài khoản cũ để cập nhật bản này.

- Frontend: **https://int3319e-cloud-final.binhyb2.workers.dev** — Cloudflare Workers Builds, nhánh `main`.
- API: **https://dhajsrfama.execute-api.ap-southeast-2.amazonaws.com/prod**.
- Cognito: pool `ap-southeast-2_a0gSirlAO`, client `6j8l1n8onu8cb366miesb73tag`.
- Hosted login: `https://stratus-automl-866160682379.auth.ap-southeast-2.amazoncognito.com`.
- Lời mời đăng nhập đã gửi tới `ducluu.lqd@gmail.com`; người dùng tự đổi mật khẩu tạm trong Cognito.

## Tài nguyên đã tạo

| Stack | Trạng thái | Nội dung |
| --- | --- | --- |
| `stratus-automl-network` | CREATE_COMPLETE | VPC, hai public subnet, Internet Gateway, routes |
| `stratus-automl-registry` | CREATE_COMPLETE | ECR runtime AutoGluon/LightGBM amd64 |
| `stratus-automl` | UPDATE_COMPLETE | S3, DynamoDB/GSI/PITR, SQS/DLQ, ASG, IAM, CloudWatch, API Gateway, Cognito, ba Lambda |

Không tạo CloudFront; frontend được Cloudflare phục vụ. Budget email chưa được cấu hình.

| Tài nguyên | ID |
| --- | --- |
| VPC | `vpc-04e072d02aeb89eb7` |
| Subnets | `subnet-007e9aa0d41c72129`, `subnet-0af67cf61eb65191c` |
| Data bucket | `stratus-automl-databucket-qv4yxqsylgwl` |
| DynamoDB | `stratus-automl-StateTable-1Q78STH83CRRG` |
| Job queue | `stratus-automl-JobQueue-LrNypelsMQnq` |
| DLQ | `stratus-automl-DeadLetterQueue-f5zgFXallO7q` |
| ECR | `stratus-automl-registry-registry-ahcflaooa3yl` |
| ASG | `stratus-automl-workers` |
| Worker logs | `stratus-automl-WorkerLogs-mKkV8RjfFPUa` |

## Cấu hình compute

EC2 Standard quota **5 vCPU**. ASG có Min=0, Max=1; worker **m7i-flex.large**, 2 vCPU / 8 GiB RAM.
Đã kiểm tra instance type và AMI có thuộc loại được account cho phép tạo. Security group không mở inbound/SSH;
worker dùng instance role, IMDSv2, public IPv4 để tải image và truy cập dịch vụ AWS.

Alarm SQS tăng từng worker khi có tác vụ. Khi cả hàng đợi và tác vụ đang xử lý rỗng đủ 15 phút,
alarm thu nhóm về 0. Khi hàng đợi mới hoạt động, metric CloudWatch có thể tới muộn; không cam kết khởi động tức thì.

Máy inference riêng: **m7i-flex.large**, 2 vCPU / 8 GiB, EBS 30 GB, luôn chạy để duy trì endpoint.
Tổng compute tối đa: 2 vCPU train + 2 vCPU inference = 4 vCPU. Máy inference không scale về 0 theo worker.

Tài khoản mới giới hạn Lambda **512 MB/function**, concurrency **5**. Controller, DLQ và Predict đều đã tạo
với 512 MB; Predict chuyển tiếp request tới EC2 trong VPC, timeout HTTP 25 giây. Chế độ compute và memory được cấu hình qua CloudFormation/script deploy.
`GetAccountSettings` không thể hiện giới hạn memory này; nó chỉ được phát hiện khi AWS từ chối tạo function lớn hơn.

## Bằng chứng kiểm thử

- 41 tests Python, 13 tests frontend, TypeScript/Vite build, CloudFormation lint: pass.
- GitHub backend/frontend CI và Cloudflare Workers Builds cho commit `9192127`: success.
- Production `/config.js` đã chứa đúng API/Cognito mới; `/app` trả 200.
- Cognito Hosted UI trả form đăng nhập; SRP login bằng tài khoản kiểm thử tạm thành công.
- API quản trị từ chối request không đăng nhập với 401; CORS API/S3 và callback/logout Cognito đúng domain Cloudflare.
- Upload CSV thật lên S3 và profile/preprocess qua API thành công. Đã sửa presigned POST sang S3 regional hostname để tránh HTTP 307 trên bucket mới.
- Hai job classification/regression đã được gửi vào SQS; ASG tự đổi Desired từ 0 sang 1.
- Hai mô hình đã train xong, có đường cong và test holdout. Lambda inference 512 MB timeout sau 28 giây ở cold request (227 MB peak); triển khai đã chuyển sang EC2 riêng để tránh hạn chế compute.
- Inference EC2 và chu kỳ scale về 0 đang được xác minh; chưa coi hoàn tất cho tới khi kiểm thử trả kết quả.

## Dùng ứng dụng

1. Mở frontend, chọn **Đăng nhập**, dùng email và mật khẩu tạm trong lời mời, tự đặt mật khẩu mới.
2. Chọn **Phân loại dữ liệu bảng** hoặc **Hồi quy dữ liệu bảng**, mô hình **LightGBM**.
3. Dùng CSV mẫu hoặc upload CSV UTF-8; chọn cột đích, tiền xử lý và bắt đầu huấn luyện.
4. Đợi EC2 khởi động; xem validation leaderboard, chỉ số test holdout, đường cong loss/RMSE.
5. Triển khai mô hình, lưu khóa API vừa tạo, mở playground để dự đoán và lấy mẫu cURL.

Hiện chỉ hai bài toán dữ liệu bảng với LightGBM có bộ xử lý train/inference. Sáu bài toán khác có giao diện
và kiểm tra cấu trúc dữ liệu, nhưng chưa có bộ xử lý tương ứng. Không có GPU trong deployment này.
Dashboard chưa đọc số lượng EC2/CPU trực tiếp; mục hạ tầng hiển thị cấu hình đã triển khai có ngày ghi nhận.

## Cập nhật deployment

Dùng [cloudflare-backend.md](cloudflare-backend.md) để đăng nhập và deploy đúng account/region.
Giữ `WORKER_INSTANCE_TYPE=m7i-flex.large`, `MAX_WORKERS=1`, `CONTROL_MEMORY_MB=512`, `PREDICT_MEMORY_MB=512`
và `INFERENCE_MODE=ec2`, `INFERENCE_INSTANCE_TYPE=m7i-flex.large`.

`frontend/public/config.js` chỉ chứa thông tin public, không chứa AWS credentials. Build variables `STRATUS_*`
có thể ghi đè cấu hình này khi chuyển sang stack khác. Credential CLI tạm nằm ngoài repository.
Dừng nhận tác vụ và đợi queue rỗng trước khi nâng cấp runtime image. Image digest mới yêu cầu train/deploy model mới.

Lần create đầu trên account mới thất bại vì memory Lambda; stack rollback và hai tài nguyên dữ liệu rỗng
của lần thất bại đã được dọn sau khi xác minh không có dữ liệu. Các ID ở bảng trên là tài nguyên đang sử dụng.
