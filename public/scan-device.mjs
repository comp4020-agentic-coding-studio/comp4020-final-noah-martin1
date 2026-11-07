// The on-device scan: a small vision model in a worker, the whole photo
// plus three overlapping bands (cut by the same scan-tiles.mjs the server
// uses), with a progress bar for the first download and for each view. The
// raw replies are posted to the server, which parses and merges them the
// same way it does its own, then shows the usual review form.

import { tilesFor } from "./scan-tiles.mjs";
import { t } from "./i18n.mjs";

const root = document.querySelector("[data-device-scan]");
if (root) start();

async function start() {
  const q = (s) => root.querySelector(s);
  const unsupported = q("[data-device-unsupported]");
  const ready = q("[data-device-ready]");
  const file = q("[data-device-file]");
  const go = q("[data-device-start]");
  const box = q("[data-device-progress]");
  const label = q("[data-device-label]");
  const bar = q("[data-device-bar]");
  const form = q("[data-device-form]");
  const config = JSON.parse(document.getElementById("scan-config").textContent);

  const gpu = "gpu" in navigator && (await navigator.gpu.requestAdapter().catch(() => null));
  if (!gpu || typeof Worker === "undefined") {
    unsupported.hidden = false;
    return;
  }
  ready.hidden = false;
  go.hidden = false;
  go.disabled = true;
  file.addEventListener("change", () => (go.disabled = !file.files?.length));

  const say = (text, pct) => {
    box.hidden = false;
    label.textContent = text;
    if (pct === null) bar.removeAttribute("value");
    else bar.value = pct;
  };

  let worker = null;
  let loaded = null;
  const pending = new Map();
  function load() {
    if (loaded) return loaded;
    worker = new Worker("/assets/scan-device-worker.mjs", { type: "module" });
    loaded = new Promise((resolve, reject) => {
      worker.addEventListener("message", (e) => {
        const m = e.data;
        if (m.type === "download") {
          const pct = m.total ? (m.loaded / m.total) * 100 : 0;
          say(t("Downloading the model: {done} of {total} GB. This only happens once.", { done: (m.loaded / 1e9).toFixed(2), total: (m.total / 1e9).toFixed(2) }), pct);
        } else if (m.type === "ready") resolve();
        else if (m.type === "result") pending.get(m.id)?.resolve(m.reply);
        else if (m.type === "error") {
          for (const p of pending.values()) p.reject(new Error(m.message));
          reject(new Error(m.message));
        }
      });
    });
    say(t("Starting the model…"), null);
    worker.postMessage({ type: "load" });
    return loaded;
  }

  const ask = (blob, id) =>
    new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: "scan", id, blob, prompt: config.prompt });
    });

  // the whole photo, then the bands, as JPEG blobs no wider than 1280 px
  async function views(f) {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const W = Math.round(bmp.width * scale);
    const H = Math.round(bmp.height * scale);
    const cut = async (x, y, w, h) => {
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d").drawImage(bmp, x / scale, y / scale, w / scale, h / scale, 0, 0, w, h);
      return c.convertToBlob({ type: "image/jpeg", quality: 0.88 });
    };
    const out = [await cut(0, 0, W, H)];
    for (const t of tilesFor(W, H)) out.push(await cut(t.x, t.y, t.w, t.h));
    bmp.close();
    return out;
  }

  go.addEventListener("click", async () => {
    const f = file.files?.[0];
    if (!f) return;
    go.disabled = true;
    file.disabled = true;
    const started = performance.now();
    try {
      await load();
      const parts = await views(f);
      const replies = [];
      for (let i = 0; i < parts.length; i++) {
        say(t("Looking at your photo: {step} of {steps} views done.", { step: i, steps: parts.length }), (i / parts.length) * 100);
        replies.push(await ask(parts[i], i));
      }
      say(t("Done. Opening the review…"), 100);
      const holder = form.querySelector("[data-device-replies]");
      for (const r of replies) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "reply";
        input.value = r;
        holder.append(input);
      }
      form.querySelector("[data-device-seconds]").value = String(Math.round((performance.now() - started) / 1000));
      form.submit();
    } catch (err) {
      say(t("The scan stopped: {reason}. You can try again, or use the barcode scanner or the add form.", { reason: err.message }), 0);
      go.disabled = false;
      file.disabled = false;
      loaded = null;
      worker?.terminate();
    }
  });
}
