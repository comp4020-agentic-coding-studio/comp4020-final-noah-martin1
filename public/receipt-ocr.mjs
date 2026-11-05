// Reading the printed text off a receipt photo, in the browser, with
// PaddleOCR's PP-OCRv4 models (about 15 MB) on onnxruntime-web. A text
// detector marks where the print is; each marked line is cut out, levelled
// and read by a recogniser. No vision model is involved: the output is the
// receipt's own text, line by line, which the server then parses
// (src/receipt-text.ts). The same file runs in node for testing
// (scripts/eval-receipt-ocr.ts), handed node's onnxruntime instead.
//
// The geometry PaddleOCR's own JavaScript port does with OpenCV is done
// here in plain code: the text mask's connected regions, each region's
// smallest rotated rectangle, grown by the usual "unclip" margin, and a
// bilinear crop of that rectangle from the photo.

// the detector sees the photo at most this big on its long side
export const DET_MAX = 1280;
// the recogniser reads lines scaled to this height
const REC_HEIGHT = 48;
// longest line crop handed to the recogniser, in pixels at REC_HEIGHT
const REC_MAX_WIDTH = 1600;

/**
 * @typedef {{ data: Uint8ClampedArray | Uint8Array, width: number, height: number }} Rgba
 * @typedef {{ text: string, score: number, box: number[][] }} TextBox
 */

// Bilinear resize of an RGBA image.
/** @param {Rgba} img @param {number} W @param {number} H @returns {Rgba} */
export function resize(img, W, H) {
  const { data, width: w, height: h } = img;
  const out = new Uint8ClampedArray(W * H * 4);
  const sx = w / W, sy = h / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        out[o + k] = (data[a + k] * (1 - tx) + data[b + k] * tx) * (1 - ty) + (data[c + k] * (1 - tx) + data[d + k] * tx) * ty;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

// The models take planar BGR floats in 0–1 (the settings PaddleOCR's own
// JavaScript port found most accurate for these exported models).
/** @param {Rgba} img */
function toTensorData(img) {
  const n = img.width * img.height;
  const out = new Float32Array(n * 3);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = img.data[p + 2] / 255;
    out[n + i] = img.data[p + 1] / 255;
    out[2 * n + i] = img.data[p] / 255;
  }
  return out;
}

// Connected regions of the text mask (8-neighbour), as pixel lists.
/** @param {Uint8Array} mask @param {number} w @param {number} h */
export function regions(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const xs = [], ys = [];
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      xs.push(x);
      ys.push(y);
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    out.push({ xs, ys });
  }
  return out;
}

// Convex hull (monotone chain) of a region's boundary pixels' corners.
/** @param {number[][]} pts */
function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Smallest-area rectangle around a convex polygon (rotating calipers over
// its edges): centre, half sizes along/across, and the long side's angle.
/** @param {number[][]} poly */
export function minAreaRect(poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!len) continue;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of poly) {
      const u = x * ux + y * uy, v = -x * uy + y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uy, minU, maxU, minV, maxV };
  }
  if (!best) return null;
  let { ux, uy, minU, maxU, minV, maxV } = best;
  // keep the long side as "along", pointing left to right
  if (maxV - minV > maxU - minU) {
    [ux, uy] = [-uy, ux];
    [minU, maxU, minV, maxV] = [minV, maxV, -maxU, -minU];
  }
  if (ux < 0) {
    ux = -ux;
    uy = -uy;
    [minU, maxU, minV, maxV] = [-maxU, -minU, -maxV, -minV];
  }
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  return {
    cx: cu * ux - cv * uy,
    cy: cu * uy + cv * ux,
    halfW: (maxU - minU) / 2,
    halfH: (maxV - minV) / 2,
    ux,
    uy,
  };
}

// A region's box, grown the way PaddleOCR's DB post-process does (offset
// by area × 1.5 / perimeter), in detector pixels.
/** @param {{ xs: number[], ys: number[] }} r */
function boxOf(r) {
  // each pixel's four corners, so a one-pixel-thick region has an area
  const pts = [];
  const seen = new Set();
  for (let i = 0; i < r.xs.length; i++) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const k = (r.ys[i] + dy) * 65536 + r.xs[i] + dx;
      if (!seen.has(k)) {
        seen.add(k);
        pts.push([r.xs[i] + dx, r.ys[i] + dy]);
      }
    }
  }
  const rect = minAreaRect(hull(pts));
  if (!rect || Math.min(rect.halfW, rect.halfH) * 2 < 3) return null;
  const w = rect.halfW * 2, h = rect.halfH * 2;
  const grow = (w * h * 1.5) / (2 * (w + h));
  return { ...rect, halfW: rect.halfW + grow, halfH: rect.halfH + grow };
}

// The rotated rectangle cut out of the photo and laid flat, scaled to the
// recogniser's line height.
/** @param {Rgba} img @param {{ cx: number, cy: number, halfW: number, halfH: number, ux: number, uy: number }} b */
function cropLine(img, b) {
  const scale = REC_HEIGHT / (b.halfH * 2);
  const W = Math.max(8, Math.min(REC_MAX_WIDTH, Math.round(b.halfW * 2 * scale)));
  const H = REC_HEIGHT;
  const out = new Uint8ClampedArray(W * H * 4);
  const { data, width: w, height: h } = img;
  for (let y = 0; y < H; y++) {
    const v = ((y + 0.5) / H - 0.5) * b.halfH * 2;
    for (let x = 0; x < W; x++) {
      const u = ((x + 0.5) / W - 0.5) * b.halfW * 2;
      const fx = Math.min(w - 1, Math.max(0, b.cx + u * b.ux - v * b.uy - 0.5));
      const fy = Math.min(h - 1, Math.max(0, b.cy + u * b.uy + v * b.ux - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const a = (y0 * w + x0) * 4, bb = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) out[o + k] = (data[a + k] * (1 - tx) + data[bb + k] * tx) * (1 - ty) + (data[c + k] * (1 - tx) + data[d + k] * tx) * ty;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

// Greedy CTC decoding: the best character per step, repeats and blanks
// dropped; the score is the mean of the kept characters' probabilities.
/** @param {Float32Array} probs @param {number} steps @param {number} classes @param {string[]} dict */
export function decode(probs, steps, classes, dict) {
  let text = "", sum = 0, n = 0, prev = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0, bestP = -Infinity;
    for (let c = 0; c < classes; c++) {
      const p = probs[t * classes + c];
      if (p > bestP) {
        bestP = p;
        best = c;
      }
    }
    if (best !== 0 && best !== prev) {
      text += dict[best - 1] ?? "";
      sum += bestP;
      n++;
    }
    prev = best;
  }
  return { text, score: n ? sum / n : 0 };
}

// Pieces of text on the same printed line joined left to right: a receipt's
// name and its price are usually two pieces with a gap between. On curled
// or tilted paper a line isn't level, so each piece is followed along its
// own slope: the next piece to its right belongs to the same line when it
// sits where that slope leads, within half a line's height. A piece joins
// at most one line, the nearest.
/** @param {TextBox[]} boxes */
export function toLines(boxes) {
  const items = boxes.map((b) => {
    const [tl, tr, br, bl] = b.box;
    const left = [(tl[0] + bl[0]) / 2, (tl[1] + bl[1]) / 2];
    const right = [(tr[0] + br[0]) / 2, (tr[1] + br[1]) / 2];
    const h = (Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) + Math.hypot(br[0] - tr[0], br[1] - tr[1])) / 2;
    const slope = right[0] > left[0] ? (right[1] - left[1]) / (right[0] - left[0]) : 0;
    return { text: b.text, left, right, h, slope, next: -1, taken: false };
  });
  // each piece's nearest follower on its line
  for (const [i, a] of items.entries()) {
    let best = -1, bestGap = Infinity;
    for (const [j, b] of items.entries()) {
      if (i === j || b.left[0] < a.right[0] - a.h) continue;
      const gap = b.left[0] - a.right[0];
      // where a's line, carried on at its slope, is at b's left edge
      const expect = a.right[1] + a.slope * gap;
      if (Math.abs(b.left[1] - expect) > Math.min(a.h, b.h) * 0.5) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = j;
      }
    }
    a.next = best;
  }
  // two pieces both pointing at one follower: the closer keeps it
  const claim = new Map();
  for (const [i, a] of items.entries()) {
    if (a.next < 0) continue;
    const other = claim.get(a.next);
    const gap = (k) => items[a.next].left[0] - items[k].right[0];
    if (other === undefined || gap(i) < gap(other)) claim.set(a.next, i);
  }
  for (const [i, a] of items.entries()) if (a.next >= 0 && claim.get(a.next) !== i) a.next = -1;
  const hasPrev = new Set(items.map((a) => a.next).filter((n) => n >= 0));
  const lines = [];
  for (const [i, a] of items.entries()) {
    if (hasPrev.has(i)) continue;
    const parts = [];
    for (let k = i, guard = 0; k >= 0 && guard < items.length; k = items[k].next, guard++) parts.push(items[k]);
    lines.push({ y: a.left[1], text: parts.map((p) => p.text).join("  ") });
  }
  return lines.sort((a, b) => a.y - b.y).map((l) => l.text);
}

/**
 * Loads the two models; `ort` is onnxruntime (web in the browser, node in
 * tests) and `fetchBytes` returns a file's bytes, so either side can supply
 * its own download and cache.
 * @param {any} ort
 * @param {{ det: Uint8Array, rec: Uint8Array, dict: string }} files
 */
export async function createReader(ort, files) {
  const det = await ort.InferenceSession.create(files.det);
  const rec = await ort.InferenceSession.create(files.rec);
  const dict = [...files.dict.split("\n"), " "];

  /** @param {Rgba} photo @param {(done: number, total: number) => void} [onLine] */
  async function read(photo, onLine) {
    // detector input: the photo at most DET_MAX on its long side, rounded up
    // to multiples of 32 as the model requires
    const s = Math.min(1, DET_MAX / Math.max(photo.width, photo.height));
    const W = Math.max(32, Math.ceil((photo.width * s) / 32) * 32);
    const H = Math.max(32, Math.ceil((photo.height * s) / 32) * 32);
    const small = resize(photo, W, H);
    const out = await det.run({ [det.inputNames[0]]: new ort.Tensor("float32", toTensorData(small), [1, 3, H, W]) });
    const prob = out[det.outputNames[0]].data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < mask.length; i++) mask[i] = prob[i] > 0.3 ? 1 : 0;
    const rx = photo.width / W, ry = photo.height / H;
    const boxes = [];
    for (const r of regions(mask, W, H)) {
      if (r.xs.length < 6) continue;
      const b = boxOf(r);
      if (!b) continue;
      // back to photo pixels (the photo may be bigger than the detector's view)
      boxes.push({ cx: b.cx * rx, cy: b.cy * ry, halfW: b.halfW * Math.hypot(b.ux * rx, b.uy * ry), halfH: b.halfH * Math.hypot(b.uy * rx, b.ux * ry), ux: b.ux, uy: b.uy });
    }
    /** @type {TextBox[]} */
    const texts = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.halfW * 2 < 4 || b.halfH * 2 < 4) continue;
      const line = cropLine(photo, b);
      const o = await rec.run({ [rec.inputNames[0]]: new ort.Tensor("float32", toTensorData(line), [1, 3, line.height, line.width]) });
      const t = o[rec.outputNames[0]];
      const { text, score } = decode(t.data, t.dims[1], t.dims[2], dict);
      if (text.trim() && score >= 0.5) {
        const corner = (su, sv) => [b.cx + su * b.halfW * b.ux - sv * b.halfH * b.uy, b.cy + su * b.halfW * b.uy + sv * b.halfH * b.ux];
        texts.push({ text, score, box: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] });
      }
      onLine?.(i + 1, boxes.length);
    }
    return { lines: toLines(texts), boxes: texts };
  }

  return { read };
}
