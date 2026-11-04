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
import { callVision, parseScan, type Detected } from "../src/fridge-scan.ts";

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

const photos = readdirSync(dir).filter((f) => f.endsWith(".jpg") && f.startsWith(only)).sort();
const rows: (ReturnType<typeof score> & { photo: string; ms: number; found: Detected[]; raw: string })[] = [];
for (const photo of photos) {
  const bytes = readFileSync(join(dir, photo));
  const { text, ms } = await callVision({ url, model, timeoutMs: 600000 }, bytes);
  const found = parseScan(text);
  const s = score(found, truth[photo]);
  rows.push({ photo, ms, found, raw: text, ...s });
  console.log(`${photo.padEnd(28)} ${(ms / 1000).toFixed(1).padStart(6)}s  recall ${(s.recall * 100).toFixed(0).padStart(3)}%  precision ${(s.precision * 100).toFixed(0).padStart(3)}%  missed: ${s.missed.join(", ")}${s.wrong.length ? `  | wrong: ${s.wrong.join(", ")}` : ""}`);
}
const avg = (k: "recall" | "precision" | "ms") => rows.reduce((a, r) => a + r[k], 0) / rows.length;
console.log(`\n${model}: recall ${(avg("recall") * 100).toFixed(1)}%  precision ${(avg("precision") * 100).toFixed(1)}%  mean ${(avg("ms") / 1000).toFixed(1)}s/photo`);
mkdirSync(join(dir, "results"), { recursive: true });
writeFileSync(join(dir, "results", `${model.replace(/[:/]/g, "_")}${only ? `-${only}` : ""}.json`), JSON.stringify({ model, recall: avg("recall"), precision: avg("precision"), meanMs: avg("ms"), rows }, null, 1));
