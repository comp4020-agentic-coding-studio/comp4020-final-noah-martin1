// The receipt page's live camera. It looks at a few frames a second (a
// small copy for framing and movement, a full-resolution crop for focus;
// public/receipt-frame.mjs) and, once a receipt fills the view, sharp and
// held still for about half a second, takes the photo itself and sends it
// to the same upload the file input uses, like a QR scanner. A "Take photo
// now" button is always there for a receipt the check doesn't like. Without
// a camera (or this script) the page is the plain upload form.
//
// On a server with no vision model the form is marked data-receipt-device:
// the photo, from the camera or the file input, is read on this device by
// receipt-ocr-worker.mjs, and only the printed lines are posted.
import "./scan.mjs";
import { CROP, grey, motion, receiptLayout, sharpness, SIZE, watcher } from "./receipt-frame.mjs";

const root = document.querySelector("[data-receipt-camera]");
const device = root?.closest("form")?.hasAttribute("data-receipt-device") ? onDevice(root.closest("form")) : null;
if (root && navigator.mediaDevices?.getUserMedia) start();

// Reading on this device: the worker starts downloading the reader as soon
// as the page opens, so it's usually ready by the time the photo is taken.
// `read(blob)` reads a photo and posts its lines through the form.
function onDevice(form) {
  const file = form.querySelector("[data-receipt-file]");
  const go = form.querySelector("[data-receipt-read]");
  const box = form.querySelector("[data-receipt-progress]");
  const label = form.querySelector("[data-receipt-label]");
  const bar = form.querySelector("[data-receipt-bar]");
  const holder = form.querySelector("[data-receipt-lines]");
  const say = (text, pct) => {
    box.hidden = false;
    label.textContent = text;
    if (pct === null) bar.removeAttribute("value");
    else bar.value = pct;
  };
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined" || typeof OffscreenCanvas === "undefined") {
    say("This browser can't read receipts. Try a recent Chrome, Edge, Safari or Firefox, or use the barcode scanner.", 0);
    file.disabled = true;
    return null;
  }
  let worker = null;
  let ready = null;
  let downloading = false;
  let busy = false;
  const pending = new Map();
  function load() {
    if (ready) return ready;
    worker = new Worker("/assets/receipt-ocr-worker.mjs", { type: "module" });
    ready = new Promise((resolve, reject) => {
      worker.addEventListener("message", (e) => {
        const m = e.data;
        if (m.type === "download") {
          downloading = m.loaded < m.total;
          if (busy && m.total) say(`Downloading the reader: ${(m.loaded / 1e6).toFixed(1)} of ${(m.total / 1e6).toFixed(1)} MB. This only happens once.`, (m.loaded / m.total) * 100);
        } else if (m.type === "ready") {
          downloading = false;
          resolve();
        } else if (m.type === "progress") {
          if (busy) say(`Reading your receipt: ${m.done} of ${m.total} lines.`, (m.done / m.total) * 100);
        } else if (m.type === "result") pending.get(m.id)?.resolve(m);
        else if (m.type === "error") {
          for (const p of pending.values()) p.reject(new Error(m.message));
          pending.clear();
          reject(new Error(m.message));
        }
      });
    });
    // a failed start can be tried again from scratch
    ready.catch(() => {
      worker?.terminate();
      ready = null;
    });
    worker.postMessage({ type: "load" });
    return ready;
  }
  // start now, quietly: the download runs while the person lines up the
  // shot. Not on a metered or slow connection the browser tells us about:
  // there it waits until a photo is taken or chosen.
  const net = navigator.connection;
  if (!net?.saveData && !/2g/.test(net?.effectiveType ?? "")) load().catch(() => {});

  let next = 0;
  async function read(blob) {
    if (busy) return;
    busy = true;
    go.disabled = true;
    file.disabled = true;
    form.classList.remove("is-camera");
    say(downloading ? "Downloading the reader…" : "Starting the reader…", null);
    box.scrollIntoView({ block: "center", behavior: "smooth" });
    const started = performance.now();
    try {
      await load();
      const id = ++next;
      say("Reading your receipt…", null);
      const result = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: "read", id, blob });
      });
      pending.delete(id);
      say("Done. Opening the review…", 100);
      holder.replaceChildren(...result.lines.map((l) => Object.assign(document.createElement("input"), { type: "hidden", name: "line", value: l })));
      form.querySelector("[data-receipt-seconds]").value = String(Math.round((performance.now() - started) / 1000));
      form.submit();
    } catch (err) {
      say(`The receipt couldn't be read: ${err.message}. Try again, or use the barcode scanner or the add form.`, 0);
      busy = false;
      file.disabled = false;
      go.disabled = !file.files?.length;
    }
  }
  file.addEventListener("change", () => (go.disabled = !file.files?.length));
  go.addEventListener("click", (e) => {
    e.preventDefault();
    const f = file.files?.[0];
    if (f) read(f);
  });
  return { read };
}

function start() {
  const form = root.closest("form");
  const startBtn = form.querySelector("[data-receipt-start]");
  const startNote = form.querySelector("[data-receipt-start-note]");
  const video = root.querySelector("[data-receipt-video]");
  const hint = root.querySelector("[data-receipt-hint]");
  const hold = root.querySelector("[data-receipt-hold]");
  const shoot = root.querySelector("[data-receipt-shoot]");
  const close = root.querySelector("[data-receipt-close]");
  const submit = form.querySelector("[data-scan-submit]");
  startBtn.hidden = false;
  startNote.hidden = false;

  const small = document.createElement("canvas");
  const smallCtx = small.getContext("2d", { willReadFrequently: true });
  const crop = document.createElement("canvas");
  crop.width = crop.height = CROP;
  const cropCtx = crop.getContext("2d", { willReadFrequently: true });
  let stream = null;
  let timer = null;
  let prev = null;
  let sent = false;
  const watch = watcher(4);

  function stop() {
    clearTimeout(timer);
    timer = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function closeCamera() {
    stop();
    root.hidden = true;
    form.classList.remove("is-camera");
  }

  // one look at the current frame; scheduled, not on every animation frame,
  // so a slow phone spends its time on the camera preview, not on this
  function look() {
    if (!stream || sent) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
      const scale = SIZE / Math.max(vw, vh);
      const w = Math.round(vw * scale), h = Math.round(vh * scale);
      if (small.width !== w || small.height !== h) {
        small.width = w;
        small.height = h;
      }
      smallCtx.drawImage(video, 0, 0, w, h);
      const rgba = smallCtx.getImageData(0, 0, w, h).data;
      cropCtx.drawImage(video, Math.round((vw - CROP) / 2), Math.round((vh - CROP) / 2), CROP, CROP, 0, 0, CROP, CROP);
      const g = grey(rgba);
      const r = watch.feed({
        layout: receiptLayout(rgba, w, h),
        sharp: sharpness(grey(cropCtx.getImageData(0, 0, CROP, CROP).data), CROP, CROP),
        moved: motion(prev, g),
      });
      prev = g;
      hold.style.strokeDashoffset = String(100 - r.progress * 100);
      root.classList.toggle("is-ready", r.progress > 0);
      if (r.capture) return capture(true);
      if (hint.textContent !== r.hint) hint.textContent = r.hint;
    }
    timer = setTimeout(look, 150);
  }

  async function capture(auto) {
    if (sent || !video.videoWidth) return;
    sent = true;
    clearTimeout(timer);
    navigator.vibrate?.(60);
    root.classList.add("is-taken");
    hint.textContent = auto ? "Got it. Sending your receipt…" : "Sending your receipt…";
    shoot.disabled = true;
    const full = document.createElement("canvas");
    // at most 2000 px on the long side: plenty for the model, under the
    // upload limit, and quick to send on mobile data
    const scale = Math.min(1, 2000 / Math.max(video.videoWidth, video.videoHeight));
    full.width = Math.round(video.videoWidth * scale);
    full.height = Math.round(video.videoHeight * scale);
    full.getContext("2d").drawImage(video, 0, 0, full.width, full.height);
    stop();
    const blob = await new Promise((res) => full.toBlob(res, "image/jpeg", 0.9));
    // read here, on this device, when there's no server model
    if (device) {
      root.hidden = true;
      return device.read(blob);
    }
    // through the form itself, as if the photo had been chosen: the browser
    // follows the redirect to the job's progress page, or shows the
    // server's reason if the photo is refused
    const files = new DataTransfer();
    files.items.add(new File([blob], "receipt.jpg", { type: "image/jpeg" }));
    form.querySelector("input[type=file]").files = files.files;
    form.requestSubmit(submit);
  }

  async function openCamera() {
    startBtn.disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (err) {
      startBtn.disabled = false;
      startNote.hidden = false;
      startNote.textContent = err?.name === "NotAllowedError"
        ? "The camera wasn't allowed. Choose a photo below instead."
        : "No camera could be opened. Choose a photo below instead.";
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    startBtn.disabled = false;
    root.hidden = false;
    form.classList.add("is-camera");
    prev = null;
    watch.reset();
    hint.textContent = "Fill the frame with the receipt, flat and in good light.";
    form.scrollIntoView({ block: "start", behavior: "smooth" });
    look();
  }

  startBtn.addEventListener("click", openCamera);
  shoot.addEventListener("click", () => capture(false));
  close.addEventListener("click", closeCamera);
  // the camera light goes off when the page is left or hidden
  addEventListener("pagehide", stop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && stream) closeCamera();
  });
}
