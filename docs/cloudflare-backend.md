# Kết nối frontend Cloudflare với backend AWS

Frontend được triển khai qua **Cloudflare Workers Builds**, Worker `int3319e-cloud-final`.
Cloudflare phục vụ React và các tệp tĩnh; API, huấn luyện và dự đoán chạy trên AWS.
Không cần CloudFront cho phương án này.

## Hiện có thể dùng gì?

| Chức năng | Trên máy qua Docker | Trên AWS |
| --- | --- | --- |
| Chọn bài toán, cấu hình mô hình, xem kiến trúc | Có | Frontend có thể phục vụ trên Cloudflare |
| CSV → tiền xử lý → LightGBM phân loại/hồi quy → đánh giá → dự đoán | Đã kiểm thử toàn luồng | Chưa hoạt động vì API/Lambda chưa bật và EC2 quota bằng 0 |
| S3, DynamoDB, SQS, ECR, ASG | LocalStack cho các dịch vụ dữ liệu | Đã tạo tài nguyên; ASG 0 máy |
| EC2 tự tăng/giảm theo hàng đợi | Không; Docker worker chạy cố định | Có cấu hình, chưa kiểm thử được chu kỳ 0 → N → 0 |
| Số máy EC2/CPU/GPU trực tiếp trên dashboard | Chưa có nguồn giám sát | Chưa nối API giám sát |
| Phân loại ảnh, phát hiện đối tượng, hai loại phân đoạn ảnh, phân loại văn bản, dự báo | Có giao diện cấu hình và kiểm tra định dạng | Chưa có bộ xử lý huấn luyện/dự đoán; mở quota không tự bổ sung chức năng này |
| XGBoost, Random Forest và các mô hình khác ngoài LightGBM | Chưa hỗ trợ huấn luyện từ giao diện | Chưa hỗ trợ |

Ngày 27/11/2026 đã kiểm tra lại account `080665850368`, region `ap-southeast-2`:
Lambda `GetAccountSettings` vẫn trả `AccessDeniedException`; EC2 Standard quota là **0 vCPU**;
stack `stratus-automl` ở `UPDATE_COMPLETE` với `EnableApi=false`;
ASG có Min=0, Desired=0, Max=2 và không có instance.

## 1. Gỡ hai chặn AWS

Theo dõi case **179576527600876** trong AWS Support và hoàn thành bước xác minh mà AWS yêu cầu.
Cần AWS cho phép Lambda hoạt động và nâng quota EC2 Standard On-Demand đủ cho hai `t3.large`
(tổng 4 vCPU; mức yêu cầu cụ thể theo AWS chấp nhận). Không cần mở CloudFront để dùng Cloudflare.

Đăng nhập CLI và kiểm tra lại:

```bash
aws login --profile stratus-deploy --region ap-southeast-2
export AWS_PROFILE=stratus-deploy
export AWS_DEFAULT_REGION=ap-southeast-2
export STACK_NAME=stratus-automl
export WORKER_INSTANCE_TYPE=t3.large
export MAX_WORKERS=2
python3 scripts/check_aws.py
```

Chỉ chạy tiếp khi Lambda truy cập được và quota đủ. Kiểm tra này không chứng minh toàn bộ quyền
triển khai đã đủ; kết quả deploy và thử thực tế mới xác nhận được.

## 2. Deploy backend theo đúng domain Cloudflare

Thay URL dưới đây bằng **origin production cố định**, không có dấu `/` cuối hoặc đường dẫn con.
Không dùng URL preview đổi theo từng commit. Giữ nguyên profile/region/stack ở bước trên.

```bash
export FRONTEND_ORIGIN='https://YOUR-FRONTEND.workers.dev'
ENABLE_API=true bash scripts/deploy.sh
```

Khi có `FRONTEND_ORIGIN`, script bỏ qua tạo/publish CloudFront; cập nhật backend hiện có,
build/push image ECR và tạo API Gateway, Cognito, các Lambda. S3 CORS, API CORS,
Cognito callback (`<origin>/auth/callback`) và logout đều dùng origin này.
Script không tự deploy lại Worker Cloudflare và không xóa database.

Lấy cấu hình public sau khi stack hoàn tất:

```bash
aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs' --output table
```

## 3. Cấu hình Cloudflare Workers Builds

Mở Worker **int3319e-cloud-final → Settings → Build**:

| Cài đặt | Giá trị |
| --- | --- |
| Production branch | `main` |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Trong **Build variables and secrets**, đặt đủ bốn biến dưới đây. Đây là thông tin public,
không phải AWS access key hoặc mật khẩu. Biến runtime ở mục Variables & Secrets riêng
không tự đi vào bản React tĩnh.

| Biến build | Giá trị |
| --- | --- |
| `STRATUS_API_URL` | Output `ApiUrl`, giữ cả stage `/prod` |
| `STRATUS_AWS_REGION` | `ap-southeast-2` |
| `STRATUS_COGNITO_CLIENT_ID` | Output `UserPoolClientId` |
| `STRATUS_COGNITO_DOMAIN` | Output `CognitoDomain`, không thêm `/login` |

Chạy build/deploy lại sau khi lưu biến. `npm run build` sinh `dist/config.js` với `local:false`.
Nếu thiếu một phần cấu hình, build báo lỗi; nếu chưa đặt biến nào, giao diện vẫn mở được nhưng
chỉ localhost mới bật kết nối phát triển. Cấu hình SPA trong `frontend/wrangler.jsonc` hỗ trợ
truy cập trực tiếp `/app/...` và `/auth/callback`.

`/api` trong cấu hình phát triển được proxy bởi Nginx/Vite trên máy. Cloudflare static assets
không tự proxy đường dẫn đó sang Python hoặc AWS. Phải dùng URL API Gateway ở trên.
Không đưa AWS credentials hay khóa dự đoán vào các biến build.

Nếu dùng một hệ thống build khác hoặc upload tệp đã build, script AWS cũng tạo sẵn
`frontend/dist/config.js`; hãy deploy cả thư mục `dist` sau khi script hoàn tất, không build lại
thiếu bốn biến trên vì sẽ ghi đè cấu hình này.

## 4. Tạo người dùng và kiểm tra toàn luồng

1. Trong **Cognito → User pools → pool của stack → Users → Create user**, tạo người dùng của bạn.
   Pool không mở đăng ký công khai. Đăng nhập tại frontend Cloudflare và đổi mật khẩu tạm nếu được yêu cầu.
2. Chọn **Phân loại dữ liệu bảng → LightGBM → Dùng dữ liệu mẫu**, chọn cột `churn`, tiền xử lý và huấn luyện.
3. Kiểm tra tác vụ chuyển `Đang chờ → Đang huấn luyện → Hoàn thành`. EC2 boot và tải image có thể mất vài phút.
4. Xem chỉ số, đường cong huấn luyện, ma trận nhầm lẫn; bấm **Triển khai mô hình**, lưu khóa API và thử dự đoán.
5. Kiểm tra ASG tăng từ 0 máy khi có hàng đợi, và về 0 sau khi hàng đợi lẫn tác vụ đang xử lý rỗng 15 phút.

```bash
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names "$STACK_NAME-workers" \
  --query 'AutoScalingGroups[0].{Desired:DesiredCapacity,Min:MinSize,Max:MaxSize,Instances:Instances[*].InstanceId}'
```

Nếu đăng nhập báo `redirect_mismatch`, kiểm tra origin và `/auth/callback`.
Nếu upload lỗi CORS, kiểm tra domain đang mở có đúng `FRONTEND_ORIGIN` của stack.
Nếu tác vụ đứng ở hàng đợi, xem ASG Activity, quota và CloudWatch logs của worker.
Không tắt Cognito hoặc `AUTH_REQUIRED` để sửa lỗi kết nối.

Tài liệu: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
[SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/),
[setup AWS trong repository](aws-setup.md).
