// Scores a local vision model on the photos in testing/fridge-scan/: what
// it found against what a person found. Uses the app's own prompt and parser
// (src/fridge-scan.ts), so the score is for what ships.
//
//   VISION_URL=http://localhost:11434 node scripts/eval-fridge-scan.ts qwen3-vl:8b [photo-prefix]
//
// "required" items are ones a careful person sees; "acceptable" are things
// that might be there (an unlabelled tub that could be hummus or dip). Recall
// counts required items found; precision counts suggestions that are required
// or acceptable. Results go to testing/fridge-scan/results/<model>.json.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Detected, scanPhoto } from "../src/fridge-scan.ts";
import { checkImage } from "../src/images.ts";

interface Truth {
  required: Record<string, string[]>;
  acceptable: string[];
}

const dir = "testing/fridge-scan";
const model = process.argv[2];
const only = process.argv[3] ?? "";
if (!model) throw new Error("usage: eval-fridge-scan.ts <model> [photo-prefix]");
const url = process.env.VISION_URL ?? "http://localhost:11434";
const truth = JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")) as Record<string, Truth>;

const hit = (name: string, keys: string[]) => keys.some((k) => name.includes(k));

export function score(found: Detected[], t: Truth) {
  const names = found.map((f) => f.name);
  const matched: string[] = [];
  const missed: string[] = [];
  for (const [item, keys] of Object.entries(t.required)) (names.some((n) => hit(n, keys)) ? matched : missed).push(item);
  const allKeys = [...Object.values(t.required).flat(), ...t.acceptable];
  const wrong = names.filter((n) => !hit(n, allKeys));
  return {
    recall: matched.length / Object.keys(t.required).length,
    precision: names.length ? (names.length - wrong.length) / names.length : 0,
    matched,
    missed,
    wrong,
  };
}

// VISION_TILES=1 scores the whole photo alone; the default matches the app
const bands = Number(process.env.VISION_TILES ?? 3);
const label = `${model}${bands === 1 ? "-whole" : `-tiles${bands}`}`;
const photos = readdirSync(dir).filter((f) => f.endsWith(".jpg") && f.startsWith(only)).sort();
const rows: (ReturnType<typeof score> & { photo: string; ms: number; calls: number; found: Detected[] })[] = [];
for (const photo of photos) {
  const bytes = readFileSync(join(dir, photo));
  const check = checkImage(bytes);
  if (!check.ok) throw new Error(`${photo}: ${check.problem}`);
  const { items: found, ms, calls } = await scanPhoto({ url, model, timeoutMs: 900000 }, bytes, check, bands);
  const s = score(found, truth[photo]);
  rows.push({ photo, ms, calls, found, ...s });
  console.log(`${photo.padEnd(28)} ${(ms / 1000).toFixed(1).padStart(6)}s  recall ${(s.recall * 100).toFixed(0).padStart(3)}%  precision ${(s.precision * 100).toFixed(0).padStart(3)}%  missed: ${s.missed.join(", ")}${s.wrong.length ? `  | wrong: ${s.wrong.join(", ")}` : ""}`);
}
const avg = (k: "recall" | "precision" | "ms") => rows.reduce((a, r) => a + r[k], 0) / rows.length;
console.log(`\n${label}: recall ${(avg("recall") * 100).toFixed(1)}%  precision ${(avg("precision") * 100).toFixed(1)}%  mean ${(avg("ms") / 1000).toFixed(1)}s/photo`);
// a partial run (photo prefix given) is a probe, not a result for the report
if (!only) {
  mkdirSync(join(dir, "results"), { recursive: true });
  writeFileSync(join(dir, "results", `${label.replace(/[:/]/g, "_")}.json`), JSON.stringify({ model: label, recall: avg("recall"), precision: avg("precision"), meanMs: avg("ms"), rows }, null, 1));
}
