import { useRef, useState } from "react";
import { CheckCircle2, Download, ImagePlus, Loader2, Play } from "lucide-react";
import { api } from "../api";

type ImageResult = {
  task: string;
  label?: string;
  confidence?: number;
  probabilities?: { label: string; score: number }[];
  mask_base64?: string;
  overlay_base64?: string;
  classes?: { id: number; label: string; color: string; coverage: number }[];
  width?: number;
  height?: number;
};

export async function prepareImage(file: File) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10_000_000)
    throw new Error("Chọn ảnh JPEG, PNG hoặc WebP tối đa 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 16_000_000 || Math.min(bitmap.width, bitmap.height) < 8)
      throw new Error("Ảnh cần ít nhất 8 × 8 px và tối đa 16 megapixel.");
    const ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(8, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(8, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let url = canvas.toDataURL("image/jpeg", 0.85);
    if (url.length > 900_000) url = canvas.toDataURL("image/jpeg", 0.6);
    if (url.length > 900_000) throw new Error("Ảnh quá lớn sau khi nén. Vui lòng chọn ảnh nhỏ hơn.");
    return { url, base64: url.split(",")[1], width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

export function ImageInference({ id, task, apiKey, inactive }: {
  id: string; task: string; apiKey: string; inactive: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [photo, setPhoto] = useState<Awaited<ReturnType<typeof prepareImage>> | null>(null);
  const [name, setName] = useState("");
  const [result, setResult] = useState<ImageResult | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [latency, setLatency] = useState(0);
  const [opacity, setOpacity] = useState(0.55);
  const [output, setOutput] = useState("visual");
  async function select(file: File) {
    if (pending.current) return;
    setBusy("Đang đọc ảnh…"); setError(""); setPhoto(null); setResult(null);
    try {
      setPhoto(await prepareImage(file)); setName(file.name);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function predict() {
    if (!photo || !apiKey.trim() || inactive || pending.current) return;
    pending.current = true; setBusy("Đang dự đoán…"); setError(""); setResult(null);
    const start = performance.now();
    try {
      setResult(await api<ImageResult>(`/predict/${id}`, { image_base64: photo.base64 }, "POST", apiKey.trim()));
      setLatency(Math.round(performance.now() - start));
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(""); }
  }
  return <>
    {error && <div className="st-alert error" role="alert">{error}</div>}
    <div className="st-playground-grid">
      <section className="st-panel">
        <div className="st-panel-head"><h3>Ảnh đầu vào</h3><span className="st-badge blue">{task === "segmentation" ? "Phân đoạn" : "Phân loại"}</span></div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="st-visually-hidden"
          aria-label="Chọn ảnh dự đoán" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void select(f); e.target.value = ""; }} />
        <button className="st-image-picker" disabled={!!busy} onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && !busy) void select(f); }}>
          {photo ? <img src={photo.url} alt="Ảnh sẽ gửi tới mô hình" /> : <><ImagePlus size={38} /><strong>Chọn hoặc thả ảnh vào đây</strong><span>JPEG, PNG, WebP · tối đa 10 MB</span></>}
        </button>
        {photo && <p className="st-muted">{name} · {photo.width} × {photo.height} px · bấm ảnh để đổi</p>}
        <p className="st-muted">Ảnh được nén trên thiết bị. Bấm Chạy dự đoán mới gửi tới API.</p>
        <button className="st-btn full" disabled={!!busy || !photo || !apiKey.trim() || inactive} onClick={() => void predict()}>
          {busy ? <Loader2 size={17} className="st-spin" /> : <Play size={17} />} {busy || "Chạy dự đoán"}
        </button>
      </section>
      <section className="st-panel">
        <div className="st-panel-head"><h3>Kết quả dự đoán</h3><div className="st-segmented small">
          <button className={output === "visual" ? "active" : ""} onClick={() => setOutput("visual")}>Trực quan</button>
          <button className={output === "json" ? "active" : ""} onClick={() => setOutput("json")}>JSON</button>
        </div></div>
        {!result ? <div className="st-prediction-empty"><ImagePlus size={34} /><h3>{busy === "Đang dự đoán…" ? busy : "Mô hình đang chờ ảnh của bạn."}</h3><p>{task === "segmentation" ? "Xem từng vùng dự đoán chồng lên ảnh gốc." : "Xem nhãn dự đoán và xác suất của từng lớp."}</p></div> : <>
          <div className="st-result-status"><span><CheckCircle2 size={15} /> Đã nhận kết quả</span><span>{latency} ms</span></div>
          {output === "json" ? <pre className="st-code st-image-json">{JSON.stringify(result, null, 2)}</pre> : result.overlay_base64 ? <>
            <div className="st-mask-preview">
              <img src={photo!.url} alt="Ảnh đầu vào" />
              <img className="st-mask-layer" style={{ opacity }} src={`data:image/png;base64,${result.overlay_base64}`} alt="Các vùng mô hình dự đoán" />
            </div>
            <label className="st-overlay-control">Độ đậm mặt nạ · {Math.round(opacity * 100)}%<input type="range" min="0" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(+e.target.value)} /></label>
            <div className="st-class-scores">{result.classes?.map((c) => <div key={c.id}>
              <span><i style={{ background: c.color }} />{c.label}</span><strong>{(c.coverage * 100).toFixed(1)}% diện tích</strong>
            </div>)}</div>
            <a className="st-btn secondary" href={`data:image/png;base64,${result.mask_base64}`} download="prediction-mask.png"><Download size={16} /> Tải mặt nạ mã lớp</a>
          </> : <>
            <div className="st-image-label"><small>Nhãn dự đoán</small><strong>{result.label}</strong><span>{((result.confidence || 0) * 100).toFixed(1)}% xác suất</span></div>
            <div className="st-class-scores">{result.probabilities?.map((p) => <div key={p.label}>
              <span>{p.label}</span><strong>{(p.score * 100).toFixed(1)}%</strong><meter min="0" max="1" value={p.score} />
            </div>)}</div>
          </>}
        </>}
      </section>
    </div>
  </>;
}
