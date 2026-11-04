// Camera barcode scanning. The browser's own BarcodeDetector where it has
// one (Android Chrome, Safari 17+); elsewhere (desktop Chrome on macOS,
// Firefox) a ZXing build of the same API, loaded only when the camera is
// asked for. Each code read is looked up on the server and added to a
// basket; the basket goes to the usual review form. The typed-number form
// needs no script at all and is always there.

const POLYFILL = "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/es/ponyfill.js";
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

async function detector() {
  if ("BarcodeDetector" in window) {
    const have = await BarcodeDetector.getSupportedFormats().catch(() => []);
    if (FORMATS.some((f) => have.includes(f))) return new BarcodeDetector({ formats: FORMATS });
  }
  const { BarcodeDetector: Ponyfill } = await import(POLYFILL);
  return new Ponyfill({ formats: FORMATS });
}

const root = document.querySelector("[data-barcode]");
if (root) start();

async function start() {
  const q = (s) => root.querySelector(s);
  const startBtn = q("[data-barcode-start]");
  const camera = q("[data-barcode-camera]");
  const video = q("[data-barcode-video]");
  const status = q("[data-barcode-status]");
  const basket = q("[data-barcode-basket]");
  const list = q("[data-barcode-list]");
  const codes = q("[data-barcode-codes]");

  // a camera is all that's needed now; the decoder comes with it
  if (!navigator.mediaDevices?.getUserMedia) return;
  startBtn.hidden = false;

  const seen = new Set();
  let stream = null;
  let timer = null;

  function add(code, label, found) {
    const li = document.createElement("li");
    li.className = found ? "" : "muted";
    li.textContent = label;
    list.append(li);
    if (found) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "code";
      input.value = code;
      codes.append(input);
    }
    basket.hidden = false;
  }

  async function lookup(code) {
    status.textContent = `Looking up ${code}…`;
    try {
      const res = await fetch(`/pantry/scan/barcode/lookup?code=${encodeURIComponent(code)}`, { headers: { accept: "application/json" } });
      const body = await res.json();
      if (!res.ok) {
        status.textContent = body.error ?? "That barcode couldn't be looked up.";
        seen.delete(code);
        return;
      }
      if (body.found) {
        const p = body.product;
        add(code, `${p.name}${p.quantity ? ` · ${p.quantity} ${p.unit}` : ""}`, true);
        status.textContent = `Added ${p.name}. Scan the next one.`;
      } else {
        add(code, `${code}: not in the database; add it by hand on the next page`, false);
        status.textContent = "Not found. Scan the next one, or add that item by hand.";
      }
    } catch {
      status.textContent = "Can't reach Larder right now. Try that barcode again.";
      seen.delete(code);
    }
  }

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    let reader;
    try {
      [stream, reader] = await Promise.all([navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }), detector()]);
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      status.textContent = err?.name === "NotAllowedError" || err?.name === "NotFoundError"
        ? "The camera couldn't be opened. Type the number below instead."
        : "The barcode reader couldn't load. Type the number below instead.";
      camera.hidden = false;
      video.hidden = true;
      startBtn.disabled = false;
      return;
    }
    video.srcObject = stream;
    await video.play();
    camera.hidden = false;
    startBtn.hidden = true;
    let busy = false;
    timer = setInterval(async () => {
      // one frame at a time: the WebAssembly reader is slower than native
      if (video.readyState < 2 || busy) return;
      busy = true;
      const found = await reader.detect(video).catch(() => []);
      busy = false;
      for (const b of found) {
        const code = b.rawValue.replace(/\D/g, "");
        if (!code || seen.has(code)) continue;
        seen.add(code);
        navigator.vibrate?.(40);
        lookup(code);
      }
    }, 300);
  });

  // stop the camera when the page goes away
  addEventListener("pagehide", () => {
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
  });
}
