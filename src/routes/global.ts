import { type Html, html, raw } from "../html.ts";
import { type Ctx, HttpError, htmlReply } from "../http.ts";
import { catalogueByTitle, ingredientsFor, pantryMatch, recipeSteps } from "../recipes.ts";
import { GLOBAL_SESSIONS, RECIPE_LIVE_COOKS, type SampleGlobalSession } from "../samples.ts";
import type { Route } from "../server.ts";
import { avatar, icon, page, previewBanner } from "../views/layout.ts";
import { amount } from "./recipes.ts";

// The live globe: anyone in the world cooking a public recipe right now,
// pinned where they are. Open to everyone, signed in or not — watching
// someone cook gives nothing personal away. Sessions are sample data until
// live cook sessions land (crit 9); the recipes behind them are real.

function firstName(name: string): string {
  return name.split(" ")[0];
}

export interface LiveSession {
  id: number;
  cook: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  recipeId: number;
  recipe: string;
  cuisine: string;
  image: string | null;
  serves: number;
  started: string;
  step: number;
  steps: string[];
  ingredients: { amount: string; name: string }[];
  ingredientIds: number[];
  watching: number;
  language: string;
  tags: string[];
  helpRequest?: SampleGlobalSession["helpRequest"];
  questions: SampleGlobalSession["questions"];
  // signed-in viewers: how many of this recipe's ingredients they have
  have?: number;
  total?: number;
}

// Sample sessions joined to their real catalogue recipes. Sessions whose
// recipe isn't in the catalogue are skipped, so a link is never dead.
export function liveSessions(viewerId: number | null): LiveSession[] {
  const recipes = catalogueByTitle([...new Set(GLOBAL_SESSIONS.map((s) => s.recipe))]);
  const lines = ingredientsFor([...recipes.values()].map((r) => r.id));
  const out: LiveSession[] = [];
  for (const s of GLOBAL_SESSIONS) {
    const r = recipes.get(s.recipe);
    if (!r) continue;
    const steps = recipeSteps(r.id).map((x) => x.text);
    const ing = lines.get(r.id) ?? [];
    const scale = s.serves / r.servings;
    const live: LiveSession = {
      id: s.id,
      cook: s.cook,
      city: s.city,
      country: s.country,
      lat: s.lat,
      lng: s.lng,
      recipeId: r.id,
      recipe: r.title,
      cuisine: r.cuisine,
      image: r.image_url,
      serves: s.serves,
      started: s.started,
      step: Math.min(s.step, steps.length),
      steps,
      ingredients: ing.map((l) => ({ amount: amount(l.quantity === null ? null : l.quantity * scale, l.unit), name: l.name })),
      ingredientIds: ing.filter((l) => !l.optional).map((l) => l.ingredient_id),
      watching: s.watching,
      language: s.language,
      tags: r.dietary_tags,
      helpRequest: s.helpRequest,
      questions: s.questions,
    };
    if (viewerId !== null) {
      const m = pantryMatch(viewerId, ing);
      live.total = live.ingredientIds.length;
      live.have = live.total - m.missing;
    }
    out.push(live);
  }
  return out;
}

// How many people are cooking each recipe right now, worldwide.
export function liveCooksFor(titles: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of titles) {
    const friends = RECIPE_LIVE_COOKS[t]?.length ?? 0;
    const world = GLOBAL_SESSIONS.filter((s) => s.recipe.toLowerCase() === t.toLowerCase()).length;
    if (friends + world) out.set(t, friends + world);
  }
  return out;
}

function sessionCard(s: LiveSession): Html {
  const pct = Math.round((s.step / Math.max(1, s.steps.length)) * 100);
  return html`<li>
    <button class="gl-row" type="button" data-session="${s.id}">
      <span class="gl-thumb">${s.image ? html`<img src="${s.image}/small" alt="" loading="lazy" />` : ""}<span class="live-dot"></span></span>
      <span class="gl-row-text">
        <strong>${s.recipe}</strong>
        <small>${firstName(s.cook)} · ${s.city}</small>
        <span class="gl-row-step"><span class="progress" style="--p: ${pct}%"><span></span></span><em>Step ${s.step}/${s.steps.length}</em></span>
      </span>
      ${s.helpRequest ? html`<span class="gl-help-dot" title="Asking for help">?</span>` : ""}
    </button>
  </li>`;
}

function detail(s: LiveSession, signedIn: boolean, open = false): Html {
  return html`<article class="gl-detail" data-detail="${s.id}" ${open ? "" : raw("hidden")}>
    <div class="gl-detail-photo">
      ${s.image ? html`<img src="${s.image}" alt="${s.recipe}" loading="lazy" />` : ""}
      <button class="gl-close" type="button" data-close aria-label="Close">${icon("close", 18)}</button>
      <span class="rx-glass rx-glass-live"><span class="live-dot"></span>Live · ${s.started}</span>
    </div>
    <div class="gl-detail-body">
      <p class="gl-who">${avatar(s.cook, "sm")}<span><strong>${s.cook}</strong> · ${s.city}, ${s.country}</span></p>
      <h2>${s.recipe}</h2>
      <p class="gl-meta"><span>${icon("users", 14)} Cooking for ${s.serves}</span><span>${icon("live", 14)} ${s.watching} watching</span>${s.cuisine ? html`<span>${s.cuisine}</span>` : ""}</p>

      <div class="gl-step">
        <div class="gl-step-head"><span class="cm-step-num">Step ${s.step} of ${s.steps.length}</span><span class="progress" style="--p: ${Math.round((s.step / Math.max(1, s.steps.length)) * 100)}%"><span></span></span></div>
        <p>${s.steps[s.step - 1] ?? ""}</p>
        ${s.steps[s.step] ? html`<small>Next: ${s.steps[s.step]}</small>` : ""}
      </div>

      ${s.helpRequest
        ? html`<div class="gl-help">
            <p class="gl-help-label">${icon("bolt", 14)} ${firstName(s.cook)} is asking for help</p>
            <p>${s.helpRequest.text}</p>
            ${s.helpRequest.original ? html`<p class="gl-original" lang="">Translated from ${s.language} · <span>“${s.helpRequest.original}”</span></p>` : ""}
          </div>`
        : ""}

      <details class="gl-ings">
        <summary>Ingredients <span class="muted">${s.ingredients.length}${s.have !== undefined ? html` · you have ${s.have}` : ""}</span></summary>
        <ul class="ing-list">${s.ingredients.map((i) => html`<li><span class="ing-amount">${i.amount}</span><span class="ing-name">${i.name}</span></li>`)}</ul>
      </details>

      <section class="gl-qa" aria-label="Questions">
        <h3>Questions</h3>
        ${s.questions.length
          ? html`<ul class="gl-thread">${s.questions.map(
              (q) => html`<li>
                ${avatar(q.who, "sm")}
                <div>
                  <p><strong>${q.who}</strong> <span class="muted">· ${q.country} · ${q.when}</span></p>
                  <p>${q.text}</p>
                  ${q.original ? html`<p class="gl-original">Translated · “${q.original}”</p>` : ""}
                  ${q.answer ? html`<p class="gl-answer"><strong>${firstName(s.cook)}:</strong> ${q.answer}</p>` : ""}
                </div>
              </li>`,
            )}</ul>`
          : html`<p class="muted small">No questions yet — ask the first one.</p>`}
        <form class="gl-ask" data-ask>
          <fieldset disabled class="bare">
            <input placeholder="${signedIn ? `Ask ${firstName(s.cook)}, e.g. “can I use butter instead?”` : "Sign in to ask a question"}" aria-label="Ask a question" />
            <button class="button button-small" type="button">Ask</button>
          </fieldset>
        </form>
        <p class="estimate-note">Questions are translated into ${firstName(s.cook)}'s language and answers back into yours. If translation is slow, you'll see the original text.</p>
      </section>

      <div class="gl-actions">
        <a class="button button-accent" href="/recipes/${s.recipeId}/cook">${icon("cook", 16)} Cook along</a>
        <a class="button button-ghost" href="/recipes/${s.recipeId}">View recipe</a>
      </div>
    </div>
  </article>`;
}

function globePage(ctx: Ctx): Html {
  const sessions = liveSessions(ctx.user?.id ?? null);
  const cuisines = [...new Set(sessions.map((s) => s.cuisine).filter(Boolean))].sort();
  const countries = new Set(sessions.map((s) => s.country)).size;
  const helping = sessions.filter((s) => s.helpRequest).length;
  // what the globe script reads; escaped so no title can break out of the tag
  const payload = JSON.stringify(
    sessions.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, recipe: s.recipe, cook: s.cook, city: s.city, cuisine: s.cuisine, tags: s.tags, have: s.have, total: s.total, help: !!s.helpRequest, step: s.step, steps: s.steps.length })),
  ).replace(/</g, "\\u003c");

  return html`
    <section class="gl" data-gl>
      <div class="gl-stage" data-globe data-mask="/assets/textures/earth-mask.png">
        <canvas aria-label="Globe of people cooking live around the world. Use the list to browse sessions."></canvas>
        <div class="gl-loading" aria-hidden="true"><span></span></div>
      </div>

      <header class="gl-hero">
        <p class="eyebrow"><span class="live-dot"></span> ${sessions.length} people cooking right now</p>
        <h1>Cooking, live,<br />all over the world.</h1>
        <p class="lede">Spin the globe and tap a pan to see what someone's making, the step they're on, and ask them anything — in your language.</p>
        <dl class="gl-stats">
          <div><dt>Live</dt><dd>${sessions.length}</dd></div>
          <div><dt>Countries</dt><dd>${countries}</dd></div>
          <div><dt>Asking for help</dt><dd>${helping}</dd></div>
        </dl>
      </header>

      <aside class="gl-panel" aria-label="Live sessions">
        <div class="gl-filters" role="group" aria-label="Filter live cooks">
          <button class="rx-chip" type="button" data-filter="all" aria-pressed="true">All</button>
          ${ctx.user ? html`<button class="rx-chip" type="button" data-filter="fridge" aria-pressed="false"><span class="dot" style="--chip: var(--sage)"></span>From my fridge</button>` : ""}
          <button class="rx-chip" type="button" data-filter="help" aria-pressed="false"><span class="dot" style="--chip: var(--peach)"></span>Needs help</button>
          <button class="rx-chip" type="button" data-filter="vegetarian" aria-pressed="false"><span class="dot" style="--chip: var(--butter)"></span>Vegetarian</button>
          <label class="gl-cuisine"><span class="sr-only">Cuisine</span>
            <select data-cuisine>
              <option value="">Any cuisine</option>
              ${cuisines.map((c) => html`<option value="${c}">${c}</option>`)}
            </select>
          </label>
        </div>
        <ul class="gl-list" data-gl-list>${sessions.map(sessionCard)}</ul>
        <p class="gl-empty muted small" data-gl-empty hidden>No one matching that is cooking right now.</p>
        ${ctx.user
          ? html`<p class="estimate-note">“From my fridge” shows cooks making something you have most of the ingredients for.</p>`
          : html`<p class="estimate-note"><a href="/register">Join free</a> to filter by what's in your fridge and go live yourself.</p>`}
      </aside>

      <div class="gl-details" data-gl-details>${sessions.map((s) => detail(s, !!ctx.user))}</div>

      <div class="gl-foot">
        ${previewBanner("Crit 9", "Cooks and questions here are sample data; the recipes are real. Live sessions arrive over WebSockets in crit 9.")}
        <section class="gl-how">
          <h2>How someone appears here</h2>
          <ol class="how-steps">
            <li><strong>Pick a recipe</strong> from the catalogue — or write your own; nutrition and cost are worked out for you.</li>
            <li><strong>Start cooking</strong> and share your rough location. Your pan appears on the globe.</li>
            <li><strong>Each step you tap through</strong> updates live, so watchers always see where you're up to.</li>
            <li><strong>Get help</strong> — questions arrive translated, and you can answer with a thumb while you stir.</li>
          </ol>
        </section>
      </div>
    </section>
    <script type="application/json" id="globe-data">${raw(payload)}</script>
    <script type="importmap">${raw(JSON.stringify({ imports: { three: "/assets/vendor/three.module.min.js", "three/addons/": "/assets/vendor/addons/" } }))}</script>
    <script type="module" src="/assets/globe.mjs"></script>
    <script type="module" src="/assets/globe-ui.mjs"></script>`;
}

function sessionFor(ctx: Ctx): LiveSession {
  const s = liveSessions(ctx.user?.id ?? null).find((x) => x.id === Number(ctx.params.id));
  if (!s) throw new HttpError(404, "That cooking session has ended or never existed.");
  return s;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/global",
    handler: (ctx) => htmlReply(page(ctx, { title: "Live around the world", active: "global", body: globePage(ctx), mainClass: "main-globe" })),
  },
  {
    // a shareable link straight to one session's card
    method: "GET",
    path: "/global/:id",
    handler: (ctx) => {
      const s = sessionFor(ctx);
      return htmlReply(
        page(ctx, {
          title: `${firstName(s.cook)} is cooking ${s.recipe}`,
          active: "global",
          body: html`<div class="gl-solo">${previewBanner("Crit 9", "A sample live session; the recipe is real.")}${detail(s, !!ctx.user, true)}</div>`,
        }),
      );
    },
  },
];

