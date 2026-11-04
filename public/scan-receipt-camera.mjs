// The receipt page's live camera. It looks at a few frames a second (a
// small copy for framing and movement, a full-resolution crop for focus;
// public/receipt-frame.mjs) and, once a receipt fills the view, sharp and
// held still for about half a second, takes the photo itself and sends it
// to the same upload the file input uses, like a QR scanner. A "Take photo
// now" button is always there for a receipt the check doesn't like. Without
// a camera (or this script) the page is the plain upload form.
import "./scan.mjs";
import { CROP, grey, motion, receiptLayout, sharpness, SIZE, watcher } from "./receipt-frame.mjs";

const root = document.querySelector("[data-receipt-camera]");
if (root && navigator.mediaDevices?.getUserMedia) start();

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
