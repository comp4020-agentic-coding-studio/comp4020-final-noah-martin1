import { ago } from "../format.ts";
import { type Html, html } from "../html.ts";
import { type Ctx, HttpError, json, type Reply, redirect, setFlash } from "../http.ts";
import {
  advanceStep,
  CITY_BY_KEY,
  endSession,
  getSession,
  heartbeat,
  isLive,
  liveSessions,
  openSessionFor,
  placeFromForm,
  questionsFor,
  setHelp,
  startSession,
} from "../live.ts";
import { logActivity } from "../activity.ts";
import { run } from "../db.ts";
import { prefsFor } from "../prefs.ts";
import { getRecipe, recipeSteps } from "../recipes.ts";
import type { Route } from "../server.ts";
import { canSeeRecipe, friendIds, sessionViewer, type Visibility } from "../visibility.ts";
import { avatar, icon } from "../views/layout.ts";

// The cook's side of live cooking: going live from cook mode, each step as
// it's tapped, a help request, and ending. Watching happens on the globe
// (src/routes/global.ts); the old /live pages now point there, since the
// live list and the globe are one page with friends first.

function firstName(name: string): string {
  return name.split(" ")[0];
}

function found(location: string): Reply {
  return { status: 302, headers: { location }, body: "" };
}

function wantsJson(ctx: Ctx): boolean {
  return (ctx.req.headers.accept ?? "").includes("application/json");
}

// Only same-site paths, never another host.
function returnTo(form: URLSearchParams, fallback: string): string {
  const to = form.get("return_to") ?? "";
  return to.startsWith("/") && !to.startsWith("//") ? to : fallback;
}

function sessionId(ctx: Ctx): number {
  const id = ctx.params.id ?? "";
  return /^\d{1,12}$/.test(id) ? Number(id) : 0;
}

const notFound = () => new HttpError(404, "That cooking session has ended or never existed.");

// The dashboard's "Live now" card: real sessions the viewer may see, friends
// first. Called without a viewer it shows only sessions anyone may see.
export function livePreviewCard(viewerId: number | null = null): Html {
  const see = sessionViewer(viewerId);
  const friends = new Set(viewerId === null ? [] : friendIds(viewerId));
  const list = liveSessions()
    .filter((s) => see(s) && s.user_id !== viewerId)
    .sort((a, b) => Number(friends.has(b.user_id)) - Number(friends.has(a.user_id)));
  const shown = list.slice(0, 3);
  return html`<section class="panel live-card">
    <header class="panel-head"><h2 class="panel-title"><span class="live-dot" aria-hidden="true"></span> Live now</h2><a href="/global">Globe →</a></header>
    ${shown.length
      ? html`<ul class="compact-list">
          ${shown.map(
            (s) => html`<li>${avatar(s.display_name, "sm")}<a class="grow" href="/global#live-${s.id}"><strong>${firstName(s.display_name)}</strong> is cooking ${s.recipe_title}${s.city ? html` <span class="muted">· ${s.city}</span>` : ""}</a><span class="mono muted">${s.current_step}/${s.step_count}</span></li>`,
          )}
        </ul>
        ${list.length > shown.length ? html`<p class="hint">and ${list.length - shown.length} more on the globe.</p>` : ""}`
      : html`<div class="live-card-empty">
          <p class="muted">Nobody's cooking live right now. Start any recipe and tap <strong>Go live</strong> — friends see your pan on the globe and can ask you questions as you go.</p>
          <a class="button button-ghost button-block" href="/global">${icon("global", 16)} Open the live globe</a>
        </div>`}
  </section>`;
}

async function start(ctx: Ctx): Promise<Reply> {
  const form = await ctx.form();
  const user = ctx.user!;
  const recipe = getRecipe(Number(form.get("recipe_id")));
  if (!recipe || !canSeeRecipe(user.id, recipe)) throw new HttpError(404, "There's no recipe at this address.");
  const back = `/recipes/${recipe.id}/cook`;
  const steps = recipeSteps(recipe.id);
  const fail = (message: string, status = 422): Reply => {
    if (wantsJson(ctx)) return json({ error: message }, status);
    setFlash(ctx, message);
    return redirect(back);
  };
  if (!steps.length) return fail("This recipe has no steps to cook through yet.");

  const visibility = form.get("visibility") as Visibility;
  if (!["public", "friends", "private"].includes(visibility)) return fail("Choose who can watch.");
  const servesIn = Number(form.get("serves"));
  const serves = Number.isInteger(servesIn) && servesIn >= 1 && servesIn <= 50 ? servesIn : recipe.servings;
  const city = form.get("city") ?? "";
  const where = form.get("where");
  if (where !== "near" && city === "none") form.set("where", "none");
  else if (where !== "near" && where !== "none" && !CITY_BY_KEY.has(city)) return fail("Choose a city, or “Don't show me on the map”.");
  const place = placeFromForm(form);
  if (!place) return fail("We couldn't read that location. Choose a city instead.");

  const { id, visibility: stored, replaced } = startSession(user.id, { recipe, stepCount: steps.length, serves, visibility, place });
  // the city someone picks is where an automatic session appears next time
  // (a device location is never remembered)
  if (where === "city" && CITY_BY_KEY.has(city)) run("UPDATE users SET live_city = ? WHERE id = ?", city, user.id);
  else if (city === "none") run("UPDATE users SET live_city = '' WHERE id = ?", user.id);
  logActivity({ actor: user, action: "live.start", subject: recipe.title, detail: { session: id, recipe: recipe.id, visibility: stored, city: s_city(place), replaced: replaced.length } });
  // going live part-way through: catch the session up to where the cook is
  const at = Number(form.get("step"));
  if (Number.isInteger(at) && at > 1 && at <= steps.length) advanceStep(id, user.id, at);
  const s = getSession(id)!;
  if (wantsJson(ctx)) {
    return json({ ok: true, id: s.id, step: s.current_step, visibility: stored, city: s.city, globe: `/global#live-${s.id}` });
  }
  setFlash(ctx, stored === "public" ? "You're live on the globe." : stored === "friends" ? "You're live — friends can watch." : "You're live, just for you.");
  return redirect(`${back}?serves=${serves}`);
}

function s_city(place: { city: string }): string {
  return place.city || "not on the map";
}

// Cook mode opened: go live automatically, unless the person turned that
// off. Never wider than they've chosen: their default visibility, narrowed
// to the recipe's; on the map only at the city they last picked by hand,
// otherwise listed but not pinned. Already live with this recipe: nothing.
async function auto(ctx: Ctx): Promise<Reply> {
  const form = await ctx.form();
  const user = ctx.user!;
  const recipe = getRecipe(Number(form.get("recipe_id")));
  if (!recipe || !canSeeRecipe(user.id, recipe)) return json({ error: "not-found" }, 404);
  const prefs = prefsFor(user.id);
  if (!prefs.auto_live) return json({ ok: false, reason: "off" });
  const steps = recipeSteps(recipe.id);
  if (!steps.length) return json({ ok: false, reason: "no-steps" });
  const open = openSessionFor(user.id);
  if (open && open.recipe_id === recipe.id) return json({ ok: true, id: open.id, step: open.current_step, visibility: open.visibility, city: open.city, already: true });
  // live with something else in another tab: leave it, offer the switch
  if (open) return json({ ok: false, reason: "elsewhere", elsewhere: open.recipe_title });
  const servesIn = Number(form.get("serves"));
  const serves = Number.isInteger(servesIn) && servesIn >= 1 && servesIn <= 50 ? servesIn : recipe.servings;
  const c = CITY_BY_KEY.get(prefs.live_city);
  const place = c ? { city: c.name, country: c.country, lat: c.lat, lng: c.lng } : { city: "", country: "", lat: null, lng: null };
  const { id, visibility } = startSession(user.id, { recipe, stepCount: steps.length, serves, visibility: prefs.default_visibility, place });
  const at = Number(form.get("step"));
  if (Number.isInteger(at) && at > 1 && at <= steps.length) advanceStep(id, user.id, at);
  const s = getSession(id)!;
  logActivity({ actor: user, action: "live.auto_start", subject: recipe.title, detail: { session: id, recipe: recipe.id, visibility, city: s_city(place) } });
  return json({ ok: true, id, step: s.current_step, visibility, city: s.city, auto: true });
}

async function step(ctx: Ctx): Promise<Reply> {
  const form = await ctx.form();
  const r = advanceStep(sessionId(ctx), ctx.user!.id, Number(form.get("step")));
  if (r.ok) return json({ ok: true, step: r.step });
  if (r.problem === "not-found") return json({ error: "not-found" }, 404);
  if (r.problem === "ended") return json({ error: "ended", step: r.step }, 410);
  // a step backwards (or beyond the last) is refused and the step kept
  return json({ error: r.problem, step: r.step }, 409);
}

async function beat(ctx: Ctx): Promise<Reply> {
  const id = sessionId(ctx);
  if (heartbeat(id, ctx.user!.id)) return json({ ok: true });
  const s = getSession(id);
  if (!s || s.user_id !== ctx.user!.id) return json({ error: "not-found" }, 404);
  return json({ error: "ended", reason: s.end_reason ?? "expired" }, 410);
}

async function end(ctx: Ctx): Promise<Reply> {
  const form = await ctx.form();
  const id = sessionId(ctx);
  const reason = form.get("reason") === "finished" ? "finished" : form.get("reason") === "left" ? "ended" : "ended";
  const before = getSession(id);
  if (!endSession(id, ctx.user!.id, reason)) {
    if (wantsJson(ctx)) return json({ error: "not-found" }, 404);
    throw notFound();
  }
  if (before && !before.ended_at) {
    logActivity({ actor: ctx.user, action: "live.end", subject: before.recipe_title, detail: { session: id, reason: form.get("reason") ?? "ended", step: before.current_step, steps: before.step_count } });
  }
  if (wantsJson(ctx)) return json({ ok: true });
  setFlash(ctx, "Live session ended.");
  return redirect(returnTo(form, "/global"));
}

async function help(ctx: Ctx): Promise<Reply> {
  const form = await ctx.form();
  const id = sessionId(ctx);
  const r = setHelp(id, ctx.user!.id, form.get("text") ?? "");
  if (!r.ok && r.problem === "not-found") {
    if (wantsJson(ctx)) return json({ error: "not-found" }, 404);
    throw notFound();
  }
  const message = r.ok ? ((form.get("text") ?? "").trim() ? "Help request shared with everyone watching." : "Help request cleared.") : r.problem === "ended" ? "That session has ended." : "Keep it under 280 characters.";
  if (wantsJson(ctx)) return json(r.ok ? { ok: true } : { error: r.problem, message }, r.ok ? 200 : 422);
  setFlash(ctx, message);
  return redirect(returnTo(form, "/global"));
}

// The cook's unanswered questions, for cook mode.
function questions(ctx: Ctx): Reply {
  const s = getSession(sessionId(ctx));
  if (!s || s.user_id !== ctx.user!.id) return json({ error: "not-found" }, 404);
  return json({
    live: isLive(s),
    step: s.current_step,
    questions: questionsFor(s.id).map((q) => ({ id: q.id, who: q.asker_name, text: q.text, answer: q.answer, when: ago(q.asked_at) })),
  });
}

export const routes: Route[] = [
  // the live list joined the globe: friends first, everyone else after
  { method: "GET", path: "/live", handler: () => found("/global") },
  { method: "POST", path: "/live/start", auth: true, handler: start },
  { method: "POST", path: "/live/auto", auth: true, handler: auto },
  { method: "GET", path: "/live/:id", handler: (ctx) => found(`/global#live-${sessionId(ctx) || ctx.params.id.replace(/[^\w-]/g, "")}`) },
  // cooking along starts from the session's card, which knows the recipe
  { method: "GET", path: "/live/:id/along", handler: (ctx) => found(`/global#live-${sessionId(ctx) || ctx.params.id.replace(/[^\w-]/g, "")}`) },
  { method: "POST", path: "/live/:id/step", auth: true, handler: step },
  { method: "POST", path: "/live/:id/heartbeat", auth: true, handler: beat },
  { method: "POST", path: "/live/:id/end", auth: true, handler: end },
  { method: "POST", path: "/live/:id/help", auth: true, handler: help },
  { method: "GET", path: "/live/:id/questions", auth: true, handler: questions },
];
