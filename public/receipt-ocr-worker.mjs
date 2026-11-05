// Reads a receipt photo in a worker, so the page and its camera stay
// smooth: loads onnxruntime-web and the two PaddleOCR models (about 15 MB,
// from the browser's cache after the first time), then turns each photo it
// is sent into the receipt's printed lines (receipt-ocr.mjs). The page posts
// those lines to the server, which decides what was bought.

import { createReader } from "./receipt-ocr.mjs";

const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
const MODELS = "https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/";
const FILES = { det: "ch_PP-OCRv4_det_infer.onnx", rec: "ch_PP-OCRv4_rec_infer.onnx", dict: "ppocr_keys_v1.txt" };

let reader = null;

// a file's bytes, with download progress across all of them
async function fetchAll(onProgress) {
  const sizes = new Map();
  const got = new Map();
  const tell = () => {
    let loaded = 0, total = 0;
    for (const [k, t] of sizes) {
      total += t;
      loaded += got.get(k) ?? 0;
    }
    onProgress(loaded, total);
  };
  const one = async (key, url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`couldn't download the reader (${res.status})`);
    // jsDelivr serves the files compressed, so content-length is the
    // compressed size; it still measures progress fairly
    sizes.set(key, Number(res.headers.get("content-length")) || 0);
    const reader = res.body.getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      n += value.length;
      got.set(key, Math.min(n, sizes.get(key) || n));
      tell();
    }
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  const [det, rec, dict] = await Promise.all([one("det", MODELS + FILES.det), one("rec", MODELS + FILES.rec), one("dict", MODELS + FILES.dict)]);
  return { det, rec, dict: new TextDecoder().decode(dict) };
}

async function load() {
  const ort = await import(`${ORT}ort.wasm.min.mjs`);
  ort.env.wasm.wasmPaths = ORT;
  // one thread: threads need cross-origin isolation the site doesn't use
  ort.env.wasm.numThreads = 1;
  const files = await fetchAll((loaded, total) => postMessage({ type: "download", loaded, total }));
  reader = await createReader(ort, files);
  postMessage({ type: "ready" });
}

async function read({ id, blob }) {
  const bmp = await createImageBitmap(blob);
  // the reader works on at most this many pixels on the long side: enough
  // for receipt print, and quick on a phone
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const { data } = ctx.getImageData(0, 0, w, h);
  const started = performance.now();
  const { lines } = await reader.read({ data, width: w, height: h }, (done, total) => postMessage({ type: "progress", id, done, total }));
  postMessage({ type: "result", id, lines, ms: Math.round(performance.now() - started) });
}

self.addEventListener("message", async (e) => {
  try {
    if (e.data.type === "load") await load();
    else if (e.data.type === "read") await read(e.data);
  } catch (err) {
    postMessage({ type: "error", message: String(err?.message ?? err) });
  }
});
