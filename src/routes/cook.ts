import { one } from "../db.ts";
import { qty } from "../format.ts";
import { html, raw } from "../html.ts";
import { htmlReply } from "../http.ts";
import { recipeIngredients, recipeSteps } from "../recipes.ts";
import type { Route } from "../server.ts";
import { icon, page } from "../views/layout.ts";
import { visibleRecipe } from "./recipes.ts";

// Cook mode: one recipe, scaled to how many you're feeding, one step at a
// time. Works now in the browser; "go live" (friends watching your steps)
// is crit 9. Without JavaScript every step is listed at once.

export const routes: Route[] = [
  {
    method: "GET",
    path: "/recipes/:id/cook",
    auth: true,
    handler: (ctx) => {
      const recipe = visibleRecipe(ctx);
      const requested = Number(ctx.url.searchParams.get("serves"));
      const serves = Number.isInteger(requested) && requested >= 1 && requested <= 50 ? requested : recipe.servings;
      const scale = serves / recipe.servings;
      const ingredients = recipeIngredients(recipe.id);
      const steps = recipeSteps(recipe.id);
      // a calendar entry the cook owns, if they came from their calendar
      const entryId = Number(ctx.url.searchParams.get("entry"));
      const entry = Number.isInteger(entryId)
        ? one<{ id: number }>(
            "SELECT id FROM calendar_entries WHERE id = ? AND owner_type = 'user' AND owner_id = ? AND status = 'planned'",
            entryId,
            ctx.user!.id,
          )
        : undefined;

      const body = html`
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/recipes">Recipes</a><span>/</span><a href="/recipes/${recipe.id}">${recipe.title}</a><span>/</span><span>Cook</span></nav>
        <header class="page-header">
          <div>
            <p class="eyebrow">Cook mode</p>
            <h1>${recipe.title}</h1>
          </div>
          <div class="page-actions">
            <form method="get" action="/recipes/${recipe.id}/cook" class="serves-form">
              ${entry ? html`<input type="hidden" name="entry" value="${entry.id}" />` : ""}
              <label class="field"><span>Cooking for</span>
                <span class="stepper"><input name="serves" type="number" min="1" max="50" value="${serves}" /><button class="button button-ghost" type="submit">Scale</button></span></label>
            </form>
            <span class="live-toggle" title="Arrives in crit 9">
              <input type="checkbox" id="go-live" disabled /> <label for="go-live">${icon("live", 16)} Go live to friends</label><small class="badge">Crit 9</small>
            </span>
          </div>
        </header>

        <div class="cook" data-cook-mode data-steps="${steps.length}">
          <section class="panel cook-ingredients">
            <h2 class="panel-title">Get ready ${scale !== 1 ? html`<span class="badge">×${Math.round(scale * 100) / 100}</span>` : ""}</h2>
            <ul class="check-list">
              ${ingredients.map(
                (i) => html`<li><label><input type="checkbox" /> <span class="mono qty">${qty(i.quantity === null ? null : Math.round(i.quantity * scale * 100) / 100, i.unit)}</span> <span>${i.name}${i.optional ? html` <small class="muted">optional</small>` : ""}</span></label></li>`,
              )}
            </ul>
          </section>

          <section class="panel cook-main">
            <header class="panel-head">
              <h2 class="panel-title">Step <span data-step-label>1</span> of ${steps.length}</h2>
              <span class="progress progress-wide" data-step-progress style="--p: ${steps.length ? Math.round(100 / steps.length) : 0}%"><span></span></span>
            </header>
            <ol class="cook-steps">
              ${steps.map(
                (s, i) => html`<li data-step="${s.step_number}" ${i === 0 ? raw('class="current"') : ""}>
                  <span class="step-index mono">${String(s.step_number).padStart(2, "0")}</span>
                  <p>${s.text}</p>
                  ${s.est_minutes ? html`<button class="button button-small button-ghost timer" type="button" data-timer="${s.est_minutes * 60}">${s.est_minutes} min timer</button>` : ""}
                </li>`,
              )}
            </ol>
            <div class="cook-controls">
              <button class="button button-ghost" type="button" data-step-prev>← Back</button>
              <button class="button" type="button" data-step-next>Next step →</button>
            </div>
            <div class="cook-done" data-cook-done>
              <p class="empty-title">Done — enjoy it.</p>
              ${entry
                ? html`<form method="post" action="/calendar/${entry.id}/status">
                    <input type="hidden" name="status" value="completed" />
                    <input type="hidden" name="return_to" value="/calendar" />
                    <button class="button" type="submit">Mark as cooked</button>
                  </form>`
                : html`<a class="button button-ghost" href="/recipes/${recipe.id}">Back to recipe</a>`}
              <p class="hint">Deducting what you used from your pantry arrives with reservations in crit 9.</p>
            </div>
          </section>
        </div>`;
      return htmlReply(page(ctx, { title: `Cook ${recipe.title}`, active: "recipes", body }));
    },
  },
];
