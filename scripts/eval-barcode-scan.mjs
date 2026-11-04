// Scores the barcode scanner on the real product photos in
// testing/barcode-scan/: each photo decoded in headless Chrome by the same
// reader the page uses (the browser's own BarcodeDetector where it has one,
// otherwise the barcode-detector ZXing build), first whole and then as a
// phone's video frame would show it (1280 px wide), timed; then every code
// read is checked by the server's check-digit rule and looked up on Open
// Food Facts through the app, also timed.
//
//   node scripts/eval-barcode-scan.mjs http://localhost:8096
//
// Writes testing/barcode-scan/results.json.

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:8096";
const dir = "testing/barcode-scan";
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const truth = JSON.parse(readFileSync(join(dir, "truth.json"), "utf8"));
const photos = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
const matches = (want, got) => (want.endsWith("*") ? got.startsWith(want.slice(0, -1)) : got === want);

// the photos and a test page, served on localhost (a secure context)
const page = `<!doctype html><meta charset=utf-8><title>barcodes</title><script type=module>
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const { BarcodeDetector: Ponyfill } = await import("https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/es/ponyfill.js");
const readers = { zxing: new Ponyfill({ formats: FORMATS }) };
if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("ean_13")) readers.native = new BarcodeDetector({ formats: FORMATS });
window.decode = async (file) => {
  const img = new Image();
  img.src = "/" + file;
  await img.decode();
  // a phone's video frame: 1280 wide
  const c = document.createElement("canvas");
  const s = 1280 / Math.max(img.naturalWidth, img.naturalHeight);
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const out = {};
  for (const [name, r] of Object.entries(readers)) {
    for (const [view, src] of [["photo", img], ["frame", c]]) {
      const t = performance.now();
      const found = await r.detect(src).catch((e) => [{ rawValue: "ERR " + e }]);
      out[name + " " + view] = { ms: Math.round(performance.now() - t), codes: found.map((f) => f.rawValue) };
    }
  }
  return out;
};
window.ready = Object.keys(readers);
</script>`;
const server = createServer((req, res) => {
  if (req.url === "/") return res.end(page);
  const f = decodeURIComponent(req.url.slice(1));
  if (photos.includes(f)) return res.end(readFileSync(join(dir, f)));
  res.statusCode = 404;
  res.end();
}).listen(0);
const port = server.address().port;

const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=9340", "--user-data-dir=/tmp/eval-barcode-chrome", "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { wsUrl = (await (await fetch("http://127.0.0.1:9340/json/list")).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send("Page.navigate", { url: `http://localhost:${port}/` });
let readers;
for (let i = 0; i < 100 && !readers; i++) { await new Promise((r) => setTimeout(r, 200)); readers = await js("window.ready"); }

// a signed-in client for the app's lookup
const jar = new Map();
const c = async (path, init = {}) => {
  const res = await fetch(new URL(path, base), { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
  for (const h of res.headers.getSetCookie()) { const [p] = h.split(";"); const at = p.indexOf("="); jar.set(p.slice(0, at), p.slice(at + 1)); }
  return res;
};
await c("/register", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: `bceval_${Date.now()}`, display_name: "B", password: "correct horse battery" }) });

const rows = [];
for (const photo of photos) {
  const decoded = await js(`decode(${JSON.stringify(photo)})`);
  const want = truth[photo];
  const views = Object.fromEntries(Object.entries(decoded).map(([k, v]) => [k, { ...v, right: v.codes.some((code) => matches(want, code)), wrong: v.codes.filter((code) => !matches(want, code)) }]));
  // the first right reading, looked up the way the page does
  const code = Object.values(views).flatMap((v) => v.codes).find((code) => matches(want, code));
  let lookup = null;
  if (code) {
    const t = Date.now();
    const res = await c(`/pantry/scan/barcode/lookup?code=${code}`, { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => ({}));
    lookup = { ms: Date.now() - t, status: res.status, found: !!body.found, product: body.product ? `${body.product.name}${body.product.quantity ? ` ${body.product.quantity} ${body.product.unit}` : ""}` : null };
    await new Promise((r) => setTimeout(r, 1500)); // gentle on Open Food Facts
  }
  rows.push({ photo, want, views, lookup });
  console.log(photo, Object.entries(views).map(([k, v]) => `${k}: ${v.right ? "OK" : "--"} ${v.ms}ms${v.wrong.length ? ` WRONG ${v.wrong}` : ""}`).join(" | "), lookup ? `| lookup ${lookup.status} ${lookup.found ? lookup.product : "not found"} ${lookup.ms}ms` : "");
}
const summary = Object.fromEntries(Object.keys(rows[0].views).map((k) => {
  const right = rows.filter((r) => r.views[k].right).length;
  const wrong = rows.filter((r) => r.views[k].wrong.length).length;
  const ms = rows.map((r) => r.views[k].ms).sort((a, b) => a - b);
  return [k, { right, of: rows.length, wrong_codes: wrong, median_ms: ms[Math.floor(ms.length / 2)], max_ms: ms.at(-1) }];
}));
const looked = rows.filter((r) => r.lookup);
const lookupSummary = { looked_up: looked.length, found: looked.filter((r) => r.lookup.found).length, median_ms: looked.map((r) => r.lookup.ms).sort((a, b) => a - b)[Math.floor(looked.length / 2)] };
writeFileSync(join(dir, "results.json"), `${JSON.stringify({ readers, summary, lookup: lookupSummary, rows }, null, 1)}\n`);
console.log(JSON.stringify({ readers, summary, lookup: lookupSummary }, null, 1));
ws.close();
proc.kill();
server.close();
