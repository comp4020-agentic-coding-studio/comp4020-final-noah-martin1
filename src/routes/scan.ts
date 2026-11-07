// Adding items from a scan, four ways that all end at the same review form:
//
//   photo     uploaded to the server's vision model, run as a background job
//   device    a small vision model in the person's own browser (WebGPU);
//             the browser posts what it found here for review
//   barcode   the camera or a typed number, looked up in Open Food Facts
//   receipt   uploaded to the server's model, which transcribes each line;
//             or, with no server model (the deployed site), read in the
//             person's own browser by a small text reader (PaddleOCR) that
//             posts the printed lines here. Either way, sizes come from the
//             printed text and lines are checked against the receipt total
//             by the app, not a model
//
// Models only suggest. Nothing is saved until the person ticks a row and
// submits it, and every row is editable. A scan job is its uploader's alone:
// anyone else gets a 404.

import { catalogFor, normaliseIngredient } from "../db.ts";
import { addDays, money, today } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { type Ctx, HttpError, htmlReply, json, redirect, setFlash } from "../http.ts";
import { logActivity } from "../activity.ts";
import { checkImage, readMultipart } from "../images.ts";
import { prefillFor } from "../scan-prefill.ts";
import { catalogueHas, learnedNames, mergeScans, parseScan, rememberCorrection, resolveName, SCAN_PROMPT, scanConfig, spellingCandidates, type Resolved } from "../fridge-scan.ts";
import { aheadOf, createJob, finishReview, jobFor, jobResult, type JobKind, type ResultRow } from "../scan-jobs.ts";
import { barcodeRow, lookupBarcode, LookupUnavailable, validBarcode } from "../barcode.ts";
import { receiptResult } from "../scan-jobs.ts";
import { parseReceiptText } from "../receipt-text.ts";
import { loadProducts } from "../products.ts";
import type { Route } from "../server.ts";
import { errors, icon, page, pageHeader, subnav } from "../views/layout.ts";
import { addPersonalItem, parseItem } from "./pantry.ts";

export interface Suggestion {
  detected: string;
  name: string;
  // "manual": a row the person typed or already checked, so no model badge
  match: Resolved["match"] | "manual";
  confidence: "high" | "medium" | "low";
  quantity: string;
  unit: string;
  expiry_days: number | null;
  // what the person typed, carried back when a save is refused
  expiry_date?: string;
  price?: string;
  keep?: boolean;
  // the printed receipt line or the barcode product, shown for checking
  source?: string;
  // where prefilled size, price and expiry came from
  suggested?: string;
}

// Each row arrives as complete as the app can make it: what the scan read
// (a receipt's price and size, a barcode's pack size, a photo's count) wins;
// any field still blank is suggested from this person's last price, the
// Woolworths and ALDI listings, and a shelf-life table (src/scan-prefill.ts).
// Every suggestion is shown with its source and is the person's to change.
export function suggestionsFrom(userId: number, rows: ResultRow[]): Suggestion[] {
  const order = { high: 0, medium: 1, low: 2 };
  return rows
    .map((r) => {
      const read = (v: string) => v !== "" && v !== undefined;
      // a count the scan saw ("3"), with no unit, is how many to prefill for
      const seen = read(r.quantity) && !r.unit && /^\d+$/.test(r.quantity) ? Number(r.quantity) : null;
      const fill = r.name ? prefillFor(userId, r.name, seen) : null;
      const sizeRead = read(r.quantity) && (r.unit !== "" || seen === null);
      const priceRead = r.price_cents !== null;
      // a barcode's 400 g jar priced from a 750 g listing: scale by size, and
      // offer no price when the units differ
      let price = fill?.price ?? "";
      if (sizeRead && !priceRead && fill) {
        const same = fill.unit === r.unit && Number(fill.quantity) > 0 && Number(r.quantity) > 0;
        price = same && price ? ((Number(price) * Number(r.quantity)) / Number(fill.quantity)).toFixed(2) : "";
      }
      // say only what was actually suggested: a receipt's own size and
      // price aren't "from Woolworths"
      const note = fill
        ? sizeRead && (priceRead || !price)
          ? fill.note.split(" · ").filter((p) => p.startsWith("keeps")).join(" · ")
          : fill.note
        : "";
      return {
        detected: r.detected,
        name: r.name,
        match: r.match,
        confidence: r.confidence,
        quantity: sizeRead ? r.quantity : (fill?.quantity ?? r.quantity),
        unit: sizeRead ? r.unit : (fill?.unit ?? r.unit),
        expiry_days: null,
        expiry_date: fill?.expiry_date || undefined,
        price: priceRead ? (r.price_cents! / 100).toFixed(2) : price || undefined,
        source: r.source,
        suggested: note || undefined,
      };
    })
    .sort((a, b) => order[a.confidence] - order[b.confidence]);
}

const MATCH_NOTE: Record<Suggestion["match"], string> = {
  exact: "",
  alias: "matched to your catalogue",
  variant: "matched to your catalogue",
  new: "new ingredient",
  manual: "",
};

function row(s: Suggestion, i: number): Html {
  const id = `s${i}`;
  const expiry = s.expiry_date ?? (s.expiry_days !== null ? addDays(today(), s.expiry_days) : "");
  // low-confidence guesses start unticked: the person opts in, not out
  const keep = s.keep ?? s.confidence !== "low";
  const manual = s.match === "manual";
  return html`<li class="scan-row scan-${s.confidence}">
    <input type="hidden" name="detected_${i}" value="${s.detected}" />
    ${s.source ? html`<input type="hidden" name="source_${i}" value="${s.source}" />` : ""}
    <label class="scan-keep"><input type="checkbox" name="keep" value="${i}" ${keep ? html`checked` : ""} aria-label="Add ${s.name || "this item"}" /></label>
    <div class="scan-fields inline-form">
      <label class="field grow-2"><span>Item</span>
        <input id="${id}-name" name="name_${i}" maxlength="80" list="ingredient-catalog" value="${s.name}" /></label>
      <label class="field"><span>Qty</span>
        <input name="quantity_${i}" inputmode="decimal" placeholder="how many?" value="${s.quantity}" /></label>
      <label class="field"><span>Unit</span>
        <input name="unit_${i}" maxlength="20" placeholder="g, ml, pack" value="${s.unit}" /></label>
      <label class="field"><span>Expires</span>
        <input name="expiry_date_${i}" type="date" value="${expiry}" /></label>
      <label class="field"><span>Price paid</span>
        <span class="input-prefix"><span>$</span><input name="price_${i}" inputmode="decimal" placeholder="0.00" value="${s.price ?? ""}" /></span></label>
    </div>
    ${manual
      ? s.source || (s.detected && s.detected !== s.name)
        ? html`<p class="scan-note small muted">${s.source ? html`From “${s.source}”` : html`Seen as “${s.detected}”`}</p>`
        : ""
      : html`<p class="scan-note small muted">
          <span class="pill pill-${s.confidence === "high" ? "fresh" : s.confidence === "medium" ? "soon" : "none"}">${s.confidence === "high" ? "Sure" : s.confidence === "medium" ? "Likely" : "Guess"}</span>
          ${s.source ? html`From “${s.source}”` : s.detected !== s.name ? html`Seen as “${s.detected}”` : ""}${MATCH_NOTE[s.match] ? html` · ${MATCH_NOTE[s.match]}` : ""}
        </p>`}
    ${s.suggested ? html`<p class="scan-note scan-suggested small muted">Prefilled: ${s.suggested}</p>` : ""}
  </li>`;
}

// The blank row for anything the scan missed. Ticked, since typing into it
// is the opt-in; a row left blank is skipped on save.
const EXTRA: Suggestion = { detected: "", name: "", match: "manual", confidence: "high", quantity: "", unit: "", expiry_days: null, keep: true };

interface ReviewOpts {
  problems?: string[];
  seconds?: number;
  status?: number;
  resubmit?: boolean;
  // which scan this review closes, so its stored photo can be dropped on save
  job?: number;
  what?: "photo" | "receipt" | "barcode";
  receipt?: { total_cents: number | null; sum_cents: number | null; matches: boolean | null };
}

export function reviewPage(ctx: Ctx, suggestions: Suggestion[], opts: ReviewOpts = {}): ReturnType<typeof htmlReply> {
  const catalog = catalogFor(ctx.user!.id);
  const what = opts.what ?? "photo";
  const lede = opts.resubmit
    ? "Fix the lines below and press Add again. Nothing has been saved yet."
    : suggestions.length
      ? `${suggestions.length} item${suggestions.length === 1 ? "" : "s"} ${what === "receipt" ? "read off your receipt" : what === "barcode" ? "found" : "spotted"}${opts.seconds ? ` in ${opts.seconds} s` : ""}. Untick anything that's wrong and fix names. ${suggestions.some((x) => x.suggested) ? "Sizes, prices and dates the scan couldn't see are filled in from shop prices and how long food keeps: change any that are different. " : ""}Nothing is saved until you press Add.`
      : what === "receipt"
        ? "No grocery lines could be read off that receipt. Add what you bought below, or try a flatter, closer photo."
        : "Nothing was recognised in that photo. Add what's there below, or try a closer photo of one shelf.";
  const r = opts.receipt;
  const check = r && r.total_cents !== null
    ? r.matches === true
      ? html`<p class="scan-check scan-check-ok" role="status">${icon("check", 16)} These prices add up to the receipt's total of ${money(r.total_cents)}. Names can still be misread, so check each item.</p>`
      : r.matches === false
        ? html`<p class="scan-check scan-check-bad" role="alert">These lines add up to ${money(r.sum_cents)}, but the receipt's total is ${money(r.total_cents)}. A price or line was probably misread: check the prices against your receipt before adding. Every line starts unticked.</p>`
        : html`<p class="scan-check" role="status">Some prices couldn't be read, so the lines can't be checked against the total of ${money(r.total_cents)}.</p>`
    : r
      ? html`<p class="scan-check" role="status">The receipt's total couldn't be read, so the prices haven't been checked. Compare them with your receipt.</p>`
      : "";
  const body = html`
    ${pageHeader("Check what we found", lede)}
    ${errors(opts.problems ?? [])}
    ${check}
    <form method="post" action="/pantry/scan/save" class="panel stack scan-review">
      ${opts.job ? html`<input type="hidden" name="job" value="${opts.job}" />` : ""}
      <ul class="scan-list">${suggestions.map(row)}</ul>
      <p class="muted small">Missed something? Add it below or with the <a href="/pantry#add">add form</a> afterwards.</p>
      <ul class="scan-list">${row(EXTRA, suggestions.length)}</ul>
      <input type="hidden" name="rows" value="${suggestions.length + 1}" />
      <datalist id="ingredient-catalog">${catalog.map((c) => html`<option value="${c}"></option>`)}</datalist>
      <div class="form-actions">
        <a class="button button-ghost" href="/pantry">Cancel</a>
        <button class="button" type="submit">${icon("plus", 16)} Add ticked items</button>
      </div>
    </form>`;
  return htmlReply(page(ctx, { title: "Check your scan", active: "pantry", body }), opts.status ?? 200);
}

/* ---------------- the scan hub ---------------- */

type Tab = "photo" | "device" | "barcode" | "receipt";

function tabs(current: Tab): Html {
  const server = scanConfig() !== null;
  const items = [
    ...(server ? [{ href: "/pantry/scan", label: "Photo" }] : []),
    { href: "/pantry/scan/device", label: server ? "On this device" : "Photo" },
    { href: "/pantry/scan/barcode", label: "Barcode" },
    // with no server model the receipt is read in the browser instead
    { href: "/pantry/scan/receipt", label: "Receipt" },
  ];
  const hrefs: Record<Tab, string> = { photo: "/pantry/scan", device: "/pantry/scan/device", barcode: "/pantry/scan/barcode", receipt: "/pantry/scan/receipt" };
  return html`<div class="subnav-scan">${subnav("Ways to scan", items, hrefs[current])}</div>`;
}

// What to photograph, shown before anything else on each way to scan: a
// short looping 3D scene (public/scan-guide.mjs) seen over your shoulder as
// you take the photo, and the same in a sentence under it. The canvas is a
// picture only; the caption is what a screen reader hears, and it's all
// that shows without WebGL.
type Guide = "fridge" | "receipt" | "barcode";
const GUIDE_CAPTIONS: Record<Guide, string> = {
  fridge: "Open the fridge or pantry, step back until all of it fits on your screen, and take the photo.",
  receipt: "Lay the receipt flat in good light and hold your phone straight above it, so the receipt fills the screen.",
  barcode: "Turn the packet round to its barcode and hold your phone a hand's width away, square on to it.",
};

function scanGuide(kind: Guide): Html {
  return html`<figure class="scan-guide" data-scan-guide="${kind}">
    <div class="scan-guide-stage">
      <canvas aria-hidden="true"></canvas>
      <button type="button" class="scan-guide-toggle" data-scan-guide-toggle aria-pressed="false" aria-label="Pause the animation">
        <span class="scan-guide-pause" aria-hidden="true">${icon("pause", 14)}</span><span class="scan-guide-play" aria-hidden="true">${icon("play", 14)}</span>
      </button>
    </div>
    <figcaption>${GUIDE_CAPTIONS[kind]}</figcaption>
  </figure>`;
}

const THREE_IMPORTS = html`<script type="importmap">${raw(JSON.stringify({ imports: { three: "/assets/vendor/three.module.min.js", "three/addons/": "/assets/vendor/addons/" } }))}</script>`;

function hub(ctx: Ctx, tab: Tab, title: string, lede: string, content: Html, opts: { problem?: string; status?: number; script?: string; guide?: Guide } = {}) {
  const body = html`
    ${pageHeader(title, lede)}
    ${tabs(tab)}
    ${opts.problem ? errors([opts.problem]) : ""}
    ${opts.guide ? scanGuide(opts.guide) : ""}
    ${content}`;
  const guideScripts = opts.guide ? html`${THREE_IMPORTS}<script type="module" src="/assets/scan-guide.mjs"></script>` : "";
  return htmlReply(
    page(ctx, { title, active: "pantry", body, headExtra: html`${guideScripts}<script type="module" src="/assets/${opts.script ?? "scan.mjs"}"></script>` }),
    opts.status ?? 200,
  );
}

function uploadForm(kind: JobKind): Html {
  const receipt = kind === "receipt";
  return html`<form method="post" action="${receipt ? "/pantry/scan/receipt" : "/pantry/scan"}" enctype="multipart/form-data" class="panel stack scan-upload" data-scan-form>
    ${receipt ? receiptCamera() : ""}
    <label class="field"><span>${receipt ? "Receipt photo" : "Photo"}</span>
      <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment" required /></label>
    <p class="muted small">${receipt
      ? "Lay the receipt flat in good light and fill the frame with it. Long receipts read best in two photos, top half then bottom."
      : "Best results: the whole fridge or pantry in one photo, doors open, in good light, labels facing out."} The scan runs in the background: you can leave the page and come back to it.</p>
    <div class="form-actions">
      <a class="button button-ghost" href="/pantry">Back to my kitchen</a>
      <button class="button" type="submit" data-scan-submit>${icon("spark", 16)} ${receipt ? "Read receipt" : "Scan photo"}</button>
    </div>
  </form>`;
}

// The live viewfinder (public/scan-receipt-camera.mjs): it watches for a
// receipt that fills the frame, sharp and held still, and takes the photo
// itself. Hidden until the script finds a camera; the file input below works
// without it.
function receiptCamera(): Html {
  return html`<div class="scan-viewfinder" data-receipt-camera hidden>
      <div class="scan-viewfinder-frame">
        <video playsinline muted data-receipt-video aria-label="Camera view for photographing a receipt"></video>
        <svg class="scan-hold" viewBox="0 0 40 40" aria-hidden="true"><circle class="scan-hold-track" cx="20" cy="20" r="17" /><circle class="scan-hold-fill" cx="20" cy="20" r="17" pathLength="100" data-receipt-hold /></svg>
        <p class="scan-viewfinder-hint" data-receipt-hint role="status" aria-live="polite">Starting the camera…</p>
      </div>
      <div class="scan-viewfinder-actions">
        <button class="button button-ghost" type="button" data-receipt-close>Close camera</button>
        <button class="button" type="button" data-receipt-shoot>${icon("camera", 16)} Take photo now</button>
      </div>
    </div>
    <button class="button button-soft" type="button" data-receipt-start hidden>${icon("camera", 16)} Use the camera</button>
    <p class="muted small" data-receipt-start-note hidden>Hold the receipt in view and Larder takes the photo as soon as it's sharp and steady.</p>`;
}

function scanPage(ctx: Ctx, problem = "", status = 200) {
  if (!scanConfig()) return devicePage(ctx, problem, status);
  return hub(ctx, "photo", "Scan your fridge or pantry", "Take a photo of your open fridge or pantry and Larder suggests what's in it. You check every item before it's added.", uploadForm("photo"), { problem, status, guide: "fridge" });
}

function receiptPage(ctx: Ctx, problem = "", status = 200) {
  const lede = "Photograph your shopping receipt and Larder lists what you bought, with the prices you paid. You check every line before it's added.";
  if (!scanConfig()) return hub(ctx, "receipt", "Read a receipt", lede, deviceReceiptForm(), { problem, status, script: "scan-receipt-camera.mjs", guide: "receipt" });
  return hub(ctx, "receipt", "Read a receipt", lede, uploadForm("receipt"), { problem, status, script: "scan-receipt-camera.mjs", guide: "receipt" });
}

// The receipt read in the browser (public/receipt-ocr-worker.mjs): the same
// camera and file input as the upload form, but the photo stays on the
// device; only the printed lines it reads are posted, to /pantry/scan/receipt/text.
// Without JavaScript there's nothing to read with, so the page says so.
function deviceReceiptForm(): Html {
  return html`<form method="post" action="/pantry/scan/receipt/text" class="panel stack scan-upload" data-scan-form data-receipt-device>
    ${receiptCamera()}
    <label class="field"><span>Receipt photo</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-receipt-file /></label>
    <p class="muted small">Lay the receipt flat in good light and fill the frame with it. It's read on this device, so the photo isn't uploaded. The reader is about 17 MB, downloaded once when you first open this page.</p>
    <div class="scan-progress" data-receipt-progress hidden>
      <p class="scan-progress-label" data-receipt-label role="status" aria-live="polite">Starting…</p>
      <progress max="100" data-receipt-bar aria-label="Reading progress"></progress>
    </div>
    <noscript><p>Reading a receipt needs JavaScript. The <a href="/pantry/scan/barcode">barcode form</a> and the <a href="/pantry#add">add form</a> work without it.</p></noscript>
    <div data-receipt-lines></div>
    <input type="hidden" name="seconds" data-receipt-seconds />
    <div class="form-actions">
      <a class="button button-ghost" href="/pantry">Back to my kitchen</a>
      <button class="button" type="submit" data-scan-submit data-receipt-read disabled>${icon("spark", 16)} Read receipt</button>
    </div>
  </form>`;
}

// The in-browser scan: the page itself loads the model and does the work.
// Without WebGPU (or JavaScript) it says so and offers the other ways.
function devicePage(ctx: Ctx, problem = "", status = 200) {
  const content = html`<section class="panel stack" data-device-scan>
    <p>This runs a small vision model inside your browser, so your photo never leaves this device. It needs a recent browser with WebGPU, and downloads about 1.4 GB the first time; after that it starts in seconds.</p>
    <p class="muted small">It's a smaller model than a server scan and makes more mistakes, so check each suggestion. A scan takes about a minute, longer on a phone. Keep this page open while it runs.</p>
    <div class="scan-device-unsupported" data-device-unsupported hidden role="alert">
      <p>This browser can't run the model (it needs WebGPU). Try Chrome or Edge on a recent computer or Android phone, or use the <a href="/pantry/scan/barcode">barcode scanner</a> or the <a href="/pantry#add">add form</a>.</p>
    </div>
    <noscript><p>The on-device scan needs JavaScript. The <a href="/pantry/scan/barcode">barcode form</a> and the <a href="/pantry#add">add form</a> work without it.</p></noscript>
    <label class="field" data-device-ready hidden><span>Photo</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-device-file /></label>
    <div class="scan-progress" data-device-progress hidden>
      <p class="scan-progress-label" data-device-label role="status" aria-live="polite">Starting…</p>
      <progress max="100" value="0" data-device-bar></progress>
    </div>
    <form method="post" action="/pantry/scan/device" data-device-form hidden>
      <div data-device-replies></div>
      <input type="hidden" name="seconds" data-device-seconds />
    </form>
    <script type="application/json" id="scan-config">${raw(JSON.stringify({ prompt: SCAN_PROMPT }).replace(/</g, "\\u003c"))}</script>
    <div class="form-actions">
      <a class="button button-ghost" href="/pantry">Back to my kitchen</a>
      <button class="button" type="button" data-device-start hidden>${icon("spark", 16)} Scan photo</button>
    </div>
  </section>`;
  return hub(ctx, "device", "Scan on this device", "Photograph your open fridge or pantry and a model running in your browser suggests what's in it. You check every item before it's added.", content, { problem, status, script: "scan-device.mjs", guide: "fridge" });
}

function barcodePage(ctx: Ctx, problem = "", status = 200, code = "") {
  const content = html`<section class="panel stack" data-barcode>
    <div class="scan-camera" data-barcode-camera hidden>
      <video playsinline muted data-barcode-video aria-label="Camera view for scanning a barcode"></video>
      <p class="muted small" data-barcode-status role="status" aria-live="polite">Point the camera at a barcode.</p>
    </div>
    <button class="button button-soft" type="button" data-barcode-start hidden>${icon("search", 16)} Use the camera</button>
    <form method="post" action="/pantry/scan/barcode" class="inline-form" data-barcode-form>
      <label class="field grow-2"><span>Barcode number</span>
        <input name="code" inputmode="numeric" autocomplete="off" pattern="[0-9 ]{8,16}" maxlength="16" placeholder="e.g. 9300633603109" value="${code}" required /></label>
      <button class="button" type="submit">${icon("search", 16)} Look up</button>
    </form>
    <p class="muted small">Products are looked up in <a href="https://world.openfoodfacts.org">Open Food Facts</a>, an open database. Not every product is in it; if yours isn't, add it by hand.</p>
    <div class="scan-basket" data-barcode-basket hidden>
      <h2 class="panel-title">Scanned so far</h2>
      <ul class="scan-basket-list" data-barcode-list></ul>
      <form method="post" action="/pantry/scan/barcode/review" data-barcode-review>
        <div data-barcode-codes></div>
        <button class="button" type="submit">${icon("check", 16)} Review and add</button>
      </form>
    </div>
  </section>`;
  return hub(ctx, "barcode", "Scan barcodes", "Scan the packets and tins you've bought, one after another, then check and add them in one go.", content, { problem, status, script: "scan-barcode.mjs", guide: "barcode" });
}

function progressPage(ctx: Ctx, id: number) {
  const job = jobFor(ctx.user!.id, id);
  if (!job) throw new HttpError(404, "That scan doesn't exist.");
  if (job.status === "done") return redirect(`/pantry/scan/jobs/${id}/review`);
  const failed = job.status === "failed";
  const ahead = job.status === "queued" ? aheadOf(id) : 0;
  const pct = Math.round((job.step / Math.max(job.steps, 1)) * 100);
  const label = failed
    ? job.error ?? "The scan didn't finish."
    : job.status === "queued"
      ? ahead ? `Waiting: ${ahead} scan${ahead === 1 ? "" : "s"} ahead of yours.` : "Starting…"
      : job.kind === "receipt"
        ? "Reading the receipt…"
        : `Looking at your photo: ${job.step} of ${job.steps} views done.`;
  const body = html`
    ${pageHeader(job.kind === "receipt" ? "Reading your receipt" : "Scanning your photo", failed ? "" : "This runs in the background. You can leave this page: the scan keeps going, and your fridge shows when it's ready.")}
    <section class="panel stack scan-progress" data-job="${id}" data-job-status="${job.status}">
      <p class="scan-progress-label" data-job-label role="status" aria-live="polite">${label}</p>
      ${failed
        ? ""
        : job.step === 0
          ? // no value until the first view is in: the bar shows it's working
            html`<progress max="100" data-job-bar aria-label="Scan progress"></progress>`
          : html`<progress max="100" value="${pct}" data-job-bar aria-label="Scan progress">${pct}%</progress>`}
      <div class="form-actions">
        <a class="button button-ghost" href="/pantry">Back to my kitchen</a>
        ${failed ? html`<a class="button" href="${job.kind === "receipt" ? "/pantry/scan/receipt" : "/pantry/scan"}">Try again</a>` : ""}
      </div>
    </section>`;
  // no JavaScript: the page reloads itself until the scan is done
  const refresh = failed ? html`` : html`<noscript><meta http-equiv="refresh" content="4" /></noscript>`;
  return htmlReply(page(ctx, { title: "Scanning", active: "pantry", body, headExtra: html`${refresh}<script type="module" src="/assets/scan.mjs"></script>` }));
}

/* ---------------- routes ---------------- */

async function upload(ctx: Ctx, kind: JobKind) {
  const again = kind === "receipt" ? receiptPage : scanPage;
  if (!scanConfig()) return again(ctx, "Scanning isn't set up on this server.", 503);
  const { files } = await readMultipart(ctx.req);
  const photo = files.get("photo");
  const check = checkImage(photo?.bytes ?? Buffer.alloc(0));
  if (!check.ok) return again(ctx, check.problem.replace("of the dish", kind === "receipt" ? "of your receipt" : "of your fridge or pantry"), 422);
  const id = createJob(ctx.user!.id, kind, photo!.bytes, check);
  logActivity({ actor: ctx.user, action: "pantry.scan_queued", subject: kind, detail: { job: id, bytes: photo!.bytes.length } });
  return redirect(`/pantry/scan/jobs/${id}`);
}

function jobId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, "That scan doesn't exist.");
  return id;
}

const MAX_ROWS = 200;

export const routes: Route[] = [
  { method: "GET", path: "/pantry/scan", auth: true, handler: (ctx) => scanPage(ctx) },
  { method: "POST", path: "/pantry/scan", auth: true, handler: (ctx) => upload(ctx, "photo") },
  { method: "GET", path: "/pantry/scan/receipt", auth: true, handler: (ctx) => receiptPage(ctx) },
  { method: "POST", path: "/pantry/scan/receipt", auth: true, handler: (ctx) => upload(ctx, "receipt") },
  {
    // the printed lines a browser read off a receipt (deviceReceiptForm);
    // what was bought is decided here, by the same parsing and total check
    // as a server reading, so a page can post nothing a receipt couldn't say
    method: "POST",
    path: "/pantry/scan/receipt/text",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const lines = form.getAll("line").slice(0, 400).map((l) => l.slice(0, 200));
      const seconds = Math.max(0, Math.min(Number(form.get("seconds")) || 0, 3600));
      const learned = learnedNames(ctx.user!.id);
      const catalogue = spellingCandidates(ctx.user!.id);
      const known = [...new Set([...Object.keys(loadProducts().products), ...catalogue])];
      const result = receiptResult(parseReceiptText(lines, known), learned, seconds * 1000, catalogue);
      logActivity({ actor: ctx.user, action: "pantry.scan", subject: "receipt-device", detail: { lines: lines.length, found: result.rows.length, seconds } });
      return reviewPage(ctx, suggestionsFrom(ctx.user!.id, result.rows.slice(0, MAX_ROWS)), { seconds: result.seconds, what: "receipt", receipt: result.receipt });
    },
  },
  { method: "GET", path: "/pantry/scan/device", auth: true, handler: (ctx) => devicePage(ctx) },
  { method: "GET", path: "/pantry/scan/barcode", auth: true, handler: (ctx) => barcodePage(ctx) },
  {
    method: "GET",
    path: "/pantry/scan/jobs/:id",
    auth: true,
    handler: (ctx) => progressPage(ctx, jobId(ctx)),
  },
  {
    // what the progress page polls
    method: "GET",
    path: "/pantry/scan/jobs/:id/status",
    auth: true,
    handler: (ctx) => {
      const job = jobFor(ctx.user!.id, jobId(ctx));
      if (!job) return json({ error: "That scan doesn't exist." }, 404);
      return json({
        status: job.status,
        step: job.step,
        steps: job.steps,
        kind: job.kind,
        ahead: job.status === "queued" ? aheadOf(job.id) : 0,
        error: job.status === "failed" ? job.error : null,
        review: job.status === "done" ? `/pantry/scan/jobs/${job.id}/review` : null,
      });
    },
  },
  {
    method: "GET",
    path: "/pantry/scan/jobs/:id/review",
    auth: true,
    handler: (ctx) => {
      const id = jobId(ctx);
      const job = jobFor(ctx.user!.id, id);
      if (!job) throw new HttpError(404, "That scan doesn't exist.");
      const result = jobResult(job);
      if (!result) return redirect(`/pantry/scan/jobs/${id}`);
      return reviewPage(ctx, suggestionsFrom(ctx.user!.id, result.rows), { seconds: result.seconds, job: id, what: job.kind, receipt: result.receipt });
    },
  },
  {
    // the in-browser model's findings, as the parser's own JSON shape
    method: "POST",
    path: "/pantry/scan/device",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const learned = learnedNames(ctx.user!.id);
      const catalogue = spellingCandidates(ctx.user!.id);
      // one raw reply per view the browser scanned, parsed and merged here
      // exactly as a server scan's are, so a page can post nothing the
      // parser wouldn't accept from a model
      const replies = form.getAll("reply").slice(0, 8).map((r) => r.slice(0, 20000));
      const items = mergeScans(replies.map(parseScan)).slice(0, MAX_ROWS);
      const seconds = Math.max(0, Math.min(Number(form.get("seconds")) || 0, 3600));
      const rows: ResultRow[] = items.map((d) => {
        const r = resolveName(d, catalogueHas, learned, catalogue);
        return { detected: d.name, name: r.name, match: r.match, confidence: d.confidence, quantity: d.count !== null ? String(d.count) : "", unit: "", price_cents: null };
      });
      logActivity({ actor: ctx.user, action: "pantry.scan", subject: "device", detail: { found: rows.length, seconds } });
      return reviewPage(ctx, suggestionsFrom(ctx.user!.id, rows), { seconds: Math.round(seconds) });
    },
  },
  {
    // the camera scanner asks about one code at a time
    method: "GET",
    path: "/pantry/scan/barcode/lookup",
    auth: true,
    handler: async (ctx) => {
      const code = validBarcode(ctx.url.searchParams.get("code") ?? "");
      if (!code) return json({ error: "That doesn't look like a product barcode." }, 422);
      try {
        const product = await lookupBarcode(code);
        if (!product) return json({ code, found: false });
        return json({ code, found: true, product, row: barcodeRow(ctx.user!.id, product) });
      } catch (err) {
        if (!(err instanceof LookupUnavailable)) throw err;
        return json({ error: err.message }, 503);
      }
    },
  },
  {
    // typed number, no JavaScript: look it up and go straight to review
    method: "POST",
    path: "/pantry/scan/barcode",
    auth: true,
    handler: async (ctx) => {
      const raw = ((await ctx.form()).get("code") ?? "").trim();
      const code = validBarcode(raw);
      if (!code) return barcodePage(ctx, "That doesn't look like a product barcode. Check the digits under the stripes.", 422, raw);
      try {
        const product = await lookupBarcode(code);
        if (!product) return barcodePage(ctx, `Barcode ${code} isn't in the product database. Add the item with the form instead.`, 404, raw);
        return reviewPage(ctx, suggestionsFrom(ctx.user!.id, [barcodeRow(ctx.user!.id, product)]), { what: "barcode" });
      } catch (err) {
        if (!(err instanceof LookupUnavailable)) throw err;
        return barcodePage(ctx, err.message, 503, raw);
      }
    },
  },
  {
    // a basket of camera-scanned codes, reviewed together
    method: "POST",
    path: "/pantry/scan/barcode/review",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const codes = [...new Set(form.getAll("code").map((c) => validBarcode(c)).filter((c): c is string => !!c))].slice(0, 50);
      const rows: ResultRow[] = [];
      const missing: string[] = [];
      for (const code of codes) {
        try {
          const product = await lookupBarcode(code);
          if (product) rows.push(barcodeRow(ctx.user!.id, product));
          else missing.push(code);
        } catch {
          missing.push(code);
        }
      }
      const problems = missing.length ? [`${missing.length === 1 ? "One barcode wasn't" : `${missing.length} barcodes weren't`} found (${missing.join(", ")}). Add ${missing.length === 1 ? "it" : "them"} in the blank row below.`] : [];
      return reviewPage(ctx, suggestionsFrom(ctx.user!.id, rows), { what: "barcode", problems });
    },
  },
  {
    method: "POST",
    path: "/pantry/scan/save",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const rows = Math.min(Number(form.get("rows")) || 0, MAX_ROWS + 1);
      const keep = new Set(form.getAll("keep").map(Number));
      const job = Number(form.get("job")) || 0;
      const problems: string[] = [];
      const ready = [];
      const resubmit: Suggestion[] = [];
      for (let i = 0; i < rows; i++) {
        const detected = normaliseIngredient(form.get(`detected_${i}`) ?? "");
        const source = (form.get(`source_${i}`) ?? "").slice(0, 160) || undefined;
        const { input, values, problems: p } = parseItem(form, `_${i}`);
        // a blank "add another" row isn't an error, ticked or not
        if (!detected && !values.name && !values.quantity) continue;
        const ticked = keep.has(i);
        // every row comes back on a refused save, unticked ones included, so
        // nothing the person checked has to be found again
        resubmit.push({ detected, name: values.name, match: "manual", confidence: "high", quantity: values.quantity, unit: values.unit, expiry_days: null, expiry_date: values.expiry_date, price: values.price, keep: ticked, source });
        if (!ticked) continue;
        if (p.length) problems.push(...p.map((m) => `${values.name || `Row ${i + 1}`}: ${m}`));
        else ready.push({ input, detected });
      }
      if (problems.length) return reviewPage(ctx, resubmit, { problems, status: 422, resubmit: true, job: job || undefined });
      if (job) finishReview(ctx.user!.id, job);
      if (!ready.length) {
        setFlash(ctx, "Nothing was ticked, so nothing was added.");
        return redirect("/pantry");
      }
      for (const { input, detected } of ready) {
        addPersonalItem(ctx.user!, input, "scan");
        // the person renamed a suggestion: remember it for their next scan
        rememberCorrection(ctx.user!.id, detected, input.name);
      }
      setFlash(ctx, `Added ${ready.length} item${ready.length === 1 ? "" : "s"}.`);
      return redirect("/pantry");
    },
  },
];
