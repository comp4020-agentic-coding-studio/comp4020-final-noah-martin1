import { money } from "../format.ts";
import { type Html, html } from "../html.ts";
import { type Ctx, htmlReply } from "../http.ts";
import { prefsFor } from "../prefs.ts";
import { PLAN_WEEK, SUGGESTIONS } from "../samples.ts";
import type { Route } from "../server.ts";
import { icon, page, pageHeader, previewBanner, subnav } from "../views/layout.ts";

// Meal planner: suggestions from what's expiring, the budget and the diet.
// Preview until crit 10 (CLAUDE.md phase 3, item 17). The inputs panel reads
// the person's real settings; the suggestions are samples.

const TABS = [
  { href: "/planner", label: "Suggestions" },
  { href: "/planner/week", label: "Week plan" },
];

function inputs(ctx: Ctx): Html {
  const prefs = prefsFor(ctx.user!.id);
  return html`<section class="panel">
    <header class="panel-head"><h2 class="panel-title">Planning with</h2><a href="/settings">Edit in settings →</a></header>
    <dl class="kv">
      <div><dt>Weekly budget</dt><dd>${prefs.weekly_budget_cents === null ? html`<span class="muted">not set</span>` : money(prefs.weekly_budget_cents)}</dd></div>
      <div><dt>Diet</dt><dd>${prefs.dietary_prefs.length ? prefs.dietary_prefs.join(", ") : html`<span class="muted">no restrictions</span>`}</dd></div>
      <div><dt>Avoid</dt><dd>${prefs.dislikes || html`<span class="muted">nothing</span>`}</dd></div>
      <div><dt>Cooking for</dt><dd>${prefs.default_servings}</dd></div>
    </dl>
    <fieldset disabled class="bare">
      <div class="inline-form planner-controls">
        <label class="field"><span>Prioritise</span><select><option>Use expiring first</option><option>Cheapest</option><option>Quickest</option></select></label>
        <label class="field"><span>Meals</span><select><option>5 dinners</option><option>7 dinners</option></select></label>
        <button class="button" type="button">${icon("planner", 16)} Suggest meals</button>
      </div>
    </fieldset>
  </section>`;
}

function suggestions(ctx: Ctx): Html {
  return html`
    ${pageHeader("Meal planner", "Suggestions built from what's expiring, what you can afford and what you eat.")}
    ${previewBanner("Crit 10", "The budget and pantry maths is exact; AI only explains each pick and matches ingredient names.")}
    ${subnav("Planner", TABS, "/planner")}
    ${inputs(ctx)}
    <div class="suggestions">
      ${SUGGESTIONS.map(
        (s) => html`<article class="card suggestion">
          <div class="card-top"><span class="score mono" title="Match score">${s.score}</span><span class="mono">${s.cost} to buy · ${s.minutes} min</span></div>
          <h3>${s.title}</h3>
          <p class="why">${icon("planner", 16)} <span>${s.why}</span></p>
          <dl class="kv kv-tight">
            <div><dt>Uses</dt><dd>${s.uses.join(", ")}</dd></div>
            <div><dt>To buy</dt><dd>${s.missing.length ? s.missing.join(", ") : "nothing"}</dd></div>
          </dl>
          <div class="tags">${s.tags.map((t) => html`<span class="tag">${t}</span>`)}</div>
          <footer class="card-foot">
            <fieldset disabled class="bare inline"><button class="button button-small" type="button">Add to calendar</button> <button class="button button-small button-ghost" type="button">Not this</button></fieldset>
          </footer>
        </article>`,
      )}
    </div>
    <p class="hint">How picks are made: recipes you can see are filtered by diet, then ranked by how many soon-to-expire items they use and what the missing ingredients cost at prices you've paid. A suggestion over budget is never shown.</p>`;
}

function week(ctx: Ctx): Html {
  const prefs = prefsFor(ctx.user!.id);
  const total = PLAN_WEEK.reduce((sum, d) => sum + Math.round(Number(d.cost.slice(1)) * 100), 0);
  const budget = prefs.weekly_budget_cents;
  return html`
    ${pageHeader("Meal planner", "A draft week you can accept in one go, or edit meal by meal.")}
    ${previewBanner("Crit 10", "Week plans will be generated from your pantry and budget.")}
    ${subnav("Planner", TABS, "/planner/week")}
    <div class="split split-wide">
      <section class="panel panel-flush">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th scope="col">Day</th><th scope="col">Meal</th><th scope="col">Recipe</th><th scope="col" class="num">To buy</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${PLAN_WEEK.map(
              (d) => html`<tr><td class="mono">${d.day}</td><td class="muted">${d.meal}</td><td><span class="item-name">${d.title}</span></td><td class="num mono">${d.cost}</td>
                <td class="row-actions"><fieldset disabled class="bare inline"><button class="link-button" type="button">Swap</button></fieldset></td></tr>`,
            )}</tbody>
          </table>
        </div>
      </section>
      <aside class="side-stack">
        <section class="panel">
          <h2 class="panel-title">Week total</h2>
          <p class="big-number mono">${money(total)}</p>
          ${budget !== null
            ? html`<div class="budget"><span class="meter ${total > budget ? "meter-over" : ""}" style="--p: ${Math.min(100, Math.round((total / Math.max(budget, 1)) * 100))}%"><span></span></span>
                <small class="muted">${money(budget - total)} left of ${money(budget)}</small></div>`
            : html`<p class="muted">Set a weekly budget in <a href="/settings">settings</a> to see how this compares.</p>`}
        </section>
        <section class="panel stack">
          <h2 class="panel-title">Accept</h2>
          <fieldset disabled class="bare stack">
            <label class="check-inline"><input type="checkbox" checked /> <span>Add all to my calendar</span></label>
            <label class="check-inline"><input type="checkbox" checked /> <span>Add missing items to shopping list</span></label>
            <button class="button button-block" type="button">Accept week</button>
          </fieldset>
        </section>
      </aside>
    </div>`;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/planner",
    auth: true,
    handler: (ctx) => htmlReply(page(ctx, { title: "Meal planner", active: "planner", body: suggestions(ctx) })),
  },
  {
    method: "GET",
    path: "/planner/week",
    auth: true,
    handler: (ctx) => htmlReply(page(ctx, { title: "Week plan", active: "planner", body: week(ctx) })),
  },
];
