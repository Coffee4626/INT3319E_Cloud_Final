import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Download,
  FlaskConical,
  Layers3,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Square,
  Terminal,
  Zap,
} from "lucide-react";
import {
  api,
  config,
  type Dataset,
  type Deployment,
  type DeployResult,
  type Job,
  type Page,
} from "../api";
import { Architecture, DataEvolution, LineChart, TaskArt } from "./Visuals";
import { TASKS, taskById } from "./catalog";
import { ImageInference } from "./ImageInference";
import { downloadText } from "./data";
const metricName = (name?: string) =>
  name
    ? ({
        accuracy: "Độ chính xác",
        cross_entropy: "Mất mát cross-entropy",
        pixel_accuracy: "Độ chính xác điểm ảnh",
        miou: "IoU trung bình",
        dice: "Điểm Dice",
        balanced_accuracy: "Độ chính xác cân bằng",
        f1: "Điểm F1",
        f1_weighted: "F1 có trọng số",
        f1_macro: "F1 trung bình các lớp",
        precision: "Độ chuẩn xác",
        recall: "Độ bao phủ",
        log_loss: "Mất mát logarit",
        root_mean_squared_error: "Sai số RMSE",
        mean_squared_error: "Sai số bình phương trung bình",
        mean_absolute_error: "Sai số tuyệt đối trung bình",
        mean_absolute_percentage_error: "Sai số phần trăm tuyệt đối trung bình",
        rmse: "Sai số RMSE",
        mae: "Sai số MAE",
        r2: "Hệ số R²",
        roc_auc: "Diện tích dưới đường ROC",
      } as Record<string, string>)[name] || name
    : "—";
export const statusName = (status: string) =>
  ({
    QUEUED: "Đang chờ",
    TRAINING: "Đang huấn luyện",
    COMPLETED: "Hoàn thành",
    FAILED: "Thất bại",
    CANCELLED: "Đã hủy",
    ACTIVE: "Đang hoạt động",
    REVOKED: "Đã thu hồi",
  })[status] || status;
export function Status({ status }: { status: string }) {
  return (
    <span
      className={`st-badge ${["COMPLETED", "ACTIVE"].includes(status) ? "green" : ["FAILED", "REVOKED"].includes(status) ? "red" : status === "CANCELLED" ? "amber" : "blue"}`}
    >
      {statusName(status)}
    </span>
  );
}
export function CopyButton({
  text,
  label = "Sao chép",
}: {
  text: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <button
      className="st-btn ghost small"
      onClick={() =>
        void navigator.clipboard
          .writeText(text)
          .then(() => setStatus("Đã sao chép"))
          .catch(() => setStatus("Chọn và sao chép thủ công"))
      }
    >
      {status === "Đã sao chép" ? <Check size={15} /> : <Copy size={15} />}{" "}
      {status || label}
    </button>
  );
}
export function useCollection<T>(path: string) {
  const [items, setItems] = useState<T[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const fetchPage = useCallback(
    async (next?: string) => {
      setLoading(true);
      setError("");
      try {
        const page = await api<Page<T>>(
          path + (next ? "?cursor=" + encodeURIComponent(next) : ""),
        );
        setItems((old) => (next ? [...old, ...page.items] : page.items));
        setCursor(page.cursor);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [path],
  );
  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);
  return {
    items,
    cursor,
    error,
    loading,
    refresh: () => fetchPage(),
    more: () => cursor && fetchPage(cursor),
  };
}
export function ErrorNote({ error }: { error: string }) {
  return error ? (
    <div className="st-alert error" role="alert">
      {error}
    </div>
  ) : null;
}
export function EmptyState({
  title,
  description,
  action,
  onClick,
}: {
  title: string;
  description: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="st-empty">
      <Layers3 size={32} />
      <h2>{title}</h2>
      <p>{description}</p>
      {action && (
        <button className="st-btn" onClick={onClick}>
          {action}
        </button>
      )}
    </div>
  );
}
export function WorkspaceStats() {
  const jobs = useCollection<Job>("/jobs"),
    data = useCollection<Dataset>("/datasets"),
    deployments = useCollection<Deployment>("/deployments");
  return (
    <>
      <div className="st-summary-row">
        {[
          { name: "Thí nghiệm", value: jobs, icon: FlaskConical },
          { name: "Bộ dữ liệu", value: data, icon: Database },
          { name: "API dự đoán", value: deployments, icon: Zap },
        ].map((s) => (
          <div key={s.name}>
            <s.icon size={21} />
            <div>
              <strong>
                {s.value.loading
                  ? "…"
                  : s.value.error
                    ? "—"
                    : `${s.value.items.length}${s.value.cursor ? "+" : ""}`}
              </strong>
              <span>{s.name}</span>
            </div>
          </div>
        ))}
        <div>
          <Layers3 size={21} />
          <div>
            <strong>{TASKS.length}</strong>
            <span>Bài toán học máy</span>
          </div>
        </div>
      </div>
      {(jobs.error || data.error || deployments.error) && (
        <div className="st-note">
          Chưa lấy được dữ liệu không gian làm việc.{" "}
          <button
            className="st-link"
            onClick={() => {
              void jobs.refresh();
              void data.refresh();
              void deployments.refresh();
            }}
          >
            Thử kết nối lại
          </button>
        </div>
      )}
    </>
  );
}
export function JobTable({
  jobs,
  go,
}: {
  jobs: Job[];
  go: (p: string) => void;
}) {
  return (
    <div className="st-panel flush">
      <div className="st-table-wrap">
        <table className="st-table">
          <thead>
            <tr>
              <th>Thí nghiệm</th>
              <th>Bài toán</th>
              <th>Mô hình</th>
              <th>Trạng thái</th>
              <th>Thời gian</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>
                  <button
                    className="st-link"
                    onClick={() => go("/app/experiments/" + j.id)}
                  >
                    {j.name}
                  </button>
                  <small className="st-table-sub">{j.id.slice(0, 12)}</small>
                </td>
                <td>
                  {
                    taskById(j.task === "tabular" ? "classification" : j.task)
                      .name
                  }
                </td>
                <td>{j.metrics?.best_model || "—"}</td>
                <td>
                  <Status status={j.status} />
                </td>
                <td>
                  {new Date(j.created_at * 1000).toLocaleString("vi-VN", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function Experiments({ go }: { go: (p: string) => void }) {
  const list = useCollection<Job>("/jobs"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all");
  const running = list.items.some((j) =>
    ["QUEUED", "TRAINING"].includes(j.status),
  );
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void list.refresh(), 5000);
    return () => clearInterval(t);
  }, [running]);
  const filtered = list.items.filter(
    (j) =>
      (j.name + " " + j.task).toLowerCase().includes(query.toLowerCase()) &&
      (status === "all" || j.status === status),
  );
  return (
    <>
      <div className="st-page-heading">
        <div>
          <div className="st-eyebrow">THÍ NGHIỆM</div>
          <h1>Mỗi lần huấn luyện, một góc nhìn mới.</h1>
          <p>
            Theo dõi tiến trình và kết quả của các thí nghiệm trong không gian làm việc.
          </p>
        </div>
        <div className="st-actions">
          <button
            className="st-btn secondary"
            disabled={list.loading}
            onClick={() => void list.refresh()}
          >
            <RefreshCw size={16} /> Làm mới
          </button>
          <button className="st-btn" onClick={() => go("/app/new")}>
            <Plus size={17} /> Tạo thí nghiệm
          </button>
        </div>
      </div>
      <ErrorNote error={list.error} />
      <div className="st-list-toolbar">
        <label className="st-search">
          <Search size={17} />
          <input
            value={query}
            placeholder="Tìm thí nghiệm hoặc bài toán…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Lọc trạng thái"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">Tất cả trạng thái</option>
          {["QUEUED", "TRAINING", "COMPLETED", "FAILED", "CANCELLED"].map(
            (s) => (
              <option key={s} value={s}>
                {statusName(s)}
              </option>
            ),
          )}
        </select>
      </div>
      {filtered.length ? (
        <JobTable jobs={filtered} go={go} />
      ) : list.loading ? (
        <div className="st-empty">
          <Loader2 className="st-spin" /> Đang tải thí nghiệm…
        </div>
      ) : (
        <EmptyState
          title={
            list.items.length
              ? "Không có kết quả phù hợp."
              : "Thí nghiệm đầu tiên đang chờ bạn."
          }
          description="Chọn bài toán, mô hình và bộ dữ liệu để bắt đầu huấn luyện."
          action="Tạo thí nghiệm"
          onClick={() => go("/app/new")}
        />
      )}{" "}
      {list.cursor && (
        <button
          className="st-btn secondary"
          disabled={list.loading}
          onClick={() => void list.more()}
        >
          Tải thêm thí nghiệm
        </button>
      )}
    </>
  );
}
export function Registry({ go }: { go: (p: string) => void }) {
  const list = useCollection<Job>("/jobs"),
    completed = list.items.filter((j) => j.status === "COMPLETED");
  return (
    <>
      <div className="st-page-heading">
        <div>
          <div className="st-eyebrow">KHO MÔ HÌNH</div>
          <h1>Hiểu mô hình. Chọn điều tốt nhất.</h1>
          <p>Chỉ số, đánh giá và bản triển khai của các mô hình đã huấn luyện.</p>
        </div>
        <button
          className="st-btn secondary"
          disabled={list.loading}
          onClick={() => void list.refresh()}
        >
          <RefreshCw size={16} /> Làm mới
        </button>
      </div>
      <ErrorNote error={list.error} />
      {completed.length ? (
        <div className="st-registry-grid">
          {completed.flatMap((j) =>
            (j.metrics?.leaderboard || []).map((m) => (
              <article
                className="st-panel st-registry-card"
                key={j.id + m.model}
              >
                <TaskArt
                  id={taskById(j.task === "tabular" ? "classification" : j.task).id}
                />
                <div className="st-panel-head">
                  <h3>{m.model}</h3>
                  <Status status={j.status} />
                </div>
                <p>
                  {
                    taskById(j.task === "tabular" ? "classification" : j.task)
                      .name
                  }
                </p>
                <div className="st-registry-score">
                  <span>{j.metrics?.eval_metric || "Điểm kiểm định"}</span>
                  <strong>{m.score_val?.toFixed(4) ?? "—"}</strong>
                </div>
                <small className="st-muted">{j.name}</small>
                <div className="st-actions">
                  <button
                    className="st-btn full"
                    onClick={() =>
                      go(
                        "/app/experiments/" +
                          j.id +
                          "?model=" +
                          encodeURIComponent(m.model),
                      )
                    }
                  >
                    Xem chỉ số & triển khai
                  </button>
                </div>
              </article>
            )),
          )}
        </div>
      ) : (
        <EmptyState
          title={list.loading ? "Đang tải mô hình…" : "Chưa có mô hình hoàn tất."}
          description="Mô hình sẽ được lưu tại đây khi huấn luyện và đánh giá kết thúc."
          action="Tạo thí nghiệm"
          onClick={() => go("/app/new")}
        />
      )}{" "}
      {list.cursor && (
        <button
          className="st-btn secondary"
          disabled={list.loading}
          onClick={() => void list.more()}
        >
          Tải thêm mô hình
        </button>
      )}
    </>
  );
}
export function Experiment({
  id,
  initialModel,
  go,
  keepKey,
}: {
  id: string;
  initialModel?: string;
  go: (p: string) => void;
  keepKey: (id: string, key: string) => void;
}) {
  const [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [selected, setSelected] = useState(initialModel || ""),
    [tab, setTab] = useState("metrics");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const j = await api<Job>("/jobs/" + id);
        if (!active) return;
        setJob(j);
        setError("");
        if (["QUEUED", "TRAINING"].includes(j.status))
          timer = setTimeout(poll, 3500);
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          timer = setTimeout(poll, 10000);
        }
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);
  async function action(kind: string) {
    setBusy(kind);
    setError("");
    try {
      if (kind === "deploy") {
        const d = await api<DeployResult>("/deploy", { job_id: id });
        keepKey(d.deployment_id, d.api_key);
        go("/app/inference/" + d.deployment_id);
      } else if (kind === "retry") {
        const j = await api<{ job_id: string }>("/jobs/" + id + "/retry", {});
        go("/app/experiments/" + j.job_id);
      } else {
        await api("/jobs/" + id + "/cancel", {});
        setJob(await api<Job>("/jobs/" + id));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (!job)
    return (
      <>
        <ErrorNote error={error} />
        <div className="st-empty">
          <Loader2 className="st-spin" /> Đang tải thí nghiệm…
        </div>
      </>
    );
  const done = job.status === "COMPLETED",
    taskId = taskById(job.task === "tabular" ? "classification" : job.task).id,
    vision = taskId === "image-classification" || taskId === "segmentation",
    models = job.metrics?.leaderboard || [],
    model =
      models.find((m) => m.model === selected) ||
      models.find((m) => m.model === job.metrics?.best_model) ||
      models[0];
  const scores = job.metrics?.evaluation?.scores || {},
    matrix = job.metrics?.evaluation?.confusion_matrix;
  const points = job.metrics?.learning_curves?.[model?.model || ""] || [];
  const stage = done ? 4 : job.status === "TRAINING" ? 3 : 2;
  const primary = Object.entries(scores).slice(0, 4);
  return (
    <>
      <button
        className="st-link st-back"
        onClick={() => go("/app/experiments")}
      >
        Tất cả thí nghiệm
      </button>
      <div className="st-page-heading">
        <div>
          <div className="st-eyebrow">THÍ NGHIỆM / {id.slice(0, 8)}</div>
          <h1>{job.name}</h1>
          <p>
            {taskById(taskId).name}{!vision && ` · Cột mục tiêu: ${job.target}`}
          </p>
        </div>
        <div className="st-actions">
          <Status status={job.status} />
          {done && (
            <button
              className="st-btn"
              disabled={
                !!busy || (!!model && model.model !== job.metrics?.best_model)
              }
              onClick={() => void action("deploy")}
            >
              <Zap size={17} />{" "}
              {busy === "deploy" ? "Đang triển khai…" : "Triển khai mô hình"}
            </button>
          )}
          {job.status === "QUEUED" && (
            <button
              className="st-btn secondary"
              disabled={!!busy}
              onClick={() => void action("cancel")}
            >
              <Square size={15} /> Hủy tác vụ
            </button>
          )}
          {["FAILED", "CANCELLED"].includes(job.status) && (
            <button
              className="st-btn"
              disabled={!!busy}
              onClick={() => void action("retry")}
            >
              <RefreshCw size={16} /> Huấn luyện lại
            </button>
          )}
        </div>
      </div>
      <ErrorNote error={error || job.error || ""} />
      <div className="st-run-status">
        <div>
          <span className={`st-status-icon ${done ? "done" : ""}`}>
            {done ? (
              <CheckCircle2 size={22} />
            ) : ["QUEUED", "TRAINING"].includes(job.status) ? (
              <Loader2 size={22} className="st-spin" />
            ) : (
              <Square size={20} />
            )}
          </span>
          <div>
            <strong>{statusName(job.status)}</strong>
            <span>
              {done
                ? "Gói mô hình và đánh giá đã được lưu."
                : job.status === "TRAINING"
                  ? "Máy xử lý đang huấn luyện và đánh giá mô hình."
                  : job.status === "QUEUED"
                    ? "Tác vụ đang chờ máy xử lý nhận từ hàng đợi."
                    : "Kiểm tra thông tin thí nghiệm trước khi thử lại."}
            </span>
          </div>
        </div>
        <div className="st-time">
          <Clock size={17} />
          {job.finished_at && job.started_at
            ? `${job.finished_at - job.started_at}s`
            : `${job.time_limit}s`}
          <span>{job.finished_at ? "Thời gian huấn luyện" : "Giới hạn thời gian"}</span>
        </div>
      </div>
      <Architecture taskId={taskId} stage={stage} live />
      <div className="st-tabs">
        {[
          ["metrics", "Chỉ số mô hình"],
          ["compute", "Tài nguyên & co giãn"],
          ["data", "Luồng dữ liệu"],
          ["events", "Nhật ký quy trình"],
        ].map(([key, label]) => (
          <button
            className={tab === key ? "active" : ""}
            key={key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "metrics" && (
        <>
          <div className="st-model-selection">
            <div>
              <h2>Hiểu mô hình của bạn.</h2>
              <p>
                {vision ? "Chỉ số được đo trên thư mục val riêng. Mô hình được chọn theo mất mát kiểm định thấp nhất; đây không phải tập kiểm tra độc lập." : "Kiểm định dùng để chọn mô hình; tập kiểm tra được giữ riêng để đánh giá."}
              </p>
            </div>
            {models.length > 0 && (
              <label>
                Mô hình
                <select
                  value={model?.model || ""}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {models.map((m) => (
                    <option key={m.model}>{m.model}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {!done ? (
            <EmptyState
              title="Đang chờ kết quả huấn luyện."
              description="Chỉ số và biểu đồ sẽ xuất hiện khi máy xử lý hoàn tất đánh giá."
            />
          ) : (
            <>
              <div className="st-metric-grid">
                {primary.length ? (
                  primary.map(([name, value]) => (
                    <div className="st-metric" key={name}>
                      <span>{metricName(name)}</span>
                      <strong>{value.toFixed(4)}</strong>
                      <small>{vision ? "Tập kiểm định val" : "Tập kiểm tra"} · mô hình tốt nhất</small>
                    </div>
                  ))
                ) : (
                  <div className="st-metric">
                    <span>Điểm kiểm định</span>
                    <strong>{model?.score_val?.toFixed(4) || "—"}</strong>
                    <small>{metricName(job.metrics?.eval_metric)}</small>
                  </div>
                )}
              </div>
              <div className="st-chart-grid">
                <div className="st-panel">
                  <div className="st-panel-head">
                    <h3>Đường cong huấn luyện</h3>
                    <span className="st-muted">
                      {job.metrics?.learning_curve_metric
                        ? metricName(job.metrics.learning_curve_metric)
                        : model?.model}
                    </span>
                  </div>
                  {points.length ? (
                    <LineChart
                      xLabel="Vòng học"
                      xValues={points.map((p) => p.epoch)}
                      series={[
                        {
                          name: "Mất mát huấn luyện",
                          color: "#3478f5",
                          values: points.map((p) => p.train),
                        },
                        {
                          name: "Mất mát kiểm định",
                          color: "#9c6ce0",
                          values: points.map((p) => p.validation),
                        },
                      ]}
                    />
                  ) : (
                    <div className="st-chart-pending">
                      <Activity size={30} />
                      <h3>Chưa có lịch sử mất mát theo vòng học</h3>
                      <p>
                        Lần huấn luyện này chỉ lưu chỉ số cuối cùng. Kiểm định và
                        điểm kiểm tra được hiển thị bên cạnh.
                      </p>
                    </div>
                  )}
                </div>
                <div className="st-panel">
                  <h3>Đánh giá mô hình</h3>
                  <dl className="st-definition">
                    <div>
                      <dt>Mô hình</dt>
                      <dd>{model?.model || "—"}</dd>
                    </div>
                    <div>
                      <dt>Chỉ số</dt>
                      <dd>{metricName(job.metrics?.eval_metric)}</dd>
                    </div>
                    <div>
                      <dt>Điểm kiểm định</dt>
                      <dd>{model?.score_val?.toFixed(4) ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Thời gian huấn luyện</dt>
                      <dd>{model?.fit_time?.toFixed(2) ?? "—"}s</dd>
                    </div>
                    <div>
                      <dt>{vision ? "Số ảnh kiểm định" : "Số mẫu kiểm tra"}</dt>
                      <dd>{(vision ? job.metrics?.evaluation?.validation_rows : job.metrics?.evaluation?.test_rows) ?? "—"}</dd>
                    </div>
                  </dl>
                  <p className="st-muted">
                    {vision ? `${job.metrics?.epochs_completed || 0} vòng đã chạy. ${job.metrics?.stop_reason === "time_limit" ? "Dừng theo giới hạn thời gian (hoàn tất đánh giá vòng hiện tại)." : job.metrics?.stop_reason === "early_stopping" ? "Dừng sớm sau 3 vòng không cải thiện." : "Hoàn tất số vòng đã cấu hình."}` : "AutoGluon quy điểm kiểm định về cao hơn tốt hơn; chỉ số dạng mất mát có thể mang dấu âm."}
                  </p>
                </div>
              </div>
              {matrix && (
                <div className="st-panel">
                  <div className="st-panel-head">
                    <h3>Ma trận nhầm lẫn</h3>
                    <span className="st-muted">
                      Hàng: thực tế · Cột: dự đoán
                    </span>
                  </div>
                  <div className="st-table-wrap">
                    <table className="st-table">
                      <thead>
                        <tr>
                          <th>Thực tế / Dự đoán</th>
                          {matrix.labels.map((label) => (
                            <th key={label}>{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.values.map((row, i) => (
                          <tr key={i}>
                            <th>{matrix.labels[i]}</th>
                            {row.map((v, j) => (
                              <td
                                key={j}
                                className={i === j ? "st-matrix-diagonal" : ""}
                              >
                                {v}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="st-panel">
                <div className="st-panel-head">
                  <h3>Bảng xếp hạng mô hình</h3>
                  <button
                    className="st-btn secondary"
                    onClick={() =>
                      downloadText(
                        "metrics-" + id.slice(0, 8) + ".json",
                        JSON.stringify(job.metrics, null, 2),
                        "application/json",
                      )
                    }
                  >
                    <Download size={16} /> Tải chỉ số
                  </button>
                </div>
                <div className="st-table-wrap">
                  <table className="st-table">
                    <thead>
                      <tr>
                        <th>Mô hình</th>
                        <th>Điểm kiểm định</th>
                        <th>Thời gian huấn luyện</th>
                        <th>Thời gian dự đoán</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {models.map((m) => (
                        <tr
                          key={m.model}
                          className={model?.model === m.model ? "selected" : ""}
                        >
                          <td>
                            {m.model}
                            {m.model === job.metrics?.best_model && (
                              <span className="st-small-tag">Mô hình tốt nhất</span>
                            )}
                          </td>
                          <td>{m.score_val?.toFixed(4)}</td>
                          <td>{m.fit_time.toFixed(2)}s</td>
                          <td>{m.pred_time_val.toFixed(4)}s</td>
                          <td>
                            <button
                              className="st-link"
                              onClick={() => setSelected(m.model)}
                            >
                              Xem chỉ số
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {job.metrics?.evaluation?.reason && (
                  <p className="st-muted">{job.metrics.evaluation.reason}</p>
                )}
              </div>
            </>
          )}
        </>
      )}
      {tab === "compute" && (
        <>
          <div className="st-section-heading">
            <div>
              <h2>Tài nguyên tính toán theo nhu cầu.</h2>
              <p>
                Hàng đợi điều khiển co giãn; máy xử lý đang huấn luyện được bảo vệ khỏi
                giảm số máy.
              </p>
            </div>
          </div>
          <div className="st-metric-grid">
            <div className="st-metric">
              <span>Trạng thái tác vụ</span>
              <strong className="text">{statusName(job.status)}</strong>
              <small>Đọc từ trạng thái tác vụ</small>
            </div>
            <div className="st-metric">
              <span>Máy EC2 đang hoạt động</span>
              <strong>—</strong>
              <small>Chưa kết nối dữ liệu giám sát EC2</small>
            </div>
            <div className="st-metric">
              <span>Chính sách co giãn</span>
              <strong className="text">Độ dài hàng đợi SQS</strong>
              <small>Tăng từ 0 máy theo hàng đợi</small>
            </div>
            <div className="st-metric">
              <span>Môi trường xử lý</span>
              <strong className="text">
                {config.local ? "Máy xử lý Docker" : "EC2 Auto Scaling"}
              </strong>
              <small>{config.region}</small>
            </div>
          </div>
          <div className="st-panel">
            <h3>
              <Server size={19} /> Vòng đời máy xử lý
            </h3>
            <div className="st-lifecycle">
              <span>Tác vụ vào SQS</span>
              <span>Tăng số máy</span>
              <span>Máy xử lý nhận tác vụ</span>
              <span>Huấn luyện & đánh giá</span>
              <span>Lưu gói mô hình</span>
              <span>Giảm máy khi nhàn rỗi</span>
            </div>
            <p className="st-muted">
              Sơ đồ mô tả chính sách vận hành. Số máy và CPU/GPU chỉ hiển
              thị khi có dữ liệu giám sát từ hạ tầng.
            </p>
          </div>
        </>
      )}
      {tab === "data" && (
        <>
          <DataEvolution taskId={taskId} stage={done ? 2 : 1} />
          <div className="st-panel">
            <h3>Bộ dữ liệu & gói mô hình</h3>
            <dl className="st-definition">
              {[
                ["Mã bộ dữ liệu", job.dataset_id || "CSV gửi trực tiếp"],
                ["Cột mục tiêu", job.target],
                [
                  "Số dòng huấn luyện",
                  job.metrics?.training_rows?.toLocaleString() || "—",
                ],
                [
                  "Số dòng kiểm tra",
                  job.metrics?.evaluation?.test_rows?.toLocaleString() || "—",
                ],
                ["Ảnh môi trường chạy", job.image_uri],
                [
                  "Dung lượng mô hình",
                  job.metrics?.artifact_bytes
                    ? `${(job.metrics.artifact_bytes / 1e6).toFixed(2)} MB`
                    : "—",
                ],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
      {tab === "events" && (
        <div className="st-panel st-log-panel">
          <h3>
            <Terminal size={17} /> Nhật ký quy trình
          </h3>
          {[
            [job.created_at, "Tác vụ đã được tạo"],
            [job.started_at, "Máy xử lý bắt đầu huấn luyện"],
            [
              job.finished_at,
              "Huấn luyện " + statusName(job.status).toLowerCase(),
            ],
          ]
            .filter(([time]) => time)
            .map(([time, label]) => (
              <div key={String(label)}>
                <time>
                  {new Date(Number(time) * 1000).toLocaleString("vi-VN")}
                </time>
                <code>{label}</code>
              </div>
            ))}
        </div>
      )}
    </>
  );
}
export function EndpointList({ go }: { go: (p: string) => void }) {
  const list = useCollection<Deployment>("/deployments");
  return (
    <>
      <div className="st-page-heading">
        <div>
          <div className="st-eyebrow">DỰ ĐOÁN</div>
          <h1>Đưa mô hình vào ứng dụng.</h1>
          <p>Chọn API dự đoán để dự đoán, xem kết quả và lấy mã tích hợp.</p>
        </div>
        <button className="st-btn secondary" onClick={() => go("/app/models")}>
          Triển khai mô hình
        </button>
      </div>
      <ErrorNote error={list.error} />
      {list.items.length ? (
        <div className="st-endpoint-grid">
          {list.items.map((d) => (
            <article className="st-panel" key={d.deployment_id}>
              <div className="st-panel-head">
                <Zap size={24} />
                <Status status={d.status} />
              </div>
              <h3>{d.name}</h3>
              <p>
                {
                  taskById(d.task === "tabular" ? "classification" : d.task)
                    .name
                }
              </p>
              <code className="st-endpoint-id">
                {d.deployment_id.slice(0, 16)}
              </code>
              <p className="st-muted">Cột mục tiêu: {d.target}</p>
              <button
                className="st-btn full"
                onClick={() => go("/app/inference/" + d.deployment_id)}
              >
                Thử dự đoán
              </button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title={list.loading ? "Đang tải API dự đoán…" : "Chưa có API dự đoán."}
          description="Chọn một mô hình đã huấn luyện và bấm Triển khai để bắt đầu dự đoán."
          action="Mở kho mô hình"
          onClick={() => go("/app/models")}
        />
      )}{" "}
      {list.cursor && (
        <button
          className="st-btn secondary"
          disabled={list.loading}
          onClick={() => void list.more()}
        >
          Tải thêm API dự đoán
        </button>
      )}
    </>
  );
}
export function Inference({
  id,
  initialKey,
  keepKey,
  go,
}: {
  id: string;
  initialKey: string;
  keepKey: (id: string, key: string) => void;
  go: (p: string) => void;
}) {
  const [deployment, setDeployment] = useState<Deployment | null>(null),
    [dataset, setDataset] = useState<Dataset | null>(null),
    [fields, setFields] = useState<Record<string, string>>({}),
    [rows, setRows] = useState("[{}]"),
    [key, setKey] = useState(initialKey),
    [result, setResult] = useState<{
      predictions?: unknown[];
      [key: string]: unknown;
    } | null>(null),
    [latency, setLatency] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [inputTab, setInputTab] = useState("form"),
    [outputTab, setOutputTab] = useState("visual"),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    void api<Deployment>("/deployments/" + id)
      .then(async (d) => {
        if (!active) return;
        setDeployment(d);
        if (d.dataset_id) {
          const ds = await api<Dataset>("/datasets/" + d.dataset_id);
          if (!active) return;
          setDataset(ds);
          const first = { ...ds.profile?.preview[0] };
          delete first[d.target];
          const values = Object.fromEntries(
            Object.entries(first).map(([k, v]) => [k, String(v ?? "")]),
          );
          setFields(values);
          setRows(JSON.stringify([values], null, 2));
        } else setInputTab("json");
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  const base = config.apiUrl.startsWith("http")
    ? config.apiUrl
    : location.origin + config.apiUrl;
  const endpoint = base.replace(/\/$/, "") + "/predict/" + id;
  const formRow = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => {
      const column = dataset?.profile?.columns.find((c) => c.name === k);
      return [k, column?.type === "numeric" && v.trim() ? Number(v) : v];
    }),
  );
  let parsed: unknown;
  try {
    parsed = inputTab === "form" ? [formRow] : JSON.parse(rows);
  } catch {
    parsed = null;
  }
  const valid =
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.length <= 100 &&
    parsed.every((v) => v && typeof v === "object" && !Array.isArray(v));
  const isVision = deployment?.task === "image-classification" || deployment?.task === "segmentation";
  const curl = `curl '${endpoint}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-Api-Key: YOUR_DEPLOYMENT_KEY' \\\n  --data '${JSON.stringify(isVision ? { image_base64: "BASE64_JPEG_PNG_WEBP" } : { rows: valid ? parsed : [] }).replace(/'/g, "'\\''")}'`;
  async function predict() {
    setBusy("predict");
    setError("");
    setResult(null);
    try {
      if (!valid) throw new Error("Đầu vào phải là mảng JSON gồm 1–100 đối tượng dữ liệu.");
      const t = performance.now();
      const data = await api<{ predictions: unknown[] }>(
        "/predict/" + id,
        { rows: parsed },
        "POST",
        key,
      );
      setLatency(Math.round(performance.now() - t));
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function rotate() {
    setBusy("key");
    setError("");
    try {
      const data = await api<{ api_key: string }>(
        "/deployments/" + id + "/key",
        {},
      );
      setKey(data.api_key);
      keepKey(id, data.api_key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function revoke() {
    setBusy("revoke");
    setError("");
    try {
      await api("/deployments/" + id, undefined, "DELETE");
      setDeployment((d) => (d ? { ...d, status: "REVOKED" } : d));
      setKey("");
      keepKey(id, "");
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (!deployment)
    return (
      <>
        <ErrorNote error={error} />
        <div className="st-empty">
          <Loader2 className="st-spin" /> Đang tải API dự đoán…
        </div>
      </>
    );
  const inactive = deployment.status !== "ACTIVE";
  return (
    <>
      <div className="st-page-heading">
        <div>
          <div className="st-eyebrow">THỬ NGHIỆM DỰ ĐOÁN</div>
          <h1>Thử mô hình. Nhìn thấy kết quả.</h1>
          <p>
            {deployment.name} ·{" "}
            {
              taskById(
                deployment.task === "tabular"
                  ? "classification"
                  : deployment.task,
              ).name
            }
          </p>
        </div>
        <button
          className="st-btn secondary"
          onClick={() => go("/app/experiments/" + deployment.job_id)}
        >
          Xem chỉ số mô hình
        </button>
      </div>
      <ErrorNote error={error} />
      <div className="st-endpoint-bar">
        <span className="st-method">POST</span>
        <code>{endpoint}</code>
        <CopyButton text={endpoint} label="Sao chép địa chỉ" />
      </div>
      <div className="st-playground-toolbar">
        <Status status={deployment.status} />
        <span className="st-muted">{isVision ? "Ảnh → " + (deployment.task === "segmentation" ? "mặt nạ từng điểm ảnh" : "nhãn và xác suất") : `Cột mục tiêu: ${deployment.target}`}</span>
      </div>
      <div className="st-panel st-api-key">
        <label>
          Khóa API của bản triển khai
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Dán khóa API của API dự đoán"
          />
        </label>
        <button
          className="st-btn secondary"
          disabled={!!busy || inactive}
          onClick={() => void rotate()}
        >
          <RefreshCw size={16} /> Tạo khóa thay thế
        </button>
        <p className="st-muted">
          Khóa được giữ trong phiên làm việc này. Lưu khóa ở nơi an toàn trước khi
          đóng trang.
        </p>
      </div>
      {isVision ? <ImageInference key={id} id={id} task={deployment.task} apiKey={key} inactive={inactive} /> : (
      <div className="st-playground-grid">
        <section className="st-panel">
          <div className="st-panel-head">
            <h3>Đầu vào</h3>
            <div className="st-segmented small">
              <button
                disabled={!Object.keys(fields).length}
                className={inputTab === "form" ? "active" : ""}
                onClick={() => {
                  setInputTab("form");
                  setResult(null);
                }}
              >
                Biểu mẫu
              </button>
              <button
                className={inputTab === "json" ? "active" : ""}
                onClick={() => {
                  setRows(JSON.stringify([formRow], null, 2));
                  setInputTab("json");
                  setResult(null);
                }}
              >
                JSON
              </button>
            </div>
          </div>
          {inputTab === "form" ? (
            <div className="st-form-grid">
              {Object.keys(fields).map((name) => {
                const c = dataset?.profile?.columns.find(
                  (col) => col.name === name,
                );
                return (
                  <label key={name}>
                    {name}
                    {c?.type === "categorical" &&
                    c.unique <= 10 &&
                    c.examples.length > 1 ? (
                      <select
                        value={fields[name]}
                        onChange={(e) => {
                          setFields((old) => ({
                            ...old,
                            [name]: e.target.value,
                          }));
                          setResult(null);
                        }}
                      >
                        {Array.from(new Set([fields[name], ...c.examples])).map(
                          (v) => (
                            <option key={v}>{v}</option>
                          ),
                        )}
                      </select>
                    ) : (
                      <input
                        type={c?.type === "numeric" ? "number" : "text"}
                        value={fields[name]}
                        onChange={(e) => {
                          setFields((old) => ({
                            ...old,
                            [name]: e.target.value,
                          }));
                          setResult(null);
                        }}
                      />
                    )}
                  </label>
                );
              })}
            </div>
          ) : (
            <label>
              Dữ liệu đầu vào
              <textarea
                rows={12}
                spellCheck={false}
                value={rows}
                onChange={(e) => {
                  setRows(e.target.value);
                  setResult(null);
                }}
              />
              <small>Mảng JSON · tối đa 100 dòng · không cần cột mục tiêu.</small>
            </label>
          )}
          <button
            className="st-btn full"
            disabled={!!busy || inactive || !key.trim() || !valid}
            onClick={() => void predict()}
          >
            {busy === "predict" ? (
              <Loader2 size={17} className="st-spin" />
            ) : (
              <Play size={17} />
            )}{" "}
            {busy === "predict" ? "Đang dự đoán…" : "Chạy dự đoán"}
          </button>
        </section>
        <section className="st-panel">
          <div className="st-panel-head">
            <h3>Kết quả dự đoán</h3>
            <div className="st-segmented small">
              <button
                className={outputTab === "visual" ? "active" : ""}
                onClick={() => setOutputTab("visual")}
              >
                Trực quan
              </button>
              <button
                className={outputTab === "json" ? "active" : ""}
                onClick={() => setOutputTab("json")}
              >
                JSON
              </button>
            </div>
          </div>
          {!result ? (
            <div className="st-prediction-empty">
              <Zap size={34} />
              <h3>
                {busy === "predict" ? "Đang xử lý…" : "Mô hình đang chờ bạn."}
              </h3>
              <p>Nhập các đặc trưng và chạy dự đoán để xem kết quả.</p>
            </div>
          ) : (
            <>
              <div className="st-result-status">
                <span>
                  <CheckCircle2 size={15} /> Đã nhận kết quả
                </span>
                <span>{latency} ms · toàn bộ yêu cầu</span>
              </div>
              {outputTab === "json" ? (
                <>
                  <CopyButton
                    text={JSON.stringify(result, null, 2)}
                    label="Sao chép JSON"
                  />
                  <pre className="st-code">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </>
              ) : (
                <div className="st-prediction-values">
                  {result.predictions?.map((prediction, i) => (
                    <div key={i}>
                      <span>
                        {result.predictions!.length === 1
                          ? deployment.target
                          : `Dòng ${i + 1} · ${deployment.target}`}
                      </span>
                      <strong>
                        {typeof prediction === "number"
                          ? new Intl.NumberFormat("vi-VN", {
                              maximumFractionDigits: 4,
                            }).format(prediction)
                          : String(prediction)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
      )}
      <div className="st-panel">
        <div className="st-panel-head">
          <div>
            <h3>Tích hợp vào ứng dụng</h3>
            <p>Gọi API dự đoán với khóa API của bản triển khai.</p>
          </div>
          <CopyButton text={curl} label="Sao chép cURL" />
        </div>
        <pre className="st-code">{curl}</pre>
      </div>
      <div className="st-actions">
        {confirm ? (
          <>
            <span>Thu hồi sẽ vô hiệu hóa API dự đoán và khóa API.</span>
            <button
              className="st-btn secondary"
              disabled={!!busy}
              onClick={() => void revoke()}
            >
              Xác nhận thu hồi
            </button>
            <button className="st-link" onClick={() => setConfirm(false)}>
              Giữ lại
            </button>
          </>
        ) : (
          <button
            className="st-link"
            disabled={inactive || !!busy}
            onClick={() => setConfirm(true)}
          >
            Thu hồi API dự đoán
          </button>
        )}
      </div>
    </>
  );
}
