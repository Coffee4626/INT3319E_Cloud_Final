import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, config } from "../api";

type Compute = {
  observed_at: number;
  workers: { total: number; in_service: number; starting: number; desired: number; maximum: number };
  queue: { waiting: number; processing: number };
};

export function ComputePanel({ jobStatus }: { jobStatus: string }) {
  const [data, setData] = useState<Compute | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (config.local) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<Compute>("/compute");
        if (active) { setData(next); setError(""); }
      } catch {
        if (active) setError("Không lấy được trạng thái mới. Dữ liệu dưới đây có thể đã cũ.");
      } finally {
        if (active) timer = setTimeout(poll, 10000);
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [refresh]);

  if (config.local) return <div className="st-panel">Môi trường local dùng worker Docker, không có nhóm EC2.</div>;
  const message = jobStatus === "QUEUED"
    ? !data ? "Đang lấy trạng thái máy…"
      : data.workers.total === 0 ? "Job đang chờ Auto Scaling bật máy. Lần chạy đầu có thể mất vài phút."
        : data.workers.starting > 0 ? "EC2 đang khởi động để nhận job."
          : "EC2 đã bật. Job đang chờ worker sẵn sàng hoặc hoàn tất tác vụ trước."
    : jobStatus === "TRAINING" ? "Worker đang huấn luyện mô hình của bạn."
      : jobStatus === "COMPLETED" ? "Huấn luyện đã xong. Máy sẽ tự tắt khi hàng đợi nhàn rỗi đủ 15 phút."
        : "Job đã dừng. Trạng thái bên dưới là của nhóm máy huấn luyện dùng chung.";
  return <section className="st-panel">
    <div className="st-panel-head">
      <div><h3>Máy huấn luyện & hàng đợi</h3><p>{message}</p></div>
      <button className="st-btn ghost small" onClick={() => setRefresh((n) => n + 1)} aria-label="Làm mới tài nguyên"><RefreshCw size={16} /> Làm mới</button>
    </div>
    {error && <div className="st-alert error" role="alert">{error}</div>}
    <div className="st-metric-grid st-compute-metrics">
      <div className="st-metric"><span>EC2 đang bật</span><strong>{data?.workers.in_service ?? "—"}</strong><small>{data ? `${data.workers.starting} máy đang khởi động` : "Đang đọc từ Auto Scaling…"}</small></div>
      <div className="st-metric"><span>Job đang chờ</span><strong>{data?.queue.waiting ?? "—"}</strong><small>Toàn bộ hàng đợi</small></div>
      <div className="st-metric"><span>Job đang xử lý</span><strong>{data?.queue.processing ?? "—"}</strong><small>Worker đã nhận từ SQS</small></div>
    </div>
    <p className="st-muted">{data ? `Đọc lúc ${new Date(data.observed_at * 1000).toLocaleTimeString("vi-VN")} · ` : ""}Tự cập nhật mỗi 10 giây. Số liệu hàng đợi có thể trễ khoảng một phút. Chỉ tính máy huấn luyện.</p>
  </section>;
}
