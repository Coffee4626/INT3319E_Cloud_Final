// Parse chunks without retaining the complete CSV or every row in browser memory.
export async function scanCsv(file: File, consume: (row: string[]) => void) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let state: "field" | "quoted" | "closed" = "field";
  let cell = "", row: string[] = [], skipLF = false, first = true;
  const finishCell = () => {
    row.push(cell); cell = ""; state = "field";
    if (row.length > 200) throw new Error("CSV tối đa 200 cột.");
  };
  const finishRow = () => {
    finishCell();
    if (row.some(v => v.trim())) consume(row);
    row = [];
  };
  const chunk = (text: string) => {
    if (first && text.length) { first = false; text = text.replace(/^\uFEFF/, ""); }
    for (const c of text) {
      if (skipLF) { skipLF = false; if (c === "\n") continue; }
      if (state === "quoted") {
        if (c === '"') state = "closed";
        else cell += c;
      } else if (state === "closed" && c === '"') {
        cell += c; state = "quoted";
      } else if (c === ",") finishCell();
      else if (c === "\n" || c === "\r") { finishRow(); skipLF = c === "\r"; }
      else if (state === "closed") throw new Error("Có ký tự thừa sau dấu nháy đóng trong CSV.");
      else if (c === '"') {
        if (cell) throw new Error("Dấu nháy CSV không hợp lệ.");
        state = "quoted";
      } else cell += c;
      if (cell.length > 131072) throw new Error("Một ô CSV vượt quá 131.072 ký tự.");
    }
  };
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      chunk(decoder.decode(value, {stream: true}));
    }
    chunk(decoder.decode());
    if ((state as string) === "quoted") throw new Error("CSV có chuỗi chưa đóng dấu nháy.");
    finishRow();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
