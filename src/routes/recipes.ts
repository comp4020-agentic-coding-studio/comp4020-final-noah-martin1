import { catalogFor } from "../db.ts";
import { DIETARY_TAGS, money, today } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { type Ctx, HttpError, htmlReply, redirect, setFlash } from "../http.ts";
import { estimate, perServing } from "../nutrition.ts";
import {
  COURSES,
  cuisines,
  deleteRecipe,
  getRecipe,
  ingredientsFor,
  listVisibleRecipes,
  pantryMatch,
  parseRecipeForm,
  type Recipe,
  type RecipeIngredient,
  type RecipeInput,
  recipeIngredients,
  recipeSteps,
  saveRecipe,
  totalMinutes,
} from "../recipes.ts";
import { prefsFor } from "../prefs.ts";
import type { Route } from "../server.ts";
import { canSeeRecipe } from "../visibility.ts";
import { avatar, errors, icon, page, pageHeader, tone } from "../views/layout.ts";
import { liveCooksFor } from "./global.ts";

const VISIBILITY_LABEL = { public: "Public", friends: "Friends", private: "Only me" } as const;

export function visibilityBadge(v: Recipe["visibility"]): Html {
  return html`<span class="badge badge-${v}">${VISIBILITY_LABEL[v]}</span>`;
}

export function duration(minutes: number): string {
  if (minutes <= 0) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m}` : `${h} hr`;
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
export function recipeTile(r: Recipe, opts: { i?: number; live?: number; costCents?: number; kcal?: number } = {}): Html {
  const minutes = totalMinutes(r);
  const [fallback] = tone(r.title);
  return html`<a class="rx-tile" href="/recipes/${r.id}" style="--i: ${Math.min(opts.i ?? 0, 24)}">
    <div class="rx-photo">
      ${r.image_url
        ? html`<img src="${r.image_url}/medium" srcset="${r.image_url}/medium 350w, ${r.image_url}/large 500w, ${r.image_url} 700w" sizes="(max-width: 900px) 45vw, 240px" alt="" loading="lazy" decoding="async" />`
        : html`<div class="rx-photo-fallback" style="--fallback: ${fallback}"><span>${r.title.slice(0, 1)}</span></div>`}
      <div class="rx-badges">
        ${opts.live ? html`<span class="rx-glass rx-glass-live"><span class="live-dot"></span>${opts.live} cooking</span>` : html`<span></span>`}
        ${r.visibility !== "public" ? html`<span class="rx-glass">${VISIBILITY_LABEL[r.visibility]}</span>` : ""}
      </div>
      ${opts.costCents !== undefined && opts.costCents > 0
        ? html`<span class="rx-glass rx-price">${money(Math.round(opts.costCents))}<small>/serve</small></span>`
        : ""}
    </div>
    <div class="rx-info">
      <h3>${r.title}</h3>
      <div class="rx-facts">
        ${minutes ? html`<span>${icon("clock", 13)}${duration(minutes)}</span>` : ""}
        ${r.cuisine ? html`<span>${r.cuisine}</span>` : html`<span>by ${r.author_name.split(" ")[0]}</span>`}
      </div>
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
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "There's no recipe at this address.");
  return id;
}

// The recipe if the viewer may see it; otherwise 404, never 403, so a stranger
// can't learn that a private recipe exists.
export function visibleRecipe(ctx: Ctx): Recipe {
  const recipe = getRecipe(parseId(ctx));
  if (!recipe || !canSeeRecipe(ctx.user?.id ?? null, recipe)) {
    throw new HttpError(404, "There's no recipe at this address.");
  }
  return recipe;
}

function ownRecipe(ctx: Ctx): Recipe {
  const recipe = visibleRecipe(ctx);
  if (recipe.author_id !== ctx.user!.id) throw new HttpError(403, "Only the author can change this recipe.");
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
  mine: boolean;
}

function browseState(ctx: Ctx): BrowseState {
  const p = ctx.url.searchParams;
  const tag = p.get("tag") ?? "";
  const course = p.get("course") ?? "";
  return {
    q: (p.get("q") ?? "").trim().slice(0, 80),
    tag: (DIETARY_TAGS as readonly string[]).includes(tag) ? tag : "",
    course: COURSES.some((c) => c.key === course) ? course : "",
    cuisine: (p.get("cuisine") ?? "").slice(0, 40),
    mine: p.get("tab") === "mine" && !!ctx.user,
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
  const qs = p.toString();
  return qs ? `/recipes?${qs}` : "/recipes";
}

function chip(label: string, href: string, on: boolean, dot?: string): Html {
  return html`<a class="rx-chip" href="${href}" aria-pressed="${on ? "true" : "false"}" data-filter>${dot ? html`<span class="dot" style="--chip: ${dot}"></span>` : ""}${label}</a>`;
}

function results(ctx: Ctx, s: BrowseState): { recipes: Recipe[]; grid: Html } {
  const viewer = ctx.user?.id ?? null;
  const recipes = listVisibleRecipes(viewer, {
    authorId: s.mine ? viewer! : undefined,
    query: s.q,
    tag: s.tag === "quick" ? undefined : s.tag,
    maxMinutes: s.tag === "quick" ? 30 : undefined,
    course: s.course,
    cuisine: s.cuisine,
    order: s.mine && !s.q ? "newest" : "featured",
  });
  const lines = ingredientsFor(recipes.map((r) => r.id));
  const live = liveCooksFor(recipes.map((r) => r.title));
  const tiles = recipes.map((r, i) => {
    const n = perServing(estimate(lines.get(r.id) ?? []), r.servings);
    return recipeTile(r, { i, live: live.get(r.title), costCents: n.counted >= 2 ? n.costCents : undefined });
  });
  const grid = recipes.length
    ? html`${tiles}`
    : html`<div class="empty rx-empty">
        <p class="empty-title">${s.mine && !s.q && !s.tag ? "Your cookbook is empty" : "Nothing matches that"}</p>
        <p>${s.mine && !s.q && !s.tag ? "Write down something you cook often — it gets nutrition and cost worked out automatically." : "Try an ingredient you have, like “eggs” or “chickpeas”, or clear a filter."}</p>
        ${s.mine ? html`<a class="button" href="/recipes/new">${icon("plus", 16)} Write a recipe</a>` : html`<a class="button button-ghost" href="/recipes">Clear filters</a>`}
      </div>`;
  return { recipes, grid };
}

function browsePage(ctx: Ctx): Html {
  const s = browseState(ctx);
  const { recipes, grid } = results(ctx, s);
  const filtered = !!(s.q || s.tag || s.course || s.cuisine);
  const topCuisines = cuisines().slice(0, 9);
  const heading = s.mine
    ? "Your recipes"
    : s.q
      ? `Results for “${s.q}”`
      : s.course
        ? COURSES.find((c) => c.key === s.course)!.label
        : s.cuisine
          ? `${s.cuisine} recipes`
          : s.tag
            ? QUICK_FILTERS.find((f) => f.key === s.tag)?.label ?? "Recipes"
            : "Popular this week";
  return html`
    <section class="rx-hero">
      <div class="rx-hero-row">
        <div>
          <p class="eyebrow">Recipes</p>
          <h1>What are we cooking?</h1>
          <p class="lede">Search by dish or by what's already in the fridge. Every recipe works out its own nutrition and cost, and cooks one step at a time.</p>
        </div>
        <div class="page-actions">
          ${ctx.user
            ? html`<nav class="tabs" aria-label="Recipe lists">
                <a class="tab" href="${hrefWith(s, { mine: false })}" ${!s.mine ? raw('aria-current="page"') : ""}>Discover</a>
                <a class="tab" href="${hrefWith(s, { mine: true })}" ${s.mine ? raw('aria-current="page"') : ""}>My recipes</a>
              </nav>
              <a class="button" href="/recipes/new" aria-label="New recipe">${icon("plus", 16)} <span class="hide-sm">New recipe</span></a>`
            : ""}
        </div>
      </div>
      <form class="rx-search" method="get" action="/recipes" role="search" data-recipe-search>
        ${icon("search", 20)}
        ${s.mine ? html`<input type="hidden" name="tab" value="mine" />` : ""}
        ${s.course ? html`<input type="hidden" name="course" value="${s.course}" />` : ""}
        ${s.tag ? html`<input type="hidden" name="tag" value="${s.tag}" />` : ""}
        ${s.cuisine ? html`<input type="hidden" name="cuisine" value="${s.cuisine}" />` : ""}
        <input type="search" name="q" value="${s.q}" placeholder="Try “pad thai”, “eggs” or “chickpeas”" aria-label="Search recipes" autocomplete="off" />
        <button class="button" type="submit">Search</button>
      </form>
    </section>

    <nav class="rx-filters" aria-label="Filter recipes">
      ${chip("All", hrefWith(s, { course: "", tag: "", cuisine: "" }), !s.course && !s.tag && !s.cuisine)}
      ${COURSES.map((c) => chip(c.label, hrefWith(s, { course: s.course === c.key ? "" : c.key }), s.course === c.key))}
      <span class="rx-divider" aria-hidden="true"></span>
      ${QUICK_FILTERS.map((f) => chip(f.label, hrefWith(s, { tag: s.tag === f.key ? "" : f.key }), s.tag === f.key, f.dot))}
      <span class="rx-divider" aria-hidden="true"></span>
      ${topCuisines.map((c) => chip(c, hrefWith(s, { cuisine: s.cuisine === c ? "" : c }), s.cuisine === c))}
    </nav>

    <div class="rx-meta-row">
      <h2 data-results-heading>${heading}</h2>
      <span class="muted" data-results-count>${recipes.length} recipe${recipes.length === 1 ? "" : "s"}${filtered ? "" : " · photos from TheMealDB"}</span>
    </div>
    <div class="rx-grid" data-recipe-grid aria-live="polite">
      ${grid}
      ${skeletons(10)}
    </div>`;
}

/* ---------------- detail ---------------- */

const MACRO_COLOURS = { protein: "#e9a07a", carbs: "#e8c76a", fat: "#a99be0" };

function nutritionCard(lines: RecipeIngredient[], servings: number): Html {
  const total = estimate(lines);
  const n = perServing(total, servings);
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
    html`<li class="macro" style="--c: ${MACRO_COLOURS[key]}"><i></i><span>${label}</span><b>${Math.round(grams)} g</b>
      <span class="meter"><span style="--p: ${Math.min(100, Math.round((grams / daily) * 100))}%"></span></span></li>`;
  return html`<section class="rd-card" aria-labelledby="nutrition-h">
    <div class="rd-card-head"><h2 id="nutrition-h">Per serve</h2><span class="muted small">estimated</span></div>
    <div class="nutri">
      <div class="nutri-ring" role="img" aria-label="${kcal} calories per serve">
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
      <div><small>Cost per serve</small><strong>${money(Math.round(n.costCents))}</strong></div>
      <div style="text-align: right"><small>Whole recipe</small><strong data-scale-cost data-base="${Math.round(total.costCents)}">${money(Math.round(total.costCents))}</strong></div>
    </div>
    <p class="estimate-note">Worked out automatically from ${total.counted} of ${total.total} ingredients at typical Australian supermarket prices. Seasonings to taste aren't counted.</p>
  </section>`;
}

function ingredientsCard(ctx: Ctx, recipe: Recipe, lines: RecipeIngredient[]): Html {
  const match = ctx.user ? pantryMatch(ctx.user.id, lines) : null;
  return html`<section class="rd-card" aria-labelledby="ingredients-h">
    <div class="rd-card-head">
      <h2 id="ingredients-h">Ingredients</h2>
      <div class="servings" data-servings data-base="${recipe.servings}">
        <button type="button" data-servings-step="-1" aria-label="Fewer servings">−</button>
        <output aria-live="polite"><span data-servings-value>${recipe.servings}</span> serves</output>
        <button type="button" data-servings-step="1" aria-label="More servings">+</button>
      </div>
    </div>
    <ul class="ing-list">
      ${lines.map((ing) => {
        const have = match?.have.has(ing.ingredient_id);
        return html`<li>
          <label class="ing-check"><input type="checkbox" aria-label="Got ${ing.name}" />${icon("check", 12)}</label>
          <span class="ing-amount" data-qty="${ing.quantity ?? ""}" data-unit="${ing.unit}">${amount(ing.quantity, ing.unit)}</span>
          <span class="ing-name">${ing.name}${ing.note || ing.optional ? html`<small>${[ing.note, ing.optional && !/serve|garnish/.test(ing.note) ? "optional" : ""].filter(Boolean).join(" · ")}</small>` : ""}</span>
          ${match && !ing.optional ? html`<span class="ing-flag ${have ? "ing-flag-have" : "ing-flag-need"}">${have ? "Have" : "Need"}</span>` : ""}
        </li>`;
      })}
    </ul>
    ${match
      ? html`<p class="estimate-note">${match.missing === 0 ? "You have everything for this one." : `You're missing ${match.missing} ingredient${match.missing === 1 ? "" : "s"}${match.priced ? `, about ${money(match.estCents)} at what you last paid` : ""}.`}</p>`
      : ""}
  </section>`;
}

function planCard(ctx: Ctx, recipe: Recipe): Html {
  if (!ctx.user) {
    return html`<section class="rd-card">
      <h2 style="font-size: 18px; margin-bottom: 8px">Save it for later</h2>
      <p class="muted small" style="margin-bottom: 16px">With a free account you can add this to your meal calendar, see what's already in your pantry and cook live with friends.</p>
      <a class="button button-block" href="/register">Join free</a>
    </section>`;
  }
  return html`<section class="rd-card">
    <h2 style="font-size: 18px; margin-bottom: 14px">Add to my calendar</h2>
    <form method="post" action="/calendar" class="plan-form">
      <input type="hidden" name="recipe_id" value="${recipe.id}" />
      <input type="hidden" name="return_to" value="/recipes/${recipe.id}" />
      <div class="field-pair">
        <label class="field"><span>Date</span><input type="date" name="date" required value="${today()}" /></label>
        <label class="field"><span>Meal</span>
          <select name="meal"><option value="dinner">Dinner</option><option value="lunch">Lunch</option><option value="breakfast">Breakfast</option></select></label>
      </div>
      <label class="check-inline"><input type="checkbox" name="shared" value="1" checked /> <span>Share with friends</span></label>
      <button class="button button-soft button-block" type="submit">${icon("calendar", 16)} Add to calendar</button>
    </form>
  </section>`;
}

function recipeDetail(ctx: Ctx, recipe: Recipe): Html {
  const lines = recipeIngredients(recipe.id);
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
  const fill = more.length < 6
    ? listVisibleRecipes(ctx.user?.id ?? null, { course: recipe.course || undefined, excludeId: recipe.id, order: "featured", limit: 12 })
        .filter((r) => !more.some((m) => m.id === r.id))
        .slice(0, 6 - more.length)
    : [];
  const [fallback] = tone(recipe.title);

  return html`<article class="rd">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/recipes">Recipes</a><span>/</span>${recipe.cuisine ? html`<a href="/recipes?cuisine=${encodeURIComponent(recipe.cuisine)}">${recipe.cuisine}</a><span>/</span>` : ""}<span>${recipe.title}</span></nav>

    <header class="rd-top">
      <div class="rd-photo">
        ${recipe.image_url
          ? html`<img src="${recipe.image_url}" alt="${recipe.title}" />`
          : html`<div class="rx-photo-fallback" style="--fallback: ${fallback}"><span>${recipe.title.slice(0, 1)}</span></div>`}
        ${live ? html`<div class="rx-badges"><span class="rx-glass rx-glass-live"><span class="live-dot"></span>${live} cooking now</span><span></span></div>` : ""}
      </div>
      <div class="rd-head">
        <div class="tags">
          ${recipe.visibility !== "public" ? visibilityBadge(recipe.visibility) : ""}
          ${recipe.cuisine ? html`<span class="tag" style="background: var(--peach); color: var(--peach-ink)">${recipe.cuisine}</span>` : ""}
          ${recipe.dietary_tags.map((t) => html`<span class="tag">${t}</span>`)}
        </div>
        <h1>${recipe.title}</h1>
        ${recipe.description ? html`<p class="lede">${recipe.description}</p>` : ""}
        <p class="rd-byline">${avatar(recipe.author_name, "sm")} <span>Recipe by <a href="/u/${recipe.author_username}">${recipe.author_name}</a></span></p>
        <dl class="rd-times">
          <div class="rd-time"><dt>${icon("leaf", 14)} Prep</dt><dd>${recipe.prep_minutes ? html`${recipe.prep_minutes}<small>min</small>` : "—"}</dd></div>
          <div class="rd-time"><dt>${icon("flame", 14)} Cook</dt><dd>${cook ? (cook >= 60 ? duration(cook) : html`${cook}<small>min</small>`) : "—"}</dd></div>
          <div class="rd-time"><dt>${icon("users", 14)} Serves</dt><dd>${recipe.servings}</dd></div>
          <div class="rd-time"><dt>${icon("check", 14)} Steps</dt><dd>${steps.length}</dd></div>
        </dl>
        <div class="rd-actions">
          <a class="button button-large button-accent" href="/recipes/${recipe.id}/cook">${icon("cook", 18)} Start cooking</a>
          <button class="button button-large button-ghost" type="button" data-print>${icon("print", 18)} Print</button>
          ${mine
            ? html`<a class="button button-large button-ghost" href="/recipes/${recipe.id}/edit">Edit</a>
                <form method="post" action="/recipes/${recipe.id}/delete" data-confirm="Delete this recipe? Planned meals using it are removed too.">
                  <button class="button button-large button-danger" type="submit">Delete</button>
                </form>`
            : ""}
        </div>
      </div>
    </header>

    <div class="rd-body">
      <aside class="rd-side">
        ${ingredientsCard(ctx, recipe, lines)}
        ${nutritionCard(lines, recipe.servings)}
        ${planCard(ctx, recipe)}
      </aside>

      <div>
        <section class="rd-card" aria-labelledby="method-h">
          <div class="rd-card-head"><h2 id="method-h">Method</h2><span class="muted small">${steps.length} steps${cook ? ` · ${duration(cook)} cooking` : ""}</span></div>
          <ol class="method">
            ${steps.map(
              (s) => html`<li>
                <span class="method-num">${s.step_number}</span>
                <div>
                  <p>${s.text}</p>
                  ${s.est_minutes ? html`<button class="timer-chip" type="button" data-timer="${s.est_minutes * 60}">${icon("timer", 14)} <span>${duration(s.est_minutes)} timer</span></button>` : ""}
                </div>
              </li>`,
            )}
          </ol>
        </section>

        <section class="cook-cta">
          <div class="cook-cta-art">${icon("cook", 32)}</div>
          <div>
            <h3>Phone on the bench?</h3>
            <p>Cook mode shows one big step at a time, with timers. ${recipe.visibility === "public" ? "Go live and cooks around the world can follow along and answer questions." : ""}</p>
          </div>
          <a class="button button-large" href="/recipes/${recipe.id}/cook">Cook step by step ${icon("arrow", 18)}</a>
        </section>
      </div>
    </div>

    ${more.length + fill.length
      ? html`<section class="more-like">
          <div class="rx-meta-row"><h2>You might also like</h2><a class="muted small" href="/recipes${recipe.course ? `?course=${recipe.course}` : ""}">See all →</a></div>
          <div class="rx-grid">${[...more, ...fill].map((r, i) => recipeTile(r, { i }))}</div>
        </section>`
      : ""}
  </article>`;
}

/* ---------------- editor ---------------- */

function ingredientRow(i: number, ing?: RecipeInput["ingredients"][number]): Html {
  return html`<div class="row-editor" data-row>
    <input name="ing_qty" inputmode="decimal" placeholder="Qty" aria-label="Quantity" value="${ing?.quantity ?? ""}" class="w-qty" />
    <input name="ing_unit" placeholder="Unit" aria-label="Unit" value="${ing?.unit ?? ""}" class="w-unit" />
    <input name="ing_name" placeholder="Ingredient" aria-label="Ingredient" list="ingredient-catalog" value="${ing?.name ?? ""}" class="grow" />
    <label class="check-inline" title="Optional ingredient"><input type="checkbox" name="ing_optional" value="${i}" ${ing?.optional ? raw("checked") : ""} /> <span>Optional</span></label>
    <button type="button" class="icon-button" data-remove-row aria-label="Remove ingredient">×</button>
  </div>`;
}

function stepRow(step?: RecipeInput["steps"][number]): Html {
  return html`<div class="row-editor step-editor" data-row>
    <span class="step-num" aria-hidden="true"></span>
    <textarea name="step_text" rows="2" placeholder="Describe this step" aria-label="Step" class="grow">${step?.text ?? ""}</textarea>
    <input name="step_minutes" inputmode="numeric" placeholder="Min" aria-label="Minutes" value="${step?.est_minutes ?? ""}" class="w-qty" />
    <button type="button" class="icon-button" data-remove-row aria-label="Remove step">×</button>
  </div>`;
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
      title: editing ? "Edit recipe" : "New recipe",
      active: "recipes",
      body: html`
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/recipes">Recipes</a><span>/</span><span>${editing ? "Edit" : "New recipe"}</span></nav>
        ${pageHeader(editing ? "Edit recipe" : "Write a recipe", "Use the ingredient names you stock — calories, macros and cost are worked out automatically, and the recipe links to your pantry.")}
        ${errors(problems)}
        <form method="post" action="${editing ? `/recipes/${recipeId}/edit` : "/recipes/new"}" class="form-grid">
          <section class="panel stack">
            <h2 class="panel-title">Basics</h2>
            <label class="field"><span>Title</span>
              <input name="title" required maxlength="120" value="${input.title ?? ""}" placeholder="e.g. Nonna's Sunday ragu" /></label>
            <label class="field"><span>Description</span>
              <textarea name="description" rows="3" maxlength="2000" placeholder="What makes it good, in a sentence or two">${input.description ?? ""}</textarea></label>
            <div class="field-row">
              <label class="field"><span>Serves</span>
                <input name="servings" type="number" min="1" max="50" required value="${input.servings ?? prefs.default_servings}" /></label>
              <fieldset class="field">
                <legend>Who can see it</legend>
                <div class="segmented">
                  ${(["public", "friends", "private"] as const).map(
                    (v) => html`<label><input type="radio" name="visibility" value="${v}" ${v === vis ? raw("checked") : ""} /><span>${VISIBILITY_LABEL[v]}</span></label>`,
                  )}
                </div>
              </fieldset>
            </div>
            <fieldset class="field">
              <legend>Dietary tags</legend>
              <div class="chips">
                ${DIETARY_TAGS.map(
                  (t) => html`<label class="chip"><input type="checkbox" name="tags" value="${t}" ${input.dietary_tags?.includes(t) ? raw("checked") : ""} /><span>${t}</span></label>`,
                )}
              </div>
            </fieldset>
          </section>

          <section class="panel stack">
            <h2 class="panel-title">Ingredients</h2>
            <div class="rows" data-rows="ingredients">
              ${ingredients.map((ing, i) => ingredientRow(i, ing))}
            </div>
            <template data-template="ingredients">${ingredientRow(0)}</template>
            <button type="button" class="button button-soft" data-add-row="ingredients">${icon("plus", 16)} Add ingredient</button>
            <datalist id="ingredient-catalog">${catalog.map((c) => html`<option value="${c}"></option>`)}</datalist>
          </section>

          <section class="panel stack">
            <h2 class="panel-title">Method</h2>
            <p class="muted small" style="margin-top: -8px">Keep each step to a sentence or two — cook mode shows them one at a time.</p>
            <div class="rows steps-rows" data-rows="steps">${steps.map((s) => stepRow(s))}</div>
            <template data-template="steps">${stepRow()}</template>
            <button type="button" class="button button-soft" data-add-row="steps">${icon("plus", 16)} Add step</button>
          </section>

          <div class="form-actions">
            <a class="button button-ghost" href="${editing ? `/recipes/${recipeId}` : "/recipes"}">Cancel</a>
            <button class="button" type="submit">${editing ? "Save changes" : "Publish recipe"}</button>
          </div>
        </form>`,
    }),
    status,
  );
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/recipes",
    handler: (ctx) => {
      // live search swaps just the grid, without a page load
      if (ctx.url.searchParams.get("partial") === "1") {
        const s = browseState(ctx);
        const { recipes, grid } = results(ctx, s);
        return {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "x-result-count": String(recipes.length) },
          body: grid.value,
        };
      }
      return htmlReply(page(ctx, { title: "Recipes", active: "recipes", body: browsePage(ctx) }));
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
      const { input, problems } = parseRecipeForm(await ctx.form());
      if (problems.length) return recipeForm(ctx, input, problems, undefined, 422);
      const id = saveRecipe(ctx.user!.id, input);
      setFlash(ctx, "Recipe published.");
      return redirect(`/recipes/${id}`);
    },
  },
  {
    method: "GET",
    path: "/recipes/:id",
    handler: (ctx) => {
      const recipe = visibleRecipe(ctx);
      return htmlReply(page(ctx, { title: recipe.title, active: "recipes", body: recipeDetail(ctx, recipe) }));
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
      const { input, problems } = parseRecipeForm(await ctx.form());
      if (problems.length) return recipeForm(ctx, input, problems, recipe.id, 422);
      saveRecipe(ctx.user!.id, input, recipe.id);
      setFlash(ctx, "Recipe saved.");
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
      setFlash(ctx, `Deleted “${recipe.title}”.`);
      return redirect("/recipes");
    },
  },
];
