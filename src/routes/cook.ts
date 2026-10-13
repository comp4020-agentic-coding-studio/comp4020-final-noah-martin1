import { one } from "../db.ts";
import { type Html, html } from "../html.ts";
import { type Ctx, htmlReply } from "../http.ts";
import { recipeIngredients, recipeSteps, type RecipeIngredient } from "../recipes.ts";
import type { Route } from "../server.ts";
import { icon } from "../views/layout.ts";
import { amount, duration, visibleRecipe } from "./recipes.ts";

// Cook mode: the phone-on-the-bench view. One big step at a time, scaled
// quantities alongside, timers on the steps that need them. Advancing a step
// is the moment a live session (crit 9) reports "Alice is on step 4". Without
// JavaScript every step is listed at once.

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

function shell(ctx: Ctx, title: string, body: Html): Html {
  return html`<html lang="en-AU">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#f7f5f1" />
      <title>${title} · Larder</title>
      <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
      <link rel="stylesheet" href="/assets/app.css" />
      <script src="/assets/app.js" defer></script>
    </head>
    <body class="cooking ${ctx.user ? "" : "guest"}">${body}</body>
  </html>`;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/recipes/:id/cook",
    handler: (ctx) => {
      const recipe = visibleRecipe(ctx);
      const requested = Number(ctx.url.searchParams.get("serves"));
      const serves = Number.isInteger(requested) && requested >= 1 && requested <= 50 ? requested : recipe.servings;
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

      const body = html`<div class="cookmode" data-cook-mode data-steps="${steps.length}">
        <header class="cm-bar">
          <a class="cm-close" href="/recipes/${recipe.id}" aria-label="Leave cook mode">${icon("close", 20)}</a>
          <div class="cm-title"><small>Cooking${scale !== 1 ? ` for ${serves}` : ""}</small><strong>${recipe.title}</strong></div>
          <div class="cm-progress" aria-hidden="true">${steps.map((_, i) => html`<span class="${i === 0 ? "on" : ""}"></span>`)}</div>
          <div class="cm-tools">
            <span class="cm-live" title="Live sessions arrive in crit 9">${icon("live", 16)} <span>Go live · soon</span></span>
          </div>
        </header>

        <div class="cm-stage">
          <section class="cm-card" aria-live="polite">
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
              <div class="cm-done-art">${icon("check", 40)}</div>
              <h2>Dinner's ready.</h2>
              <p>Enjoy every bite of your ${recipe.title.toLowerCase()}.</p>
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
              <p class="estimate-note">Taking what you used out of your pantry arrives with reservations in crit 9.</p>
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
              <form method="get" action="/recipes/${recipe.id}/cook" class="servings" style="width: 100%; justify-content: space-between">
                ${entry ? html`<input type="hidden" name="entry" value="${entry.id}" />` : ""}
                <a href="/recipes/${recipe.id}/cook?serves=${Math.max(1, serves - 1)}${entry ? `&entry=${entry.id}` : ""}" aria-label="Fewer">−</a>
                <output><span>${serves}</span> ${serves === 1 ? "person" : "people"}</output>
                <a href="/recipes/${recipe.id}/cook?serves=${Math.min(50, serves + 1)}${entry ? `&entry=${entry.id}` : ""}" aria-label="More">+</a>
              </form>
            </section>
          </aside>
        </div>

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

