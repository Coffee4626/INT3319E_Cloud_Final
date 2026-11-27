import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  UploadCloud,
  SlidersHorizontal,
  Database,
  FlaskConical,
  Layers3,
  Loader2,
  Download,
  Info,
  X,
  Play,
  Server,
} from "lucide-react";
import {
  api,
  upload,
  sampleFile,
  config,
  signedIn,
  signIn,
  type Dataset,
} from "../api";
import {
  TASKS,
  defaultConfig,
  modelById,
  taskById,
  type TaskId,
  type RunConfig,
} from "./catalog";
import { TaskArt, Architecture, DataEvolution } from "./Visuals";
import { inspectFile, downloadText, type DataSummary } from "./data";

export function TaskCatalog({
  selected,
  onSelect,
  compact = false,
}: {
  selected?: TaskId;
  onSelect: (id: TaskId) => void;
  compact?: boolean;
}) {
  const [filter, setFilter] = useState("Tất cả");
  const groups = [
    "Tất cả",
    "Thị giác máy tính",
    "Dữ liệu bảng",
  ];
  return (
    <>
      <div className="st-filters" aria-label="Lọc nhóm bài toán">
        {groups.map((g) => (
          <button
            key={g}
            className={filter === g ? "active" : ""}
            onClick={() => setFilter(g)}
          >
            {g}
            {g === "Tất cả" && <span>{TASKS.length}</span>}
          </button>
        ))}
      </div>
      <div className={`st-task-grid ${compact ? "compact" : ""}`}>
        {TASKS.filter((t) => filter === "Tất cả" || t.group === filter).map(
          (t) => (
            <button
              className={`st-task-card ${selected === t.id ? "selected" : ""}`}
              key={t.id}
              onClick={() => onSelect(t.id)}
              aria-pressed={selected === t.id}
            >
              <TaskArt id={t.id} />
              <div className="st-task-copy">
                <div className="st-card-kicker">
                  <span>{t.group}</span>
                  {selected === t.id ? <CheckCircle2 size={17} /> : null}
                </div>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <div className="st-task-io">
                  <span>{t.input}</span>
                  <span>{t.output}</span>
                </div>
              </div>
            </button>
          ),
        )}
      </div>
    </>
  );
}
export function Wizard({
  initialTask = "image-classification",
  existingDataset,
  onLive,
  go,
}: {
  initialTask?: TaskId;
  existingDataset?: string;
  onLive: (id: string) => void;
  go: (path: string) => void;
}) {
  const [step, setStep] = useState(existingDataset ? 2 : 0),
    [form, setForm] = useState(() => defaultConfig(initialTask));
  const [summary, setSummary] = useState<DataSummary | null>(null),
    [dataset, setDataset] = useState<Dataset | null>(null),
    [prepared, setPrepared] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [drag, setDrag] = useState(false),
    [dropColumns, setDropColumns] = useState<string[]>([]),
    [dedupe, setDedupe] = useState(true),
    [trim, setTrim] = useState(true),
    [dropMissing, setDropMissing] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const selectedFile = useRef<File | null>(null);
  const submitting = useRef(false);
  const submissionId = useRef<string | null>(null);
  const uploaded = useRef<Dataset | null>(null);
  const task = taskById(form.taskId),
    isLive = !!task.live,
    isTabular = task.group === "Dữ liệu bảng",
    isVision = task.group === "Thị giác máy tính";
  const patch = (v: Partial<RunConfig>) => {
    submissionId.current = null;
    setForm((f) => ({ ...f, ...v }));
  };
  const setData = (s: DataSummary, d?: Dataset) => {
    setSummary(s);
    setDataset(d || null);
    setPrepared(!!d?.prepared);
    setDropColumns([]);
    patch({
      datasetName: s.name,
      sample: s.sample,
      count: s.count,
      classes: s.classes,
      target: d?.target || s.columns.at(-1) || "",
    });
  };
  useEffect(() => {
    if (!existingDataset) return;
    let active = true;
    setBusy("Đang đọc bộ dữ liệu");
    void api<Dataset>("/datasets/" + existingDataset)
      .then((d) => {
        if (!active) return;
        const p = d.profile;
        if (!p) throw new Error("Bộ dữ liệu chưa có hồ sơ.");
        setForm({
          ...defaultConfig(d.task && d.task !== "tabular" ? taskById(d.task).id : "classification"),
          name: d.name + " · thí nghiệm",
        });
        setData(
          {
            name: d.name,
            count: p.rows,
            classes: p.classes?.length || 0,
            columns: p.columns.map((c) => c.name),
            files: p.format === "image-zip" ? [`Huấn luyện: ${p.splits?.train || 0} ảnh`, `Kiểm định: ${p.splits?.val || 0} ảnh`, `Các lớp: ${p.classes?.join(", ") || "—"}`] : [],
            size: p.size_bytes,
            sample: false,
            preview: p.preview.map((r) =>
              p.columns.map((c) => String(r[c.name] ?? "")),
            ),
          },
          d,
        );
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy("");
      });
    return () => {
      active = false;
    };
  }, [existingDataset]);
  const selectTask = (id: TaskId) => {
    if (id === form.taskId) return;
    selectedFile.current = null;
    uploaded.current = null;
    setForm(defaultConfig(id));
    setSummary(null);
    setDataset(null);
    setPrepared(false);
    setError("");
  };
  async function receive(file: File) {
    setBusy("Kiểm tra tệp trên thiết bị…");
    selectedFile.current = null;
    uploaded.current = null;
    setError("");
    setPrepared(false);
    setSummary(null);
    setDataset(null);
    try {
      const s = await inspectFile(file, task);
      selectedFile.current = file;
      setData(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function useSample() {
    if (!isLive) return;
    const f =
      task.id === "regression"
        ? new File(
            [
              [
                "area,rooms,age,price",
                ...Array.from({ length: 240 }, (_, i) => {
                  const area = 40 + i * 2;
                  return `${area},${1 + (i % 5)},${i % 20},${Math.round(45000 + area * 2100 - (i % 20) * 1500 + Math.sin(i) * 3000)}`;
                }),
              ].join("\n"),
            ],
            "house-prices.csv",
            { type: "text/csv" },
          )
        : sampleFile();
    await receive(f);
  }
  function preprocess() {
    if (!summary) return;
    setError("");
    setPrepared(true);
  }
  async function start() {
    if (submitting.current || !isLive || !prepared || (!selectedFile.current && !dataset)) return;
    submitting.current = true;
    setError("");
    setBusy("Đang tải bộ dữ liệu lên S3…");
    try {
      let source = dataset || uploaded.current;
      if (!source) {
        source = await upload(selectedFile.current!, task.id);
        uploaded.current = source;
      }
      let ready = source;
      if (!source.prepared) {
        setBusy("Đang xác minh và chuẩn bị dữ liệu…");
        ready = await api<Dataset>(`/datasets/${source.dataset_id}/preprocess`, {
          target: form.target, drop_columns: dropColumns, trim_strings: trim,
          drop_duplicates: dedupe, drop_missing_target: dropMissing,
        });
        setDataset(ready);
      }
      setBusy("Đang tạo tác vụ huấn luyện…");
      const j = await api<{ job_id: string }>("/jobs", {
        submission_id: submissionId.current ||= crypto.randomUUID(),
        dataset_id: ready.dataset_id, name: form.name, target: form.target,
        task: task.id, time_limit: form.timeLimit,
        ...(isVision ? { config: {
          model: form.modelIds[0], epochs: form.epochs, batch_size: form.batchSize,
          learning_rate: form.learningRate, image_size: form.imageSize,
          augment: form.augment, early_stopping: form.earlyStopping,
        }} : {}),
      });
      onLive(j.job_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }
  const steps = ["Chọn bài toán", "Mô hình & cấu hình", "Dữ liệu", "Kiểm tra & huấn luyện"];
  return (
    <div className="st-wizard">
      <div className="st-page-heading">
        <div>
          <div className="st-eyebrow">THÍ NGHIỆM MỚI</div>
          <h1>Từ dữ liệu đến một mô hình.</h1>
          <p>Chọn bài toán của bạn. Studio sẽ thiết lập phần còn lại.</p>
        </div>
        <button className="st-btn ghost" disabled={!!busy} onClick={() => go("/app")}>
          Đóng
        </button>
      </div>
      <div className="st-stepper">
        {steps.map((s, i) => (
          <button
            key={s}
            className={`${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
            disabled={i > step || !!busy}
            onClick={() => {
              setStep(i);
              setError("");
            }}
          >
            <span>{i < step ? <Check size={16} /> : i + 1}</span>
            {s}
          </button>
        ))}
      </div>
      {error && (
        <div className="st-alert error" role="alert">
          {error}
        </div>
      )}
      {step === 0 ? (
        <>
          <div className="st-section-heading">
            <div>
              <h2>Bạn muốn mô hình làm gì?</h2>
              <p>
                Mỗi bài toán có định dạng dữ liệu, mô hình và cách đánh giá riêng.
              </p>
            </div>
            <span className="st-chip">8 bài toán</span>
          </div>
          <TaskCatalog selected={task.id} onSelect={selectTask} />
          <div className="st-selected-task">
            <TaskArt id={task.id} />
            <div>
              <small>BÀI TOÁN ĐÃ CHỌN</small>
              <h3>{task.name}</h3>
              <p>
                {task.input} → {task.output}
              </p>
            </div>
            <CheckCircle2 size={24} />
          </div>
        </>
      ) : (
        <>
          <div className="st-context">
            <div>
              <Layers3 size={19} />
              <strong>{task.name}</strong>
              {task.vi !== task.name && <span>{task.vi}</span>}
            </div>
            <span className="st-badge blue">{task.format}</span>
          </div>
          {step === 1 && (
            <>
              {!isLive && (
                <div className="st-note">
                  <Info size={16} /> Bài toán này chưa có môi trường chạy sẵn sàng trong
                  không gian làm việc. Bạn có thể chuẩn bị cấu hình và kiểm tra bộ dữ liệu;
                  huấn luyện sẽ khả dụng khi môi trường chạy được kết nối.
                </div>
              )}
              <div className="st-section-heading">
                <div>
                  <h2>Chọn mô hình huấn luyện</h2>
                  <p>
                    {isLive
                      ? "Chọn mô hình phù hợp với bài toán của bạn."
                      : "Chọn một hoặc nhiều mô hình. Bạn có thể xem riêng kết quả từng mô hình."}
                  </p>
                </div>
                <span className="st-chip">{form.modelIds.length} đã chọn</span>
              </div>
              <div className="st-model-grid">
                {task.models.map((m) => (
                  <button
                    key={m.id}
                    disabled={isTabular && m.id !== "lightgbm"}
                    title={
                      isTabular && m.id !== "lightgbm"
                        ? "Mô hình này chưa khả dụng trong không gian làm việc."
                        : m.name
                    }
                    aria-pressed={form.modelIds.includes(m.id)}
                    className={`st-model-card ${form.modelIds.includes(m.id) ? "selected" : ""}`}
                    onClick={() =>
                      patch({
                        modelIds: [m.id],
                      })
                    }
                  >
                    <div className="st-model-icon">
                      <Layers3 size={22} />
                      {form.modelIds.includes(m.id) && (
                        <CheckCircle2 size={18} />
                      )}
                    </div>
                    <h3>{m.name}</h3>
                    <span>
                      {m.family} · {m.size}
                    </span>
                    <p>{m.description}</p>
                  </button>
                ))}
              </div>
              <div className="st-panel">
                <div className="st-panel-head">
                  <h3>
                    <SlidersHorizontal size={18} /> Cấu hình huấn luyện
                  </h3>
                  <span className="st-muted">Siêu tham số</span>
                </div>
                <div className="st-form-grid">
                  <label className="wide">
                    Tên thí nghiệm
                    <input
                      value={form.name}
                      maxLength={120}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  </label>
                  {isLive && (
                    <label>
                      Giới hạn thời gian (giây)
                      <select
                        value={form.timeLimit}
                        onChange={(e) => patch({ timeLimit: +e.target.value })}
                      >
                        {[30, 60, 120, 300, 600].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {isVision && (
                    <>
                      <label>
                        Số vòng huấn luyện
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={form.epochs}
                          onChange={(e) => patch({ epochs: +e.target.value })}
                        />
                      </label>
                      <label>
                        Kích thước lô
                        <select
                          value={form.batchSize}
                          onChange={(e) =>
                            patch({ batchSize: +e.target.value })
                          }
                        >
                          {[1, 2, 4, 8, 16].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Tốc độ học
                        <select
                          value={form.learningRate}
                          onChange={(e) =>
                            patch({ learningRate: +e.target.value })
                          }
                        >
                          {[0.01, 0.001, 0.0001].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Kích thước ảnh đầu vào
                        <select value={form.imageSize} onChange={(e) => patch({ imageSize: +e.target.value })}>
                          {[64, 128, 192, 256].map((size) => <option key={size} value={size}>{size} × {size} px</option>)}
                        </select>
                      </label>
                    </>
                  )}
                  {isTabular && (
                    <p className="st-note">
                      Giữ 20% dữ liệu làm tập kiểm tra độc lập khi đủ mẫu. AutoGluon tự tách tập kiểm định từ phần dữ liệu huấn luyện. Số vòng huấn luyện, kích thước lô và GPU không áp dụng cho mô hình này.
                    </p>
                  )}
                </div>
              </div>
              {!isLive && (
                <div className="st-panel">
                  <div className="st-panel-head">
                    <h3>
                      <Server size={18} /> Tài nguyên & tự động co giãn
                    </h3>
                  </div>
                  <div className="st-form-grid">
                    <label>
                      Máy EC2
                      <select
                        value={form.instance}
                        onChange={(e) => patch({ instance: e.target.value })}
                      >
                        <option value="g4dn.xlarge">
                          g4dn.xlarge · NVIDIA T4 · 16 GB
                        </option>
                        <option value="g5.xlarge">
                          g5.xlarge · NVIDIA A10G · 24 GB
                        </option>
                        <option value="t3.large">t3.large · CPU · 8 GB</option>
                      </select>
                    </label>
                    <label>
                      Số máy xử lý tối đa
                      <select
                        value={form.maxWorkers}
                        onChange={(e) => patch({ maxWorkers: +e.target.value })}
                      >
                        {[1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>
                            {n} máy xử lý
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="st-muted">
                    Tăng từ 0 máy khi có tác vụ trong SQS. Mỗi mô hình tương ứng một tác vụ huấn luyện; nhóm máy thu về 0 sau khi hoàn tất.
                  </p>
                </div>
              )}
            </>
          )}
          {step === 2 && (
            <div className="st-data-layout">
              <div>
                <div className="st-section-heading">
                  <div>
                    <h2>Dữ liệu phù hợp, mô hình tốt hơn.</h2>
                    <p>
                      Chọn tệp và kiểm tra cấu trúc trên thiết bị. Dữ liệu chỉ được tải lên khi bạn bấm Bắt đầu huấn luyện.
                    </p>
                  </div>
                </div>
                <input
                  ref={input}
                  className="st-visually-hidden"
                  type="file"
                  accept={task.accept}
                  aria-label="Chọn tệp bộ dữ liệu"
                  disabled={!!busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void receive(f);
                    e.target.value = "";
                  }}
                />
                <div
                  className={`st-upload ${drag ? "drag" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!busy) setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    const f = e.dataTransfer.files[0];
                    if (f && !busy) void receive(f);
                  }}
                >
                  <UploadCloud size={34} />
                  <h3>{busy || "Thả bộ dữ liệu của bạn vào đây"}</h3>
                  <p>
                    {task.format} · tối đa{" "}
                    {task.accept === ".zip" ? "200" : "10"} MB
                  </p>
                  <button
                    className="st-btn secondary"
                    disabled={!!busy || (isLive && !signedIn())}
                    onClick={() => input.current?.click()}
                  >
                    Chọn tệp
                  </button>
                  {isTabular && (
                    <>
                      <span>hoặc</span>
                      <button
                        className="st-link"
                        disabled={!!busy || !signedIn()}
                        onClick={() => void useSample()}
                      >
                        Dùng dữ liệu mẫu
                      </button>
                    </>
                  )}
                </div>
                {isLive && !signedIn() && (
                  <button
                    className="st-btn"
                    onClick={() =>
                      void signIn().catch((e) => setError(e.message))
                    }
                  >
                    Đăng nhập để tải lên
                  </button>
                )}
                {summary && (
                  <div className="st-panel">
                    <div className="st-panel-head">
                      <div>
                        <h3>
                          <Database size={18} />
                          {summary.name}
                        </h3>
                        <p>
                          {summary.sample
                            ? "Dữ liệu mẫu"
                            : "Đã kiểm tra cấu trúc"}{" "}
                          · {summary.count.toLocaleString()}{" "}
                          {task.accept === ".zip" ? "ảnh" : "dòng"} ·{" "}
                          {(summary.size / 1e6).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        className="st-icon-btn"
                        aria-label="Bỏ bộ dữ liệu"
                        disabled={!!busy}
                        onClick={() => {
                          selectedFile.current = null;
                          uploaded.current = null;
                          setSummary(null);
                          setPrepared(false);
                          setDataset(null);
                        }}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    {summary.columns.length > 0 ? (
                      <div className="st-table-wrap">
                        <table className="st-table">
                          <thead>
                            <tr>
                              {summary.columns.map((c) => (
                                <th key={c}>{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {summary.preview.map((r, i) => (
                              <tr key={i}>
                                {r.map((c, j) => (
                                  <td key={j}>{c}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <pre className="st-code">{summary.files.join("\n")}</pre>
                    )}
                    {summary.columns.length > 0 && task.group === "Dữ liệu bảng" && (
                      <label>
                        Cột mục tiêu
                        <select
                          disabled={prepared}
                          value={form.target}
                          onChange={(e) => {
                            patch({ target: e.target.value });
                            setDropColumns((d) =>
                              d.filter((c) => c !== e.target.value),
                            );
                          }}
                        >
                          {summary.columns.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {isTabular && dataset?.profile && (
                      <div className="st-profile-stats">
                        <span>
                          <b>{dataset.profile.missing_cells}</b> ô thiếu dữ liệu
                        </span>
                        <span>
                          <b>{dataset.profile.duplicates}</b> dòng trùng lặp
                        </span>
                        <span>
                          <b>{dataset.profile.columns.length}</b> cột
                        </span>
                      </div>
                    )}
                    <h4>Tiền xử lý</h4>
                    <div className="st-checks">
                      {isTabular ? (
                        <>
                          <label>
                            <input
                              type="checkbox"
                              disabled={prepared}
                              checked={trim}
                              onChange={(e) => setTrim(e.target.checked)}
                            />{" "}
                            Loại khoảng trắng dư
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              disabled={prepared}
                              checked={dedupe}
                              onChange={(e) => setDedupe(e.target.checked)}
                            />{" "}
                            Loại dòng trùng
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              disabled={prepared}
                              checked={dropMissing}
                              onChange={(e) => setDropMissing(e.target.checked)}
                            />{" "}
                            Loại dòng thiếu mục tiêu
                          </label>
                          <div className="wide">
                            <span className="st-muted">
                              Bỏ đặc trưng khỏi tập huấn luyện:
                            </span>
                            {summary.columns
                              .filter((c) => c !== form.target)
                              .map((c) => (
                                <label key={c}>
                                  <input
                                    type="checkbox"
                                    disabled={prepared}
                                    checked={dropColumns.includes(c)}
                                    onChange={(e) =>
                                      setDropColumns((d) =>
                                        e.target.checked
                                          ? [...d, c]
                                          : d.filter((x) => x !== c),
                                      )
                                    }
                                  />
                                  {c}
                                </label>
                              ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <label>
                            <input
                              type="checkbox"
                              checked={true}
                              disabled
                              onChange={(e) => {
                                patch({ normalize: e.target.checked });
                                setPrepared(false);
                              }}
                            />{" "}
                            {task.group === "Thị giác máy tính"
                              ? "Đổi kích thước & chuẩn hóa"
                              : "Chuẩn hóa dữ liệu"}
                          </label>
                          {task.group === "Thị giác máy tính" && (
                            <label>
                              <input
                                type="checkbox"
                                checked={form.augment}
                                onChange={(e) => {
                                  patch({ augment: e.target.checked });
                                  setPrepared(false);
                                }}
                              />{" "}
                              Tăng cường dữ liệu
                            </label>
                          )}
                          <label>
                            <input
                              type="checkbox"
                              checked={form.earlyStopping}
                              onChange={(e) =>
                                patch({ earlyStopping: e.target.checked })
                              }
                            />{" "}
                            Dừng sớm
                          </label>
                        </>
                      )}
                    </div>
                    <button
                      className={`st-btn ${prepared ? "secondary" : ""}`}
                      onClick={() => void preprocess()}
                      disabled={
                        !!busy ||
                        prepared ||
                        (isTabular &&
                          (!form.target ||
                            dropColumns.length >= summary.columns.length - 1))
                      }
                    >
                      {prepared ? (
                        <CheckCircle2 size={17} />
                      ) : (
                        <SlidersHorizontal size={17} />
                      )}{" "}
                      {prepared ? "Đã xác nhận cấu hình dữ liệu" : "Xác nhận cấu hình dữ liệu"}
                    </button>
                    {isVision && (
                      <p className="st-muted">
                        Kiểm tra cấu trúc thư mục hoàn tất. Chú thích, mặt nạ và
                        nội dung ảnh sẽ được xác minh trước khi tạo tác vụ. Ảnh được đổi kích thước; mặt nạ giữ nguyên mã lớp. Tập val chỉ dùng đánh giá, không tăng cường dữ liệu.
                      </p>
                    )}
                  </div>
                )}
              </div>
              <aside className="st-format-panel">
                <TaskArt id={task.id} />
                <div>
                  <span className="st-eyebrow">QUY CHUẨN DỮ LIỆU</span>
                  <h3>{task.format}</h3>
                  <p>
                    Chuẩn bị bộ dữ liệu theo cấu trúc này để phù hợp với{" "}
                    {task.name}.
                  </p>
                  <pre className="st-code">{task.structure}</pre>
                  <button
                    className="st-btn secondary"
                    onClick={() =>
                      downloadText(task.id + "-format.txt", task.structure)
                    }
                  >
                    <Download size={16} /> Tải hướng dẫn định dạng
                  </button>
                </div>
              </aside>
            </div>
          )}
          {step === 3 && (
            <>
              <div className="st-section-heading">
                <div>
                  <h2>Sẵn sàng cho lần huấn luyện đầu tiên.</h2>
                  <p>
                    Kiểm tra cấu hình và dữ liệu trước khi bắt đầu huấn luyện.
                  </p>
                </div>
              </div>
              <div className="st-review-grid">
                <div className="st-panel">
                  <h3>{form.name}</h3>
                  <dl className="st-definition">
                    <div>
                      <dt>Bài toán</dt>
                      <dd>{task.name}</dd>
                    </div>
                    <div>
                      <dt>Mô hình</dt>
                      <dd>
                        {form.modelIds
                          .map((id) => modelById(task, id).name)
                          .join(", ")}
                      </dd>
                    </div>
                    <div>
                      <dt>Bộ dữ liệu</dt>
                      <dd>{form.datasetName}</dd>
                    </div>
                    <div>
                      <dt>Dữ liệu</dt>
                      <dd>
                        {form.count.toLocaleString()} mẫu
                        {form.target ? " · mục tiêu: " + form.target : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>Huấn luyện</dt>
                      <dd>
                        {isTabular
                          ? `Giới hạn ${form.timeLimit} giây`
                          : `${form.epochs} vòng · lô ${form.batchSize} · ${form.imageSize} px · tối đa ${form.timeLimit}s`}
                      </dd>
                    </div>
                    <div>
                      <dt>Tài nguyên tính toán</dt>
                      <dd>
                        {isLive
                          ? config.local
                            ? "Máy xử lý Docker · máy hiện tại"
                            : "EC2 · theo cấu hình hạ tầng"
                          : `${form.instance} · 0–${form.maxWorkers} máy xử lý`}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="st-panel st-blue-panel">
                  <FlaskConical size={30} />
                  <h3>Theo dõi toàn bộ hành trình.</h3>
                  <p>
                    {isLive
                      ? "Sau khi bạn bắt đầu, dữ liệu được xác minh rồi đưa vào hàng đợi. EC2 tự khởi động để huấn luyện, đánh giá và lưu mô hình."
                      : "Theo dõi quá trình tăng số máy xử lý, xem mất mát từng vòng học, so sánh mô hình và thử dự đoán."}
                  </p>
                  <div className="st-note">
                    {isLive
                      ? "Chưa tạo tác vụ và chưa khởi động máy huấn luyện. Bạn có thể đóng trang mà không phát sinh compute huấn luyện."
                      : "Môi trường chạy chưa sẵn sàng cho bài toán này. Chức năng huấn luyện sẽ được mở sau khi kết nối tài nguyên cần thiết."}
                  </div>
                </div>
              </div>
              <DataEvolution taskId={task.id} stage={1} />
              <Architecture taskId={task.id} stage={0} live={isLive} />
            </>
          )}
        </>
      )}
      <div className="st-wizard-footer">
        <div>
          <span className="st-muted">Bước {step + 1} / 4</span>
          <strong>
            {step === 0
              ? task.name
              : form.modelIds.map((id) => modelById(task, id).name).join(" + ")}
          </strong>
        </div>
        <div>
          {step > 0 && (
            <button
              className="st-btn secondary"
              disabled={!!busy}
              onClick={() => {
                setStep((s) => s - 1);
                setError("");
              }}
            >
              Quay lại
            </button>
          )}
          {step < 3 ? (
            <button
              className="st-btn"
              disabled={
                !!busy ||
                (step === 2 && !prepared) ||
                (step === 1 &&
                  (!form.name.trim() ||
                    form.epochs < 1 ||
                    form.epochs > 100 ||
                    !Number.isInteger(form.epochs)))
              }
              onClick={() => {
                setStep((s) => s + 1);
                setError("");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Tiếp tục
            </button>
          ) : (
            <>
              <button
                className="st-btn secondary"
                onClick={() =>
                  downloadText(
                    "experiment-config.json",
                    JSON.stringify(form, null, 2),
                    "application/json",
                  )
                }
              >
                <Download size={16} /> Lưu cấu hình
              </button>
              <button
                className="st-btn"
                disabled={!!busy || !isLive}
                onClick={() => void start()}
              >
                {busy ? (
                  <Loader2 size={17} className="st-spin" />
                ) : (
                  <Play size={17} />
                )}{" "}
                {busy ||
                  (isLive ? "Bắt đầu huấn luyện" : "Môi trường chạy chưa sẵn sàng")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
