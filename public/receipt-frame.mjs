// Deciding, frame by frame, whether the camera is looking at a receipt that
// is sharp and held still, so the receipt page can take the photo itself the
// way a QR scanner does. Plain pixel arithmetic on a small copy of the
// frame, about a millisecond; the same file is measured in node against real
// receipts and fridge photos (scripts/eval-receipt-camera.ts).

// long side of the analysed copy of the frame, in pixels
export const SIZE = 320;
// side of the full-resolution centre crop sharpness is judged on
export const CROP = 256;

/** @param {Uint8ClampedArray | Uint8Array} rgba */
export function grey(rgba) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return out;
}

// Mean brightness of the (2r+1)² box around each pixel, from an integral
// image, so "darker than its surroundings" works under uneven light.
/** @param {Uint8Array} g @param {number} w @param {number} h @param {number} r */
function boxMean(g, w, h, r) {
  const W = w + 1;
  const sat = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = (sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0]) / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

// tilts tried when looking for printed lines: a receipt held within about
// ±10° of level
const ANGLES = [-0.18, -0.12, -0.06, 0, 0.06, 0.12, 0.18];

/** @param {Float64Array} prof @param {number} win */
function lessBaseline(prof, win) {
  // what a straight edge or the sheet's border adds to every row is taken
  // off, leaving the rows of print standing above it
  const out = new Float64Array(prof.length);
  for (let i = 0; i < prof.length; i++) {
    let lo = Infinity;
    for (let j = Math.max(0, i - win); j <= Math.min(prof.length - 1, i + win); j++) lo = Math.min(lo, prof[j]);
    out[i] = prof[i] - lo;
  }
  return out;
}

/**
 * Is a receipt filling the frame? Not a receipt classifier (the person is
 * already pointing at one) but a framing check: a large light, colourless
 * sheet, with dark colourless marks on it in many evenly spaced rows (found
 * at the tilt that lines them up best). A bare bench, the floor while the
 * phone is being raised, or a receipt too far away to read all fail it.
 * @param {Uint8ClampedArray | Uint8Array} rgba small copy, w × h
 * @param {number} w
 * @param {number} h
 */
export function receiptLayout(rgba, w, h) {
  const g = grey(rgba);
  const n = w * h;
  const local = boxMean(g, w, h, Math.max(4, Math.round(Math.max(w, h) / 40)));
  let paperN = 0, inkN = 0, inkGrey = 0;
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const m = local[i];
    if (m < 105) continue;
    const c = Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) - Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    // a coloured patch that isn't darker than its surroundings is
    // something else in the light (a bench, a label), not paper
    if (c > 40 && g[i] >= m - 10) continue;
    paperN++;
    if (g[i] < m - Math.max(16, m * 0.15)) {
      ink[i] = 1;
      inkN++;
      if (c < 45) inkGrey++;
    }
  }
  const paperShare = paperN / n;
  const inkGreyShare = inkN ? inkGrey / inkN : 0;
  const inkDensity = paperN ? inkN / paperN : 0;
  // lines: the projection of ink onto rows, at the tilt that makes it most
  // uneven (rows of print with blank gaps between)
  let best = { score: -1, lines: 0, regular: 0 };
  const off = Math.ceil(w * 0.2);
  const rows = h + off * 2;
  for (const a of ANGLES) {
    const raw = new Float64Array(rows);
    const t = Math.tan(a);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink[y * w + x]) raw[Math.round(y + x * t) + off]++;
    const prof = lessBaseline(raw, 6);
    let mean = 0;
    for (const v of prof) mean += v;
    mean /= rows;
    let score = 0;
    for (const v of prof) score += (v - mean) ** 2;
    if (score <= best.score) continue;
    const lit = [...prof].filter((v) => v > 0).sort((p, q) => p - q);
    const cut = Math.max(2, (lit[Math.floor(lit.length * 0.75)] ?? 0) * 0.35);
    const heights = [];
    let run = 0;
    for (const v of prof) {
      if (v >= cut) run++;
      else if (run) {
        heights.push(run);
        run = 0;
      }
    }
    if (run) heights.push(run);
    const tall = heights.filter((x) => x >= 2);
    const med = tall.length ? [...tall].sort((p, q) => p - q)[Math.floor(tall.length / 2)] : 0;
    const regular = tall.length ? tall.filter((x) => x <= med * 2.2).length / tall.length : 0;
    best = { score, lines: tall.length, regular };
  }
  return {
    paperShare,
    inkGreyShare,
    inkDensity,
    lines: best.lines,
    regular: best.regular,
    ok: paperShare >= 0.25 && inkGreyShare >= 0.75 && inkDensity >= 0.02 && inkDensity <= 0.35 && best.lines >= 8 && best.regular >= 0.7,
  };
}

/**
 * How sharp a full-resolution greyscale crop is, 0 (smeared) to 1 (crisp):
 * blur it, and see how much of the detail between neighbouring pixels the
 * blur takes away. An image that is already blurred loses little. (Crété et
 * al., "The blur effect", 2007.) Judged on the full-resolution crop because
 * that is what the model will read.
 * @param {Uint8Array} g greyscale, w × h
 * @param {number} w
 * @param {number} h
 */
export function sharpness(g, w, h) {
  const k = 4; // the blur: a 9-pixel line average
  let worst = 0;
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    let total = 0, lost = 0;
    for (let y = k + 1; y < h - k; y++) {
      for (let x = k + 1; x < w - k; x++) {
        const i = y * w + x;
        const step = dx + dy * w;
        const d = Math.abs(g[i] - g[i - step]);
        let b0 = 0, b1 = 0;
        for (let j = -k; j <= k; j++) {
          b0 += g[i + j * step];
          b1 += g[i - step + j * step];
        }
        const db = Math.abs(b0 - b1) / (2 * k + 1);
        total += d;
        lost += Math.max(0, d - db);
      }
    }
    if (total < (w * h) / 2) return 0; // a blank crop: nothing to judge
    worst = Math.max(worst, 1 - lost / total);
  }
  return 1 - worst;
}

// How much the picture moved since the last analysed frame: mean absolute
// difference of the small copies, 0–255.
/** @param {Uint8Array | null} a @param {Uint8Array | null} b */
export function motion(a, b) {
  if (!a || !b || a.length !== b.length) return 255;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

// sharp receipt frames measured 0.71–0.89, blurred or shaken ones 0.00–0.53
export const SHARP_ENOUGH = 0.6;
// a 2–4 px handheld tremble at 720p reads 5–9; a pan or wobble reads 15–35
export const STILL_ENOUGH = 10;

/**
 * Turns per-frame readings into a decision: capture once the receipt has
 * been in view, sharp and still, for `hold` frames in a row. Any bad frame
 * restarts the count, so a passing glimpse never fires it.
 * @param {number} hold
 */
export function watcher(hold = 4) {
  let streak = 0;
  return {
    /** @param {{ layout: { ok: boolean }, sharp: number, moved: number }} f */
    feed(f) {
      const ready = f.layout.ok && f.sharp >= SHARP_ENOUGH && f.moved <= STILL_ENOUGH;
      streak = ready ? streak + 1 : 0;
      const hint = !f.layout.ok
        ? "Fill the frame with the receipt, flat and in good light."
        : f.moved > STILL_ENOUGH || f.sharp >= SHARP_ENOUGH
          ? "Hold still…"
          : "Focusing… move a little closer or into better light.";
      return { capture: streak >= hold, progress: Math.min(1, streak / hold), hint };
    },
    reset() {
      streak = 0;
    },
  };
}
