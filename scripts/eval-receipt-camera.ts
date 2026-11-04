// Measures the receipt camera's auto-capture check (public/receipt-frame.mjs)
// on camera-like frames built from the photos in testing/: each real
// receipt laid on three benches (dark wood, grey, white) at three distances,
// level and tilted ~6°, held still and shaken; the twelve fridge and pantry
// photos and the bare benches as frames that shouldn't fire. Then a clip of
// a receipt sliding in, wobbling and settling, to time the capture.
//
//   node scripts/eval-receipt-camera.ts      (needs ffmpeg)
//
// Writes testing/receipt-camera/results.json; testing/results.md reports it.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CROP, grey, motion, receiptLayout, SHARP_ENOUGH, sharpness, SIZE, watcher } from "../public/receipt-frame.mjs";

const W = 720, H = 1280; // a phone camera's portrait frame
const sw = Math.round((SIZE * W) / H), sh = SIZE;
const work = mkdtempSync(join(tmpdir(), "receipt-camera-"));
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const pixels = (file: string, vf: string, fmt: string) =>
  new Uint8Array(execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-vf", vf, "-f", "rawvideo", "-pix_fmt", fmt, "-"], { maxBuffer: 1 << 26 }));

const benches = { wood: "0x5a3e2b", grey: "0x8a8a88", white: "0xd8d8d4" };
for (const [name, colour] of Object.entries(benches)) {
  ff("-f", "lavfi", "-i", `color=c=${colour}:s=${W}x${H},noise=alls=20:allf=t`, "-frames:v", "1", join(work, `bench-${name}.png`));
}

interface Frame { file: string; kind: "receipt" | "blurred" | "not a receipt"; label: string }
const frames: Frame[] = [];
const receipts = readdirSync("testing/receipt-scan").filter((f) => f.endsWith(".jpg")).sort();
for (const r of receipts) {
  const src = join("testing/receipt-scan", r);
  for (const bench of Object.keys(benches)) {
    for (const height of [1180, 950, 700]) {
      for (const tilt of [0, 0.1]) {
        const out = join(work, `${r}-${bench}-${height}-${tilt}.png`);
        ff("-i", join(work, `bench-${bench}.png`), "-i", src, "-filter_complex",
          `[1]scale=-1:${height},format=rgba,rotate=angle=${tilt}:fillcolor=none:out_w=rotw(${tilt}):out_h=roth(${tilt})[f];[0][f]overlay=x=(W-w)/2:y=(H-h)/2`,
          "-frames:v", "1", out);
        frames.push({ file: out, kind: "receipt", label: `${r} on ${bench}, ${Math.round((height / H) * 100)}% of the frame${tilt ? ", tilted" : ""}` });
      }
    }
  }
  const still = join(work, `${r}-wood-950-0.png`);
  for (const [name, vf] of [["out of focus", "gblur=sigma=3"], ["shaken", "dblur=angle=90:radius=6"]]) {
    const out = join(work, `${r}-${name}.png`);
    ff("-i", still, "-vf", vf, out);
    frames.push({ file: out, kind: "blurred", label: `${r}, ${name}` });
  }
}
for (const p of readdirSync("testing/fridge-scan").filter((f) => f.endsWith(".jpg")).sort()) {
  const out = join(work, `neg-${p}.png`);
  ff("-i", join("testing/fridge-scan", p), "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, out);
  frames.push({ file: out, kind: "not a receipt", label: p });
}
for (const bench of Object.keys(benches)) frames.push({ file: join(work, `bench-${bench}.png`), kind: "not a receipt", label: `bare ${bench} bench` });

// the check as the page runs it: framing on the small copy, focus on the
// centre crop at full resolution
let ms = 0;
const scored = frames.map((f) => {
  const small = pixels(f.file, `scale=${sw}:${sh}:flags=area`, "rgba");
  const crop = pixels(f.file, `crop=${CROP}:${CROP}`, "gray");
  const t = performance.now();
  const layout = receiptLayout(small, sw, sh);
  const sharp = sharpness(crop, CROP, CROP);
  ms += performance.now() - t;
  return { ...f, file: undefined, framed: layout.ok, sharp: +sharp.toFixed(2), would_capture: layout.ok && sharp >= SHARP_ENOUGH };
});

const count = (kind: Frame["kind"], key: "framed" | "would_capture") => {
  const of = scored.filter((s) => s.kind === kind);
  return { yes: of.filter((s) => s[key]).length, of: of.length };
};

// the clip: 1 s sliding in from below, 1 s wobbling, 2 s held still, at 10
// frames a second, with fresh sensor noise on every frame
const clip = join(work, "clip");
mkdirSync(clip);
ff("-f", "lavfi", "-i", `color=c=${benches.wood}:s=${W}x${H}:d=4:r=10,noise=alls=12:allf=t+u`, "-i", join("testing/receipt-scan", receipts[0]), "-filter_complex",
  "[1]scale=-1:1180,format=rgba[f];[0][f]overlay=x='(W-w)/2+if(between(t,1,2),18*sin(t*25),0)':y='if(lt(t,1),H-(H-(H-h)/2)*t,(H-h)/2)+if(between(t,1,2),14*cos(t*31),0)',format=rgb24",
  "-r", "10", join(clip, "f%02d.png"));
const watch = watcher(4);
let prev: Uint8Array | null = null;
let capturedAt: number | null = null;
const timeline: string[] = [];
for (const [i, f] of readdirSync(clip).sort().entries()) {
  const small = pixels(join(clip, f), `scale=${sw}:${sh}:flags=area`, "rgba");
  const g = grey(small);
  const r = watch.feed({ layout: receiptLayout(small, sw, sh), sharp: sharpness(pixels(join(clip, f), `crop=${CROP}:${CROP}`, "gray"), CROP, CROP), moved: motion(prev, g) });
  prev = g;
  timeline.push(`${(i / 10).toFixed(1)}s ${r.capture ? "CAPTURE" : r.hint}`);
  if (r.capture) {
    capturedAt = i / 10;
    break;
  }
}

const summary = {
  frames: scored.length,
  ms_per_frame: +(ms / scored.length).toFixed(2),
  receipts_framed: count("receipt", "framed"),
  receipts_would_capture: count("receipt", "would_capture"),
  blurred_would_capture: count("blurred", "would_capture"),
  not_receipts_framed: count("not a receipt", "framed"),
  clip: { settles_at_s: 2.0, captured_at_s: capturedAt, timeline },
  misses: scored.filter((s) => (s.kind === "receipt") !== s.would_capture).map((s) => `${s.kind}: ${s.label} (sharp ${s.sharp}, framed ${s.framed})`),
};
mkdirSync("testing/receipt-camera", { recursive: true });
writeFileSync("testing/receipt-camera/results.json", `${JSON.stringify({ summary, frames: scored }, null, 1)}\n`);
console.log(JSON.stringify(summary, null, 1));
