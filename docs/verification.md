# Kiểm chứng implementation — 27/11/2026

Thông tin triển khai và tài nguyên hiện tại: [deployment-status.md](deployment-status.md).
Tài khoản production là `866160682379`, ap-southeast-2; các hạn chế của tài khoản cũ chỉ còn là
[lịch sử](deployment-previous-account.md), không phải trạng thái backend hiện tại.

## Kiểm tra cho phiên bản ảnh

| Kiểm tra | Kết quả |
| --- | --- |
| Python unit/integration | 50 tests pass; gồm ảnh/mặt nạ, ZIP không an toàn, giới hạn config, owner, idempotency và không enqueue khi chuẩn bị dữ liệu |
| Frontend | 17 tests pass; TypeScript + Vite production build pass |
| CloudFormation | `cfn-lint infra/*.yaml`, `bash -n scripts/deploy.sh` pass |
| Docker amd64 | CPU torch 2.10.0 + torchvision 0.25.0, import và pip check pass; pretrained weights có sẵn trong image |
| Model CPU thật | MobileNet V3 Small, ResNet-18, U-Net Small, DeepLabV3 MobileNet: fit, loss/metrics, lưu, nạp và inference pass |
| Chrome wizard | Cả hai bài toán ảnh: chọn model/file/options/review không gọi API ghi; bấm Start hai lần chỉ tạo một job |
| Chrome inference | Preview ảnh local, gửi ảnh khi bấm Predict; nhãn/xác suất; overlay/opacity/tải mask; desktop 1440 và mobile 390 px không tràn ngang |

`scripts/smoke_vision.py` chạy bốn model thật trong container production. Bộ ảnh tổng hợp 64 px rất nhỏ
chỉ kiểm tra tính đúng đắn của pipeline; điểm số cao trên đó không đo năng lực tổng quát hóa.
`scripts/smoke_vision_cloud.py` kiểm tra API có đăng nhập → ZIP S3 → profile/preprocess → explicit job
→ EC2 worker → metrics → endpoint → cold/warm inference, key sai và ảnh sai. Kết quả AWS sau mỗi
lần chạy được ghi trong tài liệu deployment; script không in token, API key hoặc base64 ảnh.

## Bằng chứng tabular trước nâng cấp ảnh

Đã xác minh trên tài khoản mới: Cognito SRP login và chỉ nhận user do admin thêm, API từ chối
management request không đăng nhập, CORS và callbacks Cloudflare, presigned POST S3 đúng region,
huấn luyện LightGBM classification/regression với 48/240 dòng test holdout, loss curves và inference
cold/warm qua Lambda proxy → EC2. ASG tăng 0→1 theo SQS rồi tự về 0 sau 15 phút idle.

Lambda inference trực tiếp 512 MB từng timeout; production dùng EC2 inference riêng 2 vCPU/8 GiB.
Các thử nghiệm RIE/local không thay thế bằng chứng AWS, không đo latency dưới tải hoặc chi phí dài hạn.

Các hợp đồng giới hạn và phân biệt validation/test: [image-workflows.md](image-workflows.md).
