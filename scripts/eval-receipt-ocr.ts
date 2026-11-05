// Scores the in-browser receipt reader: PaddleOCR text (public/receipt-ocr.mjs)
// parsed by plain code (src/receipt-text.ts), on the receipts in
// testing/receipt-scan/, the same way eval-receipt-scan.ts scores the vision
// models. The OCR runs in node with onnxruntime-node and the same model files
// the browser downloads:
//
//   ORT=/path/to/onnxruntime-node MODELS=/path/to/ocr-models/assets \
//     DATA_DIR=<throwaway> node scripts/eval-receipt-ocr.ts
//
// Photos are decoded with ffmpeg. OCR=saved re-scores the last run's text
// without reading the photos again (after a parser change).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all } from "../src/db.ts";
import { loadProducts } from "../src/products.ts";
import { lineQuantity } from "../src/receipt-scan.ts";
import { parseReceiptText } from "../src/receipt-text.ts";

interface TruthLine { item: string; keys: string[]; price: number; grams?: number }
const dir = "testing/receipt-scan";
const truth = JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")) as Record<string, { total: number; lines: TruthLine[] }>;
const resultFile = join(dir, "results", "browser-paddleocr.json");

const known = [...new Set([
  ...Object.keys(loadProducts().products),
  ...all<{ name: string }>("SELECT DISTINCT i.name FROM ingredients i JOIN recipe_ingredients ri ON ri.ingredient_id = i.id JOIN recipes r ON r.id = ri.recipe_id WHERE r.visibility = 'public'").map((r) => r.name),
])];

let read: (photo: string) => Promise<{ lines: string[]; ms: number }>;
if (process.env.OCR === "saved") {
  const saved = JSON.parse(readFileSync(resultFile, "utf8")).rows as { photo: string; ms: number; ocr: string[] }[];
  read = async (photo) => {
    const s = saved.find((r) => r.photo === photo)!;
    return { lines: s.ocr, ms: s.ms };
  };
} else {
  const ort = await import(process.env.ORT ?? "onnxruntime-node");
  const { createReader } = await import("../public/receipt-ocr.mjs");
  const m = process.env.MODELS!;
  const reader = await createReader(ort, {
    det: readFileSync(join(m, "ch_PP-OCRv4_det_infer.onnx")),
    rec: readFileSync(join(m, "ch_PP-OCRv4_rec_infer.onnx")),
    dict: readFileSync(join(m, "ppocr_keys_v1.txt"), "utf8"),
  });
  read = async (photo) => {
    const path = join(dir, photo);
    const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf8" }).trim().split(",").map(Number);
    const data = execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 28 });
    const t = performance.now();
    const r = await reader.read({ data, width: w, height: h });
    return { lines: r.lines, ms: Math.round(performance.now() - t) };
  };
}

const rows: { photo: string; items: number; prices: number; [k: string]: unknown }[] = [];
for (const photo of readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort()) {
  const t = truth[photo];
  if (!t) continue;
  const { lines: ocr, ms } = await read(photo);
  const r = parseReceiptText(ocr, known);
  // each printed item matched to one read line, in order, without reuse, by
  // the food name that lands in the review row
  const used = new Set<number>();
  const matched = t.lines.map((want) => {
    const i = r.lines.findIndex((l, j) => !used.has(j) && want.keys.some((k) => l.name.toLowerCase().includes(k)));
    if (i >= 0) used.add(i);
    return { want, got: i >= 0 ? r.lines[i] : null };
  });
  const found = matched.filter((m) => m.got);
  const priced = found.filter((m) => m.got!.price_cents === Math.round(m.want.price * 100));
  const weighedRight = found.filter((m) => m.want.grams && Math.abs(Number(lineQuantity(m.got!).quantity) - m.want.grams) <= 1);
  const extra = r.lines.filter((_, j) => !used.has(j)).map((l) => `${l.name} (${l.text})`);
  const totalRead = r.total_cents === Math.round(t.total * 100);
  const allRight = found.length === t.lines.length && priced.length === found.length && !extra.length;
  const checkRight = r.check === null ? null : r.check.matches === allRight;
  const row = {
    photo, ms,
    items: found.length / t.lines.length,
    prices: found.length ? priced.length / found.length : 0,
    weighed: `${weighedRight.length}/${t.lines.filter((l) => l.grams).length}`,
    totalRead, check: r.check, checkRight,
    missed: matched.filter((m) => !m.got).map((m) => m.want.item),
    wrongPrice: found.filter((m) => !priced.includes(m)).map((m) => `${m.want.item}: read ${(m.got!.price_cents ?? 0) / 100}, paid ${m.want.price}`),
    extra,
    lines: r.lines,
    ocr,
  };
  rows.push(row);
  console.log(`${photo.padEnd(30)} ${(ms / 1000).toFixed(1).padStart(5)}s  items ${Math.round(row.items * 100)}%  prices ${Math.round(row.prices * 100)}%  weighed ${row.weighed}  total read ${totalRead ? "yes" : "no"}  check ${r.check ? (r.check.matches ? "adds up" : "flagged") : "none"} (${checkRight === null ? "n/a" : checkRight ? "right" : "WRONG"})`);
  if (row.missed.length) console.log(`   missed: ${row.missed.join("; ")}`);
  if (row.wrongPrice.length) console.log(`   prices: ${row.wrongPrice.join("; ")}`);
  if (extra.length) console.log(`   extra: ${extra.join(", ")}`);
}
const avg = (k: "items" | "prices", f = (_: string) => true) => {
  const rs = rows.filter((r) => f(r.photo));
  return rs.reduce((a, r) => a + r[k], 0) / rs.length;
};
const au = (p: string) => /^(r1|coles|woolworths|costco)/.test(p);
console.log(`\nall ${rows.length}: items ${Math.round(avg("items") * 100)}%  prices ${Math.round(avg("prices") * 100)}%`);
console.log(`Australian (${rows.filter((r) => au(r.photo)).length}): items ${Math.round(avg("items", au) * 100)}%  prices ${Math.round(avg("prices", au) * 100)}%`);
mkdirSync(join(dir, "results"), { recursive: true });
writeFileSync(resultFile, JSON.stringify({ reader: "PaddleOCR PP-OCRv4 (public/receipt-ocr.mjs) + src/receipt-text.ts", items: avg("items"), prices: avg("prices"), rows }, null, 1));
