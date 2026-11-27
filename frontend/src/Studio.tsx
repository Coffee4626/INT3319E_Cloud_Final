import { useEffect, useState } from "react";
import {
  Cloud,
  Code2,
  GitBranch,
  LayoutDashboard,
  Layers3,
  LogIn,
  LogOut,
  Menu,
  Network,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
  Zap,
  FlaskConical,
  Boxes,
  Database,
  ChevronRight,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { config, signedIn, signIn, signOut } from "./api";
import { LiveDatasets } from "./App";
import { Architecture, DataEvolution, TaskArt } from "./studio/Visuals";
import { TaskCatalog, Wizard } from "./studio/Wizard";
import {
  WorkspaceStats,
  Experiments,
  Registry,
  Experiment,
  EndpointList,
  Inference,
  EmptyState,
} from "./studio/Production";
import { TASKS, taskById, type TaskId } from "./studio/catalog";
import "./studio.css";
import "./light.css";
function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button className="st-brand" onClick={onClick}>
      <span>
        <Layers3 size={23} />
      </span>
      stratus<span className="st-brand-label">STUDIO</span>
    </button>
  );
}
export default function Studio({ authError }: { authError: string }) {
  const [path, setPath] = useState(location.pathname + location.search),
    [menu, setMenu] = useState(false),
    [authenticated, setAuthenticated] = useState(signedIn),
    [notice, setNotice] = useState(authError),
    [keys, setKeys] = useState<Record<string, string>>({});
  useEffect(() => {
    const changed = () => {
      setPath(location.pathname + location.search);
      setMenu(false);
    };
    window.addEventListener("popstate", changed);
    const expired = () => {
      setAuthenticated(false);
      setKeys({});
      setNotice("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    };
    window.addEventListener("stratus:session-expired", expired);
    return () => {
      window.removeEventListener("popstate", changed);
      window.removeEventListener("stratus:session-expired", expired);
    };
  }, []);
  const go = (next: string) => {
    history.pushState({}, "", next);
    setPath(next);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const keepKey = (id: string, key: string) =>
    setKeys((k) => ({ ...k, [id]: key }));
  const url = new URL(path, location.origin),
    route = url.pathname,
    taskQuery = url.searchParams.get("task");
  const currentTask = taskQuery ? taskById(taskQuery).id : undefined;
  const jobRoute = route.match(/^\/app\/(?:experiments|jobs)\/([^/]+)$/),
    inferenceRoute = route.match(/^\/app\/inference\/([^/]+)$/);
  const nav = [
    { path: "/app", name: "Tổng quan", icon: LayoutDashboard },
    { path: "/app/new", name: "Tạo thí nghiệm", icon: Plus },
    { path: "/app/experiments", name: "Thí nghiệm", icon: FlaskConical },
    { path: "/app/models", name: "Kho mô hình", icon: Boxes },
    { path: "/app/datasets", name: "Bộ dữ liệu", icon: Database },
    { path: "/app/endpoints", name: "Dự đoán", icon: Zap },
    { path: "/app/infrastructure", name: "Hạ tầng", icon: Network },
  ];
  const selected = route.startsWith("/app/jobs")
    ? "/app/experiments"
    : route.startsWith("/app/inference")
      ? "/app/endpoints"
      : nav.find((n) => n.path !== "/app" && route.startsWith(n.path))?.path ||
        "/app";
  const login = () => void signIn().catch((e) => setNotice(e.message));
  if (route === "/")
    return (
      <div className="st-root">
        <Landing go={go} />
      </div>
    );
  if (!authenticated)
    return (
      <div className="st-root st-auth">
        <header><Brand onClick={() => go("/")} /></header>
        <main className="st-auth-card">
          <span className="st-auth-icon"><ShieldCheck size={30} /></span>
          <span className="st-eyebrow">KHÔNG GIAN RIÊNG TƯ</span>
          <h1>Đăng nhập vào Stratus</h1>
          <p>Chỉ tài khoản được quản trị viên mời mới có thể truy cập dữ liệu, huấn luyện và triển khai mô hình.</p>
          {notice && <div className="st-alert error" role="alert">{notice}</div>}
          <button className="st-btn" onClick={login}><LogIn size={18} /> Đăng nhập bằng email được mời</button>
          <p className="st-auth-help">Lần đầu đăng nhập? Dùng mật khẩu tạm trong email mời, sau đó đặt mật khẩu mới của bạn.</p>
          <button className="st-btn ghost" onClick={() => go("/")}>Về trang chủ</button>
        </main>
      </div>
    );
  return (
    <div className="st-root st-shell">
      <a className="st-skip" href="#studio-content">
        Đến nội dung chính
      </a>
      {menu && (
        <button
          className="st-menu-backdrop"
          aria-label="Đóng menu"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`st-sidebar ${menu ? "open" : ""}`}>
        <Brand onClick={() => go("/")} />
        <div className="st-workspace">
          <span>CF</span>
          <div>
            <strong>Cloud Computing Finals</strong>
            <small>Không gian cá nhân</small>
          </div>
        </div>
        <div className="st-nav-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.path}
              className={selected === n.path ? "active" : ""}
              onClick={() => go(n.path)}
            >
              <n.icon size={18} />
              {n.name}
            </button>
          ))}
        </nav>
        <div className="st-sidebar-bottom">
          <div className="st-sidebar-note">
            <Cloud size={20} />
            <strong>Xây dựng trên AWS.</strong>
            <p>S3 → SQS → EC2 → dự đoán. Hiểu hạ tầng sau mỗi bước.</p>
            <button onClick={() => go("/app/infrastructure")}>
              Khám phá kiến trúc
            </button>
          </div>
          <button
            className="st-profile"
            onClick={
              config.local
                ? () => go("/app/infrastructure")
                : signedIn()
                  ? signOut
                  : login
            }
          >
            <span>CF</span>
            <div>
              <strong>Không gian dự án</strong>
              <small>Cloud Computing Finals</small>
            </div>
            {config.local ? (
              <Settings2 size={17} />
            ) : signedIn() ? (
              <LogOut size={17} />
            ) : (
              <LogIn size={17} />
            )}
          </button>
        </div>
      </aside>
      <div className="st-main">
        <header className="st-topbar">
          <div>
            <button
              className="st-icon-btn st-mobile-menu"
              aria-label="Mở menu"
              onClick={() => setMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span>Không gian làm việc</span>
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n.path === selected)?.name}</strong>
          </div>
          <div>
            <button
              className="st-btn secondary small"
              onClick={() => go("/app/new")}
            >
              <Plus size={15} /> Tạo thí nghiệm
            </button>
          </div>
        </header>
        <main id="studio-content" className="st-content">
          {notice && (
            <div className="st-alert error" role="alert">
              {notice}
              <button aria-label="Đóng thông báo" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {route === "/app" && <Overview go={go} />}
          {route === "/app/new" && (
            <Wizard
              key={path}
              initialTask={currentTask}
              existingDataset={url.searchParams.get("dataset") || undefined}
              onLive={(id) => go("/app/experiments/" + id)}
              go={go}
            />
          )}
          {signedIn() ? (
            <>
              {(route === "/app/experiments" || route === "/app/jobs") && (
                <Experiments go={go} />
              )}
              {jobRoute && (
                <Experiment
                  key={path}
                  id={jobRoute[1]}
                  initialModel={url.searchParams.get("model") || undefined}
                  go={go}
                  keepKey={keepKey}
                />
              )}
              {route === "/app/models" && <Registry go={go} />}
              {route === "/app/datasets" && (
                <div className="legacy-pane">
                  <LiveDatasets go={go} />
                </div>
              )}
              {route === "/app/endpoints" && <EndpointList go={go} />}
              {inferenceRoute && (
                <Inference
                  key={path}
                  id={inferenceRoute[1]}
                  initialKey={keys[inferenceRoute[1]] || ""}
                  go={go}
                  keepKey={keepKey}
                />
              )}
            </>
          ) : (
            route !== "/app" &&
            route !== "/app/new" &&
            route !== "/app/infrastructure" && (
              <EmptyState
                title="Đăng nhập vào không gian làm việc."
                description="Truy cập bộ dữ liệu, thí nghiệm và API dự đoán của bạn."
                action="Đăng nhập"
                onClick={login}
              />
            )
          )}
          {(route === "/app/infrastructure" || route === "/app/settings") && (
            <Infrastructure />
          )}
          {![
            "/app",
            "/app/new",
            "/app/experiments",
            "/app/jobs",
            "/app/models",
            "/app/datasets",
            "/app/endpoints",
            "/app/infrastructure",
            "/app/settings",
          ].includes(route) &&
            !jobRoute &&
            !inferenceRoute && (
              <EmptyState
                title="Không tìm thấy trang."
                description="Quay về không gian làm việc để tiếp tục."
                action="Về tổng quan"
                onClick={() => go("/app")}
              />
            )}
        </main>
        <footer className="st-footer">
          <span>Stratus Studio · Cloud Computing Finals</span>
          <span>Dữ liệu. Huấn luyện. Triển khai.</span>
        </footer>
      </div>
    </div>
  );
}
function Landing({ go }: { go: (p: string) => void }) {
  return (
    <div className="st-landing">
      <header>
        <Brand onClick={() => go("/")} />
        <nav>
          <a href="#tasks">Khám phá bài toán</a>
          <a href="#architecture">Kiến trúc</a>
          <button className="st-btn secondary" onClick={() => go("/app")}>
            {signedIn() ? "Mở Studio" : "Đăng nhập"}
          </button>
        </nav>
      </header>
      <section className="st-landing-hero">
        <div>
          <span className="st-eyebrow">MÔ HÌNH TIẾP THEO BẮT ĐẦU TẠI ĐÂY</span>
          <h1>
            Từ ý tưởng
            <br />
            đến <em>dự đoán.</em>
          </h1>
          <p>
            Chọn một bài toán. Mang dữ liệu của bạn.
            <br />
            Khám phá hành trình xây dựng, huấn luyện và triển khai mô hình trên
            một không gian làm việc.
          </p>
          <div className="st-actions">
            <button className="st-btn" onClick={() => go("/app/new")}>
              Bắt đầu thí nghiệm
            </button>
            <a className="st-btn ghost" href="#architecture">
              Khám phá kiến trúc
            </a>
          </div>
          <div className="st-hero-meta">
            <span>
              <Layers3 size={16} /> {TASKS.length} bài toán học máy
            </span>
            <span>
              <Cloud size={16} /> Kiến trúc AWS
            </span>
          </div>
        </div>
        <div className="st-hero-visual">
          <div className="st-hero-visual-head">
            <span>
              <Layers3 size={16} /> Thị giác máy tính
            </span>
            <span className="st-badge blue">Xem trước</span>
          </div>
          <TaskArt id="object-detection" />
          <div className="st-hero-result">
            <span>Phát hiện đối tượng</span>
            <strong>Hiểu những gì trong ảnh.</strong>
            <div>
              <span>3 phương tiện</span>
              <span>Khung giới hạn</span>
              <span>Độ tin cậy</span>
            </div>
          </div>
          <div className="st-floating-metric">
            <Activity size={21} />
            <div>
              <span>Phát hiện đối tượng</span>
              <strong>
                3<small> đối tượng</small>
              </strong>
            </div>
            <svg viewBox="0 0 110 45">
              <path
                d="M3 40L15 32L27 35L40 20L52 24L65 14L77 19L90 6L107 3"
                fill="none"
                stroke="#679dff"
                strokeWidth="2"
              />
            </svg>
          </div>
        </div>
      </section>
      <div className="st-stack-strip">
        <span>MỘT QUY TRÌNH KẾT NỐI</span>
        {[
          "Amazon S3",
          "DynamoDB",
          "Amazon SQS",
          "EC2 Auto Scaling",
          "Amazon ECR",
          "AWS Lambda",
        ].map((t) => (
          <strong key={t}>{t}</strong>
        ))}
      </div>
      <section id="tasks" className="st-landing-section">
        <div className="st-section-heading">
          <div>
            <div className="st-eyebrow">BẮT ĐẦU TỪ BÀI TOÁN CỦA BẠN</div>
            <h2>Bạn muốn xây dựng điều gì?</h2>
            <p>
              Từ một nhãn cho cả ảnh đến hiểu từng điểm ảnh. Chọn bài toán để khám
              phá.
            </p>
          </div>
        </div>
        <TaskCatalog onSelect={(id) => go("/app/new?task=" + id)} />
      </section>
      <section
        id="architecture"
        className="st-landing-section st-landing-architecture"
      >
        <div>
          <span className="st-eyebrow">NHÌN RÕ TỪNG BƯỚC</span>
          <h2>
            Không chỉ mô hình.
            <br />
            Cả hành trình phía sau.
          </h2>
          <p>
            Thấy dữ liệu đi qua từng dịch vụ, máy xử lý thay đổi theo hàng đợi và
            mô hình trở thành API dự đoán. Khám phá cách dữ liệu, tài nguyên tính toán và mô hình
            kết nối trong cùng một quy trình.
          </p>
          <button
            className="st-btn secondary"
            onClick={() => go("/app/infrastructure")}
          >
            Khám phá hạ tầng
          </button>
        </div>
        <Architecture taskId="segmentation" stage={3} live />
      </section>
      <section className="st-landing-cta">
        <Sparkles size={26} />
        <h2>Một ý tưởng. Một thí nghiệm mới.</h2>
        <p>
          Chọn bài toán phù hợp, chuẩn bị dữ liệu và quản lý toàn bộ vòng đời mô hình.
        </p>
        <button className="st-btn" onClick={() => go("/app/new")}>
          Tạo thí nghiệm đầu tiên
        </button>
      </section>
      <footer>
        <Brand onClick={() => go("/")} />
        <span>Cloud Computing Finals · Không gian khám phá</span>
        <span>
          Ảnh minh họa:{" "}
          <a
            href="https://unsplash.com/photos/adult-golden-retriever-sitting-on-green-grass-YI_iWr_12kE"
            target="_blank"
            rel="noreferrer"
          >
            Unsplash / ảnh chó
          </a>{" "}
          ·{" "}
          <a
            href="https://unsplash.com/photos/assorted-cars-on-road-Tv09pxsusIM"
            target="_blank"
            rel="noreferrer"
          >
            ảnh đường phố
          </a>
        </span>
      </footer>
    </div>
  );
}
function Overview({ go }: { go: (p: string) => void }) {
  return (
    <>
      <div className="st-overview-hero">
        <div>
          <div className="st-eyebrow">KHÔNG GIAN HỌC MÁY CỦA BẠN</div>
          <h1>
            Để dữ liệu của bạn
            <br />
            <em>tạo nên những điều khác biệt.</em>
          </h1>
          <p>
            Từ chọn bài toán đến dự đoán — xây dựng mô hình và nhìn rõ từng bước của
            hạ tầng.
          </p>
          <button className="st-btn" onClick={() => go("/app/new")}>
            <Plus size={17} /> Tạo thí nghiệm
          </button>
        </div>
        <div className="st-overview-art">
          <TaskArt id="segmentation" />
          <span>Từ điểm ảnh đến sự thấu hiểu.</span>
        </div>
      </div>
      {signedIn() && <WorkspaceStats />}
      <div className="st-section-heading">
        <div>
          <span className="st-eyebrow">KHÁM PHÁ NHỮNG KHẢ NĂNG</span>
          <h2>Bạn muốn giải quyết bài toán gì?</h2>
          <p>Chọn bài toán để xem mô hình, định dạng dữ liệu và bắt đầu huấn luyện.</p>
        </div>
      </div>
      <TaskCatalog onSelect={(id) => go("/app/new?task=" + id)} />
      <div className="st-bottom-callout">
        <Network size={27} />
        <div>
          <h3>Hiểu điều gì đang diễn ra trên AWS.</h3>
          <p>
            Xem S3, DynamoDB, SQS và EC2 Auto Scaling kết nối trong quy trình của
            từng bài toán.
          </p>
        </div>
        <button
          className="st-btn secondary"
          onClick={() => go("/app/infrastructure")}
        >
          Xem kiến trúc
        </button>
      </div>
    </>
  );
}
function Infrastructure() {
  const [taskId, setTask] = useState<TaskId>("image-classification"),
    [stage, setStage] = useState(0);
  const task = taskById(taskId);
  return (
    <>
      <div className="st-page-heading">
        <div>
          <div className="st-eyebrow">KHÁM PHÁ HẠ TẦNG</div>
          <h1>Thấy cả hệ thống phía sau mô hình.</h1>
          <p>
            Chuyển bài toán và giai đoạn để khám phá dữ liệu, tài nguyên tính toán và bản triển khai.
          </p>
        </div>
        <label>
          Kiến trúc cho bài toán
          <select
            value={taskId}
            onChange={(e) => setTask(e.target.value as TaskId)}
          >
            {TASKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="st-infra-stages">
        {[
          "Tải dữ liệu lên",
          "Tiền xử lý",
          "Đưa vào hàng đợi",
          "Huấn luyện",
          "Gói mô hình",
          "Dự đoán",
        ].map((s, i) => (
          <button
            className={stage === i ? "active" : ""}
            onClick={() => setStage(i)}
            key={s}
          >
            {s}
          </button>
        ))}
      </div>
      <Architecture taskId={task.id} stage={stage} live />
      <DataEvolution
        taskId={task.id}
        stage={stage < 2 ? stage : stage < 4 ? 1 : stage === 4 ? 2 : 3}
      />
      <div className="st-chart-grid">
        <div className="st-panel">
          <div className="st-panel-head">
            <h3>
              <Code2 size={18} /> Quy chuẩn dữ liệu
            </h3>
            <span className="st-badge blue">{task.name}</span>
          </div>
          <pre className="st-code">{task.structure}</pre>
          <p className="st-muted">
            {task.input} → {task.output}
          </p>
        </div>
        <div className="st-panel">
          <h3>
            <GitBranch size={18} /> Theo từng giai đoạn
          </h3>
          <dl className="st-definition">
            <div>
              <dt>Tải lên</dt>
              <dd>Tải lên S3 bằng địa chỉ ký sẵn; lưu thông tin dữ liệu trong DynamoDB.</dd>
            </div>
            <div>
              <dt>Chuẩn bị</dt>
              <dd>
                {task.group === "Thị giác máy tính"
                  ? "Kiểm tra ảnh / nhãn / mặt nạ, đổi kích thước và chuẩn hóa."
                  : task.id === "forecasting"
                    ? "Kiểm tra mốc thời gian, chia tập theo thời gian."
                    : "Kiểm tra lược đồ, giá trị thiếu và mục tiêu."}
              </dd>
            </div>
            <div>
              <dt>Tăng số máy</dt>
              <dd>Độ dài hàng đợi SQS → cảnh báo CloudWatch → EC2 Auto Scaling.</dd>
            </div>
            <div>
              <dt>Huấn luyện</dt>
              <dd>
                {task.models.map((m) => m.name).join(" / ")}. Máy xử lý đọc S3, ghi
                chỉ số và gói mô hình.
              </dd>
            </div>
            <div>
              <dt>Triển khai</dt>
              <dd>
                ECR cung cấp môi trường chạy, S3 lưu mô hình. API Gateway → Lambda chuyển tiếp → EC2 dự đoán trong mạng riêng.
              </dd>
            </div>
            <div>
              <dt>Giảm số máy</dt>
              <dd>Máy xử lý xong tác vụ, bỏ bảo vệ và thu về 0 khi nhàn rỗi.</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="st-panel">
        <div className="st-panel-head">
          <div>
            <h3>Trạng thái cấu hình AWS</h3>
            <p>
              ap-southeast-2 · Tài khoản 866160682379 · Ghi nhận ngày 27/11/2026 · Không tự làm mới từ AWS
            </p>
          </div>
          <span className="st-badge green">Backend đã triển khai</span>
        </div>
        <div className="st-service-grid">
          {[
            [
              "S3 + DynamoDB",
              "Đã tạo",
              "Bộ dữ liệu, gói mô hình, trạng thái tác vụ và bản triển khai.",
              "green",
            ],
            [
              "SQS + ECR",
              "Đã tạo",
              "Hàng đợi huấn luyện và kho ảnh container.",
              "green",
            ],
            [
              "EC2 Auto Scaling",
              "Co giãn theo SQS",
              "Từ 0 đến 1 máy m7i-flex.large, 2 vCPU và 8 GB RAM. Thu về 0 khi hàng đợi rỗng đủ 15 phút.",
              "green",
            ],
            [
              "EC2 dự đoán",
              "Máy riêng",
              "Một máy m7i-flex.large, 2 vCPU và 8 GB RAM, duy trì endpoint. Chỉ nhận yêu cầu từ Lambda trong VPC.",
              "green",
            ],
            [
              "Lambda",
              "Đã tạo",
              "Điều khiển, chuyển tiếp yêu cầu dự đoán và xử lý hàng đợi lỗi. Mỗi hàm dùng 512 MB RAM.",
              "green",
            ],
            [
              "Cloudflare",
              "Đã triển khai",
              "Frontend chạy trên int3319e-cloud-final.binhyb2.workers.dev và kết nối API AWS qua HTTPS.",
              "green",
            ],
            [
              "API + Cognito",
              "Đã bật",
              "API Gateway bảo vệ các thao tác quản lý bằng Cognito. Đăng nhập dùng mã ủy quyền và PKCE.",
              "green",
            ],
          ].map(([name, state, desc, color]) => (
            <div key={name}>
              <Cloud size={19} />
              <strong>{name}</strong>
              <span className={"st-badge " + color}>{state}</span>
              <p>{desc}</p>
            </div>
          ))}
        </div>
        <p className="st-muted">
          Tài nguyên huấn luyện dùng m7i-flex.large. Các tác vụ thị giác máy tính cần môi trường chạy GPU và
          hạn mức phù hợp trước khi bắt đầu huấn luyện.
        </p>
      </div>
    </>
  );
}
