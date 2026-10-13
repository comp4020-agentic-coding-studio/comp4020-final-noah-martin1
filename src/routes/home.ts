import { addDays, ago, freshness, money, qty, shortDate, today, weekday } from "../format.ts";
import { type Html, html } from "../html.ts";
import { type Ctx, htmlReply } from "../http.ts";
import { listVisibleRecipes, type Recipe } from "../recipes.ts";
import { recipeTile as recipeTileFor } from "./recipes.ts";
import type { Route } from "../server.ts";
import { friendIds } from "../visibility.ts";
import { prefsFor } from "../prefs.ts";
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
        <a class="feed-card ${r.image_url ? "feed-card-photo" : ""}" href="/recipes/${r.id}">
          ${r.image_url ? html`<img src="${r.image_url}/medium" alt="" loading="lazy" decoding="async" />` : ""}
          <span class="feed-card-text">
            <strong>${r.title}</strong>
            ${r.description ? html`<span class="clamp muted">${r.description}</span>` : ""}
            <span class="tags">${r.dietary_tags.map((t) => html`<span class="tag">${t}</span>`)}</span>
          </span>
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
      ${m.image_url
        ? html`<a class="feed-meal" href="/recipes/${m.recipe_id}"><img src="${m.image_url}/small" alt="" loading="lazy" decoding="async" /><span>${weekday(m.date)}</span></a>`
        : ""}
    </div>
  </li>`;
}

// The front door for visitors. Recipes and the live globe work without an
// account, so the page leads with them and keeps sign-up as the quiet option.
function landing(ctx: Ctx): Html {
  const picks = listVisibleRecipes(null, { order: "featured", limit: 40 }).filter((r) => r.image_url);
  const stack = picks.slice(0, 3);
  const row = picks.slice(3, 11);
  const total = listVisibleRecipes(null, { limit: 2000 }).length;
  const features: [string, string, string, string, string][] = [
    ["pantry", "A fridge you can see into", "A 3D fridge and pantry of what you actually have. Tap an item for when it goes off and which meals it's for.", "/pantry", "sage"],
    ["recipes", "Recipes that know your kitchen", "Every recipe shows what you have, what's missing, what the gap costs, and its nutrition per serve.", "/recipes", "peach"],
    ["calendar", "A week that plans itself", "Pick “$100 for the week”, “limit meat” or “what's in my fridge” and get a costed draft week in a tap.", "/calendar", "lavender"],
    ["global", "Cook live, anywhere", "Go live while you cook and your pan appears on the globe. People can follow along and ask questions.", "/global", "butter"],
    ["friends", "Friends, first", "See what friends are cooking on your calendar and at the top of the globe. Private stays private.", "/friends", "rose"],
    ["household", "One kitchen for the house", "Share a pantry and calendar with housemates, claim the shopping and race to use what's expiring.", "/household", "sky"],
  ];
  return publicPage(ctx, {
    title: "Cook what you have",
    mainClass: "main-landing",
    body: html`
      <section class="ld-hero">
        <div class="ld-copy">
          <p class="ld-eyebrow"><span class="live-dot" aria-hidden="true"></span> Recipes · pantry · people</p>
          <h1>Cook what you have.<br /><span>Waste less.</span> Cook with friends.</h1>
          <p class="lede">Larder keeps your fridge, recipes and meal plans in one calm place, and shares them with the people you cook with.</p>
          <div class="ld-actions">
            <a class="button button-large" href="/recipes">${icon("search", 18)} Browse ${total} recipes</a>
            <a class="button button-large button-ghost" href="/global">${icon("global", 18)} See who's cooking</a>
          </div>
          <p class="ld-quiet">No account needed to browse or cook. <a href="/register">Join free</a> to save your kitchen.</p>
        </div>
        <div class="ld-stack" aria-hidden="true">
          <div class="ld-tilt">
          ${stack.map(
            (r, i) => html`<a class="ld-card ld-card-${i}" href="/recipes/${r.id}" tabindex="-1">
              <img src="${r.image_url}" alt="" />
              <span class="ld-card-cap"><strong>${r.title}</strong><small>${r.cuisine || "Larder"}</small></span>
            </a>`,
          )}
          </div>
          <div class="ld-float ld-float-a">${icon("timer", 16)}<span><strong>Step 3 of 6</strong><small>Simmer 10 min</small></span></div>
          <div class="ld-float ld-float-b"><span class="live-dot"></span><span><strong>Cooking live</strong><small>Melbourne</small></span></div>
        </div>
      </section>

      <section class="ld-features" aria-label="What Larder does">
        ${features.map(
          ([ic, title, body, href, tone], i) => html`<a class="ld-feature" href="${href}" style="--tone: var(--${tone}); --i: ${i}">
            <span class="ld-feature-icon">${icon(ic, 22)}</span>
            <h2>${title}</h2>
            <p>${body}</p>
            <span class="ld-feature-go">${icon("arrow", 16)}</span>
          </a>`,
        )}
      </section>

      ${row.length
        ? html`<section class="ld-row" aria-labelledby="ld-row-h">
            <header><h2 id="ld-row-h">Cooking tonight?</h2><a href="/recipes">All recipes ${icon("arrow", 14)}</a></header>
            <div class="rx-grid">${row.map((r, i) => recipeTileFor(r, { i }))}</div>
          </section>`
        : ""}

      <section class="ld-end">
        <h2>Your kitchen, but it remembers.</h2>
        <p>Free, no ads. Your pantry and plans are yours: private unless you share them.</p>
        <div class="ld-actions">
          <a class="button button-large" href="/register">Create a free account</a>
          <a class="button button-large button-ghost" href="/login">Sign in</a>
        </div>
      </section>`,
  });
}

// The signed-in home: tonight's meal front and centre, the week at a glance,
// what needs using, money, and what friends are up to. Every card leads
// somewhere you can act.
function dashboard(ctx: Ctx): Html {
  const user = ctx.user!;
  const pantry = personalInventory(user.id);
  const urgent = pantry
    .filter((it) => ["expired", "soon"].includes(freshness(it.expiry_date).state))
    .sort((a, b) => (a.expiry_date ?? "").localeCompare(b.expiry_date ?? ""));
  const soon = urgent.filter((it) => freshness(it.expiry_date).state === "soon");
  const expired = urgent.filter((it) => freshness(it.expiry_date).state === "expired");
  const now = today();
  const week = entriesBetween(user.id, user.id, now, addDays(now, 6)).filter((e) => e.status !== "cancelled");
  const upcoming = week.filter((e) => e.status === "planned");
  const tonight = week.find((e) => e.date === now && e.meal === "dinner") ?? week.find((e) => e.date === now && e.status === "planned");
  const next = tonight ?? upcoming[0];
  const feed = friendFeed(user.id, 6);
  const shop = shoppingList(user.id, now, addDays(now, 6));
  const budget = prefsFor(user.id).weekly_budget_cents;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = user.display_name.split(" ")[0];
  const value = pantry.reduce((s, it) => s + (it.price_cents ?? 0), 0);

  const hero = next
    ? html`<a class="hm-tonight" href="/recipes/${next.recipe_id}">
        ${next.image_url ? html`<img src="${next.image_url}" alt="" />` : html`<div class="hm-tonight-fallback"></div>`}
        <div class="hm-tonight-scrim"></div>
        <div class="hm-tonight-body">
          <span class="hm-chip">${next === tonight ? (next.meal === "dinner" ? "Tonight" : `Today · ${next.meal}`) : `${weekday(next.date)} · ${next.meal}`}</span>
          <h2>${next.title}</h2>
          <span class="hm-tonight-meta">${next.cuisine ? html`${next.cuisine} · ` : ""}serves ${next.servings}</span>
        </div>
        <span class="hm-tonight-go">${icon("cook", 18)} Cook it</span>
      </a>`
    : html`<div class="hm-tonight hm-tonight-empty">
        <div class="hm-tonight-body">
          <span class="hm-chip">Tonight</span>
          <h2>Nothing planned yet</h2>
          <p>Let Larder draft a week from your budget and what's in the fridge, or pick something yourself.</p>
          <div class="hm-tonight-actions">
            <a class="button" href="/calendar#plan">${icon("spark", 16)} Plan my week</a>
            <a class="button button-ghost" href="/recipes">Browse recipes</a>
          </div>
        </div>
      </div>`;

  // seven little day cells, each with a thumbnail of its first meal
  const days = Array.from({ length: 7 }, (_, i) => addDays(now, i));
  const strip = html`<section class="hm-card hm-week" aria-labelledby="hm-week-h">
    <header class="hm-head"><h2 id="hm-week-h">This week</h2><a href="/calendar">Calendar ${icon("arrow", 14)}</a></header>
    <ol class="hm-days">
      ${days.map((d, i) => {
        const meals = week.filter((e) => e.date === d);
        const m = meals.find((e) => e.meal === "dinner") ?? meals[0];
        return html`<li class="${i === 0 ? "is-today" : ""}" style="--i: ${i}">
          <a href="${m ? `/recipes/${m.recipe_id}` : `/calendar#add`}" title="${m ? m.title : `Plan ${weekday(d)}`}">
            <span class="hm-dow">${i === 0 ? "Today" : weekday(d)}</span>
            ${m?.image_url
              ? html`<img src="${m.image_url}/small" alt="" loading="lazy" decoding="async" />`
              : html`<span class="hm-day-empty">${m ? m.title.slice(0, 1) : "+"}</span>`}
            <span class="hm-day-count">${meals.length ? `${meals.length} meal${meals.length === 1 ? "" : "s"}` : "Free"}</span>
          </a>
        </li>`;
      })}
    </ol>
  </section>`;

  const pct = budget ? Math.min(100, Math.round((shop.estCents / budget) * 100)) : 0;
  const money_ = html`<section class="hm-card hm-shop" aria-labelledby="hm-shop-h">
    <header class="hm-head"><h2 id="hm-shop-h">Shopping</h2><a href="/shopping">List ${icon("arrow", 14)}</a></header>
    <p class="hm-big">${money(shop.estCents)}<small> to buy this week</small></p>
    ${budget
      ? html`<div class="hm-meter" role="img" aria-label="${pct}% of your ${money(budget)} budget"><span style="--p: ${pct}%"></span></div>
          <p class="hm-note">${shop.estCents <= budget ? `${money(budget - shop.estCents)} under your ${money(budget)} budget` : `${money(shop.estCents - budget)} over your ${money(budget)} budget`}</p>`
      : html`<p class="hm-note"><a href="/settings">Set a weekly budget</a> to track it here.</p>`}
    <p class="hm-note">${shop.toBuy.length} item${shop.toBuy.length === 1 ? "" : "s"} for ${upcoming.length} planned meal${upcoming.length === 1 ? "" : "s"}${shop.unpriced ? ` · ${shop.unpriced} unpriced` : ""}</p>
  </section>`;

  const useSoon = html`<section class="hm-card hm-soon" aria-labelledby="hm-soon-h">
    <header class="hm-head"><h2 id="hm-soon-h">Use soon</h2><a href="/pantry">Fridge ${icon("arrow", 14)}</a></header>
    ${soon.length
      ? html`<ul class="hm-soon-list">${soon.slice(0, 4).map((it) => {
          const f = freshness(it.expiry_date);
          return html`<li><span class="hm-soon-name">${it.name}</span><span class="pill pill-${f.state}">${f.label}</span>
            <a class="hm-soon-find" href="/recipes?q=${encodeURIComponent(it.name)}" aria-label="Recipes with ${it.name}">${icon("search", 14)}</a></li>`;
        })}</ul>`
      : html`<p class="hm-note">Nothing goes off in the next few days.</p>`}
    ${expired.length ? html`<p class="hm-note hm-bad">${expired.length} item${expired.length === 1 ? " has" : "s have"} expired. <a href="/pantry#add">Tidy up</a></p>` : ""}
    <p class="hm-note">${pantry.length} items worth ${money(value)} in your kitchen</p>
  </section>`;

  const friends = html`<section class="hm-card hm-friends" aria-labelledby="hm-friends-h">
    <header class="hm-head"><h2 id="hm-friends-h">From friends</h2><a href="/friends#activity">Friends ${icon("arrow", 14)}</a></header>
    ${feed.length
      ? html`<ul class="hm-rail">${feed.map((item) => {
          const r = item.kind === "recipe" ? { id: item.recipe.id, title: item.recipe.title, img: item.recipe.image_url, who: item.recipe.author_name, what: "shared" }
            : { id: item.meal.recipe_id, title: item.meal.title, img: item.meal.image_url, who: item.meal.display_name, what: `${weekday(item.meal.date)} ${item.meal.meal}` };
          return html`<li><a href="/recipes/${r.id}">
            <span class="hm-rail-img">${r.img ? html`<img src="${r.img}/medium" alt="" loading="lazy" decoding="async" />` : html`<span>${r.title.slice(0, 1)}</span>`}</span>
            <span class="hm-rail-who">${avatar(r.who, "sm")}<span>${r.who.split(" ")[0]} · ${r.what}</span></span>
            <strong>${r.title}</strong>
          </a></li>`;
        })}</ul>`
      : empty("Quiet in here", "Add friends to see the recipes and meals they share.", html`<a class="button button-ghost" href="/friends">Find friends</a>`)}
  </section>`;

  return html`
    <header class="hm-top">
      <div>
        <p class="hm-date">${weekday(now)} ${shortDate(now)}</p>
        <h1>${greeting}, ${first}</h1>
      </div>
      <div class="hm-actions">
        <a class="button button-ghost" href="/global">${icon("global", 16)} Live globe</a>
        <a class="button" href="/recipes/new">${icon("plus", 16)} New recipe</a>
      </div>
    </header>
    <div class="hm">
      ${hero}
      ${strip}
      ${useSoon}
      ${money_}
      <div class="hm-live">${livePreviewCard(user.id)}</div>
      ${friends}
    </div>`;
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
    // the feed is part of Friends now; old links still land in the right place
    method: "GET",
    path: "/feed",
    auth: true,
    handler: () => ({ status: 302, headers: { location: "/friends#activity" }, body: "" }),
  },
];
