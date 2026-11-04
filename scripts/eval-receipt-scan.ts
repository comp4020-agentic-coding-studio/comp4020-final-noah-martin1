// Scores a vision model on the receipts in testing/receipt-scan/, using the
// app's own prompt and parser (src/receipt-scan.ts):
//
//   VISION_URL=http://localhost:11434 node scripts/eval-receipt-scan.ts qwen3-vl:8b-instruct
//
// Items: share of the printed items found (by keyword). Prices: of those
// found, the share whose price matches what was paid to the cent. Total
// check: whether the app's sum-against-total check came out right; a
// receipt read wrongly but flagged as not adding up is the check working.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callVision } from "../src/fridge-scan.ts";
import { lineQuantity, parseReceipt, RECEIPT_PROMPT } from "../src/receipt-scan.ts";

interface TruthLine { item: string; keys: string[]; price: number; grams?: number; ml?: number }
const dir = "testing/receipt-scan";
const model = process.argv[2];
if (!model) throw new Error("usage: eval-receipt-scan.ts <model>");
const url = process.env.VISION_URL ?? "http://localhost:11434";
const truth = JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")) as Record<string, { total: number; lines: TruthLine[] }>;

// RESCORE=1 re-scores the saved replies (after a truth.json fix) without
// asking the model again
const resultFile = join(dir, "results", `${model.replace(/[:/]/g, "_")}.json`);
const saved = process.env.RESCORE ? (JSON.parse(readFileSync(resultFile, "utf8")).rows as { photo: string; ms: number; raw: string }[]) : [];

const rows: { photo: string; items: number; prices: number; [k: string]: unknown }[] = [];
for (const photo of readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort()) {
  const t = truth[photo];
  const prior = saved.find((s) => s.photo === photo);
  const { text, ms } = prior ? { text: prior.raw, ms: prior.ms } : await callVision({ url, model, timeoutMs: 900000 }, readFileSync(join(dir, photo)), RECEIPT_PROMPT);
  const r = parseReceipt(text);
  // match each printed item to one read line, in order, without reuse, by
  // the food name the model gave: that's what lands in the review row (the
  // printed text it copied would match even when the name is wrong)
  const used = new Set<number>();
  const matched = t.lines.map((want) => {
    const i = r.lines.findIndex((l, j) => !used.has(j) && want.keys.some((k) => l.name.toLowerCase().includes(k)));
    if (i >= 0) used.add(i);
    return { want, got: i >= 0 ? r.lines[i] : null };
  });
  const found = matched.filter((m) => m.got);
  const priced = found.filter((m) => m.got!.price_cents === Math.round(m.want.price * 100));
  const weighedRight = found.filter((m) => m.want.grams && Math.abs(Number(lineQuantity(m.got!).quantity) - m.want.grams) <= 1);
  const extra = r.lines.filter((_, j) => !used.has(j)).map((l) => l.name);
  const totalRead = r.total_cents === Math.round(t.total * 100);
  const allRight = found.length === t.lines.length && priced.length === found.length && !extra.length;
  // the check is right if it passes a correct reading or flags a wrong one
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
    raw: text,
  };
  rows.push(row);
  console.log(`${photo.padEnd(22)} ${(ms / 1000).toFixed(0).padStart(4)}s  items ${Math.round(row.items * 100)}%  prices ${Math.round(row.prices * 100)}%  weighed ${row.weighed}  total read ${totalRead ? "yes" : "no"}  check ${r.check ? (r.check.matches ? "adds up" : "flagged") : "none"} (${checkRight === null ? "n/a" : checkRight ? "right" : "WRONG"})`);
  if (row.missed.length) console.log(`   missed: ${row.missed.join("; ")}`);
  if (row.wrongPrice.length) console.log(`   prices: ${row.wrongPrice.join("; ")}`);
  if (extra.length) console.log(`   extra: ${extra.join(", ")}`);
}
const avg = (k: "items" | "prices") => rows.reduce((a, r) => a + r[k], 0) / rows.length;
console.log(`\n${model}: items ${Math.round(avg("items") * 100)}%  prices ${Math.round(avg("prices") * 100)}%`);
mkdirSync(join(dir, "results"), { recursive: true });
writeFileSync(resultFile, JSON.stringify({ model, items: avg("items"), prices: avg("prices"), rows }, null, 1));
