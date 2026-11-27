# Phân loại ảnh và phân đoạn ngữ nghĩa

Hai bài toán ảnh được hỗ trợ từ chọn model, chuẩn bị dữ liệu, huấn luyện trên EC2 Auto Scaling,
đánh giá, lưu artifact S3, triển khai endpoint đến inference. Phát hiện đối tượng và instance
segmentation không nằm trong phiên bản này. Dữ liệu bảng vẫn chạy LightGBM như trước.

## Khi nào tài nguyên được sử dụng?

Wizard giữ `File`, model và các tùy chọn trong bộ nhớ trình duyệt. Các bước chọn model, chọn tệp,
xác nhận cấu hình dữ liệu và xem lại **không gọi API ghi**. Đóng trang tại đây không upload và không
tạo job. Tệp chưa lưu sẽ mất khi tải lại trang.

Chỉ nút **Bắt đầu huấn luyện** mới chạy chuỗi:

1. Xin presigned POST và tải ZIP/CSV lên S3.
2. Xác minh cấu trúc và dữ liệu; lưu snapshot bất biến.
3. Ghi phiên bản dữ liệu đã chuẩn bị.
4. `POST /jobs` ghi DynamoDB và đưa một message vào SQS.
5. CloudWatch/SQS kích hoạt nhóm EC2 từ 0 lên 1; worker nhận và huấn luyện.

Frontend chặn bấm lặp đồng thời. `submission_id` UUID được giữ khi thử lại một yêu cầu, và server
dùng conditional put để không tạo thêm job cho cùng user/UUID/cấu hình. Đổi cấu hình với cùng UUID
trả 409. Nếu gửi queue thất bại, job được đánh dấu FAILED và có thể retry từ trang thí nghiệm.
Các API upload/complete/preprocess riêng không tác động SQS hay Auto Scaling.

Worker thu về 0 sau 15 phút hàng đợi rỗng và không còn job đang xử lý. Máy **inference EC2 riêng
vẫn chạy liên tục** để phục vụ endpoint; việc chờ người dùng cấu hình không tạo thêm máy inference.

## Phân loại ảnh

```text
dataset.zip
├── train/
│   ├── cat/001.jpg
│   └── dog/002.jpg
└── val/
    ├── cat/003.jpg
    └── dog/004.jpg
```

ZIP đặt `train` và `val` ngay tại gốc, không bọc thêm thư mục dataset. Có 2–100 lớp và mỗi lớp
phải xuất hiện trong cả hai tập. Chia tập theo nguồn/đối tượng để tránh ảnh gần giống lọt vào hai tập.

- **MobileNet V3 Small**: bộ mã hóa ImageNet cố định, học đầu phân loại.
- **ResNet-18**: bộ mã hóa ImageNet cố định, học đầu phân loại.
- Chỉ số: accuracy, macro F1, cross-entropy và ma trận nhầm lẫn trên `val`.
- Inference: nhãn, xác suất cao nhất và xác suất của tất cả lớp.

## Phân đoạn ngữ nghĩa

```text
dataset.zip
├── classes.json
├── images/train/001.jpg
├── images/val/002.jpg
├── masks/train/001.png
└── masks/val/002.png
```

`classes.json` là mảng tên lớp, ví dụ `["background", "road", "car"]`. Chỉ số trong mảng là
mã điểm ảnh: 0, 1, 2. Mặt nạ là PNG grayscale/palette 8-bit, cùng kích thước và tên gốc với ảnh;
không dùng ảnh mặt nạ RGB đã tô màu. Mã 255 được bỏ qua khi tính loss/chỉ số. Mỗi ảnh cần ít nhất
một điểm ảnh có nhãn. Tập `train` và `val` đều phải có ảnh và mặt nạ tương ứng.

- **U-Net Small**: mạng hai tầng encoder/decoder với skip connections, học toàn bộ từ đầu.
- **DeepLabV3 MobileNet**: bộ mã hóa từ trọng số COCO của torchvision cố định, tinh chỉnh đầu phân đoạn.
- Chỉ số: mean IoU, Dice trung bình các lớp có xuất hiện, pixel accuracy, cross-entropy;
  ma trận nhầm lẫn đếm điểm ảnh trên lưới đã resize.
- Inference: PNG mã lớp, PNG tô màu, màu chú giải và tỷ lệ diện tích mỗi lớp. Giao diện chồng mặt nạ
  lên ảnh, chỉnh độ đậm và tải PNG mã lớp để sử dụng tiếp.

## Cấu hình, đánh giá và giới hạn

`config`: `model`, `epochs` (1–100), `batch_size` (1–16), `learning_rate` (0.00001–0.01),
`image_size` (64–256, bội 32), `augment` (lật ngang ảnh và mặt nạ đồng bộ), `early_stopping`
(dừng sau 3 vòng không cải thiện loss kiểm định). Mặc định 5 vòng, lô 4, 128 px, tốc độ học 0.001.
Ảnh RGB được resize vuông và chuẩn hóa theo ImageNet; mặt nạ resize bằng nearest-neighbor để giữ mã lớp.

Huấn luyện CPU, seed 42, 2 threads. `time_limit` 10–600 giây là ngân sách mềm: có thể kết thúc
giữa vòng train, rồi hoàn tất đánh giá vòng đó và ghi checkpoint. Khởi tạo model, kiểm tra dữ liệu,
đánh giá và lưu S3 có thể kéo dài hơn ngân sách fit. Trọng số pretrained được tải có kiểm tra hash
trong bước build Docker và đóng gói vào ECR; job không cần tải trọng số từ Internet.

Checkpoint có loss `val` thấp nhất được lưu. Loss thật của từng vòng và chỉ số của checkpoint đó
được ghi vào DynamoDB sau khi hoàn tất. **`val` dùng chọn checkpoint; chưa có tập test độc lập cho
bài toán ảnh.** Đừng hiểu các chỉ số này là kết quả đo trên dữ liệu hoàn toàn chưa dùng chọn model.

ZIP tối đa 200 MB, 5.000 entries, 400 MB giải nén; mỗi tệp tối đa 5 MB, ảnh JPEG/PNG/WebP,
tối đa 16 megapixel/ảnh và 150 megapixel toàn tập. Từ chối path traversal, symlink, tệp trùng,
ZIP mã hóa, ảnh hỏng, mặt nạ sai kích thước/mã lớp. Resize bộ dữ liệu trước khi upload nếu vượt giới hạn.
Segmentation hỗ trợ 2–32 lớp. Đây là cấu hình CPU cho dữ liệu nhỏ, không phải cụm GPU phân tán.

## API

```json
POST /uploads
{"name":"dataset.zip","task":"segmentation"}

POST /datasets/<id>/complete
{}

POST /datasets/<id>/preprocess
{}

POST /jobs
{
  "dataset_id":"<prepared-id>",
  "task":"segmentation",
  "name":"Road segmentation",
  "time_limit":300,
  "submission_id":"70509643-109e-4b85-b0c0-021a53aef925",
  "config":{"model":"unet","epochs":5,"batch_size":4,"image_size":128,
            "learning_rate":0.001,"augment":true,"early_stopping":true}
}

POST /predict/<deployment-id>
{"image_base64":"<base64 JPEG, PNG hoặc WebP; không có tiền tố data:>"}
```

Các API quản lý dùng Cognito và kiểm tra owner. Prediction dùng `X-Api-Key` của endpoint như trước.
Chuỗi base64 tối đa 900.000 ký tự (~675 KB); request body tối đa 1 MB. Không nhận URL ảnh.
Frontend nhận ảnh tối đa 10 MB/16 megapixel, resize cạnh dài tối đa 1024 px và nén JPEG trên thiết bị
trước khi người dùng bấm **Chạy dự đoán**. API cũng giới hạn ảnh đầu ra trong 1024 × 1024 px.
Các tọa độ/mặt nạ đầu ra tương ứng ảnh đã resize, không phải ảnh gốc độ phân giải cao.

Runtime giữ cùng cơ chế kiểm tra image digest: model từ image cũ cần train/deploy lại sau nâng cấp.
Không thay đổi Cognito hoặc phạm vi quyền đăng nhập khi thêm các bài toán ảnh.

## Kiểm thử model thật

```sh
docker build --platform linux/amd64 -t stratus-vision:check .
docker run --rm --platform linux/amd64 --cpus=2 --memory=4g \
  --entrypoint python -v "$PWD:/work:ro" -w /work \
  stratus-vision:check -u scripts/smoke_vision.py
```

Bài thử dùng ảnh tổng hợp rất nhỏ để xác minh fit/save/load/inference của cả bốn model;
các điểm số thu được không chứng minh chất lượng trên dữ liệu thực tế.

## Bộ dữ liệu để thử nhanh

- [ZIP phân loại](https://int3319e-cloud-final.binhyb2.workers.dev/datasets/shapes-classification.zip)
- [ZIP segmentation](https://int3319e-cloud-final.binhyb2.workers.dev/datasets/shapes-segmentation.zip)
- [Ảnh thử inference](https://int3319e-cloud-final.binhyb2.workers.dev/datasets/try-circle.png)

Mỗi bộ gồm 180 ảnh train và 60 ảnh val, 128 × 128 px, các lớp circle/square/triangle; segmentation
thêm background. Đây là dữ liệu hình học tổng hợp, seed cố định, để thử pipeline. Ảnh inference
lấy từ val, không phải test độc lập. Upload nguyên ZIP, không giải nén. Gợi ý MobileNet V3 Small
hoặc U-Net Small, 5 vòng, lô 4, 128 px, 300 giây.
