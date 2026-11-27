export type TaskId =
  | "image-classification"
  | "object-detection"
  | "segmentation"
  | "instance-segmentation"
  | "classification"
  | "regression"
  | "text-classification"
  | "forecasting";
export type ModelSpec = {
  id: string;
  name: string;
  family: string;
  description: string;
  size: string;
};
export type TaskSpec = {
  id: TaskId;
  name: string;
  vi: string;
  group: "Thị giác máy tính" | "Dữ liệu bảng" | "Ngôn ngữ tự nhiên" | "Chuỗi thời gian";
  description: string;
  input: string;
  output: string;
  accept: string;
  format: string;
  structure: string;
  models: ModelSpec[];
  metric: string;
  metricLabel: string;
  live?: boolean;
  color: string;
};
const m = (
  id: string,
  name: string,
  family: string,
  description: string,
  size = "224 × 224",
): ModelSpec => ({ id, name, family, description, size });
const CATALOG: TaskSpec[] = [
  {
    id: "image-classification",
    name: "Phân loại hình ảnh",
    vi: "Phân loại hình ảnh",
    group: "Thị giác máy tính",
    description:
      "Một hình ảnh, một nhãn. Nhận biết sản phẩm, động vật hoặc phân loại chất lượng.",
    input: "Hình ảnh",
    output: "Nhãn + độ tin cậy",
    accept: ".zip",
    format: "ZIP · thư mục theo nhãn",
    structure:
      "dataset.zip\n├── train/\n│   ├── cat/*.jpg\n│   └── dog/*.jpg\n└── val/\n    ├── cat/*.jpg\n    └── dog/*.jpg",
    metric: "accuracy",
    metricLabel: "Độ chính xác",
    color: "#568bff",
    live: true,
    models: [
      m("mobilenet-v3", "MobileNet V3 Small", "CNN · ImageNet", "Bộ mã hóa đã học trên ImageNet, huấn luyện đầu phân loại. Gọn và phù hợp CPU.", "64–256 px"),
      m("resnet18", "ResNet-18", "CNN · ImageNet", "Giữ bộ mã hóa và học đầu phân loại theo bộ nhãn của bạn.", "64–256 px"),
    ],
  },
  {
    id: "object-detection",
    name: "Phát hiện đối tượng",
    vi: "Phát hiện đối tượng",
    group: "Thị giác máy tính",
    description:
      "Xác định đối tượng và vị trí của chúng bằng khung giới hạn trên từng hình ảnh.",
    input: "Ảnh + khung giới hạn",
    output: "Khung + nhãn + độ tin cậy",
    accept: ".zip",
    format: "ZIP · nhãn YOLO",
    structure:
      "dataset.zip\n├── data.yaml\n├── images/train/*.jpg\n├── images/val/*.jpg\n├── labels/train/*.txt\n└── labels/val/*.txt\n\n# class_id x_center y_center width height\n0 0.52 0.46 0.30 0.25",
    metric: "map",
    metricLabel: "mAP@50",
    color: "#30c5ec",
    models: [
      m(
        "yolo",
        "YOLO11n",
        "Một giai đoạn",
        "Phát hiện nhiều đối tượng trong một lượt xử lý.",
        "640 × 640",
      ),
      m(
        "fasterrcnn",
        "Faster R-CNN",
        "Hai giai đoạn",
        "Đề xuất vùng ảnh rồi phân loại đối tượng.",
        "640 × 640",
      ),
      m(
        "detr",
        "DETR",
        "Transformer",
        "Dự đoán tập khung giới hạn bằng cơ chế chú ý.",
        "640 × 640",
      ),
    ],
  },
  {
    id: "segmentation",
    name: "Phân đoạn ngữ nghĩa",
    vi: "Phân đoạn ngữ nghĩa",
    group: "Thị giác máy tính",
    description:
      "Gán nhãn cho từng điểm ảnh: đường, cây, xe hoặc bầu trời. Nhìn thấy toàn bộ cấu trúc của ảnh.",
    input: "Ảnh + mặt nạ từng điểm ảnh",
    output: "Bản đồ phân vùng",
    accept: ".zip",
    format: "ZIP · ảnh + mặt nạ PNG",
    structure:
      "dataset.zip\n├── classes.json\n├── images/\n│   ├── train/001.jpg\n│   └── val/002.jpg\n└── masks/\n    ├── train/001.png\n    └── val/002.png\n\n# classes.json: [\"background\", \"object\"]\n# Mặt nạ PNG 8-bit: 0, 1… là mã lớp; 255 bỏ qua.",
    metric: "miou",
    metricLabel: "IoU trung bình",
    color: "#a78bfa",
    live: true,
    models: [
      m("unet", "U-Net Small", "Mã hóa – giải mã", "Huấn luyện toàn bộ mạng gọn, gồm hai tầng kết nối tắt, trên ảnh và mặt nạ của bạn.", "64–256 px"),
      m("deeplab-mobile", "DeepLabV3 MobileNet", "CNN · COCO", "Giữ bộ mã hóa đã học và tinh chỉnh đầu phân đoạn theo các lớp của bạn.", "64–256 px"),
    ],
  },
  {
    id: "instance-segmentation",
    name: "Phân đoạn từng đối tượng",
    vi: "Phân đoạn từng đối tượng",
    group: "Thị giác máy tính",
    description:
      "Tách riêng từng đối tượng cùng lớp bằng mặt nạ: mỗi chiếc xe có một vùng riêng.",
    input: "Ảnh + chú thích đa giác",
    output: "Mặt nạ từng đối tượng + nhãn",
    accept: ".zip",
    format: "ZIP · COCO JSON",
    structure:
      "dataset.zip\n├── train/*.jpg\n├── val/*.jpg\n└── annotations/\n    ├── instances_train.json\n    └── instances_val.json\n\n# COCO: images, categories, annotations\n# segmentation: tọa độ đa giác",
    metric: "mask_map",
    metricLabel: "mAP của mặt nạ",
    color: "#f093c5",
    models: [
      m(
        "maskrcnn",
        "Mask R-CNN",
        "Hai giai đoạn",
        "Khung giới hạn và mặt nạ riêng cho mỗi đối tượng.",
        "640 × 640",
      ),
      m(
        "yoloseg",
        "YOLO11n-seg",
        "Một giai đoạn",
        "Phân đoạn từng đối tượng trong một quy trình gọn.",
        "640 × 640",
      ),
    ],
  },
  {
    id: "classification",
    name: "Phân loại dữ liệu bảng",
    vi: "Phân loại dữ liệu bảng",
    group: "Dữ liệu bảng",
    description:
      "Dự đoán một nhãn từ các cột dữ liệu. Ví dụ: khách hàng có rời bỏ dịch vụ hay không.",
    input: "CSV + cột mục tiêu",
    output: "Nhãn dự đoán",
    accept: ".csv",
    format: "CSV UTF-8 · có tên cột",
    structure:
      "age,monthly_spend,tenure_months,support_tickets,plan,churn\n28,49,12,1,standard,no\n42,129,4,6,premium,yes\n\nCột mục tiêu: churn\nĐặc trưng: các cột còn lại",
    metric: "accuracy",
    metricLabel: "Độ chính xác",
    color: "#5c9fff",
    live: true,
    models: [
      m(
        "lightgbm",
        "LightGBM",
        "Tăng cường cây quyết định",
        "Tăng cường cây quyết định hiệu quả với dữ liệu có cấu trúc.",
        "Dữ liệu bảng",
      ),
      m(
        "xgboost",
        "XGBoost",
        "Tăng cường cây quyết định",
        "Ứng viên so sánh cho dữ liệu bảng.",
        "Dữ liệu bảng",
      ),
      m(
        "randomforest",
        "Random Forest",
        "Tổ hợp cây",
        "Tổ hợp cây quyết định cho dữ liệu bảng.",
        "Dữ liệu bảng",
      ),
    ],
  },
  {
    id: "regression",
    name: "Hồi quy dữ liệu bảng",
    vi: "Hồi quy dữ liệu bảng",
    group: "Dữ liệu bảng",
    description:
      "Ước lượng một giá trị liên tục như giá nhà, doanh thu hoặc nhu cầu sản phẩm.",
    input: "CSV + cột mục tiêu dạng số",
    output: "Giá trị dự đoán",
    accept: ".csv",
    format: "CSV UTF-8 · cột mục tiêu dạng số",
    structure:
      "area,rooms,age,price\n82,3,5,240000\n120,4,2,365000\n\nCột mục tiêu: price (dạng số)\nĐặc trưng: area, rooms, age",
    metric: "r2",
    metricLabel: "Hệ số R²",
    color: "#61c9ff",
    live: true,
    models: [
      m(
        "lightgbm",
        "LightGBM",
        "Tăng cường cây quyết định",
        "Tăng cường cây quyết định hiệu quả với dữ liệu có cấu trúc.",
        "Dữ liệu bảng",
      ),
      m(
        "xgboost",
        "XGBoost",
        "Tăng cường cây quyết định",
        "Ứng viên so sánh cho dữ liệu bảng.",
        "Dữ liệu bảng",
      ),
      m(
        "extratrees",
        "Extra Trees",
        "Tổ hợp cây",
        "Tổ hợp cây ngẫu nhiên cho dữ liệu bảng.",
        "Dữ liệu bảng",
      ),
    ],
  },
  {
    id: "text-classification",
    name: "Phân loại văn bản",
    vi: "Phân loại văn bản",
    group: "Ngôn ngữ tự nhiên",
    description:
      "Đọc câu chữ và phân loại cảm xúc, chủ đề hoặc ý định của người dùng.",
    input: "CSV · text, label",
    output: "Nhãn + độ tin cậy",
    accept: ".csv",
    format: "CSV UTF-8 · text,label",
    structure:
      'text,label\n"Sản phẩm rất tốt, giao hàng nhanh",positive\n"Tôi chưa hài lòng với dịch vụ",negative\n"Sản phẩm đúng như mô tả",neutral',
    metric: "f1",
    metricLabel: "F1 có trọng số",
    color: "#9f8dff",
    models: [
      m(
        "distilbert",
        "DistilBERT",
        "Transformer",
        "Bộ mã hóa nhỏ gọn cho phân loại văn bản.",
        "128 token",
      ),
      m(
        "bert",
        "BERT base",
        "Transformer",
        "Biểu diễn ngữ cảnh hai chiều.",
        "256 token",
      ),
    ],
  },
  {
    id: "forecasting",
    name: "Dự báo chuỗi thời gian",
    vi: "Dự báo chuỗi thời gian",
    group: "Chuỗi thời gian",
    description:
      "Học xu hướng theo thời gian để dự báo các giá trị tiếp theo của một chuỗi.",
    input: "CSV · timestamp,target",
    output: "Dự báo + khoảng tin cậy",
    accept: ".csv",
    format: "CSV UTF-8 · timestamp,target",
    structure:
      "timestamp,target\n2026-01-01,120\n2026-01-02,134\n2026-01-03,127\n\nSắp xếp thời gian tăng dần.\nTách tập huấn luyện, kiểm định và kiểm tra theo thời gian.",
    metric: "mape",
    metricLabel: "MAPE",
    color: "#4bd6c9",
    models: [
      m(
        "prophet",
        "Prophet",
        "Mô hình cộng",
        "Phân tích xu hướng và tính mùa vụ.",
        "30 ngày",
      ),
      m(
        "lstm",
        "LSTM",
        "Mạng hồi tiếp",
        "Học quan hệ giữa các bước thời gian.",
        "30 ngày",
      ),
    ],
  },
];
export const TASKS = CATALOG.filter((task) => ["image-classification", "segmentation", "classification", "regression"].includes(task.id));
export const taskById = (id: string) =>
  TASKS.find((task) => task.id === id) || TASKS[0];
export const modelById = (task: TaskSpec, id: string) =>
  task.models.find((model) => model.id === id) || task.models[0];
export type RunConfig = {
  name: string;
  taskId: TaskId;
  modelIds: string[];
  epochs: number;
  imageSize: number;
  batchSize: number;
  learningRate: number;
  trainSplit: number;
  instance: string;
  maxWorkers: number;
  augment: boolean;
  normalize: boolean;
  earlyStopping: boolean;
  datasetName: string;
  sample: boolean;
  count: number;
  classes: number;
  target: string;
  timeLimit: number;
};
export function defaultConfig(
  taskId: TaskId = "image-classification",
): RunConfig {
  const task = taskById(taskId);
  return {
    name: task.vi + " · thí nghiệm",
    taskId,
    modelIds: [task.models[0].id],
    epochs: 5,
    imageSize: 128,
    batchSize: 4,
    learningRate: 0.001,
    trainSplit: 80,
    instance: "m7i-flex.large",
    maxWorkers: 1,
    augment: true,
    normalize: true,
    earlyStopping: true,
    datasetName: "",
    sample: false,
    count: 0,
    classes: 0,
    target: "",
    timeLimit: task.group === "Thị giác máy tính" ? 300 : 60,
  };
}
