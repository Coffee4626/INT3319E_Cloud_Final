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
| `stratus-automl-registry` | CREATE_COMPLETE | ECR runtime AutoGluon/LightGBM + PyTorch CPU amd64 |
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
| Inference instance | `i-0fc79d59ea5b6ea40` |
| Inference logs | `stratus-automl-InferenceLogs-St4PnloVNzIT` |
| Runtime digest | `sha256:f1fa95a7e8e8856f16f53fde5d4f23ff92477b9502d01b8673cf755dde16f860` |

## Cấu hình compute

EC2 Standard quota **8 vCPU**. ASG có Min=0, Max=1; worker **m7i-flex.large**, 2 vCPU / 8 GiB RAM.
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

- 50 tests Python, 17 tests frontend, TypeScript/Vite build, CloudFormation lint: pass.
- GitHub backend/frontend CI và Cloudflare Workers Builds cho commit `74af061`: success.
- Production `/config.js` đã chứa đúng API/Cognito mới và `inferenceMode=ec2`, cache-control no-store; `/app` trả 200.
- Màn hình khóa workspace đã kiểm tra bằng Chrome headless ở desktop và viewport 390 px, không có tràn ngang.
- Cognito Hosted UI trả form đăng nhập; SRP login bằng tài khoản kiểm thử tạm thành công.
- Cognito `AllowAdminCreateUserOnly=true`; hiện chỉ có email được mời `ducluu.lqd@gmail.com`. Không mở tự đăng ký. Toàn bộ workspace yêu cầu đăng nhập, xác minh phiên qua API trước khi hiển thị; token bị từ chối sẽ đóng workspace.
- API quản trị từ chối request không đăng nhập với 401; CORS API/S3 và callback/logout Cognito đúng domain Cloudflare.
- Upload CSV thật lên S3 và profile/preprocess qua API thành công. Đã sửa presigned POST sang S3 regional hostname để tránh HTTP 307 trên bucket mới.
- Hai job classification/regression đã được gửi vào SQS; ASG tự đổi Desired từ 0 sang 1.
- Hai mô hình đã train xong, có đường cong và test holdout. Lambda inference 512 MB timeout sau 28 giây ở cold request (227 MB peak); triển khai đã chuyển sang EC2 riêng để tránh hạn chế compute.
- **Smoke toàn luồng trên cấu hình EC2 inference: PASS** cho classification và regression, mỗi bài 240 dòng, 48 dòng holdout. Upload/profile/preprocess, queue/train, metrics/curves, deploy, first/warm inference, từ chối key sai đều đã được kiểm tra qua API thật.
- EC2 inference đã báo health check 200; CloudFormation UPDATE_COMPLETE. Security group thực tế chỉ mở 8080 từ Lambda SG; không có public inbound/SSH.
- **Auto Scaling 0 → 1 → 0: PASS.** Alarm QueueHasWork tăng Desired 0 → 1 lúc 17:33:32, worker `i-02f93a624532616ce` train xong. Alarm QueueIdle tự giảm 1 → 0 lúc 17:51:24; lúc 17:52:33 nhóm không còn instance. Các mốc dùng giờ Việt Nam. Máy inference vẫn chạy riêng; không dùng thao tác thủ công để kết thúc chu kỳ kiểm thử này.

| Bài kiểm thử | Job | Chỉ số trên test holdout | Lần dự đoán đầu / gọi lại |
| --- | --- | --- | --- |
| Classification | `026787e1a2834cdbb742927a19d2895e` | Accuracy / balanced accuracy / weighted F1 = 1.0 | 2295 / 1035 ms |
| Regression | `a0078803f7774c26a107f7d150fabb9a` | MAE 7.2228, RMSE 11.6618, R² 0.9940 | 1164 / 1269 ms |

Cả hai có 120 điểm đường cong thật (log loss hoặc RMSE). Đây là dữ liệu kiểm thử đơn giản, không phải
cam kết chất lượng hoặc latency cho dữ liệu người dùng. Thời gian gồm mạng từ máy chạy kiểm thử.
Các deployment kiểm thử: `8e1247f1230a45d58475c48f822de2a4`, `1d696f0965464f47822a0c4ef8b79bf6`.
Tài khoản kiểm thử tạm đã được xóa; tài khoản người dùng không bị thay đổi.

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
Giữ `WORKER_INSTANCE_TYPE=m7i-flex.large`, `MAX_WORKERS=3`, `CONTROL_MEMORY_MB=512`, `PREDICT_MEMORY_MB=512`
và `INFERENCE_MODE=ec2`, `INFERENCE_INSTANCE_TYPE=m7i-flex.large`.

`frontend/public/config.js` chỉ chứa thông tin public, không chứa AWS credentials. Build variables `STRATUS_*`
có thể ghi đè cấu hình này khi chuyển sang stack khác. Credential CLI tạm nằm ngoài repository.
Dừng nhận tác vụ và đợi queue rỗng trước khi nâng cấp runtime image. Image digest mới yêu cầu train/deploy model mới.

Lần create đầu trên account mới thất bại vì memory Lambda; stack rollback và hai tài nguyên dữ liệu rỗng
của lần thất bại đã được dọn sau khi xác minh không có dữ liệu. Các ID ở bảng trên là tài nguyên đang sử dụng.

## Nâng cấp ảnh — 18:39 ngày 27/11/2026 (giờ Việt Nam)

Backend code `71a08ce`, frontend `74af061`; CloudFormation UPDATE_COMPLETE, GitHub CI và
Cloudflare Workers Builds đều success. Runtime digest và instance inference trong bảng trên đã cập nhật.
Frontend production phục vụ assets `index-BGDuAjca.js` / `index-Btz2VGsq.css`; đã mở trực tiếp bằng
Chrome để kiểm tra landing, bốn task đang hỗ trợ và khóa workspace khi chưa đăng nhập.

Hai bài toán ảnh là **phân loại ảnh** và **phân đoạn ngữ nghĩa**, không có detection/instance segmentation.
Xem [hướng dẫn ZIP, model, chỉ số và inference](image-workflows.md).

Bốn lượt huấn luyện thật qua API có Cognito đã hoàn tất:

| Model | Job | Endpoint | Inference lần đầu / lần tiếp (ms) |
| --- | --- | --- | --- |
| mobilenet-v3 | `adb641740ce0598c8e8f68e540795689` | `df1228d1912e42d7859833b54ae5bd61` | 2427 / 1110 |
| resnet18 | `0e0de0bfdb48511ea80de4ee7713815e` | `1542f411d6dd45b586b51e6f031cf702` | 1766 / 1044 |
| unet | `54f3204876d05d23925ce475fd377e7a` | `c16543a585ae4636b47689b86ff7e9ec` | 1166 / 1012 |
| deeplab-mobile | `6d6ee0c9e687546ca9c272c06da1cc34` | `4a378369561240f3875479f88023e442` | 1682 / 1197 |

Mỗi lượt đều pass: ZIP trực tiếp S3, kiểm tra ảnh/mặt nạ, snapshot bất biến, chuẩn bị dữ liệu,
SQS/EC2 train, loss từng vòng, validation metrics, lưu/nạp model, deploy, inference lần đầu/lần tiếp,
từ chối API key sai (401), ảnh sai (400). Các chỉ số chỉ trên tập val của dữ liệu tổng hợp rất nhỏ,
không phải benchmark chất lượng thực tế hoặc đo latency dưới tải.

- Upload/complete/preprocess hai bộ ảnh không tạo thêm job. Thử lại cùng `submission_id` trả cùng job.
- Alarm SQS ghi nhận 4 messages, tự tăng Desired **0 → 1 lúc 18:36:32**, tạo worker `i-08c73ad287ddac684`.
- Bốn job hoàn tất khoảng 18:38. Sau kiểm thử, queue visible/in-flight/delayed đều 0; không còn job đang chạy.
- Tài khoản Cognito kiểm thử được tạo với SUPPRESS, không gửi email và đã xóa sau kiểm thử.
- Sau khi xác nhận không có công việc, worker kiểm thử được đưa về 0; policy tự thu về 0 sau 15 phút idle
  vẫn giữ nguyên. Máy inference riêng tiếp tục phục vụ endpoint.

Không thay đổi tài khoản được mời, API URL, CORS hoặc Cognito callback. Model của digest cũ vẫn cần
train/deploy lại theo cơ chế kiểm tra tương thích đã có; không xóa dữ liệu/model cũ.

## Giới hạn ZIP 200 MB — 20:37 ngày 27/11/2026

Runtime code `425ef8e`; frontend bổ sung timeout upload 10 phút trong `bccdee9`.
Giới hạn ZIP 200.000.000 bytes được áp dụng trong UI, presigned POST S3, download và validator;
giới hạn giải nén 400 MB. CSV vẫn 10 MB; các giới hạn số ảnh/kích thước ảnh giữ nguyên.

Đã kiểm thử qua API production bằng user tạm: ZIP ảnh **190.193.358 bytes**, 44 ảnh hợp lệ,
upload S3 khoảng 35,3 giây; complete/validate/snapshot khoảng 9,02 giây. Không tạo job, không bật
worker. Policy S3 được giải mã và xác nhận content-length-range 200 MB. Tệp thử lớn, mọi version
của nó, record dataset và user tạm đã được dọn sau kiểm thử.

Bộ dữ liệu có sẵn cho người dùng tại `/datasets/shapes-classification.zip` và
`/datasets/shapes-segmentation.zip`: mỗi bộ 180 train + 60 val, ảnh hình học tổng hợp 128 px.
Các ảnh `try-circle.png`, `try-square.png`, `try-triangle.png` lấy từ val để thử inference.
Có script tái tạo `scripts/create_image_examples.py`; không phải benchmark chất lượng thực tế.

## CSV 200 MB

CSV now accepts 200,000,000 bytes end to end. The existing 100,000-row / 200-column
limits remain. The browser streams inspection; the controller streams profiling and
preparation from temporary files. CSVs over 10 MB use background Lambda invocation
and dataset status polling, avoiding API Gateway request timeouts. These operations
do not queue training jobs. A controller-only image built with `Dockerfile.controller`
from the existing immutable model image preserves trained-model compatibility and
leaves worker/inference EC2 images unchanged. Full deployments clear the controller override.

## Parallel training and inference power

The deployed training group allows 0–3 m7i-flex.large workers. The regional Standard
On-Demand quota is 8 vCPU: three 2-vCPU workers plus the separate 2-vCPU inference
host fit this quota. Queue step scaling adds 1, 2 or 3 workers for visible backlogs
of 1, 2 or at least 3, capped by MaxWorkers, with 180 seconds of warmup. SQS metrics
and instance startup are asynchronous; brief jobs may finish before additional
workers become ready. The idle alarm still returns the group to zero after 15 minutes.

To pause inference in ap-southeast-2, select EC2 instance `stratus-automl-inference`
(`i-0fc79d59ea5b6ea40`) and choose Instance state → Stop instance. Later choose
Start instance. Docker is enabled on boot and the inference container uses
`--restart always`. Lambda connects to its retained private IP, so the API endpoint
and API keys remain valid. Inference requests fail while the instance is stopped
or starting; the first prediction must reload the model. S3 model artifacts remain.
Stopped instances do not incur EC2 compute charges, but their EBS storage remains billed.
