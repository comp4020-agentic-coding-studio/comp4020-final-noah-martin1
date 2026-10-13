import { addDays, today } from "../format.ts";
import { html } from "../html.ts";
import { HttpError, htmlReply } from "../http.ts";
import { findUser, friendship } from "../friends.ts";
import { listVisibleRecipes } from "../recipes.ts";
import type { Route } from "../server.ts";
import { avatar, empty, page } from "../views/layout.ts";
import { entriesBetween, mealChip } from "./calendar.ts";
import { recipeCard } from "./recipes.ts";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/u/:username",
    handler: (ctx) => {
      const person = findUser(ctx.params.username ?? "");
      if (!person) throw new HttpError(404, "There's nobody with that username.");
      const viewer = ctx.user;
      const self = viewer?.id === person.id;
      const f = viewer && !self ? friendship(viewer.id, person.id) : undefined;
      const recipes = listVisibleRecipes(viewer?.id ?? null, { authorId: person.id });
      const start = today();
      const meals = viewer ? entriesBetween(viewer.id, person.id, start, addDays(start, 6)) : [];

      let relation = html``;
      if (viewer && !self) {
        if (!f) {
          relation = html`<form method="post" action="/friends/${person.username}/request"><button class="button" type="submit">Add friend</button></form>`;
        } else if (f.status === "accepted") {
          relation = html`<span class="pill pill-fresh">Friends</span>`;
        } else if (f.requested_by === viewer.id) {
          relation = html`<span class="pill pill-none">Request sent</span>`;
        } else {
          relation = html`<form method="post" action="/friends/${person.username}/accept"><button class="button" type="submit">Accept request</button></form>`;
        }
      }

      const body = html`
        <header class="profile-head">
          ${avatar(person.display_name, "lg")}
          <div class="grow">
            <h1>${person.display_name}</h1>
            <p class="muted">@${person.username}</p>
          </div>
          <div class="page-actions">${self ? html`<a class="button button-ghost" href="/recipes/new">New recipe</a>` : relation}</div>
        </header>

        <section class="section">
          <h2 class="section-title">Cooking this week</h2>
          ${meals.length
            ? html`<div class="meal-list">${meals.map((m) => mealChip(m, false))}</div>`
            : html`<p class="muted">${self ? "Nothing planned in the next 7 days." : "Nothing shared with you for the next 7 days."}</p>`}
        </section>

        <section class="section">
          <h2 class="section-title">Recipes <span class="count">${recipes.length}</span></h2>
          ${recipes.length
            ? html`<div class="rx-grid">${recipes.map((r) => recipeCard(r))}</div>`
            : empty("No recipes to show", self ? "Recipes you write appear here." : "This person hasn't shared any recipes with you.")}
        </section>`;
      return htmlReply(page(ctx, { title: person.display_name, body }));
    },
  },
];
