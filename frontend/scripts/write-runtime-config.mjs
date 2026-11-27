import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fields = {
  STRATUS_API_URL: "apiUrl",
  STRATUS_AWS_REGION: "region",
  STRATUS_COGNITO_CLIENT_ID: "clientId",
  STRATUS_COGNITO_DOMAIN: "cognitoDomain",
};

export function buildRuntimeConfig(env) {
  const names = Object.keys(fields);
  if (!names.some((name) => env[name]?.trim())) return null;
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Thiếu cấu hình AWS: ${missing.join(", ")}`);
  }
  const config = Object.fromEntries(
    Object.entries(fields).map(([name, key]) => [key, env[name].trim()]),
  );
  for (const field of ["apiUrl", "cognitoDomain"]) {
    const url = new URL(config[field]);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error(`${field} phải là URL HTTPS, không chứa thông tin đăng nhập, tham số hoặc fragment.`);
    }
    if (field === "cognitoDomain" && url.pathname !== "/") {
      throw new Error("cognitoDomain chỉ chứa origin, không có đường dẫn /login hoặc /oauth2.");
    }
    config[field] = url.href.replace(/\/$/, "");
  }
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(config.region)) {
    throw new Error("STRATUS_AWS_REGION không hợp lệ.");
  }
  if (!/^[a-z0-9]+$/i.test(config.clientId)) {
    throw new Error("STRATUS_COGNITO_CLIENT_ID không hợp lệ.");
  }
  return { ...config, local: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = buildRuntimeConfig(process.env);
  if (config) {
    writeFileSync(new URL("../dist/config.js", import.meta.url),
      `window.STRATUS_CONFIG = ${JSON.stringify(config)};\n`);
    console.log("Đã tạo cấu hình kết nối AWS cho frontend.");
  } else {
    console.log("Dùng cấu hình public/config.js: localhost kết nối local, domain triển khai kết nối AWS.");
  }
}
