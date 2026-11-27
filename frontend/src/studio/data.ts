import { scanCsv } from "./csvStream.ts";
import type { TaskSpec } from "./catalog";
export type DataSummary = {
  name: string;
  count: number;
  classes: number;
  columns: string[];
  files: string[];
  size: number;
  sample: boolean;
  preview: string[][];
};
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const finish = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === ",") {
      finish();
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      finish();
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      continue;
    }
    if (closed) throw new Error("Có ký tự thừa sau dấu nháy đóng trong CSV.");
    if (c === '"') {
      if (cell) throw new Error("Dấu nháy CSV không hợp lệ.");
      quoted = true;
    } else cell += c;
  }
  if (quoted) throw new Error("CSV có chuỗi chưa đóng dấu nháy.");
  finish();
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
export async function inspectFile(
  file: File,
  task: TaskSpec,
): Promise<DataSummary> {
  const isZip = task.accept === ".zip";
  if (!file.name.toLowerCase().endsWith(task.accept))
    throw new Error(
      `Bài toán này cần tệp ${task.accept.toUpperCase()}. ${task.format}.`,
    );
  if (file.size > 200_000_000)
    throw new Error("Dung lượng tối đa 200 MB.");
  if (!file.size) throw new Error("Tệp đang trống.");
  if (!isZip) {
    let columns: string[] = [], count = 0, lastTime = -Infinity, interval: number | undefined;
    const preview: string[][] = [];
    await scanCsv(file, row => {
      if (!columns.length) {
        columns = row.map(c => c.trim());
        if (columns.length < 2 || new Set(columns).size !== columns.length || columns.some(c => !c))
          throw new Error("CSV cần ít nhất 2 cột với tên cột không trùng.");
        const required = task.id === "text-classification" ? ["text", "label"] : task.id === "forecasting" ? ["timestamp", "target"] : [];
        if (required.length && (columns.length !== 2 || required.some(c => !columns.includes(c)))) throw new Error(`CSV phải có các cột: ${required.join(", ")}.`);
        return;
      }
      if (row.length !== columns.length) throw new Error("Số ô trong các dòng CSV không khớp tên cột.");
      if (task.id === "forecasting") {
        const time = Date.parse(row[columns.indexOf("timestamp")]);
        const value = row[columns.indexOf("target")];
        if (!Number.isFinite(time) || time <= lastTime || !value.trim() || !Number.isFinite(Number(value)))
          throw new Error("Cột timestamp phải tăng dần; target phải là số.");
        if (lastTime !== -Infinity) {
          if (interval !== undefined && time-lastTime !== interval) throw new Error("Khoảng thời gian giữa các quan sát phải đều nhau.");
          interval = time-lastTime;
        }
        lastTime = time;
      }
      if (task.id === "text-classification" && (!row[columns.indexOf("text")].trim() || row[columns.indexOf("text")].length > 5000)) throw new Error("Văn bản phải có từ 1 đến 5.000 ký tự mỗi dòng.");
      if (++count > 100000) throw new Error("CSV tối đa 100.000 dòng.");
      if (preview.length < 5) preview.push(row.map(c => c.slice(0, 64)));
    });
    if (["anomaly-detection", "clustering", "text-classification", "forecasting"].includes(task.id) && (count < 30 || count > 20000)) throw new Error("Bài toán này cần 30–20.000 dòng dữ liệu.");
    if (count < 2) throw new Error("CSV cần ít nhất 2 dòng dữ liệu.");
    return { name: file.name, count, classes: 0, columns, files: [], size: file.size, sample: false, preview };
  }
  const buffer = await file.arrayBuffer(),
    view = new DataView(buffer);
  let end = -1;
  for (
    let i = buffer.byteLength - 22;
    i >= Math.max(0, buffer.byteLength - 65557);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0)
    throw new Error(
      "Không đọc được ZIP. Hãy dùng ZIP tiêu chuẩn, không mã hóa.",
    );
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (entries > 5000) throw new Error("Hỗ trợ ZIP tối đa 5.000 mục.");
  const files: string[] = [];
  for (let i = 0; i < entries; i++) {
    if (
      offset + 46 > view.byteLength ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new Error("Danh mục trung tâm của tệp ZIP không hợp lệ.");
    if (view.getUint16(offset + 8, true) & 1)
      throw new Error("ZIP mã hóa không được hỗ trợ.");
    const nameLength = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true);
    if (offset + 46 + nameLength + extra + comment > view.byteLength)
      throw new Error("ZIP bị thiếu dữ liệu.");
    const name = new TextDecoder().decode(
      new Uint8Array(buffer, offset + 46, nameLength),
    );
    if (name.includes("..") || name.startsWith("/") || name.includes("\\"))
      throw new Error("ZIP chứa đường dẫn không an toàn.");
    if (!name.endsWith("/") && !name.startsWith("__MACOSX/")) files.push(name);
    offset += 46 + nameLength + extra + comment;
  }
  const images = files.filter(
    (f) => /\.(png|jpe?g|webp)$/i.test(f) && !/(^|\/)masks\//.test(f),
  );
  if (images.length < 2)
    throw new Error("ZIP cần ít nhất 2 hình ảnh JPG, PNG hoặc WebP.");
  if (
    task.id === "image-classification" &&
    !images.every((f) => /(^|\/)(train|val)\/[^/]+\/[^/]+$/.test(f))
  )
    throw new Error(
      "Cấu trúc yêu cầu train/<class>/image.jpg và val/<class>/image.jpg.",
    );
  if (
    task.id === "segmentation" &&
    (!files.some((f) => /(^|\/)masks\/.*\.png$/i.test(f)) ||
      !files.some((f) => f.endsWith("classes.json")))
  )
    throw new Error(
      "Phân đoạn ngữ nghĩa cần images/, masks/ với mặt nạ PNG và classes.json.",
    );
  if (
    task.id === "object-detection" &&
    (!files.some((f) => f.endsWith("data.yaml")) ||
      !files.some((f) => /(^|\/)labels\/.*\.txt$/i.test(f)))
  )
    throw new Error(
      "Phát hiện đối tượng cần data.yaml và labels/*.txt theo định dạng YOLO.",
    );
  if (
    task.id === "instance-segmentation" &&
    !files.some((f) => /(^|\/)annotations\/.*\.json$/i.test(f))
  )
    throw new Error(
      "Phân đoạn từng đối tượng cần annotations/*.json theo định dạng COCO.",
    );
  const hasSplit = (split: string) =>
    images.some((f) => new RegExp("(^|/)" + split + "/").test(f));
  if (!hasSplit("train") || !hasSplit("val"))
    throw new Error("Bộ dữ liệu cần cả train/ và val/.");
  if (task.id === "image-classification") {
    const trainClasses = new Set(
      images
        .filter((f) => /(^|\/)train\//.test(f))
        .map((f) => f.split("/").at(-2)),
    );
    if (trainClasses.size < 2)
      throw new Error("Phân loại hình ảnh cần ít nhất 2 lớp trong train/.");
    if (
      images
        .filter((f) => /(^|\/)val\//.test(f))
        .some((f) => !trainClasses.has(f.split("/").at(-2)))
    )
      throw new Error("Nhãn trong val/ phải tồn tại trong train/.");
  }
  if (
    task.id === "segmentation" &&
    images.some(
      (f) =>
        !/(^|\/)images\//.test(f) ||
        !files.includes(
          f
            .replace(/(^|\/)images\//, "$1masks/")
            .replace(/\.(png|jpe?g|webp)$/i, ".png"),
        ),
    )
  )
    throw new Error(
      "Mỗi ảnh trong images/ cần mặt nạ PNG cùng tên trong masks/.",
    );
  if (
    task.id === "object-detection" &&
    images.some(
      (f) =>
        !/(^|\/)images\//.test(f) ||
        !files.includes(
          f
            .replace(/(^|\/)images\//, "$1labels/")
            .replace(/\.(png|jpe?g|webp)$/i, ".txt"),
        ),
    )
  )
    throw new Error(
      "Mỗi ảnh trong images/ cần tệp nhãn TXT cùng tên trong labels/.",
    );
  return {
    name: file.name,
    count: images.length,
    classes:
      task.id === "image-classification"
        ? new Set(images.map((f) => f.split("/").at(-2))).size
        : 0,
    columns: [],
    files: files.slice(0, 8),
    size: file.size,
    sample: false,
    preview: [],
  };
}
export function downloadText(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
