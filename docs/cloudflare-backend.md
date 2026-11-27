# Kết nối frontend Cloudflare với backend AWS

Frontend được triển khai qua **Cloudflare Workers Builds**, Worker `int3319e-cloud-final`.
URL production: **https://int3319e-cloud-final.binhyb2.workers.dev**.
Cloudflare phục vụ React và các tệp tĩnh; API, huấn luyện và dự đoán chạy trên AWS.
Không cần CloudFront cho phương án này.

Backend đã triển khai trong account **866160682379**, region **ap-southeast-2**.
API Gateway: `https://dhajsrfama.execute-api.ap-southeast-2.amazonaws.com/prod`.
Cognito pool: `ap-southeast-2_a0gSirlAO`. Xem bằng chứng kiểm thử và giới hạn tại
[deployment-status.md](deployment-status.md). Tài khoản cũ và case Support được lưu riêng
trong [deployment-previous-account.md](deployment-previous-account.md).

## 1. Đăng nhập AWS để cập nhật

```bash
aws login --profile stratus-new --region ap-southeast-2
export AWS_PROFILE=stratus-new
export AWS_DEFAULT_REGION=ap-southeast-2
export STACK_NAME=stratus-automl
export WORKER_INSTANCE_TYPE=m7i-flex.large
export MAX_WORKERS=1
export CONTROL_MEMORY_MB=512
export PREDICT_MEMORY_MB=512
export INFERENCE_MODE=ec2
export INFERENCE_INSTANCE_TYPE=m7i-flex.large
python3 scripts/check_aws.py
```

Tài khoản mới có EC2 Standard quota 5 vCPU; một worker và một máy inference dùng tổng 4 vCPU.
Lambda hiện chỉ cho phép tối đa 512 MB mỗi function. Inference chạy trên EC2 riêng; Lambda chỉ chuyển tiếp request. Kiểm tra quota không thay thế
việc thử upload, train và inference thực tế.

## 2. Deploy backend theo đúng domain Cloudflare

Dùng **origin production cố định** dưới đây, không có dấu `/` cuối hoặc đường dẫn con.
Không dùng URL preview đổi theo từng commit. Giữ nguyên profile/region/stack ở bước trên.

```bash
export FRONTEND_ORIGIN='https://int3319e-cloud-final.binhyb2.workers.dev'
ENABLE_API=true bash scripts/deploy.sh
```

Khi có `FRONTEND_ORIGIN`, script bỏ qua tạo/publish CloudFront; cập nhật backend hiện có,
build/push image ECR và tạo API Gateway, Cognito, các Lambda. S3 CORS, API CORS,
Cognito callback (`<origin>/auth/callback`) và logout đều dùng origin này.
Script không tự deploy lại Worker Cloudflare và không xóa database.

Các giá trị mà template sẽ thiết lập khi deploy backend:

| Cấu hình | URL |
| --- | --- |
| S3/API CORS origin | `https://int3319e-cloud-final.binhyb2.workers.dev` |
| Cognito callback | `https://int3319e-cloud-final.binhyb2.workers.dev/auth/callback` |
| Cognito logout | `https://int3319e-cloud-final.binhyb2.workers.dev` |

Các giá trị này đã được áp dụng trên stack AWS mới.

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

Repository đã có cấu hình production trong `frontend/public/config.js`; build từ nhánh `main` dùng ngay cấu hình này. Localhost vẫn kết nối `/api` local. Khi chuyển sang stack/domain khác, có thể cập nhật tệp đó hoặc đặt đủ bốn biến dưới đây trong **Build variables and secrets**. Đây là thông tin public,
không phải AWS access key hoặc mật khẩu. Biến runtime ở mục Variables & Secrets riêng
không tự đi vào bản React tĩnh.

| Biến build | Giá trị |
| --- | --- |
| `STRATUS_API_URL` | Output `ApiUrl`, giữ cả stage `/prod` |
| `STRATUS_AWS_REGION` | `ap-southeast-2` |
| `STRATUS_COGNITO_CLIENT_ID` | Output `UserPoolClientId` |
| `STRATUS_COGNITO_DOMAIN` | Output `CognitoDomain`, không thêm `/login` |
| `STRATUS_INFERENCE_MODE` | `ec2` cho deployment này; tùy chọn, dùng để hiển thị kiến trúc |

Chạy build/deploy lại sau khi lưu biến. `npm run build` sinh `dist/config.js` với `local:false`.
Nếu thiếu một phần cấu hình, build báo lỗi; nếu chưa đặt biến nào, build giữ nguyên cấu hình trong `public/config.js`. Cấu hình SPA trong `frontend/wrangler.jsonc` hỗ trợ
truy cập trực tiếp `/app/...` và `/auth/callback`.

`/api` trong cấu hình phát triển được proxy bởi Nginx/Vite trên máy. Cloudflare static assets
không tự proxy đường dẫn đó sang Python hoặc AWS. Phải dùng URL API Gateway ở trên.
Không đưa AWS credentials hay khóa dự đoán vào các biến build.

Nếu dùng một hệ thống build khác hoặc upload tệp đã build, script AWS cũng tạo sẵn
`frontend/dist/config.js`; hãy deploy cả thư mục `dist` sau khi script hoàn tất, không build lại
với cấu hình của một stack khác vì sẽ ghi đè cấu hình này.

## 4. Tạo người dùng và kiểm tra toàn luồng

1. Tài khoản `ducluu.lqd@gmail.com` đã được tạo và gửi lời mời. Mở frontend, đăng nhập bằng mật khẩu tạm trong email, rồi tự đặt mật khẩu mới. Kiểm tra cả thư rác. Pool không mở đăng ký công khai.
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
