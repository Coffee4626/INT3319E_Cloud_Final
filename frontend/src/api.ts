export type Config = {
  apiUrl: string;
  local: boolean;
  region: string;
  clientId?: string;
  cognitoDomain?: string;
  inferenceMode?: "lambda" | "ec2";
};
declare global {
  interface Window {
    STRATUS_CONFIG?: Config;
  }
}
export const config: Config = window.STRATUS_CONFIG || {
  apiUrl: "/api",
  local: ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname),
  region: "us-east-1",
};
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
type Tokens = { id_token: string; refresh_token: string; expires_at: number };
function tokens(): Tokens | null {
  try {
    const value = JSON.parse(sessionStorage.getItem("stratus.tokens") || "null");
    return value && typeof value.id_token === "string" && value.id_token.split(".").length === 3
      && typeof value.refresh_token === "string" && value.refresh_token.length > 0
      && Number.isFinite(value.expires_at) ? value : null;
  } catch {
    return null;
  }
}
export function signedIn() {
  return config.local || !!tokens();
}
function clearSession() {
  sessionStorage.removeItem("stratus.tokens");
  window.dispatchEvent(new Event("stratus:session-expired"));
}
export async function verifySession() {
  if (config.local) return true;
  if (!signedIn()) return false;
  try {
    // The API authorizer verifies the token; browser storage alone grants no access.
    await api("/health");
    return true;
  } catch {
    clearSession();
    throw new Error("Không thể xác minh phiên đăng nhập. Vui lòng đăng nhập lại.");
  }
}
export async function signIn() {
  if (config.local) {
    location.href = "/app";
    return;
  }
  if (!config.clientId || !config.cognitoDomain)
    throw new Error("Chưa cấu hình Cognito. Kiểm tra cài đặt AWS.");
  sessionStorage.setItem("stratus.returnTo",
    location.pathname === "/app" || location.pathname.startsWith("/app/")
      ? location.pathname + location.search : "/app");
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  sessionStorage.setItem("stratus.pkce", JSON.stringify({ verifier, state }));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: location.origin + "/auth/callback",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  location.href = `${config.cognitoDomain}/oauth2/authorize?${params}`;
}
export async function completeSignIn() {
  const params = new URLSearchParams(location.search);
  const saved = JSON.parse(sessionStorage.getItem("stratus.pkce") || "null");
  if (params.get("error"))
    throw new Error(params.get("error_description") || "Đăng nhập thất bại");
  if (!saved || saved.state !== params.get("state") || !params.get("code"))
    throw new Error("Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.");
  const response = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId!,
      code: params.get("code")!,
      redirect_uri: location.origin + "/auth/callback",
      code_verifier: saved.verifier,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Không thể hoàn tất đăng nhập");
  sessionStorage.setItem(
    "stratus.tokens",
    JSON.stringify({
      ...data,
      expires_at: Date.now() + data.expires_in * 1000,
    }),
  );
  sessionStorage.removeItem("stratus.pkce");
  const returnTo = sessionStorage.getItem("stratus.returnTo") || "/app";
  sessionStorage.removeItem("stratus.returnTo");
  history.replaceState({}, "", /^\/app(?:\/|\?|$)/.test(returnTo) ? returnTo : "/app");
}
let refresh: Promise<string> | null = null;
async function bearer(): Promise<string> {
  const stored = tokens();
  if (!stored) throw new Error("Bạn cần đăng nhập để tiếp tục.");
  if (stored.expires_at > Date.now() + 60_000) return stored.id_token;
  if (!refresh)
    refresh = (async () => {
      const result = await fetch(`${config.cognitoDomain}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: config.clientId!,
          refresh_token: stored.refresh_token,
        }),
      });
      const data = await result.json();
      if (!result.ok) {
        clearSession();
        throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      }
      sessionStorage.setItem(
        "stratus.tokens",
        JSON.stringify({
          ...stored,
          ...data,
          expires_at: Date.now() + data.expires_in * 1000,
        }),
      );
      return data.id_token as string;
    })().finally(() => {
      refresh = null;
    });
  return refresh;
}
export function signOut() {
  sessionStorage.removeItem("stratus.tokens");
  if (config.local) location.href = "/";
  else
    location.href = `${config.cognitoDomain}/logout?${new URLSearchParams({ client_id: config.clientId!, logout_uri: location.origin })}`;
}
export async function api<T>(
  path: string,
  payload?: unknown,
  method?: string,
  deploymentKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (deploymentKey !== undefined) headers["X-Api-Key"] = deploymentKey;
  else if (!config.local) headers.Authorization = await bearer();
  let result: Response;
  try {
    result = await fetch(config.apiUrl.replace(/\/$/, "") + path, {
      method: method || (payload === undefined ? "GET" : "POST"),
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(35_000),
    });
  } catch {
    throw new Error(
      "Không thể kết nối API hoặc yêu cầu đã hết thời gian. Kiểm tra kết nối rồi thử lại.",
    );
  }
  let data;
  try {
    data = await result.json();
  } catch {
    throw new Error(
      `API không trả về JSON hợp lệ (HTTP ${result.status}). Kiểm tra kết nối dịch vụ API.`,
    );
  }
  if (!result.ok) {
    if (result.status === 401 && deploymentKey === undefined && !config.local) clearSession();
    throw new Error(
      data.error || data.message || `Yêu cầu thất bại (${result.status})`,
    );
  }
  return data;
}
export type Column = {
  name: string;
  type: string;
  missing: number;
  unique: number;
  unique_lower_bound?: boolean;
  examples: string[];
};
export type Profile = {
  format?: string;
  task?: string;
  classes?: string[];
  splits?: { train: number; val: number };
  rows: number;
  columns: Column[];
  missing_cells: number;
  duplicates: number;
  size_bytes: number;
  preview: Record<string, string>[];
};
export type Dataset = {
  task?: string;
  id: string;
  dataset_id: string;
  name: string;
  status: string;
  profile?: Profile;
  prepared: boolean;
  error?: string;
  target?: string;
  created_at: number;
  report?: Record<string, number | string[]>;
};
export type Metrics = {
  forecast_evaluation?: {timestamp: string; actual: number; predicted: number}[];
  learning_curve_metric?: string;
  learning_curves?: Record<string, {epoch: number; train: number; validation: number}[]>;
  leaderboard?: {
    model: string;
    score_val: number;
    fit_time: number;
    pred_time_val: number;
  }[];
  best_model?: string;
  eval_metric?: string;
  features?: string[];
  artifact_bytes?: number;
  training_rows?: number;
  total_rows?: number;
  evaluation?: {
    method: string;
    seed: number;
    test_rows: number;
    validation_rows?: number;
    reason?: string;
    scores?: Record<string, number>;
    confusion_matrix?: { labels: string[]; values: number[][] } | null;
  };
  problem_type?: string;
  epochs_completed?: number;
  stop_reason?: string;
};
export type Job = {
  id: string;
  name: string;
  status: string;
  task: string;
  target: string;
  time_limit: number;
  dataset_id?: string;
  created_at: number;
  started_at?: number;
  finished_at?: number;
  metrics?: Metrics;
  error?: string;
  image_uri: string;
};
export type Deployment = {
  last_used_at?: number;
  revoke_reason?: string;
  id: string;
  deployment_id: string;
  name: string;
  status: string;
  task: string;
  target: string;
  dataset_id?: string;
  created_at: number;
  job_id: string;
  key_prefix: string;
  image_uri: string;
};
export type DeployResult = {
  deployment_id: string;
  predict_path: string;
  api_key: string;
  image_uri: string;
};
export type Page<T> = { items: T[]; cursor: string | null };
export async function upload(file: File, task = "tabular"): Promise<Dataset> {
  const vision = task === "image-classification" || task === "segmentation";
  if (file.size > 200_000_000) throw new Error(vision ? "Dung lượng ZIP tối đa 200 MB." : "Dung lượng CSV tối đa 200 MB.");
  if (!file.name.toLowerCase().endsWith(vision ? ".zip" : ".csv"))
    throw new Error(vision ? "Vui lòng chọn file .zip" : "Vui lòng chọn file .csv");
  const ticket = await api<{
    dataset_id: string;
    upload: { url: string; fields: Record<string, string> };
  }>("/uploads", { name: file.name, task });
  const form = new FormData();
  Object.entries(ticket.upload.fields).forEach(([key, value]) =>
    form.append(key, value),
  );
  form.append("file", file);
  const result = await fetch(ticket.upload.url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(600_000),
  });
  if (!result.ok)
    throw new Error("Tải lên S3 thất bại. Kiểm tra CORS và kích thước tệp.");
  return waitForDataset(await api<Dataset>(`/datasets/${ticket.dataset_id}/complete`, {}));
}
export function sampleFile() {
  const header = "age,monthly_spend,tenure_months,support_tickets,plan,churn";
  const rows = Array.from({ length: 240 }, (_, i) => {
    const tenure = 1 + ((i * 7) % 60),
      tickets = (i * 13) % 7,
      spend = 19 + ((i * 17) % 180);
    return [
      20 + (i % 45),
      spend,
      tenure,
      tickets,
      i % 3 === 0 ? "premium" : "standard",
      tickets >= 4 && tenure < 35 ? "yes" : "no",
    ].join(",");
  });
  return new File([[header, ...rows].join("\n")], "customer-churn.csv", {
    type: "text/csv",
  });
}

export async function waitForDataset(initial: Dataset): Promise<Dataset> {
  let dataset = initial;
  const deadline = Date.now() + 1_260_000;
  while (dataset.status === "PROCESSING") {
    if (Date.now() > deadline) throw new Error("Xử lý dữ liệu quá thời gian. Vui lòng kiểm tra Bộ dữ liệu.");
    await new Promise(resolve => setTimeout(resolve, 3000));
    dataset = await api<Dataset>(`/datasets/${dataset.dataset_id}`);
  }
  if (dataset.status !== "READY") throw new Error(dataset.error || "Không xử lý được bộ dữ liệu.");
  return dataset;
}
