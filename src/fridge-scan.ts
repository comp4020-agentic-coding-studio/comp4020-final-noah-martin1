// Photo-to-pantry: a local vision model lists what it sees in a fridge or
// pantry photo, and this module turns that reply into checkable suggestions.
// The model only proposes names. Matching a name to the ingredient catalogue,
// and everything the person then saves (quantity, unit, expiry, price), is
// decided here or by the person, never by the model.

import { all, normaliseIngredient, one, run } from "./db.ts";

export interface Detected {
  name: string;
  count: number | null;
  container: string;
  // the model's own label for how sure it is: "high" | "medium" | "low"
  confidence: "high" | "medium" | "low";
}

export const SCAN_PROMPT = `You are cataloguing the food in a home fridge or pantry photo so it can be added to a kitchen inventory.

List every distinct food or drink item you can actually see. Rules:
- One entry per kind of item. Five apples is one entry with count 5.
- Name the food itself in plain grocery words, e.g. "milk", "cheddar cheese", "tomato ketchup", "carrot", "chickpeas". Not brand names, not "bottle", "jar" or "container".
- If the same food appears prepared two ways, say which: "fried chicken" and "raw chicken", not "chicken" twice.
- If a container's contents can't be identified, use a short guess like "leftovers" with confidence "low". Do not invent items you cannot see.
- Ignore non-food things (thermometers, bags, baskets, cleaning products).
- count is how many you can see, or null if you can't tell.
- container is one of: loose, bottle, jar, carton, can, tub, packet, box, bag, tray, container.
- confidence is "high" when the label or shape is unmistakable, "medium" when likely, "low" when guessing.

Reply with only a JSON object, no prose:
{"items":[{"name":"...","count":1,"container":"loose","confidence":"high"}]}`;

const CONTAINERS = new Set(["loose", "bottle", "jar", "carton", "can", "tub", "packet", "box", "bag", "tray", "container"]);

// Words that describe the packaging or the photo, not a food: a reply of just
// "bottle" or "food" is no suggestion at all.
const NOT_FOOD = /^(bottles?|jars?|containers?|cans?|tins?|boxe?s?|bags?|packets?|tubs?|cartons?|food|foods|items?|groceries|condiments?|drinks?|beverages?|sauces?|unknown|misc(ellaneous)?|thermometer|basket|shelf|fridge|refrigerator|pantry|plastic bag|cleaning products?)$/;

// Local models wrap JSON in prose or ``` fences, leave trailing commas, or
// stop mid-array when they hit the token limit. Take the outermost object if
// it parses; otherwise salvage every complete {...} item inside "items".
export function parseScan(text: string): Detected[] {
  const raw = extractItems(text);
  const seen = new Map<string, Detected>();
  for (const r of raw) {
    const d = cleanItem(r);
    if (!d) continue;
    const key = normaliseIngredient(d.name);
    const prior = seen.get(key);
    if (prior) {
      // the same food listed twice (two shelves): keep one, add the counts
      if (prior.count !== null && d.count !== null) prior.count += d.count;
      if (rank(d.confidence) > rank(prior.confidence)) prior.confidence = d.confidence;
    } else seen.set(key, d);
  }
  return [...seen.values()];
}

function extractItems(text: string): unknown[] {
  const body = text.replace(/```(?:json)?/gi, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(body.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
      if (Array.isArray(obj?.items)) return obj.items;
      if (Array.isArray(obj)) return obj;
    } catch {
      // fall through to salvage
    }
  }
  const out: unknown[] = [];
  for (const m of body.matchAll(/\{[^{}]*"name"\s*:[^{}]*\}/g)) {
    try {
      out.push(JSON.parse(m[0].replace(/,\s*}/g, "}")));
    } catch {
      // a half-written item at the cut-off point
    }
  }
  return out;
}

function cleanItem(r: unknown): Detected | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.replace(/\s*\(.*?\)\s*/g, " ").trim().toLowerCase() : "";
  if (!name || name.length > 60 || NOT_FOOD.test(name)) return null;
  const n = typeof o.count === "number" ? o.count : typeof o.count === "string" ? Number(o.count) : NaN;
  const count = Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n) : null;
  const c = typeof o.container === "string" ? o.container.toLowerCase().trim() : "";
  const conf = typeof o.confidence === "string" ? o.confidence.toLowerCase().trim() : "";
  return {
    name,
    count,
    container: CONTAINERS.has(c) ? c : "",
    confidence: conf === "high" || conf === "low" ? conf : "medium",
  };
}

const rank = (c: Detected["confidence"]) => (c === "high" ? 2 : c === "medium" ? 1 : 0);

/* ---------------- matching to the ingredient catalogue ---------------- */

// Names a model (or an American label) uses for something the catalogue
// already holds under an Australian name. Only the same food: "tomato sauce"
// is ketchup here, but "pasta sauce" is not passata, so it is not listed.
const ALIASES: Record<string, string> = {
  ketchup: "tomato ketchup",
  catsup: "tomato ketchup",
  "bell pepper": "capsicum",
  "red bell pepper": "capsicum",
  "green bell pepper": "capsicum",
  "yellow bell pepper": "capsicum",
  "sweet pepper": "capsicum",
  cilantro: "coriander",
  courgette: "zucchini",
  aubergine: "eggplant",
  "spring onions": "spring onion",
  scallion: "spring onion",
  scallions: "spring onion",
  "green onion": "spring onion",
  "green onions": "spring onion",
  garbanzo: "chickpeas",
  "garbanzo beans": "chickpeas",
  chickpea: "chickpeas",
  yogurt: "yoghurt",
  "greek yogurt": "greek yoghurt",
  "plain yogurt": "yoghurt",
  "natural yoghurt": "yoghurt",
  mayo: "mayonnaise",
  "cheddar": "cheddar cheese",
  "sliced cheese": "cheese",
  "cheese slices": "cheese",
  "shredded cheese": "cheese",
  "parmesan cheese": "parmesan",
  "philadelphia": "cream cheese",
  "whole milk": "milk",
  "skim milk": "milk",
  "full cream milk": "milk",
  "low fat milk": "milk",
  "fat free milk": "milk",
  "free range eggs": "eggs",
  egg: "eggs",
  "chicken eggs": "eggs",
  "canned tuna": "tuna",
  "tinned tuna": "tuna",
  "tuna chunks": "tuna",
  "chopped tomatoes": "canned tomatoes",
  "diced tomatoes": "canned tomatoes",
  "crushed tomatoes": "canned tomatoes",
  "tinned tomatoes": "canned tomatoes",
  "barbecue sauce": "barbecue sauce",
  "bbq sauce": "barbecue sauce",
  "soya sauce": "soy sauce",
  "dijon": "dijon mustard",
  "yellow mustard": "mustard",
  "wholegrain mustard": "mustard",
  "jalapeno": "jalapeño",
  "jalapenos": "jalapeño",
  "jalapeños": "jalapeño",
  "pickled jalapenos": "jalapeño",
  "mandarin": "mandarin",
  "mandarins": "mandarin",
  "tangerine": "mandarin",
  "clementine": "mandarin",
  "grapes": "green grapes",
  "red grapes": "grapes",
  "white bread": "bread",
  "sliced bread": "bread",
  "loaf of bread": "bread",
  "sparkling water": "sparkling water",
  "mineral water": "sparkling water",
  "soda water": "sparkling water",
  "bottled water": "water",
  "olive oil extra virgin": "olive oil",
  "extra virgin olive oil": "olive oil",
  "vegetable oil": "vegetable oil",
  "canola oil": "vegetable oil",
  "cooking oil": "vegetable oil",
  "spaghetti pasta": "spaghetti",
  "rolled oat": "rolled oats",
  oats: "rolled oats",
  "plain white flour": "plain flour",
  "all-purpose flour": "plain flour",
  "all purpose flour": "plain flour",
  "chocolate hazelnut spread": "chocolate hazelnut spread",
  nutella: "chocolate hazelnut spread",
  "hazelnut spread": "chocolate hazelnut spread",
};

// Turn a plural or common spelling variant into the catalogue's form. Tried
// in order; the first candidate that exists wins.
function variants(name: string): string[] {
  const out = [name];
  if (ALIASES[name]) out.push(ALIASES[name]);
  const singular = name
    .replace(/ies$/, "y")
    .replace(/(tomato|potato|mango)es$/, "$1")
    .replace(/([^s])s$/, "$1");
  if (singular !== name) out.push(singular, ALIASES[singular] ?? singular);
  if (!name.endsWith("s")) out.push(`${name}s`);
  out.push(name.replace(/yogurt/g, "yoghurt"), name.replace(/flavou?red /g, ""));
  return [...new Set(out.filter(Boolean))];
}

export interface Resolved {
  detected: Detected;
  // the catalogue name to save under (an existing ingredient), or the
  // cleaned model name when nothing in the catalogue matches
  name: string;
  match: "exact" | "alias" | "variant" | "new";
}

// Exact name or a known alias/variant first, then the person's own past
// corrections (they renamed "yoghurt" to "kefir" before). A name with no
// match is offered as a new ingredient, clearly marked, rather than forced
// onto the nearest-looking catalogue entry.
export function resolveName(d: Detected, known: (name: string) => boolean, learned: Map<string, string> = new Map()): Resolved {
  const n = normaliseIngredient(d.name);
  const taught = learned.get(n);
  if (taught) return { detected: d, name: taught, match: "alias" };
  if (known(n)) return { detected: d, name: n, match: "exact" };
  const alias = ALIASES[n];
  if (alias && known(alias)) return { detected: d, name: alias, match: "alias" };
  for (const v of variants(n)) if (v !== n && known(v)) return { detected: d, name: v, match: "variant" };
  return { detected: d, name: n, match: "new" };
}

export function catalogueHas(name: string): boolean {
  return !!one("SELECT 1 FROM ingredients WHERE name = ?", normaliseIngredient(name));
}

/* ---------------- learning from corrections ---------------- */

// When someone saves a suggestion under a different name ("yoghurt" →
// "kefir"), remember it for them so the next scan proposes "kefir" straight
// away. Per person, since one household's "leftovers" tub is another's soup.
export function learnedNames(userId: number): Map<string, string> {
  const rows = all<{ detected: string; corrected: string }>(
    "SELECT detected, corrected FROM scan_corrections WHERE user_id = ? ORDER BY updated_at",
    userId,
  );
  return new Map(rows.map((r) => [r.detected, r.corrected]));
}

export function rememberCorrection(userId: number, detected: string, saved: string): void {
  const from = normaliseIngredient(detected);
  const to = normaliseIngredient(saved);
  if (!from || !to || from === to) return;
  run(
    `INSERT INTO scan_corrections (user_id, detected, corrected) VALUES (?, ?, ?)
     ON CONFLICT (user_id, detected) DO UPDATE SET corrected = excluded.corrected, times = times + 1, updated_at = datetime('now')`,
    userId,
    from,
    to,
  );
}

/* ---------------- talking to the local model ---------------- */

export interface ScanConfig {
  url: string;
  model: string;
  timeoutMs: number;
}

// Off unless VISION_URL points at an Ollama-compatible server: the deployed
// app's 256 MB machine can't host a vision model, so the photo scan is a
// feature of a self-hosted install and the plain add form stays the default.
export function scanConfig(): ScanConfig | null {
  const url = process.env.VISION_URL?.replace(/\/+$/, "");
  if (!url) return null;
  return {
    url,
    model: process.env.VISION_MODEL ?? "qwen3-vl:8b",
    timeoutMs: Number(process.env.VISION_TIMEOUT_MS ?? 180000),
  };
}

export class ScanUnavailable extends Error {}

/* ---------------- tiling a busy photo ---------------- */

// A small model loses track on a packed fridge: it lists the first shelf,
// then repeats one item until it runs out of tokens. Three overlapping bands
// along the photo's long side keep each request to a manageable handful of
// items (measured: 4 → 10 of 14 required items on a full double-door
// fridge). Overlap means an item cut by a band edge is whole in a neighbour.
export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function tilesFor(width: number, height: number, bands = 3, overlap = 0.12): Tile[] {
  if (bands <= 1) return [{ x: 0, y: 0, w: width, h: height }];
  const wide = width >= height;
  const long = wide ? width : height;
  const size = Math.round(long / bands + long * overlap);
  const step = (long - size) / (bands - 1);
  return Array.from({ length: bands }, (_, i) => {
    const at = Math.round(i * step);
    return wide ? { x: at, y: 0, w: size, h: height } : { x: 0, y: at, w: width, h: size };
  });
}

// Crops with macOS's built-in `sips`, which is there wherever this scan is
// meant to run (next to a local model on a Mac). Null means "no cropper":
// the caller scans the whole photo instead.
export async function cropTiles(image: Buffer, width: number, height: number, bands: number): Promise<Buffer[] | null> {
  if (bands <= 1 || process.platform !== "darwin") return null;
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const dir = await mkdtemp(join(tmpdir(), "larder-scan-"));
  try {
    const src = join(dir, "in.jpg");
    await writeFile(src, image);
    const out: Buffer[] = [];
    for (const [i, t] of tilesFor(width, height, bands).entries()) {
      const dst = join(dir, `t${i}.jpg`);
      // sips: -c <height> <width>, --cropOffset <y> <x>
      await promisify(execFile)("sips", ["-s", "format", "jpeg", "-c", String(t.h), String(t.w), "--cropOffset", String(t.y), String(t.x), src, "--out", dst]);
      out.push(await readFile(dst));
    }
    return out;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Whole photo plus bands: the whole view catches big items a band splits,
// the bands catch the small ones the whole view skips. Replies are merged
// the same way one reply's duplicates are.
export async function scanPhoto(cfg: ScanConfig, image: Buffer, size: { width: number; height: number }, bands = Number(process.env.VISION_TILES ?? 3)): Promise<{ items: Detected[]; ms: number; calls: number }> {
  const started = Date.now();
  const tiles = (await cropTiles(image, size.width, size.height, bands)) ?? [];
  const texts: string[] = [];
  for (const img of [image, ...tiles]) texts.push((await callVision(cfg, img)).text);
  return { items: mergeScans(texts.map(parseScan)), ms: Date.now() - started, calls: texts.length };
}

export function mergeScans(lists: Detected[][]): Detected[] {
  const merged = new Map<string, Detected>();
  for (const list of lists) {
    for (const d of list) {
      const key = normaliseIngredient(d.name);
      const prior = merged.get(key);
      if (!prior) merged.set(key, { ...d });
      else {
        // the same items seen again in an overlapping view: keep the larger
        // count, not the sum, and the surer confidence
        if (d.count !== null) prior.count = Math.max(prior.count ?? 0, d.count);
        if (rank(d.confidence) > rank(prior.confidence)) prior.confidence = d.confidence;
      }
    }
  }
  return [...merged.values()];
}

export async function callVision(cfg: ScanConfig, image: Buffer, prompt = SCAN_PROMPT): Promise<{ text: string; ms: number }> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(cfg.timeoutMs),
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        format: "json",
        think: false,
        keep_alive: "10m",
        // a mild repeat penalty stops the "hot sauce, hot sauce, …" loop a
        // small model falls into on a packed shelf; stronger ones also
        // suppress JSON's own repeated keys and cut the list short
        options: { temperature: 0, num_predict: 1000, num_ctx: 8192, repeat_penalty: 1.1, repeat_last_n: 96 },
        messages: [{ role: "user", content: prompt, images: [image.toString("base64")] }],
      }),
    });
  } catch (err) {
    throw new ScanUnavailable(err instanceof Error && err.name === "TimeoutError" ? "The photo scan took too long." : "The photo scanner isn't running.");
  }
  if (!res.ok) throw new ScanUnavailable(`The photo scanner answered ${res.status}.`);
  const body = (await res.json()) as { message?: { content?: string } };
  return { text: body.message?.content ?? "", ms: Date.now() - started };
}
