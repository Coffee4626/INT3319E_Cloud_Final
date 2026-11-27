import { useId, useState } from "react";
import {
  Boxes,
  Cloud,
  Database,
  FileImage,
  FileText,
  Layers3,
  Server,
  Workflow,
  Zap,
  Check,
  Cpu,
  CircleHelp,
} from "lucide-react";
import { taskById, type TaskId } from "./catalog";
import { config } from "../api";

export function TaskArt({
  id,
  plain = false,
  maskOpacity = 0.55,
}: {
  id: TaskId;
  plain?: boolean;
  maskOpacity?: number;
}) {
  const vision = [
    "image-classification",
    "object-detection",
    "segmentation",
    "instance-segmentation",
  ].includes(id);
  return (
    <div
      className={`st-task-art art-${id}`}
      aria-label={`Minh họa ${taskById(id).name}`}
    >
      {vision ? (
        <>
          <img
            src={
              id === "image-classification"
                ? "/tasks/classification.jpg"
                : "/tasks/street.jpg"
            }
            alt={
              id === "image-classification"
                ? "Chó Golden Retriever trên bãi cỏ"
                : "Đường phố với nhiều xe và người đi xe đạp"
            }
            loading="lazy"
          />
          {!plain && id === "image-classification" && (
            <div className="st-image-label">
              <span>
                <Check size={12} /> Golden Retriever
              </span>
              <strong>Nhãn ảnh</strong>
            </div>
          )}
          {!plain && id === "object-detection" && (
            <>
              <span className="st-bbox box-a">
                <b>ô tô 0.98</b>
              </span>
              <span className="st-bbox box-b">
                <b>ô tô 0.96</b>
              </span>
              <span className="st-bbox box-c">
                <b>ô tô 0.94</b>
              </span>
            </>
          )}
          {!plain && id === "segmentation" && (
            <>
              <svg
                className="st-mask"
                viewBox="0 0 1200 800"
                preserveAspectRatio="none"
                style={{ opacity: maskOpacity }}
                aria-hidden="true"
              >
                <path
                  fill="#4d80ff"
                  d="M280 0H705L650 560H560L500 190L280 190Z"
                />
                <path
                  fill="#a78bfa"
                  d="M0 0H280L280 190L500 190L560 560L360 630L0 570Z M705 0H1200V650L710 570L650 560Z"
                />
                <path
                  fill="#15d8b6"
                  d="M0 335L215 335L365 500L310 610L0 610Z"
                />
                <path
                  fill="#e969c0"
                  d="M0 710L560 570L710 570L1200 720V800H0Z"
                />
                <path
                  fill="#ffbe63"
                  d="M205 580L350 575L400 680L380 735H195Z M580 580H670L700 690H570Z M950 600H1090L1130 710V745H900Z"
                />
              </svg>
              <div className="st-art-legend">
                <i style={{ background: "#4d80ff" }} />
                bầu trời <i style={{ background: "#a78bfa" }} />
                tòa nhà <i style={{ background: "#e969c0" }} />
                mặt đường
              </div>
            </>
          )}
          {!plain && id === "instance-segmentation" && (
            <svg
              className="st-mask"
              viewBox="0 0 1200 800"
              preserveAspectRatio="none"
              style={{ opacity: maskOpacity }}
              aria-hidden="true"
            >
              <path
                fill="#52a5ff"
                stroke="#94c5ff"
                strokeWidth="4"
                d="M225 580Q270 563 340 580L370 640L397 680L380 723H203L196 650Z"
              />
              <path
                fill="#e681e8"
                stroke="#ffb6f4"
                strokeWidth="4"
                d="M585 590L654 583L680 620L694 680L675 703H571L568 655Z"
              />
              <path
                fill="#52e0c3"
                stroke="#9ff7e3"
                strokeWidth="4"
                d="M961 599Q1017 587 1083 607L1094 642L1123 674L1123 730H901L896 683L928 640Z"
              />
              <path
                fill="#ffb961"
                d="M755 575L780 570L791 617L785 664L769 709L753 704L756 658L745 614Z"
              />
            </svg>
          )}
        </>
      ) : id === "text-classification" ? (
        <div className="st-text-art">
          <div>
            <span>“</span> Sản phẩm rất tuyệt!
          </div>
          <div className="st-sentiment">
            <span>Tích cực</span>
            <b>97.2%</b>
          </div>
          <div className="st-text-embedding">
            0.24 <i /> 0.89 <i /> −0.12 <i /> 0.67
          </div>
        </div>
      ) : id === "classification" ? (
        <div className="st-table-art">
          <table>
            <thead>
              <tr>
                <th>TUỔI</th>
                <th>CHI TIÊU</th>
                <th>RỜI BỎ</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((i) => (
                <tr key={i}>
                  <td>{[28, 42, 35][i]}</td>
                  <td>${[49, 129, 79][i]}</td>
                  <td>
                    <span className={i === 1 ? "positive" : ""}>
                      {i === 1 ? "Có" : "Không"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="st-plot-art">
          <div className="st-art-axis">
            {id === "regression"
              ? "GIÁ TRỊ DỰ ĐOÁN"
              : "DỰ BÁO · 30 NGÀY TIẾP THEO"}
          </div>
          <svg
            viewBox="0 0 300 130"
            role="img"
            aria-label={
              id === "regression"
                ? "Các điểm dữ liệu và đường hồi quy"
                : "Đường lịch sử và vùng dự báo"
            }
          >
            {[25, 55, 85, 115].map((y) => (
              <line key={y} x1="0" y1={y} x2="300" y2={y} stroke="#ffffff0c" />
            ))}
            {id === "regression" ? (
              <>
                <path d="M20 115L275 15" stroke="#4d8eff" strokeWidth="2" />
                {Array.from({ length: 32 }, (_, i) => (
                  <circle
                    key={i}
                    cx={20 + i * 8}
                    cy={112 - i * 3.1 + Math.sin(i * 3.3) * 17}
                    r="3.4"
                    fill={i % 3 === 0 ? "#85baff" : "#4080f0"}
                    opacity=".85"
                  />
                ))}
              </>
            ) : (
              <>
                <path
                  d="M180 65L200 40L220 42L240 17L270 8L290 14L290 57L270 51L240 63L220 75L200 75L180 86Z"
                  fill="#438bff30"
                />
                <path
                  d="M5 107L25 91L45 99L65 63L85 79L105 60L125 71L145 40L165 57L180 65"
                  fill="none"
                  stroke="#75b1ff"
                  strokeWidth="3"
                />
                <path
                  d="M180 65L200 58L220 61L240 40L270 30L290 35"
                  fill="none"
                  stroke="#5d98ff"
                  strokeWidth="3"
                  strokeDasharray="5 5"
                />
                <line
                  x1="180"
                  y1="5"
                  x2="180"
                  y2="120"
                  stroke="#ffffff40"
                  strokeDasharray="3 5"
                />
              </>
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
export type ChartSeries = { name: string; color: string; values: number[] };
export function LineChart({
  series,
  xLabel = "Vòng học",
  percent = false,
  height = 220,
  xValues,
}: {
  xValues?: number[];
  series: ChartSeries[];
  xLabel?: string;
  percent?: boolean;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const count = Math.max(1, ...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  const max = percent ? 1 : Math.max(0.1, ...all) * 1.12;
  const w = 600,
    h = height,
    left = 48,
    right = 18,
    top = 20,
    bottom = 35;
  const x = (i: number) =>
      left + (i / Math.max(1, count - 1)) * (w - left - right),
    y = (v: number) => top + (1 - v / max) * (h - top - bottom);
  return (
    <div className="st-chart">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Biểu đồ ${series.map((s) => s.name).join(", ")} theo ${xLabel}`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(
            Math.max(
              0,
              Math.min(
                count - 1,
                Math.round(
                  ((((e.clientX - rect.left) / rect.width) * w - left) /
                    (w - left - right)) *
                    (count - 1),
                ),
              ),
            ),
          );
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0"
              stopColor={series[0]?.color || "#4688ff"}
              stopOpacity=".18"
            />
            <stop offset="1" stopColor="#4688ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (max * i) / 4;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={w - right}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--st-border)"
              />
              <text x={left - 10} y={y(v) + 4} textAnchor="end">
                {percent
                  ? `${Math.round(v * 100)}%`
                  : v.toFixed(max > 10 ? 0 : 2)}
              </text>
            </g>
          );
        })}
        {series.map((s, j) => {
          const path = s.values
            .map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`)
            .join(" ");
          return (
            <g key={s.name}>
              {j === 0 && s.values.length > 1 && (
                <path
                  d={`${path}L${x(s.values.length - 1)},${h - bottom}L${left},${h - bottom}Z`}
                  fill={`url(#${uid})`}
                />
              )}
              <path
                d={path}
                fill="none"
                stroke={s.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={j === 1 ? "5 4" : undefined}
              />
            </g>
          );
        })}
        {[0, Math.floor((count - 1) / 2), count - 1].map((i, k) => (
          <text key={k} x={x(i)} y={h - 12} textAnchor="middle">
            {xValues?.[i] ?? i + 1}
          </text>
        ))}
        <text x={w / 2} y={h - 1} textAnchor="middle">
          {xLabel}
        </text>
        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={top}
              y2={h - bottom}
              stroke="#9cb5d7"
              strokeDasharray="4 4"
            />
            {series.map(
              (s) =>
                s.values[hover] !== undefined && (
                  <circle
                    key={s.name}
                    cx={x(hover)}
                    cy={y(s.values[hover])}
                    r="4"
                    fill={s.color}
                    stroke="#121a29"
                    strokeWidth="2"
                  />
                ),
            )}
          </g>
        )}
      </svg>
      <div className="st-chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
            {hover !== null && s.values[hover] !== undefined && (
              <b>{s.values[hover].toFixed(4)}</b>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
const serviceDetails: Record<string, string> = {
  "S3 · dữ liệu":
    "Lưu dữ liệu gốc và phiên bản đã tiền xử lý. Dữ liệu ảnh gồm ảnh, nhãn và mặt nạ; dữ liệu bảng gồm CSV và lược đồ.",
  "Lambda điều khiển":
    "Xác thực yêu cầu, kiểm tra siêu dữ liệu và ghi tác vụ. API Gateway cung cấp đường dẫn tải lên, quản lý tác vụ và triển khai.",
  "Hàng đợi SQS":
    "Tác vụ được đưa vào hàng đợi. CloudWatch theo dõi lượng thông điệp đang chờ và đang xử lý.",
  "EC2 Auto Scaling":
    "Máy xử lý tăng theo nhu cầu. Máy xử lý đang huấn luyện được bảo vệ khỏi việc giảm số máy; số máy về 0 khi nhàn rỗi.",
  "S3 · kho mô hình":
    "Điểm lưu mô hình, chỉ số, cấu hình tiền xử lý và gói mô hình được lưu theo từng phiên bản.",
  "Lambda dự đoán":
    "Nạp môi trường chạy từ ECR và mô hình từ S3. Mỗi bản triển khai có API dự đoán và khóa riêng.",
  "EC2 dự đoán":
    "API Gateway → Lambda chuyển tiếp trong VPC → EC2 chạy mô hình. EC2 nạp môi trường từ ECR, mô hình từ S3 và kiểm tra khóa riêng của từng endpoint.",
};
export function Architecture({
  taskId = "image-classification",
  stage = 0,
  workers,
  compact = false,
  live = false,
  pending,
  instance,
}: {
  pending?: number;
  instance?: string;
  taskId?: TaskId;
  stage?: number;
  workers?: number;
  compact?: boolean;
  live?: boolean;
}) {
  const [selected, setSelected] = useState("");
  const task = taskById(taskId);
  const nodes = [
    { name: "S3 · dữ liệu", icon: Database, info: task.input },
    { name: "Lambda điều khiển", icon: Workflow, info: "Kiểm tra & tiền xử lý" },
    {
      name: "Hàng đợi SQS",
      icon: Layers3,
      info:
        pending !== undefined
          ? `${pending} tác vụ đang chờ`
          : stage === 2
            ? "Hàng đợi huấn luyện"
            : "Tác vụ huấn luyện",
    },
    {
      name: "EC2 Auto Scaling",
      icon: Server,
      info: `${workers === undefined ? "Nhóm máy xử lý" : workers + " máy xử lý"} · ${instance ? (instance.startsWith("g") ? "GPU" : "CPU") : "CPU"}`,
    },
    { name: "S3 · kho mô hình", icon: Boxes, info: "Mô hình + chỉ số" },
    config.inferenceMode === "ec2"
      ? { name: "EC2 dự đoán", icon: Server, info: "Qua API + Lambda" }
      : { name: "Lambda dự đoán", icon: Zap, info: "API dự đoán" },
  ];
  return (
    <div className={`st-architecture ${compact ? "compact" : ""}`}>
      <div className="st-section-bar">
        <span>
          <Cloud size={16} /> Luồng dữ liệu & tính toán
        </span>
        <small>Kiến trúc AWS</small>
      </div>
      <div className="st-flow">
        {nodes.map((n, i) => (
          <button
            key={n.name}
            className={`st-node ${i === stage ? "active" : ""} ${i < stage ? "done" : ""} ${selected === n.name ? "selected" : ""}`}
            onClick={() => setSelected(selected === n.name ? "" : n.name)}
            title={`Xem ${n.name}`}
          >
            <span className="st-node-icon">
              <n.icon size={20} />
            </span>
            <strong>{n.name}</strong>
            <small>{n.info}</small>
            {i < stage && <Check size={12} className="st-node-check" />}
          </button>
        ))}
      </div>
      <div className="st-infra-rail">
        <span>
          <Database size={13} /> DynamoDB <em>trạng thái tác vụ · triển khai</em>
        </span>
        <span>
          <Boxes size={13} /> ECR <em>ảnh môi trường chạy</em>
        </span>
        <span>
          <Cpu size={13} /> CloudWatch <em>nhật ký · co giãn</em>
        </span>
      </div>
      {selected && (
        <div className="st-node-detail">
          <CircleHelp size={16} />
          <p>
            <strong>{selected}.</strong> {serviceDetails[selected]}
          </p>
          <button aria-label="Đóng chi tiết" onClick={() => setSelected("")}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
export function DataEvolution({
  taskId,
  stage = 0,
}: {
  taskId: TaskId;
  stage?: number;
}) {
  const task = taskById(taskId);
  const vision = task.group === "Thị giác máy tính";
  return (
    <div className="st-data-evolution">
      {[
        {
          icon: vision ? FileImage : FileText,
          title: "Dữ liệu gốc",
          info: task.format,
        },
        {
          icon: Layers3,
          title: "Dữ liệu đã xử lý",
          info: vision
            ? "Đổi kích thước · chuẩn hóa · chia tập"
            : "Lược đồ · giá trị thiếu · chia tập",
        },
        {
          icon: Boxes,
          title: "Gói mô hình",
          info: "Trọng số + tiền xử lý",
        },
        { icon: Zap, title: "Kết quả dự đoán", info: task.output },
      ].map((n, i) => (
        <div className={stage >= i ? "active" : ""} key={n.title}>
          <n.icon size={17} />
          <div>
            <strong>{n.title}</strong>
            <span>{n.info}</span>
          </div>
          {i < 3 && <b>→</b>}
        </div>
      ))}
    </div>
  );
}
