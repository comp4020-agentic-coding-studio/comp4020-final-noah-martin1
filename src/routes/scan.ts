// "Scan your fridge": upload a photo, a local vision model proposes what's in
// it, and the person confirms each line before anything is saved. The model
// only suggests names; quantity, unit, expiry and price are the person's to
// fill in (prefilled only with a count the model actually saw). With no model
// configured, or a failing one, the page says so and points at the add form.
//
// The review form is source-agnostic: a future barcode scan can produce the
// same Suggestion rows and reuse reviewPage and the save route unchanged.

import { catalogFor, normaliseIngredient } from "../db.ts";
import { addDays, today } from "../format.ts";
import { type Html, html } from "../html.ts";
import { type Ctx, htmlReply, redirect, setFlash } from "../http.ts";
import { logActivity } from "../activity.ts";
import { checkImage, readMultipart } from "../images.ts";
import { shelfware } from "../kitchen.ts";
import { catalogueHas, learnedNames, rememberCorrection, resolveName, scanConfig, scanPhoto, ScanUnavailable, type Resolved } from "../fridge-scan.ts";
import type { Route } from "../server.ts";
import { errors, icon, page, pageHeader } from "../views/layout.ts";
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
}

// Rough "keeps for" defaults by where the item lives, offered as a starting
// point the person can change; never saved unless the form submits it.
function keepsFor(name: string): number | null {
  const { place, model } = shelfware(name, "other");
  if (model === "leafy") return 5;
  if (model === "tray") return 3;
  if (model === "milk" || model === "tub") return 7;
  if (model === "veg" && place === "fridge") return 7;
  return null;
}

export function suggestionsFrom(resolved: Resolved[]): Suggestion[] {
  const order = { high: 0, medium: 1, low: 2 };
  return resolved
    .map((r) => ({
      detected: r.detected.name,
      name: r.name,
      match: r.match,
      confidence: r.detected.confidence,
      quantity: r.detected.count !== null ? String(r.detected.count) : "",
      unit: "",
      expiry_days: keepsFor(r.name),
    }))
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
    <label class="scan-keep"><input type="checkbox" name="keep" value="${i}" ${keep ? html`checked` : ""} aria-label="Add ${s.name}" /></label>
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
      ? s.detected && s.detected !== s.name
        ? html`<p class="scan-note small muted">Seen as “${s.detected}”</p>`
        : ""
      : html`<p class="scan-note small muted">
          <span class="pill pill-${s.confidence === "high" ? "fresh" : s.confidence === "medium" ? "soon" : "none"}">${s.confidence === "high" ? "Sure" : s.confidence === "medium" ? "Likely" : "Guess"}</span>
          ${s.detected !== s.name ? html`Seen as “${s.detected}”` : ""}${MATCH_NOTE[s.match] ? html` · ${MATCH_NOTE[s.match]}` : ""}
        </p>`}
  </li>`;
}

// The blank row for anything the scan missed. Ticked, since typing into it
// is the opt-in; a row left blank is skipped on save.
const EXTRA: Suggestion = { detected: "", name: "", match: "manual", confidence: "high", quantity: "", unit: "", expiry_days: null, keep: true };

export function reviewPage(ctx: Ctx, suggestions: Suggestion[], opts: { problems?: string[]; seconds?: number; status?: number; resubmit?: boolean } = {}): ReturnType<typeof htmlReply> {
  const catalog = catalogFor(ctx.user!.id);
  const lede = opts.resubmit
    ? "Fix the lines below and press Add again. Nothing has been saved yet."
    : suggestions.length
      ? `${suggestions.length} item${suggestions.length === 1 ? "" : "s"} spotted${opts.seconds ? ` in ${opts.seconds} s` : ""}. Untick anything that's wrong, fix names, and add how much you have. Nothing is saved until you press Add.`
      : "Nothing was recognised in that photo. Add what's there below, or try a closer photo of one shelf.";
  const body = html`
    ${pageHeader("Check what we found", lede)}
    ${errors(opts.problems ?? [])}
    <form method="post" action="/pantry/scan/save" class="panel stack scan-review">
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

export function scanPage(ctx: Ctx, problem = "", status = 200): ReturnType<typeof htmlReply> {
  const on = scanConfig() !== null;
  const body = html`
    ${pageHeader("Scan your fridge or pantry", "Take a photo of a shelf and Larder suggests what's on it. You check every item before it's added.")}
    ${problem ? errors([problem]) : ""}
    ${on
      ? html`<form method="post" action="/pantry/scan" enctype="multipart/form-data" class="panel stack scan-upload" data-scan-form>
          <label class="field"><span>Photo</span>
            <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment" required /></label>
          <p class="muted small">Best results: one shelf or door at a time, in good light, labels facing out. A scan takes up to a minute or two.</p>
          <div class="form-actions">
            <a class="button button-ghost" href="/pantry">Back to my kitchen</a>
            <button class="button" type="submit" data-scan-submit>${icon("spark", 16)} Scan photo</button>
          </div>
          <p class="muted small" data-scan-wait hidden role="status">Looking at your photo… this can take a minute.</p>
        </form>`
      : html`<section class="panel stack">
          <p>Photo scanning needs a vision model running alongside Larder, and this server doesn't have one.</p>
          <p class="muted small">It runs on a self-hosted install with <a href="https://ollama.com">Ollama</a>: set <code>VISION_URL</code> to its address. Until then, the <a href="/pantry#add">add form</a> does the same job by hand.</p>
        </section>`}`;
  return htmlReply(page(ctx, { title: "Scan your fridge", active: "pantry", body, headExtra: html`<script type="module" src="/assets/scan.mjs"></script>` }), status);
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/pantry/scan",
    auth: true,
    handler: (ctx) => scanPage(ctx),
  },
  {
    method: "POST",
    path: "/pantry/scan",
    auth: true,
    handler: async (ctx) => {
      const cfg = scanConfig();
      if (!cfg) return scanPage(ctx, "Photo scanning isn't set up on this server.", 503);
      const { files } = await readMultipart(ctx.req);
      const photo = files.get("photo");
      const check = checkImage(photo?.bytes ?? Buffer.alloc(0));
      if (!check.ok) return scanPage(ctx, check.problem.replace("of the dish", "of your fridge or pantry"), 422);
      try {
        const { items, ms, calls } = await scanPhoto(cfg, photo!.bytes, check);
        const learned = learnedNames(ctx.user!.id);
        const resolved = items.map((d) => resolveName(d, catalogueHas, learned));
        logActivity({ actor: ctx.user, action: "pantry.scan", detail: { model: cfg.model, ms, calls, found: resolved.length, new: resolved.filter((r) => r.match === "new").length } });
        return reviewPage(ctx, suggestionsFrom(resolved), { seconds: Math.round(ms / 1000) });
      } catch (err) {
        if (!(err instanceof ScanUnavailable)) throw err;
        logActivity({ actor: ctx.user, action: "pantry.scan", outcome: "failed", detail: { model: cfg.model, reason: err.message } });
        return scanPage(ctx, `${err.message} You can add items with the form instead.`, 503);
      }
    },
  },
  {
    method: "POST",
    path: "/pantry/scan/save",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const rows = Math.min(Number(form.get("rows")) || 0, 200);
      const keep = new Set(form.getAll("keep").map(Number));
      const problems: string[] = [];
      const ready = [];
      const resubmit: Suggestion[] = [];
      for (let i = 0; i < rows; i++) {
        const detected = normaliseIngredient(form.get(`detected_${i}`) ?? "");
        const { input, values, problems: p } = parseItem(form, `_${i}`);
        // a blank "add another" row isn't an error, ticked or not
        if (!detected && !values.name && !values.quantity) continue;
        const ticked = keep.has(i);
        // every row comes back on a refused save, unticked ones included, so
        // nothing the person checked has to be found again
        resubmit.push({ detected, name: values.name, match: "manual", confidence: "high", quantity: values.quantity, unit: values.unit, expiry_days: null, expiry_date: values.expiry_date, price: values.price, keep: ticked });
        if (!ticked) continue;
        if (p.length) problems.push(...p.map((m) => `${values.name || `Row ${i + 1}`}: ${m}`));
        else ready.push({ input, detected });
      }
      if (problems.length) return reviewPage(ctx, resubmit, { problems, status: 422, resubmit: true });
      if (!ready.length) {
        setFlash(ctx, "Nothing was ticked, so nothing was added.");
        return redirect("/pantry");
      }
      for (const { input, detected } of ready) {
        addPersonalItem(ctx.user!, input, "scan");
        // the person renamed a suggestion: remember it for their next scan
        rememberCorrection(ctx.user!.id, detected, input.name);
      }
      setFlash(ctx, `Added ${ready.length} item${ready.length === 1 ? "" : "s"} from your photo.`);
      return redirect("/pantry");
    },
  },
];
