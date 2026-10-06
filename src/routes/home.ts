import { addDays, ago, freshness, money, qty, shortDate, today, weekday } from "../format.ts";
import { type Html, html } from "../html.ts";
import { type Ctx, htmlReply } from "../http.ts";
import { listVisibleRecipes, type Recipe } from "../recipes.ts";
import type { Route } from "../server.ts";
import { friendIds } from "../visibility.ts";
import { avatar, empty, icon, NAV_GROUPS, page, pageHeader, publicPage } from "../views/layout.ts";
import { shoppingList } from "../shopping.ts";
import { entriesBetween, type FriendMeal, friendMeals, mealChip } from "./calendar.ts";
import { personalInventory } from "./pantry.ts";
import { livePreviewCard } from "./live.ts";

type FeedItem = { kind: "recipe"; at: string; recipe: Recipe } | { kind: "meal"; at: string; meal: FriendMeal };

// Friends' recipes and shared meals, newest first. Plain page loads for now;
// the feed goes live over WebSockets in crit 9.
export function friendFeed(viewerId: number, limit = 40): FeedItem[] {
  const friends = friendIds(viewerId);
  const recipes = listVisibleRecipes(viewerId, { authorIds: friends, limit });
  const now = today();
  const meals = friendMeals(viewerId, friends, addDays(now, -3), addDays(now, 14));
  return [
    ...recipes.map((recipe) => ({ kind: "recipe" as const, at: recipe.created_at, recipe })),
    ...meals.map((meal) => ({ kind: "meal" as const, at: meal.created_at, meal })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

export function feedItem(item: FeedItem): Html {
  if (item.kind === "recipe") {
    const r = item.recipe;
    return html`<li class="feed-item">
      ${avatar(r.author_name)}
      <div class="grow">
        <p><a href="/u/${r.author_username}" class="strong">${r.author_name}</a> shared a recipe <span class="muted">· ${ago(item.at)}</span></p>
        <a class="feed-card" href="/recipes/${r.id}">
          <strong>${r.title}</strong>
          ${r.description ? html`<span class="clamp muted">${r.description}</span>` : ""}
          <span class="tags">${r.dietary_tags.map((t) => html`<span class="tag">${t}</span>`)}</span>
        </a>
      </div>
    </li>`;
  }
  const m = item.meal;
  return html`<li class="feed-item">
    ${avatar(m.display_name)}
    <div class="grow">
      <p><a href="/u/${m.username}" class="strong">${m.display_name}</a> is planning
        <a href="/recipes/${m.recipe_id}">${m.title}</a> for ${m.meal} on ${weekday(m.date)} ${shortDate(m.date)}
        <span class="muted">· ${ago(item.at)}</span></p>
    </div>
  </li>`;
}

function landing(ctx: Ctx): Html {
  const features: [string, string, string, string][] = [
    ["pantry", "Pantry with expiry & prices", "Log what you have, when it goes off and what you paid. The soonest-to-expire rises to the top.", ""],
    ["recipes", "Recipes that know your kitchen", "Every recipe shows what you already have, what's missing and what the gap costs.", ""],
    ["calendar", "Meal calendar", "Plan the week, share it with friends, and see what they're cooking.", ""],
    ["household", "Shared household", "One pantry for the house. Reserve ingredients live so nobody uses the last eggs you planned on.", "Crit 9"],
    ["live", "Cook together, live", "See “Alice is cooking pad thai — step 4 of 7” as it happens, and cook along.", "Crit 9"],
    ["planner", "Budget-aware planner", "Suggestions from what's expiring, what you can afford and what you like.", "Crit 10"],
  ];
  return publicPage(ctx, {
    title: "Cook what you have",
    body: html`
      <section class="hero">
        <p class="eyebrow">Recipes · pantry · people</p>
        <h1>Cook what you have.<br />Waste less. Cook with friends.</h1>
        <p class="lede">Larder keeps your pantry, recipes and meal plans in one place — and shares them with the people you cook with.</p>
        <div class="hero-actions">
          <a class="button button-large" href="/register">Create an account</a>
          <a class="button button-large button-ghost" href="/login">Sign in</a>
        </div>
      </section>
      <section class="feature-grid" aria-label="Features">
        ${features.map(
          ([ic, title, body, phase]) => html`<article class="feature">
            <div class="feature-head">${icon(ic, 24)}${phase ? html`<span class="badge">${phase}</span>` : ""}</div>
            <h2>${title}</h2>
            <p>${body}</p>
          </article>`,
        )}
      </section>`,
  });
}

function dashboard(ctx: Ctx): Html {
  const user = ctx.user!;
  const pantry = personalInventory(user.id);
  const urgent = pantry.filter((it) => ["expired", "soon"].includes(freshness(it.expiry_date).state)).slice(0, 6);
  const now = today();
  const upcoming = entriesBetween(user.id, user.id, now, addDays(now, 6)).filter((e) => e.status === "planned");
  const feed = friendFeed(user.id, 5);
  const shop = shoppingList(user.id, now, addDays(now, 6));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return html`
    ${pageHeader(`${greeting}, ${user.display_name.split(" ")[0]}`, `${weekday(now)} ${shortDate(now)}`, html`<a class="button" href="/recipes/new">${icon("plus", 16)} New recipe</a>`)}
    <div class="dash">
      <section class="panel">
        <header class="panel-head"><h2 class="panel-title">Use soon</h2><a href="/pantry">Pantry →</a></header>
        ${urgent.length
          ? html`<ul class="compact-list">${urgent.map((it) => {
              const f = freshness(it.expiry_date);
              return html`<li><span class="grow">${it.name}</span><span class="mono muted">${qty(it.quantity, it.unit)}</span><span class="pill pill-${f.state}">${f.label}</span></li>`;
            })}</ul>`
          : html`<p class="muted">Nothing expiring in the next 3 days.</p>`}
      </section>

      <section class="panel">
        <header class="panel-head"><h2 class="panel-title">Next 7 days</h2><a href="/calendar">Calendar →</a></header>
        ${upcoming.length
          ? html`<ul class="compact-list">${upcoming.slice(0, 6).map(
              (e) => html`<li><span class="mono muted w-day">${weekday(e.date)}</span><a class="grow" href="/recipes/${e.recipe_id}">${e.title}</a><span class="muted">${e.meal}</span></li>`,
            )}</ul>`
          : html`<p class="muted">No meals planned. <a href="/calendar">Plan one</a>.</p>`}
      </section>

      <section class="panel">
        <header class="panel-head"><h2 class="panel-title">Shopping</h2><a href="/shopping">List →</a></header>
        ${shop.toBuy.length
          ? html`<p class="big-number mono">${shop.toBuy.length} <small>item${shop.toBuy.length === 1 ? "" : "s"}</small></p>
              <p class="muted">≈ ${money(shop.estCents)} for this week's planned meals${shop.unpriced ? ` (+${shop.unpriced} unpriced)` : ""}.</p>`
          : html`<p class="muted">${upcoming.length ? "Your pantry covers this week's meals." : "Plan meals to build a list."}</p>`}
      </section>

      ${livePreviewCard()}

      <section class="panel">
        <header class="panel-head"><h2 class="panel-title">Household</h2><span class="badge">Crit 9</span></header>
        <p class="muted">Share a pantry and calendar with housemates, and reserve ingredients so nobody uses what you planned on.</p>
        <a class="button button-ghost button-block" href="/household">Preview household</a>
      </section>

      <section class="panel dash-wide">
        <header class="panel-head"><h2 class="panel-title">From friends</h2><a href="/feed">Feed →</a></header>
        ${feed.length
          ? html`<ul class="feed">${feed.map(feedItem)}</ul>`
          : empty("Quiet in here", "Add friends to see the recipes and meals they share.", html`<a class="button button-ghost" href="/friends">Find friends</a>`)}
      </section>
    </div>
    <p class="hint">Pantry value: ${money(pantry.reduce((s, it) => s + (it.price_cents ?? 0), 0))} across ${pantry.length} item${pantry.length === 1 ? "" : "s"}.</p>`;
}

// Everything in one list, for phones where the tab bar only fits five.
function morePage(ctx: Ctx): Html {
  const user = ctx.user!;
  return html`
    ${pageHeader("More")}
    <div class="more">
      ${NAV_GROUPS.map(
        (g) => html`<section class="panel panel-flush">
          ${g.heading ? html`<h2 class="panel-title more-heading">${g.heading}</h2>` : ""}
          <ul class="more-list">${g.items.map(
            (i) => html`<li><a href="${i.href}">${icon(i.key)}<span class="grow">${i.label}</span>${i.phase ? html`<small class="badge">${i.phase}</small>` : ""}<span aria-hidden="true">›</span></a></li>`,
          )}</ul>
        </section>`,
      )}
      <section class="panel panel-flush">
        <h2 class="panel-title more-heading">You</h2>
        <ul class="more-list">
          <li><a href="/u/${user.username}">${avatar(user.display_name, "sm")}<span class="grow">Profile</span><span aria-hidden="true">›</span></a></li>
          <li><a href="/settings">${icon("settings")}<span class="grow">Settings</span><span aria-hidden="true">›</span></a></li>
          <li><a href="/readme/">${icon("recipes")}<span class="grow">About Larder</span><span aria-hidden="true">›</span></a></li>
        </ul>
      </section>
      <form method="post" action="/logout"><button class="button button-ghost button-block" type="submit">${icon("logout", 16)} Sign out</button></form>
    </div>`;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/more",
    auth: true,
    handler: (ctx) => htmlReply(page(ctx, { title: "More", active: "more", body: morePage(ctx) })),
  },
  {
    method: "GET",
    path: "/",
    handler: (ctx) =>
      htmlReply(ctx.user ? page(ctx, { title: "Home", active: "home", body: dashboard(ctx) }) : landing(ctx)),
  },
  {
    method: "GET",
    path: "/feed",
    auth: true,
    handler: (ctx) => {
      const feed = friendFeed(ctx.user!.id);
      const body = html`
        ${pageHeader("Feed", "What your friends are sharing and planning.")}
        <div class="feed-layout">
          <section class="panel">
            ${feed.length
              ? html`<ul class="feed">${feed.map(feedItem)}</ul>`
              : empty("Nothing yet", "When friends share recipes or plan shared meals, they show up here.", html`<a class="button button-ghost" href="/friends">Find friends</a>`)}
          </section>
          <aside>${livePreviewCard()}
            <section class="panel"><h2 class="panel-title">Discover</h2>
              <ul class="compact-list">${listVisibleRecipes(ctx.user!.id, { excludeAuthorId: ctx.user!.id, limit: 5 }).map(
                (r) => html`<li><a class="grow" href="/recipes/${r.id}">${r.title}</a><span class="muted">${r.author_name}</span></li>`,
              )}</ul>
              <a href="/recipes?tab=discover">Browse all →</a>
            </section>
          </aside>
        </div>`;
      return htmlReply(page(ctx, { title: "Feed", active: "feed", body }));
    },
  },
];
