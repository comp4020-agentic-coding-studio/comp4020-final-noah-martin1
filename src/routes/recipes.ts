import { type Answer, answerFor, suggestions } from "../assistant.ts";
import { all, catalogFor } from "../db.ts";
import { DIETARY_TAGS, money, monthLabel, qty, sized, today } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { t, th, tn } from "../i18n.ts";
import { logActivity } from "../activity.ts";
import { type Ctx, HttpError, htmlReply, json, redirect, setFlash, text } from "../http.ts";
import { checkImage, loadImage, MAX_IMAGE_BYTES, ownedImage, readMultipart, saveImage } from "../images.ts";
import { estimate, perServing, priceReference } from "../nutrition.ts";
import {
  COURSES,
  countVisibleRecipes,
  cuisines,
  deleteRecipe,
  getRecipe,
  hasShownVideo,
  ingredientsFor,
  kitchenMatches,
  listVisibleRecipes,
  pantryMatch,
  parseRecipeForm,
  andList,
  type Recipe,
  type RecipeIngredient,
  type RecipeInput,
  recipeIngredients,
  recipeSteps,
  saveRecipe,
  totalMinutes,
} from "../recipes.ts";
import { prefsFor } from "../prefs.ts";
import { costToMake, recipePurchase } from "../pricing.ts";
import { priceNote } from "../price-notes.ts";
import { usableStock } from "../shopping.ts";
import { packLine } from "./shopping.ts";
import type { Route } from "../server.ts";
import { canSeeRecipe } from "../visibility.ts";
import { avatar, errors, icon, page, pageHeader, tone } from "../views/layout.ts";
import { liveCooksFor } from "./global.ts";
import { averagesFor, ownReview, parseFilters, reviewsFor, summaryFor, typingOn, getReview } from "../reviews.ts";
import { type ComposerState, ratingBadge, reviewsSection } from "../views/reviews.ts";

const VISIBILITY_LABEL = { public: "Public", friends: "Friends", private: "Only me" } as const;

export function visibilityBadge(v: Recipe["visibility"]): Html {
  return html`<span class="badge badge-${v}">${t(VISIBILITY_LABEL[v])}</span>`;
}

export function duration(minutes: number): string {
  if (minutes <= 0) return "—";
  if (minutes < 60) return t("{n} min", { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? t("{h} hr {m}", { h, m }) : t("{h} hr", { h });
}

// Kitchen-friendly amounts: ⅓ cup, 1½ tbsp, 250 g.
const FRACTION_GLYPHS: [number, string][] = [
  [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"],
];

export function amount(quantity: number | null, unit: string): string {
  if (quantity === null) return "";
  let num: string;
  if (["g", "ml"].includes(unit) && quantity >= 20) {
    num = String(Math.round(quantity / 5) * 5);
  } else {
    const whole = Math.floor(quantity);
    const frac = quantity - whole;
    const glyph = FRACTION_GLYPHS.find(([v]) => Math.abs(frac - v) < 0.04)?.[1];
    if (frac < 0.04) num = String(whole || (quantity > 0 ? "<1" : "0"));
    else if (frac > 0.96) num = String(whole + 1);
    else if (glyph) num = `${whole || ""}${glyph}`;
    else num = String(Math.round(quantity * 10) / 10);
  }
  return unit ? `${num} ${unit}` : num;
}

// A photo tile, IMDb-poster style: image, a couple of glass badges, then the
// title and quick facts beneath.
export function recipeTile(r: Recipe, opts: { i?: number; live?: number; costCents?: number; kcal?: number; id?: string; stars?: { average: number; count: number }; kitchen?: { have: number; need: number; missing: string[] } } = {}): Html {
  const minutes = totalMinutes(r);
  const [fallback] = tone(r.title);
  return html`<a class="rx-tile" href="/recipes/${r.id}"${opts.id ? html` id="${opts.id}"` : ""} style="--i: ${Math.min(opts.i ?? 0, 24)}">
    <div class="rx-photo">
      ${r.image_url
        ? sized(r.image_url, "medium") === r.image_url
          ? html`<img src="${r.image_url}" alt="" loading="lazy" decoding="async" />`
          : html`<img src="${sized(r.image_url, "medium")}" srcset="${sized(r.image_url, "medium")} 350w, ${sized(r.image_url, "large")} 500w, ${r.image_url} 700w" sizes="(max-width: 900px) 45vw, 240px" alt="" loading="lazy" decoding="async" />`
        : html`<div class="rx-photo-fallback" style="--fallback: ${fallback}"><span>${r.title.slice(0, 1)}</span></div>`}
      <div class="rx-badges">
        ${opts.live ? html`<span class="rx-glass rx-glass-live"><span class="live-dot"></span>${t("{n} cooking", { n: opts.live })}</span>` : html`<span></span>`}
        ${r.visibility !== "public" ? html`<span class="rx-glass">${t(VISIBILITY_LABEL[r.visibility])}</span>` : ""}
      </div>
      ${opts.costCents !== undefined && opts.costCents > 0
        ? html`<span class="rx-glass rx-price">${money(Math.round(opts.costCents))}<small>${t("/serve")}</small></span>`
        : ""}
    </div>
    <div class="rx-info">
      <h3>${r.title}</h3>
      <div class="rx-facts">
        ${opts.stars ? html`<span class="rx-stars" aria-label="${tn(opts.stars.count, "{avg} out of 5 stars from {n} review", "{avg} out of 5 stars from {n} reviews", { avg: opts.stars.average })}">${icon("star", 13)}${opts.stars.average.toFixed(1)}<small>(${opts.stars.count})</small></span>` : ""}
        ${minutes ? html`<span>${icon("clock", 13)}${duration(minutes)}</span>` : ""}
        ${r.cuisine ? html`<span>${r.cuisine}</span>` : html`<span>${t("by {name}", { name: r.author_name.split(" ")[0] })}</span>`}
      </div>
      ${opts.kitchen
        ? html`<p class="rx-kitchen ${opts.kitchen.missing.length ? "rx-kitchen-short" : "rx-kitchen-all"}">${opts.kitchen.missing.length
            ? t("Need {items}", { items: andList(opts.kitchen.missing) })
            : html`${icon("check", 12)} ${t("You have all {n}", { n: opts.kitchen.need })}`}</p>`
        : ""}
    </div>
  </a>`;
}

// Kept for the profile page's grid of someone's recipes.
export function recipeCard(r: Recipe): Html {
  return recipeTile(r);
}

function skeletons(n: number): Html {
  return html`${Array.from({ length: n }, () => html`<div class="rx-tile rx-skeleton" aria-hidden="true"><div class="rx-photo"></div><span class="sk-line" style="width: 82%"></span><span class="sk-line" style="width: 52%"></span></div>`)}`;
}

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, t("There's no recipe at this address."));
  return id;
}

// The recipe if the viewer may see it; otherwise 404, never 403, so a stranger
// can't learn that a private recipe exists.
export function visibleRecipe(ctx: Ctx): Recipe {
  const recipe = getRecipe(parseId(ctx));
  if (!recipe || !canSeeRecipe(ctx.user?.id ?? null, recipe)) {
    throw new HttpError(404, t("There's no recipe at this address."));
  }
  return recipe;
}

function ownRecipe(ctx: Ctx): Recipe {
  const recipe = visibleRecipe(ctx);
  if (recipe.author_id !== ctx.user!.id) throw new HttpError(403, t("Only the author can change this recipe."));
  return recipe;
}

/* ---------------- browse ---------------- */

const QUICK_FILTERS = [
  { key: "quick", label: "Under 30 min", dot: "var(--butter)" },
  { key: "vegetarian", label: "Vegetarian", dot: "var(--sage)" },
  { key: "high-protein", label: "High protein", dot: "var(--peach)" },
  { key: "gluten-free", label: "Gluten-free", dot: "var(--sky)" },
  { key: "dairy-free", label: "Dairy-free", dot: "var(--lavender)" },
  { key: "vegan", label: "Vegan", dot: "var(--sage)" },
];

interface BrowseState {
  q: string;
  tag: string;
  course: string;
  cuisine: string;
  video: boolean;
  // best reviewed first, only recipes with reviews
  rated: boolean;
  // what the viewer can cook from their kitchen (signed in): nothing
  // missing first, then one, then two
  have: boolean;
  mine: boolean;
  // how many pages of PAGE recipes to show (Show more adds one)
  pages: number;
}

const PAGE = 200;

function browseState(ctx: Ctx): BrowseState {
  const p = ctx.url.searchParams;
  const tag = p.get("tag") ?? "";
  const course = p.get("course") ?? "";
  return {
    q: (p.get("q") ?? "").trim().slice(0, 80),
    tag: (DIETARY_TAGS as readonly string[]).includes(tag) ? tag : "",
    course: COURSES.some((c) => c.key === course) ? course : "",
    cuisine: (p.get("cuisine") ?? "").slice(0, 40),
    video: p.get("video") === "1",
    rated: p.get("rated") === "1",
    have: p.get("have") === "1" && !!ctx.user,
    mine: p.get("tab") === "mine" && !!ctx.user,
    pages: Math.min(Math.max(Number.parseInt(p.get("pages") ?? "1", 10) || 1, 1), 20),
  };
}

function hrefWith(s: BrowseState, change: Partial<BrowseState>): string {
  const next = { ...s, ...change };
  const p = new URLSearchParams();
  if (next.mine) p.set("tab", "mine");
  if (next.q) p.set("q", next.q);
  if (next.course) p.set("course", next.course);
  if (next.tag) p.set("tag", next.tag);
  if (next.cuisine) p.set("cuisine", next.cuisine);
  if (next.video) p.set("video", "1");
  if (next.rated) p.set("rated", "1");
  if (next.have) p.set("have", "1");
  if (next.pages > 1) p.set("pages", String(next.pages));
  const qs = p.toString();
  return qs ? `/recipes?${qs}` : "/recipes";
}

function chip(label: string, href: string, on: boolean, dot?: string): Html {
  return html`<a class="rx-chip" href="${href}" aria-pressed="${on ? "true" : "false"}" data-filter>${dot ? html`<span class="dot" style="--chip: ${dot}"></span>` : ""}${label}</a>`;
}

// `from`: only the recipes after this many (the tiles a "Show more" adds)
function results(ctx: Ctx, s: BrowseState, from = 0): { recipes: Recipe[]; total: number; grid: Html } {
  const viewer = ctx.user?.id ?? null;
  const filters = {
    authorId: s.mine ? viewer! : undefined,
    query: s.q,
    tag: s.tag === "quick" ? undefined : s.tag,
    maxMinutes: s.tag === "quick" ? 30 : undefined,
    course: s.course,
    cuisine: s.cuisine,
    video: s.video,
    rated: s.rated,
  };
  const shown = s.pages * PAGE;
  const order = s.rated ? "rating" : s.mine && !s.q ? "newest" : "featured";
  // from my kitchen: ranked by what's missing, every match counted
  const matches = s.have && viewer !== null ? kitchenMatches(viewer, filters) : null;
  const recipes = matches
    ? matches.slice(from, shown).map((m) => m.recipe)
    : listVisibleRecipes(viewer, { ...filters, order, limit: shown - from, offset: from });
  const missingFor = new Map((matches ?? []).map((m) => [m.recipe.id, m]));
  // the grid stops at `shown`; the count is every match
  const total = matches ? matches.length : from + recipes.length < shown ? from + recipes.length : countVisibleRecipes(viewer, filters);
  const lines = ingredientsFor(recipes.map((r) => r.id));
  const live = liveCooksFor(recipes.map((r) => r.title));
  const stars = averagesFor(recipes.map((r) => r.id));
  const tiles = recipes.map((r, i) => {
    i += from;
    const made = costToMake((lines.get(r.id) ?? []).filter((l) => !l.optional), `${r.id}@${r.updated_at}`);
    // the first tile of each later page is where Show more lands without the script
    const id = i > 0 && i % PAGE === 0 ? `more-${i}` : undefined;
    const m = missingFor.get(r.id);
    // a per-serve price only when nothing in the recipe is unpriced, so a
    // tile never reads cheap because something was left out
    const perServe = made.cents > 0 && !made.unpriced.length ? made.cents / Math.max(1, r.servings) : undefined;
    const tile = recipeTile(r, { i, id, live: live.get(r.title), costCents: perServe, stars: stars.get(r.id), kitchen: m ? { have: m.have, need: m.need, missing: m.missing } : undefined });
    // a heading where the number missing changes: "You have everything", "Missing one"...
    // the one before, which on a "Show more" page is the last one already shown
    const prev = i > 0 ? (i > from ? missingFor.get(recipes[i - from - 1].id) : matches?.[i - 1]) : undefined;
    if (m && (i === 0 || (prev && prev.missing.length !== m.missing.length))) {
      return html`<p class="rx-group" role="heading" aria-level="3">${t(m.missing.length === 0 ? "You have everything" : m.missing.length === 1 ? "Missing one ingredient" : "Missing two")}</p>${tile}`;
    }
    return tile;
  });
  const grid = recipes.length || from > 0
    ? html`${tiles}`
    : html`<div class="empty rx-empty">
        <p class="empty-title">${t(s.have ? "Nothing you can cook yet" : s.mine && !s.q && !s.tag ? "Your cookbook is empty" : "Nothing matches that")}</p>
        <p>${t(s.have ? "Add what's in your fridge and pantry, and the recipes you can make (or nearly make) show up here." : s.mine && !s.q && !s.tag ? "Write down something you cook often — it gets nutrition and cost worked out automatically." : s.rated ? "None of these have reviews yet. Cook one and be the first to rate it." : "Try an ingredient you have, like “eggs” or “chickpeas”, or clear a filter.")}</p>
        ${s.have ? html`<a class="button" href="/pantry">${icon("pantry", 16)} ${t("Open my kitchen")}</a>` : s.mine ? html`<a class="button" href="/recipes/new">${icon("plus", 16)} ${t("Write a recipe")}</a>` : html`<a class="button button-ghost" href="/recipes">${t("Clear filters")}</a>`}
      </div>`;
  return { recipes, total, grid };
}

// A link to the same list one page longer; with the script it fetches just
// the next page into the grid instead (public/app.js)
function showMore(s: BrowseState, shown: number, total: number): Html {
  if (shown >= total) return html``;
  const next = Math.min(PAGE, total - shown);
  return html`<div class="rx-more"><a class="button button-soft" href="${hrefWith(s, { pages: s.pages + 1 })}#more-${shown}" data-show-more data-from="${shown}">${t("Show {n} more", { n: next })}</a></div>`;
}

// "392 recipes", and when the grid stops short, how many it shows
export function resultCount(total: number, shown: number): string {
  return `${tn(total, "{n} recipe", "{n} recipes")}${shown < total ? ` · ${t("showing {n}", { n: shown })}` : ""}`;
}

function browsePage(ctx: Ctx): Html {
  const s = browseState(ctx);
  const { recipes, total, grid } = results(ctx, s);
  const filtered = !!(s.q || s.tag || s.course || s.cuisine || s.video || s.rated || s.have);
  // filters start the list again from the top
  const f = { ...s, pages: 1 };
  const topCuisines = cuisines().slice(0, 9);
  const heading = s.mine
    ? t("Your recipes")
    : s.have
      ? s.q ? t("From your kitchen: “{q}”", { q: s.q }) : t("From your kitchen")
      : s.q
      ? t("Results for “{q}”", { q: s.q })
      : s.course
        ? t(COURSES.find((c) => c.key === s.course)!.label)
        : s.cuisine
          ? t("{cuisine} recipes", { cuisine: s.cuisine })
          : s.tag
            ? t(QUICK_FILTERS.find((f) => f.key === s.tag)?.label ?? "Recipes")
            : s.rated
              ? t("Top rated")
              : s.video
                ? t("Recipes with a video")
                : t("Popular this week");
  return html`
    <section class="rx-hero">
      <div class="rx-hero-row">
        <div>
          <p class="eyebrow">${t("Recipes")}</p>
          <h1>${t("What are we cooking?")}</h1>
          <p class="lede">${t("Search by dish or by what's already in the fridge. Every recipe works out its own nutrition and cost, and cooks one step at a time.")}</p>
        </div>
        <div class="page-actions">
          ${ctx.user
            ? html`<nav class="tabs" aria-label="${t("Recipe lists")}">
                <a class="tab" href="${hrefWith(s, { mine: false })}" ${!s.mine ? raw('aria-current="page"') : ""}>${t("Discover")}</a>
                <a class="tab" href="${hrefWith(s, { mine: true })}" ${s.mine ? raw('aria-current="page"') : ""}>${t("My recipes")}</a>
              </nav>
              <a class="button" href="/recipes/new" aria-label="${t("New recipe")}">${icon("plus", 16)} <span class="hide-sm">${t("New recipe")}</span></a>`
            : ""}
        </div>
      </div>
      <form class="rx-search" method="get" action="/recipes" role="search" data-recipe-search>
        ${icon("search", 20)}
        ${s.mine ? html`<input type="hidden" name="tab" value="mine" />` : ""}
        ${s.course ? html`<input type="hidden" name="course" value="${s.course}" />` : ""}
        ${s.tag ? html`<input type="hidden" name="tag" value="${s.tag}" />` : ""}
        ${s.cuisine ? html`<input type="hidden" name="cuisine" value="${s.cuisine}" />` : ""}
        ${s.video ? html`<input type="hidden" name="video" value="1" />` : ""}
        ${s.rated ? html`<input type="hidden" name="rated" value="1" />` : ""}
        ${s.have ? html`<input type="hidden" name="have" value="1" />` : ""}
        <input type="search" name="q" value="${s.q}" placeholder="${t("Try “pad thai”, “eggs” or “chickpeas”")}" aria-label="${t("Search recipes")}" autocomplete="off" />
        <button class="button" type="submit">${t("Search")}</button>
      </form>
    </section>

    <nav class="rx-filters" aria-label="${t("Filter recipes")}">
      ${chip(t("All"), hrefWith(f, { course: "", tag: "", cuisine: "", video: false, rated: false, have: false }), !s.course && !s.tag && !s.cuisine && !s.video && !s.rated && !s.have)}
      ${COURSES.map((c) => chip(t(c.label), hrefWith(f, { course: s.course === c.key ? "" : c.key }), s.course === c.key))}
      <span class="rx-divider" aria-hidden="true"></span>
      ${ctx.user ? chip(t("From my kitchen"), hrefWith(f, { have: !s.have, rated: false }), s.have, "var(--accent)") : ""}
      ${chip(t("Top rated"), hrefWith(f, { rated: !s.rated, have: false }), s.rated, "var(--butter-ink)")}
      ${chip(t("Has video"), hrefWith(f, { video: !s.video }), s.video, "var(--rose)")}
      ${QUICK_FILTERS.map((q) => chip(t(q.label), hrefWith(f, { tag: s.tag === q.key ? "" : q.key }), s.tag === q.key, q.dot))}
      <span class="rx-divider" aria-hidden="true"></span>
      ${topCuisines.map((c) => chip(c, hrefWith(f, { cuisine: s.cuisine === c ? "" : c }), s.cuisine === c))}
    </nav>

    <div class="rx-meta-row">
      <h2 data-results-heading>${heading}</h2>
      <span class="muted" data-results-count>${resultCount(total, recipes.length)}${filtered ? "" : ` · ${t("photos from TheMealDB")}`}</span>
    </div>
    <div class="rx-grid" data-recipe-grid aria-live="polite">
      ${grid}
      ${skeletons(10)}
    </div>
    <div data-show-more-slot>${showMore(s, recipes.length, total)}</div>`;
}

/* ---------------- detail ---------------- */

const MACRO_COLOURS = { protein: "#e9a07a", carbs: "#e8c76a", fat: "#a99be0" };

// "checked Oct 2026", from the newest month in the price table
function checkedLabel(): string {
  const label = monthLabel(priceReference().checked);
  return label ? t(", checked {date}", { date: label }) : "";
}

// What the recipe costs, in three numbers that are each named for what they
// are (docs/ARCHITECTURAL_GUIDELINES.md, "Pricing and budgeting"):
//   Cost to make   the value of the amounts the recipe uses: the same for
//                  everyone, and what "per serve" divides
//   At the checkout, from an empty kitchen   whole packs to buy owning nothing
//   At the checkout, after your pantry       whole packs after what you hold
// Every stand-in, estimate or ingredient with no price is named underneath,
// so a total is never quietly short (a lamb shoulder left out made a lamb
// bake read $5.50).
function purchaseCard(ctx: Ctx, recipe: Recipe, lines: RecipeIngredient[]): Html {
  const viewer = ctx.user?.id ?? null;
  const empty = recipePurchase(viewer, lines, 1, [], recipe.title);
  const used = { costCents: empty.consumptionCents };
  const stock = viewer === null ? [] : usableStock("user", viewer);
  const mine = viewer === null ? null : recipePurchase(viewer, lines, 1, stock, recipe.title);
  const required = lines.filter((l) => !l.optional);
  // how each ingredient is priced, when it's anything other than plainly
  const notes = new Map<string, string>();
  for (const l of required) {
    const n = priceNote(l.name);
    if (n.note && !notes.has(l.name)) notes.set(l.name, n.note);
  }
  const unpriced = [...new Set(empty.toBuy.filter((l) => !l.pack && !l.sharesPack && l.toBuy !== null && l.consumptionCents === null).map((l) => l.name))];
  const plan = mine ?? empty;
  const packs = (p: typeof empty) => p.toBuy.filter((l) => l.pack).length;
  return html`<section class="rd-card rd-buy" aria-labelledby="buy-h">
    <div class="rd-card-head"><h2 id="buy-h">${t("What it costs")}</h2><span class="muted small">${tn(recipe.servings, "as written, {n} serve", "as written, {n} serves")}</span></div>
    <dl class="cost-split">
      <div><dt>${t("Cost to make")}</dt><dd class="mono" data-scale-cost data-base="${Math.round(used.costCents)}">${money(Math.round(used.costCents))}</dd>
        <small>${t("the value of what goes in the dish")}</small></div>
      <div><dt>${t("At the checkout")}</dt><dd class="mono" data-recipe-purchase="${empty.purchaseCents}">${money(empty.purchaseCents)}</dd>
        <small>${tn(packs(empty), "{n} whole pack, from an empty kitchen", "{n} whole packs, from an empty kitchen")}</small></div>
      ${mine
        ? html`<div class="cost-mine"><dt>${t("After your pantry")}</dt><dd class="mono" data-recipe-purchase-mine="${mine.purchaseCents}">${money(mine.purchaseCents)}</dd>
            <small>${mine.covered.length ? t("you have {n} of {total}", { n: mine.covered.length, total: mine.covered.length + mine.toBuy.length }) : t("you have none of it yet")}</small></div>`
        : ""}
    </dl>
    <p class="estimate-note">${t("Cost to make counts only what the recipe uses; at the checkout you buy whole packs, so it's more, and the rest stays in your kitchen.")}${viewer ? "" : html` ${th("{join} to see it after what you already have.", { join: html`<a href="/register">${t("Join free")}</a>` })}`}</p>
    ${plan.toBuy.length
      ? html`<details class="rd-buy-list"><summary>${t("What you'd buy")}</summary><ul class="shop-list">${plan.toBuy.map(
          (l) => html`<li class="shop-line"><span class="mono qty">${l.toBuy === null ? t("some") : qty(l.toBuy, l.unit === "each" ? "" : l.unit)}</span><span class="grow"><span class="item-name">${l.name}</span>${packLine(l.pack, l.consumptionCents, l.sharesPack, l.unitClash)}</span><span class="hh-line-price mono">${l.pack ? money(l.pack.costCents) : l.sharesPack ? t("incl.") : "—"}</span></li>`,
        )}</ul></details>`
      : html`<p class="estimate-note">${t("Your pantry covers everything.")}</p>`}
    ${notes.size
      ? html`<details class="rd-price-notes"><summary>${t("{n} priced as something close", { n: notes.size })}</summary><ul>${[...notes].map(([name, note]) => html`<li><strong>${name}</strong>: ${note}</li>`)}</ul></details>`
      : ""}
    ${unpriced.length
      ? html`<p class="rd-unpriced" role="note">${icon("alert", 14)} ${tn(unpriced.length, "No price yet for {names}, so it isn't in these totals.", "No price yet for {names}, so they aren't in these totals.", { names: andList(unpriced) })}</p>`
      : ""}
  </section>`;
}

function nutritionCard(recipe: Recipe, lines: RecipeIngredient[], servings: number): Html {
  const total = estimate(lines);
  const n = perServing(total, servings);
  const made = costToMake(lines.filter((l) => !l.optional), `${recipe.id}@${recipe.updated_at}`);
  const kcal = Math.round(n.kcal);
  const pK = n.protein * 4;
  const cK = n.carbs * 4;
  const fK = n.fat * 9;
  const sum = pK + cK + fK || 1;
  // three arcs around one ring, each the share of energy from that macro
  const C = 2 * Math.PI * 46;
  let offset = 0;
  const arcs = (
    [
      ["protein", pK],
      ["carbs", cK],
      ["fat", fK],
    ] as const
  ).map(([k, v]) => {
    const len = Math.max(0, (v / sum) * C - 4);
    const arc = `<circle cx="58" cy="58" r="46" stroke="${MACRO_COLOURS[k]}" stroke-dasharray="${len.toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}"/>`;
    offset += (v / sum) * C;
    return arc;
  });
  const macro = (label: string, grams: number, key: keyof typeof MACRO_COLOURS, daily: number) =>
    html`<li class="macro" style="--c: ${MACRO_COLOURS[key]}"><i></i><span>${t(label)}</span><b>${Math.round(grams)} g</b>
      <span class="meter"><span style="--p: ${Math.min(100, Math.round((grams / daily) * 100))}%"></span></span></li>`;
  return html`<section class="rd-card" aria-labelledby="nutrition-h">
    <div class="rd-card-head"><h2 id="nutrition-h">${t("Per serve")}</h2><span class="muted small">${t("estimated")}</span></div>
    <div class="nutri">
      <div class="nutri-ring" role="img" aria-label="${t("{n} calories per serve", { n: kcal })}">
        ${raw(`<svg viewBox="0 0 116 116"><circle class="track" cx="58" cy="58" r="46"/>${arcs.join("")}</svg>`)}
        <div class="nutri-center"><strong data-scale-kcal>${kcal}</strong><span>kcal</span></div>
      </div>
      <ul class="macros">
        ${macro("Protein", n.protein, "protein", 50)}
        ${macro("Carbs", n.carbs, "carbs", 260)}
        ${macro("Fat", n.fat, "fat", 70)}
      </ul>
    </div>
    <div class="cost-row">
      <div><small>${t("Cost per serve")}</small><strong>${money(Math.round(made.cents / Math.max(1, servings)))}${made.unpriced.length ? "+" : ""}</strong></div>
      <div style="text-align: right"><small>${t("Cost to make")}</small><strong>${money(made.cents)}${made.unpriced.length ? "+" : ""}</strong></div>
    </div>
    <p class="estimate-note">${t("Nutrition from {n} of {total} ingredients; cost from the Woolworths and ALDI prices{checked} (see “What it costs”). Seasonings to taste aren't counted.", { n: total.counted, total: total.total, checked: checkedLabel() })}</p>
  </section>`;
}

function ingredientsCard(ctx: Ctx, recipe: Recipe, lines: RecipeIngredient[]): Html {
  const match = ctx.user ? pantryMatch(ctx.user.id, lines) : null;
  return html`<section class="rd-card" aria-labelledby="ingredients-h">
    <div class="rd-card-head">
      <h2 id="ingredients-h">${t("Ingredients")}</h2>
      <div class="servings" data-servings data-base="${recipe.servings}">
        <button type="button" data-servings-step="-1" aria-label="${t("Fewer servings")}">−</button>
        <output aria-live="polite">${th("{n} serves", { n: html`<span data-servings-value>${recipe.servings}</span>` })}</output>
        <button type="button" data-servings-step="1" aria-label="${t("More servings")}">+</button>
      </div>
    </div>
    <ul class="ing-list">
      ${lines.map((ing) => {
        const have = match?.have.has(ing.ingredient_id);
        return html`<li>
          <label class="ing-check"><input type="checkbox" aria-label="${t("Got {name}", { name: ing.name })}" />${icon("check", 12)}</label>
          <span class="ing-amount" data-qty="${ing.quantity ?? ""}" data-unit="${ing.unit}">${amount(ing.quantity, ing.unit)}</span>
          <span class="ing-name">${ing.name}${ing.note || ing.optional ? html`<small>${[ing.note, ing.optional && !/serve|garnish/.test(ing.note) ? t("optional") : ""].filter(Boolean).join(" · ")}</small>` : ""}</span>
          ${match && !ing.optional ? html`<span class="ing-flag ${have ? "ing-flag-have" : "ing-flag-need"}">${have ? t("Have") : t("Need")}</span>` : ""}
        </li>`;
      })}
    </ul>
    ${match
      ? html`<p class="estimate-note">${match.missing === 0 ? t("You have everything for this one.") : tn(match.missing, "You're missing {n} ingredient.", "You're missing {n} ingredients.")}</p>`
      : ""}
  </section>`;
}

function planCard(ctx: Ctx, recipe: Recipe): Html {
  if (!ctx.user) {
    return html`<section class="rd-card">
      <h2 style="font-size: 18px; margin-bottom: 8px">${t("Save it for later")}</h2>
      <p class="muted small" style="margin-bottom: 16px">${t("With a free account you can add this to your meal calendar, see what's already in your pantry and cook live with friends.")}</p>
      <a class="button button-block" href="/register">${t("Join free")}</a>
    </section>`;
  }
  return html`<section class="rd-card">
    <h2 style="font-size: 18px; margin-bottom: 14px">${t("Add to my calendar")}</h2>
    <form method="post" action="/calendar" class="plan-form">
      <input type="hidden" name="recipe_id" value="${recipe.id}" />
      <input type="hidden" name="return_to" value="/recipes/${recipe.id}" />
      <div class="field-pair">
        <label class="field"><span>${t("Date")}</span><input type="date" name="date" required value="${today()}" /></label>
        <label class="field"><span>${t("Meal")}</span>
          <select name="meal"><option value="dinner">${t("Dinner")}</option><option value="lunch">${t("Lunch")}</option><option value="breakfast">${t("Breakfast")}</option></select></label>
      </div>
      <label class="check-inline"><input type="checkbox" name="shared" value="1" checked /> <span>${t("Share with friends")}</span></label>
      <button class="button button-soft button-block" type="submit">${icon("calendar", 16)} ${t("Add to calendar")}</button>
    </form>
  </section>`;
}

// "Ask about this recipe". Without JavaScript the form reloads the page with
// the checked answer; with it, the answer arrives in place and an optional
// on-device model (public/assistant.mjs) rewords it.
function answerBody(a: Answer): Html {
  return html`<p class="ask-headline">${a.headline}</p>
    ${a.lines.length ? html`<ul class="ask-lines">${a.lines.map((l) => html`<li>${l}</li>`)}</ul>` : ""}`;
}

// Every known food word, and the ones this answer is allowed to mention: the
// page drops a model reply that names a food outside the checked facts.
let FOOD_WORDS: string[] | null = null;
function foodGuard(allowedText: string): { foods: string[]; allowed: string[] } {
  FOOD_WORDS ??= [
    ...new Set(
      all<{ name: string }>("SELECT name FROM ingredients")
        .flatMap((i) => i.name.toLowerCase().split(/[^a-z]+/))
        .concat(["tempeh", "seitan", "trout", "cod", "bass", "tuna", "beef", "pork", "lamb", "chicken", "turkey", "tofu", "lentils", "quinoa"])
        .filter((w) => w.length > 2 && !["and", "the", "for", "with", "fresh", "dried", "ground", "whole", "large", "small", "fine", "plain", "free", "range", "extra", "virgin"].includes(w)),
    ),
  ];
  const t = allowedText.toLowerCase();
  return { foods: FOOD_WORDS, allowed: FOOD_WORDS.filter((w) => t.includes(w)) };
}

function askCard(ctx: Ctx, recipe: Recipe, lines: RecipeIngredient[]): Html {
  const q = (ctx.url.searchParams.get("ask") ?? "").slice(0, 200);
  const answer = q ? answerFor(recipe, lines, q, ctx.user?.id ?? null) : null;
  return html`<section class="rd-card ask" id="ask" aria-labelledby="ask-h" data-ask="${recipe.id}">
    <div class="rd-card-head">
      <h2 id="ask-h"><span class="ask-spark" aria-hidden="true">${icon("spark", 16)}</span>${t("Ask a question")}</h2>
    </div>
    <form class="ask-form" method="get" action="/recipes/${recipe.id}#ask" data-ask-form>
      <label class="sr-only" for="ask-q">${t("Your question")}</label>
      <input id="ask-q" name="ask" maxlength="200" autocomplete="off" placeholder="${t("Swap an ingredient, feed 6…")}" value="${q}" />
      <button class="button button-small" type="submit">${t("Ask")}</button>
    </form>
    <div class="ask-chips">${suggestions(lines).map((s) => html`<button type="button" class="rx-chip" data-ask-chip="${s.q}">${s.label}</button>`)}</div>
    <div class="ask-answer" aria-live="polite" data-ask-answer ${answer ? "" : raw("hidden")}>${answer ? answerBody(answer) : ""}</div>
    <div class="ask-ai" data-ask-ai hidden>
      <button type="button" class="ask-ai-toggle" data-ask-ai-toggle aria-pressed="false">
        <span class="ask-ai-dot"></span><span data-ask-ai-label>${t("Say it in plain words with the on-device assistant")}</span>
      </button>
      <p class="ask-ai-note muted small">${t("A small free model (Qwen2.5 0.5B, about 1 GB, downloaded once and cached) runs on your device's GPU. Nothing you type leaves this device for it, and it only rewords the checked answer above.")}</p>
    </div>
  </section>`;
}

// The how-to video. A catalogue recipe shows a video only when its
// ingredients and steps were written from that video and checked against it
// (src/data/videos.json); an author's own link is labelled as theirs. With
// neither, say so rather than guess.
function videoCard(recipe: Recipe): Html {
  const id = recipe.video_id;
  if (id && hasShownVideo(recipe)) {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    return html`<section class="rd-card rd-video" aria-labelledby="video-h">
      <div class="rd-card-head"><h2 id="video-h">${t("Watch it made")}</h2></div>
      <div class="rd-video-frame">
        <iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${recipe.video_title ?? t("Video for {title}", { title: recipe.title })}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
      </div>
      <p class="estimate-note">${recipe.video_status === "verified"
        ? html`${recipe.video_channel ? t("Video by {channel}.", { channel: recipe.video_channel }) : t("Video.")} ${t("The ingredients and steps above were transcribed from it (its transcript or the creator's written recipe) and checked a second time against that source · {date}. Amounts are converted to metric.", { date: recipe.video_checked ?? "" })}`
        : t("Added by the recipe's author — not checked against the recipe.")}
        <a href="${watch}" rel="noopener noreferrer" target="_blank">${t("Can't see it? Open on YouTube")}</a></p>
    </section>`;
  }
  return html`<section class="rd-card rd-video" aria-labelledby="video-h">
    <div class="rd-card-head"><h2 id="video-h">${t("Watch it made")}</h2></div>
    <p class="muted small">${t("No matching video available for this recipe.")}</p>
  </section>`;
}

// The reviews at the foot of the page: filtered and sorted from the
// address, "Show more" by `shown`, and the viewer's own review in the box.
function reviewsPart(ctx: Ctx, recipe: Recipe, composer?: ComposerState): { section: Html; badge: Html } {
  const viewer = ctx.user?.id ?? null;
  const filters = parseFilters(ctx.url.searchParams);
  const shown = Math.min(Math.max(Number.parseInt(ctx.url.searchParams.get("shown") ?? "20", 10) || 20, 20), 200);
  const summary = summaryFor(recipe.id);
  const { reviews, total } = reviewsFor(recipe.id, viewer, filters, shown);
  const mineRow = viewer !== null ? ownReview(recipe.id, viewer) : undefined;
  const mine = mineRow ? getReview(mineRow.id, viewer) ?? null : null;
  return {
    section: reviewsSection(ctx, recipe, { summary, reviews, total, filters, mine, typing: typingOn(recipe.id, viewer), composer, shown: Math.min(shown, total) }),
    badge: ratingBadge(summary),
  };
}

// The recipe page again with a refused review's words kept in the box.
export function renderReviewsPage(ctx: Ctx, recipe: Recipe, composer: ComposerState, status: number) {
  return htmlReply(
    page(ctx, {
      title: recipe.title,
      active: "recipes",
      body: recipeDetail(ctx, recipe, composer),
      headExtra: html`<script type="module" src="/assets/assistant.mjs"></script><script type="module" src="/assets/reviews.mjs"></script>`,
    }),
    status,
  );
}

function recipeDetail(ctx: Ctx, recipe: Recipe, composer?: ComposerState): Html {
  const lines = recipeIngredients(recipe.id);
  const rv = reviewsPart(ctx, recipe, composer);
  const steps = recipeSteps(recipe.id);
  const mine = ctx.user?.id === recipe.author_id;
  const live = liveCooksFor([recipe.title]).get(recipe.title) ?? 0;
  const cook = recipe.cook_minutes;
  const more = listVisibleRecipes(ctx.user?.id ?? null, {
    course: recipe.course || undefined,
    cuisine: recipe.cuisine || undefined,
    excludeId: recipe.id,
    order: "featured",
    limit: 6,
  });
  const fill = more.length < 5
    ? listVisibleRecipes(ctx.user?.id ?? null, { course: recipe.course || undefined, excludeId: recipe.id, order: "featured", limit: 12 })
        .filter((r) => !more.some((m) => m.id === r.id))
        .slice(0, 5 - more.length)
    : [];
  const [fallback] = tone(recipe.title);

  return html`<article class="rd">
    <nav class="crumbs" aria-label="${t("Breadcrumb")}"><a href="/recipes">${t("Recipes")}</a><span>/</span>${recipe.cuisine ? html`<a href="/recipes?cuisine=${encodeURIComponent(recipe.cuisine)}">${recipe.cuisine}</a><span>/</span>` : ""}<span>${recipe.title}</span></nav>

    <header class="rd-top">
      <div class="rd-photo">
        ${recipe.image_url
          ? html`<img src="${recipe.image_url}" alt="${recipe.title}" />`
          : html`<div class="rx-photo-fallback" style="--fallback: ${fallback}"><span>${recipe.title.slice(0, 1)}</span></div>`}
        ${live ? html`<div class="rx-badges"><span class="rx-glass rx-glass-live"><span class="live-dot"></span>${t("{n} cooking now", { n: live })}</span><span></span></div>` : ""}
      </div>
      <div class="rd-head">
        <div class="tags">
          ${recipe.visibility !== "public" ? visibilityBadge(recipe.visibility) : ""}
          ${recipe.cuisine ? html`<span class="tag" style="background: var(--peach); color: var(--peach-ink)">${recipe.cuisine}</span>` : ""}
          ${recipe.dietary_tags.map((tag) => html`<span class="tag">${t(tag)}</span>`)}
        </div>
        <h1>${recipe.title}</h1>
        ${recipe.description ? html`<p class="lede">${recipe.description}</p>` : ""}
        <p class="rd-byline">${avatar(recipe.author_name, "sm", recipe.author_avatar)} <span>${th("Recipe by {name}", { name: html`<a href="/u/${recipe.author_username}">${recipe.author_name}</a>` })}</span>${rv.badge}</p>
        <dl class="rd-times">
          <div class="rd-time"><dt>${icon("leaf", 14)} ${t("Prep")}</dt><dd>${recipe.prep_minutes ? html`${recipe.prep_minutes}<small>${t("min")}</small>` : "—"}</dd></div>
          <div class="rd-time"><dt>${icon("flame", 14)} ${t("Cook")}</dt><dd>${cook ? (cook >= 60 ? duration(cook) : html`${cook}<small>${t("min")}</small>`) : "—"}</dd></div>
          <div class="rd-time"><dt>${icon("users", 14)} ${t("Serves")}</dt><dd>${recipe.servings}</dd></div>
          <div class="rd-time"><dt>${icon("check", 14)} ${t("Steps")}</dt><dd>${steps.length}</dd></div>
        </dl>
        <div class="rd-actions">
          <a class="button button-large button-accent" href="/recipes/${recipe.id}/cook">${icon("cook", 18)} ${t("Start cooking")}</a>
          <button class="button button-large button-ghost" type="button" data-print>${icon("print", 18)} ${t("Print")}</button>
          ${mine
            ? html`<a class="button button-large button-ghost" href="/recipes/${recipe.id}/edit">${t("Edit")}</a>
                <form method="post" action="/recipes/${recipe.id}/delete" data-confirm="${t("Delete this recipe? Planned meals using it are removed too.")}">
                  <button class="button button-large button-danger" type="submit">${t("Delete")}</button>
                </form>`
            : ""}
        </div>
      </div>
    </header>

    <div class="rd-body">
      <aside class="rd-side rd-side-a">
        ${ingredientsCard(ctx, recipe, lines)}
      </aside>
      <aside class="rd-side rd-side-b">
        ${nutritionCard(recipe, lines, recipe.servings)}
        ${purchaseCard(ctx, recipe, lines)}
        ${planCard(ctx, recipe)}
      </aside>

      <div class="rd-main">
        <section class="rd-card" aria-labelledby="method-h">
          <div class="rd-card-head"><h2 id="method-h">${t("Method")}</h2><span class="muted small">${tn(steps.length, "{n} step", "{n} steps")}${cook ? ` · ${t("{time} cooking", { time: duration(cook) })}` : ""}</span></div>
          <ol class="method">
            ${steps.map(
              (s) => html`<li>
                <span class="method-num">${s.step_number}</span>
                <div>
                  <p>${s.text}</p>
                  ${s.est_minutes ? html`<button class="timer-chip" type="button" data-timer="${s.est_minutes * 60}">${icon("timer", 14)} <span>${t("{time} timer", { time: duration(s.est_minutes) })}</span></button>` : ""}
                </div>
              </li>`,
            )}
          </ol>
        </section>

        ${videoCard(recipe)}

        <section class="cook-cta">
          <div class="cook-cta-art">${icon("cook", 32)}</div>
          <div>
            <h3>${t("Phone on the bench?")}</h3>
            <p>${t("Cook mode shows one big step at a time, with timers.")} ${recipe.visibility === "public" ? t("Go live and cooks around the world can follow along and answer questions.") : ""}</p>
          </div>
          <a class="button button-large" href="/recipes/${recipe.id}/cook">${t("Cook step by step")} ${icon("arrow", 18)}</a>
        </section>

        ${askCard(ctx, recipe, lines)}
      </div>
    </div>

    ${rv.section}

    ${more.length + fill.length
      ? html`<section class="more-like">
          <div class="rx-meta-row"><h2>${t("You might also like")}</h2><a class="muted small" href="/recipes${recipe.course ? `?course=${recipe.course}` : ""}">${t("See all →")}</a></div>
          <div class="rx-grid more-like-grid">${[...more, ...fill].slice(0, 5).map((r, i) => recipeTile(r, { i }))}</div>
        </section>`
      : ""}
  </article>`;
}

/* ---------------- editor ---------------- */

function ingredientRow(i: number, ing?: RecipeInput["ingredients"][number]): Html {
  return html`<div class="row-editor" data-row>
    <input name="ing_qty" inputmode="decimal" placeholder="${t("Qty")}" aria-label="${t("Quantity")}" value="${ing?.quantity ?? ""}" class="w-qty" />
    <input name="ing_unit" placeholder="${t("Unit")}" aria-label="${t("Unit")}" value="${ing?.unit ?? ""}" class="w-unit" />
    <input name="ing_name" placeholder="${t("Ingredient")}" aria-label="${t("Ingredient")}" list="ingredient-catalog" value="${ing?.name ?? ""}" class="grow" />
    <label class="check-inline" title="${t("Optional ingredient")}"><input type="checkbox" name="ing_optional" value="${i}" ${ing?.optional ? raw("checked") : ""} /> <span>${t("Optional")}</span></label>
    <button type="button" class="icon-button" data-remove-row aria-label="${t("Remove ingredient")}">×</button>
    <p class="price-hint" data-price-hint aria-live="polite" hidden></p>
  </div>`;
}

function stepRow(step?: RecipeInput["steps"][number]): Html {
  return html`<div class="row-editor step-editor" data-row>
    <span class="step-num" aria-hidden="true"></span>
    <textarea name="step_text" rows="2" placeholder="${t("Describe this step")}" aria-label="${t("Step")}" class="grow">${step?.text ?? ""}</textarea>
    <input name="step_minutes" inputmode="numeric" placeholder="${t("Min")}" aria-label="${t("Minutes")}" value="${step?.est_minutes ?? ""}" class="w-qty" />
    <button type="button" class="icon-button" data-remove-row aria-label="${t("Remove step")}">×</button>
  </div>`;
}

// The recipe form arrives as multipart (a photo chosen without JavaScript)
// or url-encoded (the page uploaded the photo first and sends its reference).
// Either way the recipe ends with a photo this author owns, or the one it
// already has; anything else is refused before anything is saved.
async function readRecipeForm(ctx: Ctx, existing?: Recipe): Promise<{ input: RecipeInput; problems: string[] }> {
  const multipart = (ctx.req.headers["content-type"] ?? "").startsWith("multipart/form-data");
  let form: URLSearchParams;
  let file: { filename: string; bytes: Buffer } | undefined;
  if (multipart) {
    const m = await readMultipart(ctx.req);
    form = m.fields;
    file = m.files.get("image");
  } else form = await ctx.form();
  const parsed = parseRecipeForm(form);
  const ref = (form.get("image_ref") ?? "").trim();
  const user = ctx.user!;
  if (file) {
    const check = checkImage(file.bytes);
    if (check.ok) parsed.input.image_url = saveImage(user.id, file.bytes, check);
    else {
      parsed.problems.push(t(check.problem));
      logActivity({ actor: user, action: "recipe.image_rejected", outcome: "denied", subject: parsed.input.title, detail: { reason: check.problem, bytes: file.bytes.length } });
    }
  } else if (ref && ownedImage(user.id, ref)) parsed.input.image_url = ref;
  else if (ref && existing && ref === existing.image_url) parsed.input.image_url = ref;
  else if (ref) parsed.problems.push(t("That photo couldn't be found. Choose it again."));
  if (!parsed.input.image_url && !existing?.image_url) {
    if (!parsed.problems.some((p) => /photo/i.test(p))) parsed.problems.push(t("Add a photo of the dish. Every recipe needs one."));
  }
  return parsed;
}

function recipeForm(ctx: Ctx, input: Partial<RecipeInput>, problems: string[], recipeId?: number, status = 200) {
  const ingredients = input.ingredients?.length ? input.ingredients : [undefined, undefined, undefined];
  const steps = input.steps?.length ? input.steps : [undefined, undefined];
  const catalog = catalogFor(ctx.user!.id);
  const prefs = prefsFor(ctx.user!.id);
  const vis = input.visibility ?? prefs.default_visibility;
  const editing = recipeId !== undefined;
  return htmlReply(
    page(ctx, {
      title: editing ? t("Edit recipe") : t("New recipe"),
      active: "recipes",
      body: html`
        <nav class="crumbs" aria-label="${t("Breadcrumb")}"><a href="/recipes">${t("Recipes")}</a><span>/</span><span>${editing ? t("Edit") : t("New recipe")}</span></nav>
        ${pageHeader(editing ? t("Edit recipe") : t("Write a recipe"), t("Use the ingredient names you stock — calories, macros and cost are worked out automatically, and the recipe links to your pantry."))}
        ${errors(problems)}
        <form method="post" action="${editing ? `/recipes/${recipeId}/edit` : "/recipes/new"}" class="form-grid" enctype="multipart/form-data" data-recipe-form>
          <div class="form-col">
          <section class="panel stack rx-photo-field" data-photo-field>
            <h2 class="panel-title">${t("Photo")}</h2>
            <div class="rx-photo-pick">
              <div class="rx-photo-preview" data-photo-preview>
                ${input.image_url
                  ? html`<img src="${input.image_url}" alt="${t("The recipe's photo")}" />`
                  : html`<span class="rx-photo-empty">${icon("plus", 22)}<span>${t("No photo yet")}</span></span>`}
              </div>
              <div class="stack">
                <label class="field"><span>${input.image_url ? t("Replace the photo") : t("Photo of the dish")} <small class="muted">${t("(required)")}</small></span>
                  <input type="file" name="image" accept="image/jpeg,image/png,image/webp" data-photo-input ${input.image_url ? "" : raw("required")} aria-describedby="photo-help" /></label>
                <input type="hidden" name="image_ref" value="${input.image_url ?? ""}" data-photo-ref />
                <p class="muted small" id="photo-help" data-photo-status aria-live="polite">${t("JPEG, PNG or WebP, up to 5 MB, at least 200 × 150 pixels. Use your own photo of the dish.")}</p>
              </div>
            </div>
          </section>
          <section class="panel stack">
            <h2 class="panel-title">${t("Basics")}</h2>
            <label class="field"><span>${t("Title")}</span>
              <input name="title" required maxlength="120" value="${input.title ?? ""}" placeholder="${t("e.g. Nonna's Sunday ragu")}" /></label>
            <label class="field"><span>${t("Description")}</span>
              <textarea name="description" rows="3" maxlength="2000" placeholder="${t("What makes it good, in a sentence or two")}">${input.description ?? ""}</textarea></label>
            <div class="field-row">
              <label class="field"><span>${t("Serves")}</span>
                <input name="servings" type="number" min="1" max="50" required value="${input.servings ?? prefs.default_servings}" /></label>
              <fieldset class="field">
                <legend>${t("Who can see it")}</legend>
                <div class="segmented">
                  ${(["public", "friends", "private"] as const).map(
                    (v) => html`<label><input type="radio" name="visibility" value="${v}" ${v === vis ? raw("checked") : ""} /><span>${t(VISIBILITY_LABEL[v])}</span></label>`,
                  )}
                </div>
              </fieldset>
            </div>
            <label class="field"><span>${t("YouTube video (optional)")}</span>
              <input name="video_url" type="url" maxlength="200" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" value="${input.video_id ? `https://www.youtube.com/watch?v=${input.video_id}` : ""}" />
              <small>${t("Shown on the recipe page, labelled as yours. Make sure it's the same dish.")}</small></label>
            <fieldset class="field">
              <legend>${t("Dietary tags")}</legend>
              <div class="chips">
                ${DIETARY_TAGS.map(
                  (tag) => html`<label class="chip"><input type="checkbox" name="tags" value="${tag}" ${input.dietary_tags?.includes(tag) ? raw("checked") : ""} /><span>${t(tag)}</span></label>`,
                )}
              </div>
            </fieldset>
          </section>
          </div>

          <div class="form-col">
          <section class="panel stack">
            <h2 class="panel-title">${t("Ingredients")}</h2>
            <div class="rows" data-rows="ingredients">
              ${ingredients.map((ing, i) => ingredientRow(i, ing))}
            </div>
            <template data-template="ingredients">${ingredientRow(0)}</template>
            <button type="button" class="button button-soft" data-add-row="ingredients">${icon("plus", 16)} ${t("Add ingredient")}</button>
            <p class="muted small" data-price-help>${t("Each ingredient shows what Larder prices it at. If it has no price, or the price is wrong, add what you paid: it prices your recipes and shopping.")}</p>
            <datalist id="ingredient-catalog">${catalog.map((c) => html`<option value="${c}"></option>`)}</datalist>
          </section>

          <section class="panel stack">
            <h2 class="panel-title">${t("Method")}</h2>
            <p class="muted small" style="margin-top: -8px">${t("Keep each step to a sentence or two — cook mode shows them one at a time.")}</p>
            <div class="rows steps-rows" data-rows="steps">${steps.map((s) => stepRow(s))}</div>
            <template data-template="steps">${stepRow()}</template>
            <button type="button" class="button button-soft" data-add-row="steps">${icon("plus", 16)} ${t("Add step")}</button>
          </section>
          </div>

          <div class="form-actions">
            <a class="button button-ghost" href="${editing ? `/recipes/${recipeId}` : "/recipes"}">${t("Cancel")}</a>
            <button class="button" type="submit">${editing ? t("Save changes") : t("Publish recipe")}</button>
          </div>
        </form>`,
    }),
    status,
  );
}

export const routes: Route[] = [
  {
    // the page uploads a chosen photo straight away and keeps the reference
    method: "POST",
    path: "/images",
    auth: true,
    handler: async (ctx) => {
      const type = ctx.req.headers["content-type"] ?? "";
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of ctx.req) {
        size += (chunk as Buffer).length;
        if (size > MAX_IMAGE_BYTES) {
          logActivity({ actor: ctx.user, action: "recipe.image_rejected", outcome: "denied", detail: { reason: "too large" } });
          return json({ error: t("That photo is over 5 MB. Try a smaller one.") }, 413);
        }
        chunks.push(chunk as Buffer);
      }
      const bytes = Buffer.concat(chunks);
      if (!type.startsWith("image/")) return json({ error: t("That file isn't a JPEG, PNG or WebP photo.") }, 415);
      const check = checkImage(bytes);
      if (!check.ok) {
        logActivity({ actor: ctx.user, action: "recipe.image_rejected", outcome: "denied", detail: { reason: check.problem, bytes: bytes.length } });
        return json({ error: t(check.problem) }, 422);
      }
      return json({ url: saveImage(ctx.user!.id, bytes, check), width: check.width, height: check.height });
    },
  },
  {
    method: "GET",
    path: "/images/:id",
    handler: (ctx) => {
      const id = Number(ctx.params.id);
      const img = Number.isSafeInteger(id) ? loadImage(id) : undefined;
      if (!img) throw new HttpError(404, t("There's no image at this address."));
      return {
        status: 200,
        headers: { "content-type": img.mime, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
        body: Buffer.from(img.bytes),
      };
    },
  },
  {
    method: "GET",
    path: "/recipes",
    handler: (ctx) => {
      // live search swaps just the grid, without a page load
      if (ctx.url.searchParams.get("partial") === "1") {
        const s = browseState(ctx);
        // "Show more": only the tiles after the ones already on the page
        const from = Math.min(Math.max(Number.parseInt(ctx.url.searchParams.get("from") ?? "0", 10) || 0, 0), (s.pages - 1) * PAGE);
        const { recipes, total, grid } = results(ctx, s, from);
        const shown = from + recipes.length;
        return {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-result-count": encodeURIComponent(resultCount(total, shown)),
            // the next Show more link, or nothing when the list is complete
            "x-show-more": encodeURIComponent(showMore(s, shown, total).value),
          },
          body: grid.value,
        };
      }
      return htmlReply(page(ctx, { title: t("Recipes"), active: "recipes", body: browsePage(ctx) }));
    },
  },
  {
    method: "GET",
    path: "/recipes/new",
    auth: true,
    handler: (ctx) => recipeForm(ctx, {}, []),
  },
  {
    method: "POST",
    path: "/recipes/new",
    auth: true,
    handler: async (ctx) => {
      const { input, problems } = await readRecipeForm(ctx);
      if (problems.length) return recipeForm(ctx, input, problems, undefined, 422);
      const id = saveRecipe(ctx.user!.id, input);
      logActivity({ actor: ctx.user, action: "recipe.create", subject: input.title, detail: { recipe: id, visibility: input.visibility, ingredients: input.ingredients.length, steps: input.steps.length } });
      setFlash(ctx, t("Recipe published."));
      return redirect(`/recipes/${id}`);
    },
  },
  {
    method: "GET",
    path: "/recipes/:id",
    handler: (ctx) => {
      const recipe = visibleRecipe(ctx);
      return htmlReply(
        page(ctx, {
          title: recipe.title,
          active: "recipes",
          body: recipeDetail(ctx, recipe),
          headExtra: html`<script type="module" src="/assets/assistant.mjs"></script><script type="module" src="/assets/reviews.mjs"></script>`,
        }),
      );
    },
  },
  {
    // the checked answer as JSON, for the in-page assistant
    method: "GET",
    path: "/recipes/:id/ask",
    handler: (ctx) => {
      const recipe = visibleRecipe(ctx);
      const q = (ctx.url.searchParams.get("q") ?? "").slice(0, 200);
      if (!q.trim()) return text(t("Ask a question."), 400);
      const a = answerFor(recipe, recipeIngredients(recipe.id), q, ctx.user?.id ?? null);
      return {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        body: JSON.stringify({ ...a, html: answerBody(a).value, guard: foodGuard(a.facts + " " + q) }),
      };
    },
  },
  {
    method: "GET",
    path: "/recipes/:id/edit",
    auth: true,
    handler: (ctx) => {
      const recipe = ownRecipe(ctx);
      const input: RecipeInput = {
        ...recipe,
        image_url: recipe.image_url ?? undefined,
        ingredients: recipeIngredients(recipe.id).map((i) => ({ ...i, optional: !!i.optional })),
        steps: recipeSteps(recipe.id),
      };
      return recipeForm(ctx, input, [], recipe.id);
    },
  },
  {
    method: "POST",
    path: "/recipes/:id/edit",
    auth: true,
    handler: async (ctx) => {
      const recipe = ownRecipe(ctx);
      const { input, problems } = await readRecipeForm(ctx, recipe);
      if (problems.length) return recipeForm(ctx, { ...input, image_url: input.image_url ?? recipe.image_url ?? undefined }, problems, recipe.id, 422);
      saveRecipe(ctx.user!.id, input, recipe.id);
      logActivity({ actor: ctx.user, action: "recipe.update", subject: input.title, detail: { recipe: recipe.id, visibility: input.visibility, photo_changed: !!input.image_url && input.image_url !== recipe.image_url } });
      setFlash(ctx, t("Recipe saved."));
      return redirect(`/recipes/${recipe.id}`);
    },
  },
  {
    method: "POST",
    path: "/recipes/:id/delete",
    auth: true,
    handler: (ctx) => {
      const recipe = ownRecipe(ctx);
      deleteRecipe(recipe.id, ctx.user!.id);
      logActivity({ actor: ctx.user, action: "recipe.delete", subject: recipe.title, detail: { recipe: recipe.id } });
      setFlash(ctx, t("Deleted “{title}”.", { title: recipe.title }));
      return redirect("/recipes");
    },
  },
];
