import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, inspectFile } from "../src/studio/data.ts";
import { taskById, TASKS } from "../src/studio/catalog.ts";
const file = (text, name = "data.csv") => new File([text], name);
// Build a small standard ZIP with stored entries. The inspector checks schema,
// deliberately leaving decoded pixel / annotation validation to the worker.
function zip(names) {
  const local = [],
    central = [];
  let offset = 0;
  for (const name of names) {
    const n = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(n.length, 26);
    local.push(h, n);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += h.length + n.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12);
  end.writeUInt32LE(offset, 16);
  return new File([Buffer.concat([...local, ...central, end])], "data.zip");
}
test("CSV supports escaped quotes, commas, CRLF and multiline cells", () => {
  assert.deepEqual(
    parseCsv(
      'text,label\r\n"Great, \"\"quality\"\"",yes\r\n"two\nlines",no\r\n',
    ),
    [
      ["text", "label"],
      ['Great, "quality"', "yes"],
      ["two\nlines", "no"],
    ],
  );
});
test("Malformed quoting is rejected rather than silently rewritten", () => {
  for (const s of ['a,b\n"open,x', 'a,b\n"closed"junk,x', 'a,b\na"b,x'])
    assert.throws(() => parseCsv(s));
});
test("CSV schema detects duplicate headers, wrong row width, format and empty files", async () => {
  const task = taskById("classification");
  for (const f of [
    file("a,a\n1,2\n3,4"),
    file("a,b\n1,2,3\n3,4"),
    file(""),
    file("a,b\n1,2\n3,4", "image.zip"),
  ])
    await assert.rejects(inspectFile(f, task));
  const value = await inspectFile(file("\uFEFFx,y\n1,yes\n2,no"), task);
  assert.equal(value.count, 2);
  assert.deepEqual(value.columns, ["x", "y"]);
});
test("ZIP classification requires valid split/class hierarchy", async () => {
  const t = taskById("image-classification");
  await assert.rejects(
    inspectFile(zip(["train/dog/1.jpg", "train/cat/2.jpg"]), t),
  );
  await assert.rejects(
    inspectFile(zip(["train/dog/1.jpg", "val/dog/2.jpg"]), t),
  );
  const d = await inspectFile(
    zip([
      "train/dog/1.jpg",
      "train/cat/2.jpg",
      "val/dog/3.jpg",
      "val/cat/4.jpg",
    ]),
    t,
  );
  assert.equal(d.classes, 2);
  assert.equal(d.count, 4);
});
test("Segmentation requires a matching mask for each image", async () => {
  const names = ["images/train/1.jpg", "images/val/2.jpg"];
  await assert.rejects(
    inspectFile(
      zip([...names, "classes.json", "masks/train/1.png"]),
      taskById("segmentation"),
    ),
  );
  assert.equal(
    (
      await inspectFile(
        zip([...names, "classes.json", "masks/train/1.png", "masks/val/2.png"]),
        taskById("segmentation"),
      )
    ).count,
    2,
  );

});
test("ZIP rejects traversal, truncated data and huge entry counts", async () => {
  const t = taskById("image-classification");
  await assert.rejects(
    inspectFile(zip(["../train/dog/1.jpg", "val/dog/2.jpg"]), t),
  );
  await assert.rejects(inspectFile(file("broken archive", "data.zip"), t));
  await assert.rejects(
    inspectFile(
      zip(Array.from({ length: 5001 }, (_, i) => `train/dog/${i}.jpg`)),
      t,
    ),
  );
});
test("Supported image and tabular tasks have explicit models and data contracts", () => {
  assert.equal(TASKS.length, 4);
  assert.equal(new Set(TASKS.map((t) => t.id)).size, 4);
  assert.deepEqual(TASKS.filter(t => t.group === "Thị giác máy tính").map(t => t.id), ["image-classification", "segmentation"]);
  assert.ok(TASKS.every(t => t.live));
  for (const t of TASKS) {
    assert.ok(t.models.length);
    assert.ok(t.structure);
    assert.ok([".csv", ".zip"].includes(t.accept));
  }
});

test("Image ZIP size gate accepts under 200 MB and rejects above it", async () => {
  const names = ['train/a/1.png', 'train/b/2.png', 'val/a/3.png', 'val/b/4.png'];
  const allowed = zip(names);
  // Isolate the byte-size gate while retaining a small valid central directory.
  Object.defineProperty(allowed, 'size', { value: 199_999_999 });
  assert.equal((await inspectFile(allowed, taskById('image-classification'))).count, 4);
  const tooLarge = zip(names);
  Object.defineProperty(tooLarge, 'size', { value: 200_000_001 });
  await assert.rejects(inspectFile(tooLarge, taskById('image-classification')), /200 MB/);
});

test("CSV accepts 200 MB size gate and streams without reading whole text", async () => {
  const task = taskById("classification");
  const good = file('x,y\n1,yes\n2,no\n');
  Object.defineProperty(good, 'size', {value: 200_000_000});
  good.text = async () => { throw Error('Must stream'); };
  assert.equal((await inspectFile(good, task)).count, 2);
  const large = file('x,y\n1,yes\n2,no\n');
  Object.defineProperty(large, 'size', {value: 200_000_001});
  await assert.rejects(inspectFile(large, task), /200 MB/);
});

test("Streaming CSV handles UTF-8 and escaped quotes across single-byte chunks", async () => {
  const {scanCsv} = await import('../src/studio/csvStream.ts');
  const bytes = new TextEncoder().encode('\ufeffx,y\r\n"mèo, \"\"đen\"\"",yes\r\n"hai\ndòng",no');
  let offset = 0;
  const input = {stream: () => new ReadableStream({pull(c) { if (offset < bytes.length) c.enqueue(bytes.slice(offset, ++offset)); else c.close(); }})};
  const rows = [];
  await scanCsv(input, row => rows.push(row));
  assert.deepEqual(rows, [['x','y'], ['mèo, "đen"','yes'], ['hai\ndòng','no']]);
  for (const invalid of ['x,y\n"open,a', 'x,y\n"closed"bad,a', 'x,y\na"b,a'])
    await assert.rejects(scanCsv(file(invalid), () => {}));
});
