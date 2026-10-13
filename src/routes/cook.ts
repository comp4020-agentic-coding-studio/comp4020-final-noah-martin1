import { one } from "../db.ts";
import { type Html, html, raw } from "../html.ts";
import { type Ctx, htmlReply } from "../http.ts";
import { CITIES, type CookSession, getSession, isLive, openSessionFor, QUESTION_MAX, questionsFor } from "../live.ts";
import { prefsFor } from "../prefs.ts";
import { type Recipe, recipeIngredients, recipeSteps, type RecipeIngredient } from "../recipes.ts";
import type { Route } from "../server.ts";
import { canSeeSession } from "../visibility.ts";
import { avatar, icon, VIEW_TRANSITIONS } from "../views/layout.ts";
import { amount, duration, visibleRecipe } from "./recipes.ts";

// Cook mode: the phone-on-the-bench view. One big step at a time, scaled
// quantities alongside, timers on the steps that need them. Going live puts
// the cook on the globe; each step they tap through updates watchers within
// a second, and watchers' questions pop up here to answer with one thumb
// (public/cook-live.mjs). Without JavaScript every step is listed at once
// and going live, ending and answering are plain forms.

// Ingredients a step mentions, so the step card can show exactly what to grab.
// Generic words that would match half the list ("sauce", "oil", "powder").
const GENERIC = new Set(["sauce", "oil", "powder", "paste", "stock", "seeds", "leaves", "fresh", "ground", "dried", "red", "green", "white", "black", "sweet", "light", "dark"]);

function mentioned(step: string, lines: RecipeIngredient[]): RecipeIngredient[] {
  const text = ` ${step.toLowerCase().replace(/[^a-z\s]/g, " ")} `;
  const has = (word: string) => new RegExp(`\\s${word}(es|s)?\\s`).test(text);
  const seen = new Set<string>();
  const out: RecipeIngredient[] = [];
  for (const l of lines) {
    if (seen.has(l.name) || l.quantity === null) continue;
    const words = l.name.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
    const stem = (w: string) => w.replace(/(es|s)$/, "");
    const hit = has(words.map(stem).join(" ")) || words.some((w) => w.length > 3 && !GENERIC.has(w) && has(stem(w)));
    if (hit) {
      seen.add(l.name);
      out.push(l);
    }
  }
  return out.slice(0, 6);
}

// confetti for the finish: where each piece flies, its colour and spin
const BURST: [number, number, string, number][] = Array.from({ length: 18 }, (_, i) => {
  // an upward fan, so nothing lands on the words below
  const a = Math.PI + (i / 17) * Math.PI + (i % 2) * 0.08;
  const d = 70 + (i % 3) * 28;
  const tones = ["peach-ink", "accent", "lavender-ink", "butter-ink", "rose-ink", "sky-ink"];
  return [Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d), tones[i % tones.length], (i * 47) % 360];
});

function shell(ctx: Ctx, title: string, body: Html): Html {
  return html`<html lang="en-AU">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#f7f5f1" />
      ${VIEW_TRANSITIONS}
      <title>${title} · Larder</title>
      ${raw(`<script>try{var t=localStorage.getItem("larder-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>`)}
      <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
      <link rel="stylesheet" href="/assets/app.css" />
      <script src="/assets/app.js" defer></script>
      <script type="module" src="/assets/cook-live.mjs"></script>
    </head>
    <body class="cooking ${ctx.user ? "" : "guest"}">${body}</body>
  </html>`;
}

const REGIONS = [...new Set(CITIES.map((c) => c.region))];

function cityOptions(): Html {
  return html`${REGIONS.map(
    (region) => html`<optgroup label="${region}">${CITIES.filter((c) => c.region === region).map(
      (c) => html`<option value="${c.key}">${c.name}${c.country !== c.name ? `, ${c.country}` : ""}</option>`,
    )}</optgroup>`,
  )}`;
}

// The "Go live" sheet: who can watch, and where on the globe you appear.
function goLive(ctx: Ctx, recipe: Recipe, serves: number, elsewhere: CookSession | undefined, entryId: number | null): Html {
  const prefs = prefsFor(ctx.user!.id);
  const allowed = { public: recipe.visibility === "public", friends: recipe.visibility !== "private", private: true };
  const wanted = allowed[prefs.default_visibility] ? prefs.default_visibility : recipe.visibility === "private" ? "private" : "friends";
  const choice = (value: "public" | "friends" | "private", label: string, hint: string) =>
    html`<label class="cm-seg ${allowed[value] ? "" : "disabled"}">
      <input type="radio" name="visibility" value="${value}" ${value === wanted ? raw("checked") : ""} ${allowed[value] ? "" : raw("disabled")} />
      <span><strong>${label}</strong><small>${hint}</small></span>
    </label>`;
  return html`<details class="cm-golive" data-golive>
    <summary class="cm-live cm-live-go">${icon("live", 16)} <span>Go live</span></summary>
    <form class="cm-sheet" method="post" action="/live/start" data-golive-form>
      <input type="hidden" name="recipe_id" value="${recipe.id}" />
      <input type="hidden" name="serves" value="${serves}" />
      <input type="hidden" name="step" value="1" data-golive-step />
      ${entryId ? html`<input type="hidden" name="entry" value="${entryId}" />` : ""}
      <input type="hidden" name="where" value="city" data-where />
      <input type="hidden" name="lat" value="" data-lat />
      <input type="hidden" name="lng" value="" data-lng />
      <header class="cm-sheet-head">
        <span class="cm-sheet-art" aria-hidden="true"><span class="live-dot"></span></span>
        <div>
          <h2>Cook live</h2>
          <p>Your pan appears on the live globe while you cook. Watchers see the step you're on and can ask you questions.</p>
        </div>
      </header>

      <fieldset class="cm-field">
        <legend>Who can watch</legend>
        <div class="cm-segs">
          ${choice("public", "Everyone", "On the globe")}
          ${choice("friends", "Friends", "Friends only")}
          ${choice("private", "Just me", "Practice run")}
        </div>
        ${recipe.visibility !== "public"
          ? html`<p class="cm-note">This recipe is ${recipe.visibility === "friends" ? "friends-only" : "private"}, so ${recipe.visibility === "friends" ? "only friends" : "only you"} can watch you cook it.</p>`
          : ""}
      </fieldset>

      <fieldset class="cm-field">
        <legend>Where you appear</legend>
        <div class="cm-where">
          <label class="cm-select"><span class="sr-only">City</span>
            <select name="city" data-city required>
              <option value="" disabled selected>Choose a city…</option>
              ${cityOptions()}
              <optgroup label="Privacy"><option value="none">Don't show me on the map</option></optgroup>
            </select>
          </label>
          <button class="button button-soft button-small cm-locate" type="button" data-locate hidden>${icon("global", 14)} Use my location</button>
        </div>
        <p class="cm-note" data-where-note>City-level only: we store a city centre, or your position rounded to about 10 km. Never your address.</p>
      </fieldset>

      ${elsewhere ? html`<p class="cm-note cm-note-warn">You're live with ${elsewhere.recipe_title} right now. Going live here ends that session.</p>` : ""}

      <div class="cm-sheet-actions">
        <button class="button button-accent" type="submit">${icon("live", 16)} Go live</button>
        <p class="cm-note">Ends when you finish, after 3 hours, or after 45 minutes with this page closed.</p>
      </div>
    </form>
  </details>`;
}

// While live: the on-air pill (watchers), and a sheet with the globe link,
// a help request and the end button.
function onAir(live: CookSession | undefined, recipeId: number): Html {
  const id = live?.id ?? "";
  return html`<details class="cm-onair" data-onair ${live ? "" : raw("hidden")}>
    <summary class="cm-live cm-live-on"><span class="live-dot"></span> <span>Live</span><span class="cm-onair-sep" aria-hidden="true">·</span><span><b data-watchers>0</b> watching</span></summary>
    <div class="cm-sheet cm-sheet-small">
      <p class="cm-onair-who" data-onair-who>${live ? (live.visibility === "public" ? "Everyone can watch" : live.visibility === "friends" ? "Friends can watch" : "Only you can see this") : ""}${live?.city ? ` · ${live.city}` : ""}</p>
      <a class="button button-soft button-block" href="/global#live-${id}" data-onair-globe>${icon("global", 16)} See yourself on the globe</a>
      <form class="cm-help" method="post" action="/live/${id}/help" data-help-form>
        <label class="field"><span>Stuck? Ask everyone watching</span>
          <input name="text" maxlength="${QUESTION_MAX}" placeholder="e.g. My sauce split — how do I save it?" value="${live?.help_text ?? ""}" autocomplete="off" />
        </label>
        <input type="hidden" name="return_to" value="/recipes/${recipeId}/cook" />
        <button class="button button-small button-ghost" type="submit">${live?.help_text ? "Update" : "Ask for help"}</button>
      </form>
      <form method="post" action="/live/${id}/end" data-end-form>
        <input type="hidden" name="return_to" value="/recipes/${recipeId}" />
        <button class="button button-danger button-block" type="submit">End live session</button>
      </form>
    </div>
  </details>`;
}

// Watchers' questions waiting for an answer, as a stack of cards the cook
// can clear with a quick reply.
function questionStack(live: CookSession | undefined, recipeId: number): Html {
  const open = live ? questionsFor(live.id).filter((q) => q.answer === null) : [];
  return html`<aside class="cm-qs" data-qs aria-label="Questions from watchers" aria-live="polite" ${open.length ? "" : raw("hidden")}>
    ${open.map(
      (q) => html`<article class="cm-q" data-q="${q.id}">
        <header>${avatar(q.asker_name, "sm")}<p><strong>${q.asker_name}</strong> asks</p></header>
        <p class="cm-q-text">${q.text}</p>
        <form method="post" action="/global/${live!.id}/answer" class="cm-q-form">
          <input type="hidden" name="question" value="${q.id}" />
          <input type="hidden" name="return_to" value="/recipes/${recipeId}/cook" />
          <div class="cm-q-quick">
            <button type="submit" name="text" value="Yes, that works!">Yes, that works</button>
            <button type="submit" name="text" value="I wouldn't — it changes the dish.">I wouldn't</button>
            <button type="submit" name="text" value="Not sure — give it a go!">Not sure, try it</button>
          </div>
          <div class="cm-q-row"><input name="text" maxlength="${QUESTION_MAX}" placeholder="Or type an answer…" aria-label="Answer ${q.asker_name}" autocomplete="off" /><button class="button button-small" type="submit">Send</button></div>
        </form>
      </article>`,
    )}
  </aside>`;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/recipes/:id/cook",
    handler: (ctx) => {
      const recipe = visibleRecipe(ctx);
      const viewerId = ctx.user?.id ?? null;
      const open = viewerId !== null ? openSessionFor(viewerId) : undefined;
      const liveHere = open && open.recipe_id === recipe.id ? open : undefined;
      const elsewhere = open && !liveHere ? open : undefined;
      const requested = Number(ctx.url.searchParams.get("serves"));
      const serves = Number.isInteger(requested) && requested >= 1 && requested <= 50 ? requested : (liveHere?.serves ?? recipe.servings);
      const scale = serves / recipe.servings;
      const lines = recipeIngredients(recipe.id);
      const steps = recipeSteps(recipe.id);
      const scaled = (l: RecipeIngredient) => amount(l.quantity === null ? null : l.quantity * scale, l.unit);
      // a calendar entry the cook owns, if they came from their calendar
      const entryId = Number(ctx.url.searchParams.get("entry"));
      const entry =
        ctx.user && Number.isInteger(entryId)
          ? one<{ id: number }>(
              "SELECT id FROM calendar_entries WHERE id = ? AND owner_type = 'user' AND owner_id = ? AND status = 'planned'",
              entryId,
              ctx.user.id,
            )
          : undefined;
      // cooking along with someone: their live step beside yours
      const alongId = Number(ctx.url.searchParams.get("along"));
      const alongRow = Number.isSafeInteger(alongId) && alongId > 0 ? getSession(alongId) : undefined;
      const along =
        alongRow && isLive(alongRow) && alongRow.user_id !== viewerId && canSeeSession(viewerId, alongRow) ? alongRow : undefined;

      const body = html`<div class="cookmode" data-cook-mode data-steps="${steps.length}">
        <header class="cm-bar">
          <a class="cm-close" href="/recipes/${recipe.id}" aria-label="Leave cook mode">${icon("close", 20)}</a>
          <div class="cm-title"><small>Cooking${scale !== 1 ? ` for ${serves}` : ""}</small><strong>${recipe.title}</strong></div>
          <div class="cm-progress" aria-hidden="true">${steps.map((_, i) => html`<span class="${i === 0 ? "on" : ""}"></span>`)}</div>
          <div class="cm-tools" data-live-root data-recipe="${recipe.id}" data-session="${liveHere?.id ?? ""}" data-live-step="${liveHere?.current_step ?? 1}" data-step-count="${steps.length}">
            ${along
              ? html`<a class="cm-along" href="/global#live-${along.id}" data-along="${along.id}" data-along-steps="${along.step_count}" title="Cooking along with ${along.display_name}">
                  ${avatar(along.display_name, "sm")}<span><small>${along.display_name.split(" ")[0]} is on</small><b data-along-step>step ${along.current_step} of ${along.step_count}</b></span>
                </a>`
              : ""}
            ${ctx.user
              ? html`${onAir(liveHere, recipe.id)}${liveHere ? "" : goLive(ctx, recipe, serves, elsewhere, entry?.id ?? null)}`
              : html`<a class="cm-live cm-live-go" href="/login?next=${encodeURIComponent(`/recipes/${recipe.id}/cook`)}" title="Sign in to cook live">${icon("live", 16)} <span>Go live</span></a>`}
          </div>
        </header>

        <div class="cm-stage">
          <section class="cm-card" aria-live="polite">
            <p class="cm-lookback" data-lookback hidden>Looking back · watchers still see step <b data-lookback-step></b></p>
            <ol class="cm-steps">
              ${steps.map((s, i) => {
                const uses = mentioned(s.text, lines);
                return html`<li class="cm-step ${i === 0 ? "current" : ""}" data-step="${s.step_number}">
                  <span class="cm-step-num">Step ${s.step_number} of ${steps.length}</span>
                  <p>${s.text}</p>
                  ${uses.length ? html`<div class="cm-step-ings">${uses.map((u) => html`<span>${u.quantity !== null ? html`<b>${scaled(u)}</b>` : ""} ${u.name}</span>`)}</div>` : ""}
                  ${s.est_minutes ? html`<button class="timer-chip" type="button" data-timer="${s.est_minutes * 60}">${icon("timer", 18)} <span>Start ${duration(s.est_minutes)} timer</span></button>` : ""}
                </li>`;
              })}
            </ol>
            <div class="cm-done" data-cook-done>
              <div class="cm-done-art">
                ${icon("check", 40)}
                <span class="cm-burst" aria-hidden="true">${BURST.map(([x, y, c, r]) => html`<i style="--x: ${x}px; --y: ${y}px; --c: var(--${c}); --r: ${r}deg"></i>`)}</span>
              </div>
              <h2>Dinner's ready.</h2>
              <p>Enjoy every bite of your ${recipe.title.toLowerCase()}.</p>
              <p class="cm-done-live" data-done-live hidden>Your live session has ended — thanks for cooking with everyone.</p>
              <div class="rd-actions">
                ${entry
                  ? html`<form method="post" action="/calendar/${entry.id}/status">
                      <input type="hidden" name="status" value="completed" />
                      <input type="hidden" name="return_to" value="/calendar" />
                      <button class="button button-large button-accent" type="submit">Mark as cooked</button>
                    </form>`
                  : ""}
                <a class="button button-large button-ghost" href="/recipes/${recipe.id}">Back to recipe</a>
              </div>
              ${ctx.user ? html`<p class="estimate-note">Used something up? <a href="/pantry">Update your fridge</a> so tomorrow's plans stay right.</p>` : html`<p class="estimate-note"><a href="/register">Join free</a> to keep a fridge that knows what this used.</p>`}
            </div>
          </section>

          <aside class="cm-side">
            <section class="rd-card">
              <h2>Ingredients${scale !== 1 ? ` · ×${Math.round(scale * 100) / 100}` : ""}</h2>
              <ul class="ing-list">
                ${lines.map(
                  (l) => html`<li>
                    <label class="ing-check"><input type="checkbox" aria-label="Got ${l.name}" />${icon("check", 12)}</label>
                    <span class="ing-amount">${scaled(l)}</span>
                    <span class="ing-name">${l.name}${l.note ? html`<small>${l.note}</small>` : ""}</span>
                  </li>`,
                )}
              </ul>
            </section>
            <section class="rd-card">
              <h2>Cooking for</h2>
              ${liveHere
                ? html`<p class="muted small">Cooking for ${serves} — set when you went live.</p>`
                : html`<form method="get" action="/recipes/${recipe.id}/cook" class="servings" style="width: 100%; justify-content: space-between">
                    ${entry ? html`<input type="hidden" name="entry" value="${entry.id}" />` : ""}
                    <a href="/recipes/${recipe.id}/cook?serves=${Math.max(1, serves - 1)}${entry ? `&entry=${entry.id}` : ""}" aria-label="Fewer">−</a>
                    <output><span>${serves}</span> ${serves === 1 ? "person" : "people"}</output>
                    <a href="/recipes/${recipe.id}/cook?serves=${Math.min(50, serves + 1)}${entry ? `&entry=${entry.id}` : ""}" aria-label="More">+</a>
                  </form>`}
            </section>
          </aside>
        </div>

        ${questionStack(liveHere, recipe.id)}
        <div class="cm-toast ${ctx.flash ? "good" : ""}" data-cm-toast role="status" ${ctx.flash ? "" : raw("hidden")}>${ctx.flash ?? ""}</div>

        <nav class="cm-nav">
          <button class="button button-ghost" type="button" data-step-prev>${icon("back", 18)} Back</button>
          <p class="hint"><kbd>←</kbd> <kbd>→</kbd> to move between steps</p>
          <button class="button" type="button" data-step-next><span data-next-label>Next step</span> ${icon("arrow", 18)}</button>
        </nav>
      </div>`;
      return htmlReply(shell(ctx, `Cook ${recipe.title}`, body));
    },
  },
];
