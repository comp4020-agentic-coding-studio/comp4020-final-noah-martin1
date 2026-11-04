import { describe, expect, it } from "vitest";
import { motion, receiptLayout, sharpness, watcher } from "../public/receipt-frame.mjs";

// Synthetic frames: a light sheet with rows of short dark marks is what a
// receipt looks like to the check; the real-photo measurements are in
// scripts/eval-receipt-camera.ts and testing/results.md.
const W = 180, H = 320;

function frame(paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = paint(x, y);
      out.set([r, g, b, 255], (y * W + x) * 4);
    }
  }
  return out;
}

// rows of "letters" (3 px marks with 2 px gaps) every 12 px, on paper that
// fills the frame, optionally tilted
const receipt = (tilt = 0) =>
  frame((x, y) => {
    const yy = y - x * tilt;
    const inRow = ((yy % 12) + 12) % 12 < 4 && x > 15 && x < W - 15;
    const glyph = x % 5 < 3 && (x * 7 + Math.floor(yy / 12) * 13) % 23 > 4;
    return inRow && glyph ? [40, 40, 40] : [235, 233, 228];
  });

describe("framing a receipt for the camera", () => {
  it("passes a sheet of printed rows, level or tilted", () => {
    expect(receiptLayout(receipt(), W, H).ok).toBe(true);
    expect(receiptLayout(receipt(0.1), W, H).ok).toBe(true);
  });

  it("fails a bare bench, a blank sheet, and colourful clutter", () => {
    expect(receiptLayout(frame(() => [90, 62, 43]), W, H).ok).toBe(false);
    expect(receiptLayout(frame(() => [235, 233, 228]), W, H).ok).toBe(false);
    // bright coloured packets in rows, like a pantry shelf
    const shelf = frame((x, y) => ((y % 12) < 4 && x % 5 < 3 ? [200, 30, 40] : [240, 220, 120]));
    expect(receiptLayout(shelf, W, H).ok).toBe(false);
  });

  it("scores a blurred crop well below a crisp one", () => {
    const S = 128;
    // irregular light and dark blocks (a periodic pattern would be averaged
    // flat by the check's own blur, crisp or not)
    const crisp = new Uint8Array(S * S);
    let seed = 7;
    const cells = Array.from({ length: 16 * 16 }, () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % 2 ? 30 : 230));
    for (let i = 0; i < crisp.length; i++) crisp[i] = cells[Math.floor(Math.floor(i / S) / 8) * 16 + Math.floor((i % S) / 8)];
    const blurred = new Uint8Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let sum = 0, n = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const yy = Math.min(S - 1, Math.max(0, y + dy)), xx = Math.min(S - 1, Math.max(0, x + dx));
          sum += crisp[yy * S + xx];
          n++;
        }
        blurred[y * S + x] = sum / n;
      }
    }
    expect(sharpness(crisp, S, S)).toBeGreaterThan(0.5);
    expect(sharpness(blurred, S, S)).toBeLessThan(0.5);
    // nothing to judge on a blank crop
    expect(sharpness(new Uint8Array(S * S).fill(200), S, S)).toBe(0);
  });

  it("measures movement between frames", () => {
    const a = new Uint8Array(100).fill(100);
    expect(motion(a, a)).toBe(0);
    expect(motion(a, new Uint8Array(100).fill(130))).toBe(30);
    // the first frame has nothing to compare with: treated as moving
    expect(motion(null, a)).toBe(255);
  });

  it("captures only after the receipt has been sharp and still for several frames in a row", () => {
    const w = watcher(4);
    const good = { layout: { ok: true }, sharp: 0.8, moved: 1 };
    expect(w.feed(good).capture).toBe(false);
    expect(w.feed(good).capture).toBe(false);
    // a wobble starts the count again
    expect(w.feed({ ...good, moved: 30 })).toMatchObject({ capture: false, progress: 0, hint: "Hold still…" });
    for (let i = 0; i < 3; i++) expect(w.feed(good).capture).toBe(false);
    expect(w.feed(good)).toMatchObject({ capture: true, progress: 1 });
  });

  it("says what's wrong while it waits", () => {
    const w = watcher(4);
    expect(w.feed({ layout: { ok: false }, sharp: 0.8, moved: 0 }).hint).toMatch(/Fill the frame/);
    expect(w.feed({ layout: { ok: true }, sharp: 0.2, moved: 0 }).hint).toMatch(/Focusing/);
  });
});
