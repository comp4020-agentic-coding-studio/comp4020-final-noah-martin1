import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ago } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { type Ctx, HttpError, htmlReply, json, type Reply, redirect, setFlash } from "../http.ts";
import { type LocalTime, localTime, MEAL_LABEL } from "../localtime.ts";
import {
  answerQuestion,
  askQuestion,
  type CookSession,
  getSession,
  isLive,
  type LiveEvent,
  liveBus,
  liveSessions as openSessions,
  publicLiveCounts,
  QUESTION_MAX,
  questionsFor,
  sessionVersion,
} from "../live.ts";
import { catalogueByTitle, ingredientsFor, pantryMatch, type RecipeIngredient, recipeSteps } from "../recipes.ts";
import { GLOBAL_SESSIONS, type SampleGlobalSession } from "../samples.ts";
import type { Route } from "../server.ts";
import { canSeeSession, friendIds, sessionViewer } from "../visibility.ts";
import { avatar, icon, page, previewBanner } from "../views/layout.ts";
import { amount } from "./recipes.ts";

// The live globe: everyone cooking right now that the viewer may see, pinned
// where they are (city-level), with friends first. Open to everyone, signed
// in or not. Real sessions come from src/live.ts and update over Server-Sent
// Events; a layer of clearly tagged demo cooks (src/samples.ts) keeps the
// globe from ever sitting empty, under the preview banner.

function firstName(name: string): string {
  return name.split(" ")[0];
}

type Group = "mine" | "friends" | "live" | "demo";

interface ThreadItem {
  who: string;
  country?: string;
  text: string;
  original?: string;
  answer?: string;
  when: string;
}

export interface GlobeSession {
  id: string;
  kind: "live" | "demo";
  group: Group;
  cook: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
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
  help: { text: string; original?: string } | null;
  questions: ThreadItem[];
  visibility: "public" | "friends" | "private";
  v: string;
  // what time it is where they are ("7:42 pm", dinner), when that's known
  local: LocalTime | null;
  // signed-in viewers: how many of this recipe's ingredients they have
  have?: number;
  total?: number;
}

interface Viewer {
  id: number | null;
  friends: Set<number>;
  see: (s: CookSession) => boolean;
}

function viewerFor(ctx: Ctx): Viewer {
  const id = ctx.user?.id ?? null;
  return { id, friends: new Set(id === null ? [] : friendIds(id)), see: sessionViewer(id) };
}

function scaled(lines: RecipeIngredient[], scale: number) {
  return lines.map((l) => ({ amount: amount(l.quantity === null ? null : l.quantity * scale, l.unit), name: l.name }));
}

function withPantry(g: GlobeSession, viewerId: number | null, lines: RecipeIngredient[]): GlobeSession {
  if (viewerId === null) return g;
  const m = pantryMatch(viewerId, lines);
  g.total = g.ingredientIds.length;
  g.have = g.total - m.missing;
  return g;
}

const GROUP_ORDER: Record<Group, number> = { mine: 0, friends: 1, live: 2, demo: 3 };

// Real sessions the viewer may see, as the page shows them.
function realSessions(viewer: Viewer, rows: CookSession[] = openSessions().filter(viewer.see)): GlobeSession[] {
  const lines = ingredientsFor([...new Set(rows.map((s) => s.recipe_id))]);
  return rows.map((s) => {
    const steps = recipeSteps(s.recipe_id).map((x) => x.text);
    const ing = lines.get(s.recipe_id) ?? [];
    const g: GlobeSession = {
      id: String(s.id),
      kind: "live",
      group: s.user_id === viewer.id ? "mine" : viewer.friends.has(s.user_id) ? "friends" : "live",
      cook: s.display_name,
      city: s.city,
      country: s.country,
      lat: s.lat,
      lng: s.lng,
      recipeId: s.recipe_id,
      recipe: s.recipe_title,
      cuisine: s.cuisine,
      image: s.image_url,
      serves: s.serves,
      started: ago(s.started_at),
      step: Math.max(1, Math.min(s.current_step, steps.length)),
      steps,
      ingredients: scaled(ing, s.serves / s.recipe_servings),
      ingredientIds: ing.filter((l) => !l.optional).map((l) => l.ingredient_id),
      watching: watcherCount(s.id, s.user_id),
      language: "",
      tags: s.dietary_tags,
      help: s.help_text ? { text: s.help_text } : null,
      questions: questionsFor(s.id).map((q) => ({ who: q.asker_name, text: q.text, answer: q.answer ?? undefined, when: ago(q.asked_at) })),
      visibility: s.visibility,
      v: sessionVersion(s),
      local: localTime(s.city, s.lat, s.lng),
    };
    return withPantry(g, viewer.id, ing);
  });
}

// Demo cooks keep sensible hours: nobody's shown making carbonara at 3 am
// local time. Over a day the globe's cooks move west with the evening.
export function awakeAt(local: LocalTime | null): boolean {
  return !local || (local.hour >= 6 && local.hour < 23);
}

// Sample cooks joined to their real catalogue recipes; a sample whose recipe
// isn't in the catalogue is skipped, so a link is never dead. Only those for
// whom it's a waking hour are cooking (`now` is for the spec).
function demoSessions(viewerId: number | null, now = new Date()): GlobeSession[] {
  const recipes = catalogueByTitle([...new Set(GLOBAL_SESSIONS.map((s) => s.recipe))]);
  const lines = ingredientsFor([...recipes.values()].map((r) => r.id));
  const out: GlobeSession[] = [];
  for (const s of GLOBAL_SESSIONS) {
    const r = recipes.get(s.recipe);
    const local = localTime(s.city, s.lat, s.lng, now);
    if (!r || !awakeAt(local)) continue;
    const steps = recipeSteps(r.id).map((x) => x.text);
    const ing = lines.get(r.id) ?? [];
    const g: GlobeSession = {
      id: `demo-${s.id}`,
      kind: "demo",
      group: "demo",
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
      ingredients: scaled(ing, s.serves / r.servings),
      ingredientIds: ing.filter((l) => !l.optional).map((l) => l.ingredient_id),
      watching: s.watching,
      language: s.language,
      tags: r.dietary_tags,
      help: s.helpRequest ? { text: s.helpRequest.text, original: s.helpRequest.original } : null,
      questions: s.questions as SampleGlobalSession["questions"],
      visibility: "public",
      v: "demo",
      local,
    };
    out.push(withPantry(g, viewerId, ing));
  }
  return out;
}

function allSessions(viewer: Viewer, now?: Date): GlobeSession[] {
  return [...realSessions(viewer), ...demoSessions(viewer.id, now)].sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);
}

// How many people are cooking each recipe right now, worldwide (sessions
// anyone may see), for "2 cooking now" on recipe tiles.
export function liveCooksFor(titles: string[]): Map<string, number> {
  return publicLiveCounts(titles);
}

/* ---------------- markup ---------------- */

function pct(s: GlobeSession): number {
  return Math.round((s.step / Math.max(1, s.steps.length)) * 100);
}

function tag(s: GlobeSession): Html {
  return s.kind === "live"
    ? html`<span class="gl-tag gl-tag-live">Live</span>`
    : html`<span class="gl-tag gl-tag-demo" title="Sample data">Demo</span>`;
}

// "7:42 pm there" with a "dinner" pill, kept ticking by the page (data-local holds the
// zone's offset from UTC in minutes)
function clock(s: GlobeSession, withMeal = true): Html {
  if (!s.local) return html``;
  return html`<span class="gl-local gl-local-${s.local.meal}" data-local="${s.local.offset}" ${withMeal ? raw("data-meal") : ""}><time>${s.local.time}</time>${withMeal ? html` there <span>${MEAL_LABEL[s.local.meal]}</span>` : ""}</span>`;
}

function place(s: GlobeSession): string {
  return s.city ? (s.country && !s.city.startsWith("near ") ? `${s.city}, ${s.country}` : s.city) : "Location not shared";
}

function row(s: GlobeSession): Html {
  return html`<li data-row="${s.id}">
    <button class="gl-row gl-row-${s.group}" type="button" data-session="${s.id}">
      <span class="gl-thumb">${s.image ? html`<img src="${s.image}/small" alt="" loading="lazy" />` : html`<span class="gl-thumb-fallback">${s.recipe.slice(0, 1)}</span>`}<span class="live-dot"></span></span>
      <span class="gl-row-text">
        <strong>${s.recipe}</strong>
        <small>${s.group === "mine" ? "You" : firstName(s.cook)} · ${s.city || "on the move"}${s.local ? html` · ${clock(s, false)}` : ""}</small>
        <span class="gl-row-step"><span class="progress" style="--p: ${pct(s)}%"><span></span></span><em>Step ${s.step}/${s.steps.length}</em></span>
      </span>
      <span class="gl-row-side">${tag(s)}${s.help ? html`<span class="gl-help-dot" title="Asking for help">?</span>` : ""}</span>
    </button>
  </li>`;
}

function metaPart(s: GlobeSession): Html {
  return html`${s.local ? html`<span>${icon("clock", 14)} ${clock(s)}</span>` : ""}<span>${icon("users", 14)} Cooking for ${s.serves}</span><span>${icon("live", 14)} <b data-watch-count="${s.id}">${s.watching}</b> watching</span>${s.cuisine ? html`<span>${s.cuisine}</span>` : ""}`;
}

function stepPart(s: GlobeSession): Html {
  return html`<div class="gl-step">
    <div class="gl-step-head"><span class="cm-step-num">Step ${s.step} of ${s.steps.length}</span><span class="progress" style="--p: ${pct(s)}%"><span></span></span></div>
    <p>${s.steps[s.step - 1] ?? ""}</p>
    ${s.steps[s.step] ? html`<small>Next: ${s.steps[s.step]}</small>` : html`<small>Last step — nearly there.</small>`}
  </div>`;
}

function helpPart(s: GlobeSession): Html {
  if (!s.help) return html``;
  return html`<div class="gl-help">
    <p class="gl-help-label">${icon("bolt", 14)} ${s.group === "mine" ? "You're" : `${firstName(s.cook)} is`} asking for help</p>
    <p>${s.help.text}</p>
    ${s.help.original ? html`<p class="gl-original">Translated from ${s.language} · <span>“${s.help.original}”</span></p>` : ""}
  </div>`;
}

function threadPart(s: GlobeSession): Html {
  if (!s.questions.length) {
    return html`<p class="muted small gl-thread-empty">${s.group === "mine" ? "No questions yet. They'll pop up in cook mode as they arrive." : "No questions yet — ask the first one."}</p>`;
  }
  return html`<ul class="gl-thread">${s.questions.map(
    (q) => html`<li>
      ${avatar(q.who, "sm")}
      <div>
        <p><strong>${q.who}</strong> <span class="muted">${q.country ? `· ${q.country} ` : ""}· ${q.when}</span></p>
        <p>${q.text}</p>
        ${q.original ? html`<p class="gl-original">Translated · “${q.original}”</p>` : ""}
        ${q.answer ? html`<p class="gl-answer"><strong>${s.group === "mine" ? "You" : firstName(s.cook)}:</strong> ${q.answer}</p>` : s.kind === "live" ? html`<p class="gl-awaiting">Waiting for ${s.group === "mine" ? "your" : `${firstName(s.cook)}'s`} answer…</p>` : ""}
      </div>
    </li>`,
  )}</ul>`;
}

function askBox(s: GlobeSession, signedIn: boolean): Html {
  if (s.kind === "demo") {
    return html`<form class="gl-ask" data-ask>
        <fieldset disabled class="bare">
          <input placeholder="Demo cooks can't answer — ask someone tagged Live" aria-label="Ask a question" />
          <button class="button button-small" type="button">Ask</button>
        </fieldset>
      </form>
      <p class="estimate-note">For demo cooks, questions are shown translated into your language with the original beneath.</p>`;
  }
  if (s.group === "mine") {
    return html`<p class="gl-mine-note">This is you. Questions arrive in cook mode, where you can answer with one thumb.</p>`;
  }
  if (!signedIn) {
    return html`<div class="gl-ask gl-ask-guest">
      <p>Watching is free. <strong>Sign in to ask ${firstName(s.cook)} a question</strong>, like “can I use butter instead?”</p>
      <a class="button button-small" href="/login?next=${encodeURIComponent(`/global#live-${s.id}`)}">Sign in to ask</a>
    </div>`;
  }
  return html`<form class="gl-ask" method="post" action="/global/${s.id}/ask" data-ask="${s.id}">
      <div class="gl-ask-row">
        <input name="text" maxlength="${QUESTION_MAX}" required autocomplete="off" placeholder="Ask ${firstName(s.cook)}, e.g. “can I use butter instead?”" aria-label="Ask ${firstName(s.cook)} a question" />
        <button class="button button-small" type="submit">Ask</button>
      </div>
      <p class="gl-ask-status" data-ask-status role="status"></p>
    </form>`;
}

function detail(s: GlobeSession, signedIn: boolean, open = false): Html {
  const along = s.kind === "live" && s.group !== "mine" ? `/recipes/${s.recipeId}/cook?serves=${s.serves}&along=${s.id}` : `/recipes/${s.recipeId}/cook`;
  return html`<article class="gl-detail gl-detail-${s.kind}" data-detail="${s.id}" ${open ? "" : raw("hidden")}>
    <div class="gl-detail-photo">
      ${s.image ? html`<img src="${s.image}" alt="${s.recipe}" loading="lazy" />` : html`<div class="gl-photo-fallback"><span>${s.recipe.slice(0, 1)}</span></div>`}
      <button class="gl-close" type="button" data-close aria-label="Close">${icon("close", 18)}</button>
      ${s.kind === "live"
        ? html`<span class="rx-glass rx-glass-live"><span class="live-dot"></span>Live · started ${s.started}</span>`
        : html`<span class="rx-glass gl-glass-demo">Demo cook · sample data</span>`}
      <div class="gl-ended" data-ended hidden><span>${icon("check", 22)}</span><p>${firstName(s.cook)} has finished cooking.</p></div>
    </div>
    <div class="gl-detail-body">
      <p class="gl-who">${avatar(s.cook, "sm")}<span><strong>${s.group === "mine" ? "You" : s.cook}</strong> · ${place(s)}</span>${s.group === "friends" ? html`<span class="gl-tag gl-tag-friend">Friend</span>` : ""}${s.group === "mine" ? html`<span class="gl-tag gl-tag-friend">${s.visibility === "public" ? "Everyone" : s.visibility === "friends" ? "Friends only" : "Only you"}</span>` : ""}</p>
      <h2>${s.recipe}</h2>
      <p class="gl-meta" data-part="meta">${metaPart(s)}</p>
      <div data-part="step">${stepPart(s)}</div>
      <div data-part="help">${helpPart(s)}</div>

      <details class="gl-ings">
        <summary>Ingredients <span class="muted">${s.ingredients.length}${s.have !== undefined ? html` · you have ${s.have}` : ""}</span></summary>
        <ul class="ing-list">${s.ingredients.map((i) => html`<li><span class="ing-amount">${i.amount}</span><span class="ing-name">${i.name}</span></li>`)}</ul>
      </details>

      <section class="gl-qa" aria-label="Questions">
        <h3>Questions</h3>
        <div data-part="thread">${threadPart(s)}</div>
        ${askBox(s, signedIn)}
      </section>

      <div class="gl-actions">
        ${s.group === "mine"
          ? html`<a class="button button-accent" href="/recipes/${s.recipeId}/cook?serves=${s.serves}">${icon("cook", 16)} Back to cook mode</a>`
          : html`<a class="button button-accent" href="${along}">${icon("cook", 16)} Cook along</a>`}
        <a class="button button-ghost" href="/recipes/${s.recipeId}">View recipe</a>
      </div>
    </div>
  </article>`;
}

// What the globe script needs for one pan.
function marker(s: GlobeSession) {
  return {
    id: s.id,
    kind: s.kind,
    group: s.group,
    lat: s.lat,
    lng: s.lng,
    recipe: s.recipe,
    cook: s.group === "mine" ? "You" : firstName(s.cook),
    city: s.city,
    country: s.country,
    cuisine: s.cuisine,
    tags: s.tags,
    have: s.have,
    total: s.total,
    help: !!s.help,
    step: s.step,
    steps: s.steps.length,
    // minutes from UTC where they are, for the globe's local-time label
    offset: s.local?.offset ?? null,
    v: s.v,
  };
}

// JSON inside a <script> tag: escape "<" so nothing can close the tag early.
function scriptJson(value: unknown): Html {
  return raw(JSON.stringify(value).replace(/</g, "\\u003c"));
}

const GROUP_HEAD: Record<Group, string> = {
  mine: "You're live",
  friends: "Friends cooking",
  live: "Live around the world",
  demo: "Demo cooks",
};

function group(key: Group, sessions: GlobeSession[], extra?: Html): Html {
  const list = sessions.filter((s) => s.group === key);
  return html`<section class="gl-group gl-group-${key}" data-group="${key}" ${list.length || extra ? "" : raw("hidden")}>
    <h3 class="gl-group-head">${key === "friends" ? html`<span class="gl-friend-dot" aria-hidden="true"></span>` : ""}${GROUP_HEAD[key]}${key === "demo" ? html` <span class="gl-tag gl-tag-demo">Sample data</span>` : html` <span class="gl-count" data-group-count>${list.length || ""}</span>`}</h3>
    <ul class="gl-list" data-list="${key}">${list.map(row)}</ul>
    ${extra ?? ""}
  </section>`;
}

function globePage(ctx: Ctx): Html {
  const viewer = viewerFor(ctx);
  const sessions = allSessions(viewer);
  const real = sessions.filter((s) => s.kind === "live");
  const demo = sessions.filter((s) => s.kind === "demo");
  const cuisines = [...new Set(sessions.map((s) => s.cuisine).filter(Boolean))].sort();
  const countries = new Set(sessions.map((s) => s.country).filter(Boolean)).size;
  const helping = sessions.filter((s) => s.help).length;
  const signedIn = !!ctx.user;

  const liveEmpty = html`<div class="gl-cta" data-live-empty ${real.length ? raw("hidden") : ""}>
    <span class="gl-cta-art" aria-hidden="true">${icon("cook", 22)}</span>
    <div>
      <p><strong>No one's live right now.</strong> Open any recipe, tap <em>Start cooking</em>, then <em>Go live</em> — your pan lands on this globe while you cook.</p>
      ${signedIn
        ? html`<a class="button button-small button-accent" href="/recipes">${icon("search", 14)} Find something to cook</a>`
        : html`<a class="button button-small button-accent" href="/register">Join free to go live</a>`}
    </div>
  </div>`;

  return html`
    <section class="gl" data-gl data-stream="/global/stream" ${signedIn ? raw("data-signed-in") : ""}>
      <div class="gl-stage" data-globe data-textures="/assets/textures/">
        <canvas aria-label="Globe of people cooking live around the world. Use the list to browse sessions."></canvas>
        <div class="gl-pins" data-pins aria-hidden="false"></div>
        <div class="gl-zoom" role="group" aria-label="Zoom">
          <button type="button" data-zoom="in" aria-label="Zoom in">${icon("plus", 18)}</button>
          <button type="button" data-zoom="out" aria-label="Zoom out"><svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button>
          <button type="button" data-zoom="reset" aria-label="Show the whole globe">${icon("global", 18)}</button>
        </div>
        <div class="gl-loading" aria-hidden="true"><span></span></div>
      </div>

      <header class="gl-hero">
        <p class="eyebrow"><span class="live-dot"></span> <span><b data-stat="live">${real.length}</b> cooking live${demo.length ? ` · ${demo.length} demo cooks` : ""}</span></p>
        <h1>Cooking, live,<br />all over the world.</h1>
        <p class="lede">Spin the globe and tap a pan to see what someone's making, the step they're on, and ask them anything. Friends show up first.</p>
        <p class="gl-daylight" data-daylight>${icon("clock", 14)} <span class="gl-daylight-long">The globe is lit as it is right now: day where the sun is up, city lights where it's night, so you can see who's cooking lunch and who's cooking dinner.</span><span class="gl-daylight-short">Lit live: lunch in daylight, dinner by city lights</span></p>
        <dl class="gl-stats">
          <div><dt>Live now</dt><dd data-stat="live">${real.length}</dd></div>
          <div><dt>Countries</dt><dd>${countries}</dd></div>
          <div><dt>Asking for help</dt><dd data-stat="help">${helping}</dd></div>
        </dl>
      </header>

      <aside class="gl-panel" aria-label="Live sessions">
        <div class="gl-filters" role="group" aria-label="Filter live cooks">
          <button class="rx-chip" type="button" data-filter="all" aria-pressed="true">All</button>
          ${signedIn ? html`<button class="rx-chip" type="button" data-filter="friends" aria-pressed="false"><span class="dot" style="--chip: var(--lavender)"></span>Friends</button>` : ""}
          ${signedIn ? html`<button class="rx-chip" type="button" data-filter="fridge" aria-pressed="false"><span class="dot" style="--chip: var(--sage)"></span>From my fridge</button>` : ""}
          <button class="rx-chip" type="button" data-filter="help" aria-pressed="false"><span class="dot" style="--chip: var(--peach)"></span>Needs help</button>
          <button class="rx-chip" type="button" data-filter="vegetarian" aria-pressed="false"><span class="dot" style="--chip: var(--butter)"></span>Vegetarian</button>
          <label class="gl-cuisine"><span class="sr-only">Cuisine</span>
            <select data-cuisine>
              <option value="">Any cuisine</option>
              ${cuisines.map((c) => html`<option value="${c}">${c}</option>`)}
            </select>
          </label>
        </div>
        <div class="gl-scroll">
          ${group("mine", sessions)}
          ${group("friends", sessions)}
          ${group("live", sessions, liveEmpty)}
          ${group("demo", sessions)}
          <p class="gl-empty muted small" data-gl-empty hidden>No one matching that is cooking right now.</p>
        </div>
        ${signedIn
          ? html`<p class="estimate-note">“From my fridge” shows cooks making something you have at least half the ingredients for.</p>`
          : html`<p class="estimate-note">Watching needs no account. <a href="/register">Join free</a> to ask questions, filter by your fridge and go live yourself.</p>`}
        <p class="gl-conn" data-conn hidden></p>
      </aside>

      <div class="gl-details" data-gl-details>${sessions.map((s) => detail(s, signedIn))}</div>

      <div class="gl-foot">
        ${previewBanner("Demo cooks", "Cooks tagged “Demo” are sample data so the globe is never empty; anyone tagged “Live” is a real person cooking right now. The recipes are real either way.")}
        <section class="gl-how">
          <h2>How to appear on the globe</h2>
          <ol class="how-steps">
            <li><strong>Pick a recipe</strong> from the catalogue — or write your own, and its nutrition and cost are worked out for you.</li>
            <li><strong>Start cooking and tap Go live.</strong> Choose who sees you (everyone, friends, or just you) and a city. We never store more than a rough area.</li>
            <li><strong>Each step you tap through</strong> shows here within a second, so watchers always see where you're up to.</li>
            <li><strong>Watchers ask questions</strong> — “can I swap the butter for oil?” — and you answer from cook mode with one thumb.</li>
          </ol>
          <div class="gl-how-actions">
            <a class="button button-accent" href="/recipes">${icon("cook", 16)} Find a recipe to cook</a>
            ${signedIn ? html`<a class="button button-ghost" href="/friends">${icon("friends", 16)} Add friends to see them first</a>` : html`<a class="button button-ghost" href="/register">Join free</a>`}
          </div>
        </section>
      </div>
    </section>
    <script type="application/json" id="globe-data">${scriptJson(sessions.map(marker))}</script>
    <script type="importmap">${scriptJson({ imports: { three: "/assets/vendor/three.module.min.js", "three/addons/": "/assets/vendor/addons/" } })}</script>
    <script type="module" src="/assets/globe.mjs"></script>
    <script type="module" src="/assets/globe-ui.mjs"></script>`;
}

/* ---------------- one session ---------------- */

function realId(param: string | undefined): number | null {
  return param && /^\d{1,12}$/.test(param) ? Number(param) : null;
}

// A live session the viewer may see, or 404 — the same answer whether it's
// hidden from them or never existed.
function visibleSession(ctx: Ctx, viewer: Viewer): CookSession {
  const id = realId(ctx.params.id);
  const s = id === null ? undefined : getSession(id);
  if (!s || !canSeeSession(viewer.id, s)) throw new HttpError(404, "That cooking session has ended or never existed.");
  return s;
}

function cardFor(viewer: Viewer, s: CookSession, signedIn: boolean) {
  const [g] = realSessions(viewer, [s]);
  return {
    id: g.id,
    v: g.v,
    group: g.group,
    marker: marker(g),
    row: row(g).value,
    detail: detail(g, signedIn).value,
    parts: { meta: metaPart(g).value, step: stepPart(g).value, help: helpPart(g).value, thread: threadPart(g).value },
  };
}

// Only same-site paths, never another host.
function returnTo(form: URLSearchParams, fallback: string): string {
  const to = form.get("return_to") ?? "";
  return to.startsWith("/") && !to.startsWith("//") ? to : fallback;
}

function wantsJson(ctx: Ctx): boolean {
  return (ctx.req.headers.accept ?? "").includes("application/json");
}

function soloPage(ctx: Ctx): Reply {
  const demo = /^demo-(\d+)$/.exec(ctx.params.id ?? "");
  const viewer = viewerFor(ctx);
  if (demo) {
    const s = demoSessions(viewer.id).find((x) => x.id === ctx.params.id);
    if (!s) throw new HttpError(404, "That cooking session has ended or never existed.");
    return htmlReply(
      page(ctx, {
        title: `${firstName(s.cook)} is cooking ${s.recipe}`,
        active: "global",
        body: html`<div class="gl-solo">${previewBanner("Demo cook", "A sample live session; the recipe is real.")}${detail(s, !!ctx.user, true)}</div>`,
      }),
    );
  }
  const s = visibleSession(ctx, viewer);
  if (!isLive(s)) {
    return htmlReply(
      page(ctx, {
        title: `${firstName(s.display_name)} finished cooking`,
        active: "global",
        body: html`<div class="gl-solo"><section class="gl-finished">
          <span class="gl-cta-art" aria-hidden="true">${icon("check", 26)}</span>
          <p class="eyebrow">Session ended</p>
          <h1>${s.user_id === viewer.id ? "You" : firstName(s.display_name)} cooked ${s.recipe_title}</h1>
          <p class="lede">This live session has finished. The recipe is still here to cook yourself.</p>
          <div class="gl-actions"><a class="button button-accent" href="/recipes/${s.recipe_id}/cook">${icon("cook", 16)} Cook it yourself</a><a class="button button-ghost" href="/global">See who's live</a></div>
        </section></div>`,
      }),
    );
  }
  const [g] = realSessions(viewer, [s]);
  return htmlReply(
    page(ctx, {
      title: `${g.group === "mine" ? "You're" : `${firstName(g.cook)} is`} cooking ${g.recipe}`,
      active: "global",
      body: html`<div class="gl-solo" data-gl data-solo data-stream="/global/stream?only=${g.id}">
          <a class="gl-solo-back" href="/global#live-${g.id}">${icon("global", 16)} See on the globe</a>
          ${detail(g, !!ctx.user, true)}
        </div>
        <script type="application/json" id="globe-data">${scriptJson([marker(g)])}</script>
        <script type="module" src="/assets/globe-ui.mjs"></script>`,
    }),
  );
}

const ASK_MESSAGES: Record<string, string> = {
  ended: "That session has just finished, so the cook can't answer now.",
  own: "This is your own session — questions come to you here.",
  empty: "Type a question first.",
  "too-long": `Keep it under ${QUESTION_MAX} characters.`,
  "too-soon": "Give the cook a moment — you can ask again in a few seconds.",
};

async function ask(ctx: Ctx): Promise<Reply> {
  const viewer = viewerFor(ctx);
  const s = visibleSession(ctx, viewer);
  const form = await ctx.form();
  const r = askQuestion(s.id, ctx.user!.id, form.get("text") ?? "");
  if (!r.ok) {
    if (r.problem === "not-found") throw new HttpError(404, "That cooking session has ended or never existed.");
    const status = r.problem === "ended" ? 410 : r.problem === "too-soon" ? 429 : 422;
    if (wantsJson(ctx)) return json({ error: r.problem, message: ASK_MESSAGES[r.problem] }, status);
    setFlash(ctx, ASK_MESSAGES[r.problem]);
    return redirect(`/global/${s.id}`);
  }
  if (wantsJson(ctx)) return json({ ok: true, card: cardFor(viewer, getSession(s.id)!, true) });
  setFlash(ctx, `Asked ${firstName(s.display_name)}. Their answer will appear here.`);
  return redirect(`/global/${s.id}`);
}

async function answer(ctx: Ctx): Promise<Reply> {
  const id = realId(ctx.params.id);
  const form = await ctx.form();
  const r = answerQuestion(id ?? 0, ctx.user!.id, Number(form.get("question")), form.get("text") ?? "");
  if (!r.ok) {
    if (r.problem === "not-found") throw new HttpError(404, "That cooking session has ended or never existed.");
    const message = r.problem === "ended" ? "This session has ended." : r.problem === "empty" ? "Type an answer first." : `Keep it under ${QUESTION_MAX} characters.`;
    if (wantsJson(ctx)) return json({ error: r.problem, message }, r.problem === "ended" ? 410 : 422);
    setFlash(ctx, message);
    return redirect(returnTo(form, `/global/${id}`));
  }
  if (wantsJson(ctx)) return json({ ok: true, question: { id: r.question.id, answer: r.question.answer } });
  setFlash(ctx, "Answer sent.");
  return redirect(returnTo(form, `/global/${id}`));
}

/* ---------------- live updates (Server-Sent Events) ---------------- */

// Each open globe (or cook page) holds one EventSource. Events carry only a
// session id and a version; the page fetches the card it needs, which checks
// visibility again. Every event is filtered per connection: a viewer hears
// about a session only if canSeeSession() lets them see it right now, and an
// "end" goes only to connections that were told the session existed.
interface Conn {
  id: string;
  viewerId: number | null;
  key: string;
  only: number | null;
  watching: number | null;
  known: Set<number>;
  res: ServerResponse;
}

const conns = new Map<string, Conn>();
const MAX_STREAMS = 400;
const MAX_PER_VIEWER = 8;
const HEARTBEAT_MS = 25_000;

function clientIp(req: IncomingMessage): string {
  const fly = req.headers["fly-client-ip"];
  if (typeof fly === "string" && fly) return fly;
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "?";
}

function send(c: Conn, event: string, data: unknown): void {
  if (c.res.destroyed || c.res.writableEnded) return;
  // a client that stopped reading isn't worth buffering for
  if (c.res.writableLength > 256 * 1024) {
    c.res.destroy();
    return;
  }
  c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Distinct people (signed-in) or browsers (signed-out) with this session's
// card open, not counting the cook.
export function watcherCount(sessionId: number, cookId: number): number {
  const who = new Set<string>();
  for (const c of conns.values()) {
    if (c.watching === sessionId && c.viewerId !== cookId) who.add(c.viewerId !== null ? `u${c.viewerId}` : c.id);
  }
  return who.size;
}

function notifyWatchers(sessionId: number): void {
  const s = getSession(sessionId);
  if (!s) return;
  const n = watcherCount(s.id, s.user_id);
  for (const c of conns.values()) if (c.known.has(s.id)) send(c, "watchers", { id: String(s.id), n });
}

liveBus.on("event", (e: LiveEvent) => {
  const s = getSession(e.sessionId);
  const live = !!s && isLive(s);
  for (const c of conns.values()) {
    if (c.only !== null && c.only !== e.sessionId) continue;
    if (live && canSeeSession(c.viewerId, s!)) {
      c.known.add(s!.id);
      send(c, "upsert", { id: String(s!.id), v: sessionVersion(s!), kind: e.kind });
    } else if (c.known.delete(e.sessionId)) {
      send(c, "end", { id: String(e.sessionId), reason: s?.end_reason ?? "hidden" });
    }
  }
  if (!live) for (const c of conns.values()) if (c.watching === e.sessionId) c.watching = null;
});

setInterval(() => {
  for (const c of conns.values()) if (!c.res.destroyed) c.res.write(": ping\n\n");
}, HEARTBEAT_MS).unref();

// end every stream on shutdown so the server can close promptly
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    for (const c of conns.values()) c.res.end();
  });
}

function stream(ctx: Ctx): Reply {
  const viewerId = ctx.user?.id ?? null;
  const key = viewerId !== null ? `u${viewerId}` : `ip:${clientIp(ctx.req)}`;
  let mine = 0;
  for (const c of conns.values()) if (c.key === key) mine++;
  if (conns.size >= MAX_STREAMS || mine >= MAX_PER_VIEWER) {
    return { status: 429, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "30" }, body: "Too many live connections" };
  }
  const only = realId(ctx.url.searchParams.get("only") ?? undefined);
  return {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
    body: "",
    stream: (res) => {
      const c: Conn = { id: randomBytes(16).toString("base64url"), viewerId, key, only, watching: null, known: new Set(), res };
      conns.set(c.id, c);
      res.socket?.setNoDelay(true);
      res.on("close", () => {
        if (!conns.delete(c.id)) return;
        if (c.watching !== null) notifyWatchers(c.watching);
      });
      res.write("retry: 4000\n\n");
      send(c, "hello", { conn: c.id });
      const see = sessionViewer(viewerId);
      const list = openSessions().filter((s) => (only === null || s.id === only) && see(s));
      for (const s of list) c.known.add(s.id);
      send(c, "sync", { sessions: list.map((s) => ({ id: String(s.id), v: sessionVersion(s), w: watcherCount(s.id, s.user_id) })) });
    },
  };
}

// The page says which card is open, so the cook sees "3 watching".
async function watch(ctx: Ctx): Promise<Reply> {
  const form = await ctx.form();
  const c = conns.get(form.get("conn") ?? "");
  if (!c || c.viewerId !== (ctx.user?.id ?? null)) return json({ error: "not-found" }, 404);
  const wanted = realId(form.get("session") ?? undefined);
  let next: number | null = null;
  if (wanted !== null) {
    const s = getSession(wanted);
    if (!s || !isLive(s) || !canSeeSession(c.viewerId, s)) return json({ error: "not-found" }, 404);
    next = s.id;
  }
  const prev = c.watching;
  c.watching = next;
  if (prev !== next) {
    if (prev !== null) notifyWatchers(prev);
    if (next !== null) notifyWatchers(next);
  }
  return json({ ok: true });
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/global",
    handler: (ctx) => htmlReply(page(ctx, { title: "Live around the world", active: "global", body: globePage(ctx), mainClass: "main-globe" })),
  },
  { method: "GET", path: "/global/stream", handler: stream },
  {
    // the same sessions the page shows, for scripts and the spec
    method: "GET",
    path: "/global/sessions.json",
    handler: (ctx) => {
      // ?at=<ISO time> asks who'd be cooking then (demo cooks keep local hours)
      const at = new Date(ctx.url.searchParams.get("at") ?? "");
      return json({ sessions: allSessions(viewerFor(ctx), Number.isNaN(at.getTime()) ? undefined : at).map(marker) });
    },
  },
  { method: "POST", path: "/global/watch", handler: watch },
  {
    // a shareable link straight to one session's card
    method: "GET",
    path: "/global/:id",
    handler: soloPage,
  },
  {
    method: "GET",
    path: "/global/:id/card",
    handler: (ctx) => {
      const viewer = viewerFor(ctx);
      const s = visibleSession(ctx, viewer);
      if (!isLive(s)) return json({ error: "ended" }, 410);
      return json(cardFor(viewer, s, !!ctx.user));
    },
  },
  { method: "POST", path: "/global/:id/ask", auth: true, handler: ask },
  { method: "POST", path: "/global/:id/answer", auth: true, handler: answer },
];
