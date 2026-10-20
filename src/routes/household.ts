import { packLine } from "./shopping.ts";
import { catalogFor } from "../db.ts";
import { addDays, ago, freshness, money, monthLabel, parseIsoDate, qty, shortDate, today, weekday, weekStart } from "../format.ts";
import {
  type Activity,
  addItem,
  boughtLine,
  claimLine,
  claimTonight,
  createHousehold,
  ENTRY_STATUSES,
  expiryRace,
  formatCode,
  type House,
  type HouseEntry,
  type HouseItem,
  type HouseLine,
  type HouseList,
  houseActivity,
  houseClaims,
  houseEntries,
  householdFor,
  houseItem,
  houseItems,
  houseShopping,
  houseUsuals,
  houseVersion,
  joinHousehold,
  leaveHousehold,
  LIST_DAYS,
  MEALS,
  type Meal,
  type Member,
  members,
  moveFromPersonal,
  overview,
  parseItem,
  personalItems,
  plannableByHouse,
  planHouseMeal,
  regenerateCode,
  releaseTonight,
  removeHouseEntry,
  removeItem,
  renameHousehold,
  requireHouse,
  setHouseBudget,
  setHouseEntryStatus,
  unclaimLine,
  updateItem,
} from "../household.ts";
import { type Html, html, raw } from "../html.ts";
import { type Ctx, htmlReply, json, redirect, setFlash } from "../http.ts";
import { getRecipe, listVisibleRecipes, type Recipe, totalMinutes } from "../recipes.ts";
import type { Route } from "../server.ts";
import { avatar, empty, errors, icon, page, subnav, tone } from "../views/layout.ts";
import { duration } from "./recipes.ts";

// Household: the people you live with sharing one pantry, one meal calendar
// and one shopping list. Every read and write goes through src/household.ts,
// which resolves the viewer's own household and 404s anything else. Pages
// work as plain forms; public/household.mjs makes claims feel live by polling
// a small version endpoint and swapping the regions that changed.

const TABS = [
  { href: "/household", label: "Overview" },
  { href: "/household/pantry", label: "Shared pantry" },
  { href: "/household/calendar", label: "House calendar" },
  { href: "/household/shopping", label: "Shared shopping" },
  { href: "/household/members", label: "Members" },
];

const SCRIPT = html`<script type="module" src="/assets/household.mjs"></script>`;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

// "You, Sam and Bo"
function nameList(viewerId: number, people: Member[]): string {
  const names = [...people].sort((a, b) => Number(b.id === viewerId) - Number(a.id === viewerId)).map((m) => (m.id === viewerId ? "You" : firstName(m.display_name)));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function when(iso: string): string {
  if (iso === today()) return "Today";
  if (iso === addDays(today(), 1)) return "Tomorrow";
  return `${weekday(iso)} ${shortDate(iso)}`;
}

// Where a form may send someone back to: household pages only.
function backTo(form: URLSearchParams, fallback: string): string {
  const to = form.get("return_to") ?? "";
  return /^\/household(\/[a-z]+)?(\?[\w=&%.-]*)?(#[\w-]+)?$/.test(to) ? to : fallback;
}

function returnField(path: string): Html {
  return html`<input type="hidden" name="return_to" value="${path}" />`;
}

/* ---------------- the shell for members ---------------- */

function shell(ctx: Ctx, house: House, people: Member[], path: string, title: string, body: Html, status = 200) {
  const me = ctx.user!.id;
  const header = html`<header class="hh-hero">
    <div class="hh-hero-text">
      <p class="eyebrow">Household</p>
      <h1>${house.name}</h1>
      <p class="lede hh-lede"><span class="avatars">${people.map((m) => avatar(m.display_name, "sm"))}</span>
        <span>${nameList(me, people)} · one pantry, one calendar, one shopping list</span></p>
    </div>
    <div class="hh-hero-side">
      <span class="hh-live" data-hh-live hidden title="This page updates by itself when a housemate changes something"><span class="live-dot"></span>Live</span>
      <a class="button button-ghost button-small" href="/household/members#invite">${icon("plus", 15)} Invite</a>
    </div>
  </header>`;
  return htmlReply(
    page(ctx, {
      title,
      active: "household",
      headExtra: SCRIPT,
      body: html`<div class="hh" data-hh-root data-hh-version="${houseVersion(me)}">
        ${header}
        ${subnav("Household", TABS, path)}
        ${body}
        <div class="hh-toasts" data-hh-toasts aria-live="polite"></div>
      </div>`,
    }),
    status,
  );
}

/* ---------------- no household yet: what it is, start one or join one ---------------- */

interface WelcomeState {
  name?: string;
  code?: string;
  createProblems?: string[];
  joinProblems?: string[];
  // shown above everything when someone followed a household link without one
  lead?: string;
}

function welcome(ctx: Ctx, s: WelcomeState = {}, status = 200) {
  const feature = (key: string, iconName: string, title: string, body: string) =>
    html`<li class="hh-feat hh-feat-${key}"><span class="hh-feat-icon">${icon(iconName, 20)}</span><h3>${title}</h3><p>${body}</p></li>`;
  const body = html`<div class="hh hh-welcome">
    ${s.lead ? html`<p class="hh-lead-note" role="note">${icon("household", 16)} ${s.lead}</p>` : ""}
    <header class="hh-welcome-hero">
      <p class="eyebrow">Household</p>
      <h1>One kitchen,<br />everyone in it.</h1>
      <p class="lede">A household is the people you live with, sharing one pantry, one meal calendar and one shopping list.
        Changes show up for everyone as they happen, so nobody buys the same milk twice or uses the eggs someone was saving.</p>
    </header>

    <ul class="hh-feats" aria-label="What a household gives you">
      ${feature("pantry", "pantry", "Shared pantry", "One list of what's in the house: who bought it, what it cost and when it goes off. Move things in from your own pantry in a tap.")}
      ${feature("calendar", "calendar", "House calendar", "Plan house dinners onto the week, see who planned what, and tick them off as cooked.")}
      ${feature("shopping", "shopping", "Shared shopping", "The list builds itself from house meals minus what's in stock. Say “I've got this” so nobody doubles up, and watch the shared budget ticker.")}
      ${feature("race", "timer", "Expiry race & nudges", "Things about to go off float to the top: call “use tonight” before anyone else. When a housemate's shop completes a recipe of yours, you hear about it.")}
    </ul>

    <div class="hh-doors">
      <section class="hh-door hh-door-start" aria-labelledby="start-h">
        <span class="hh-door-n" aria-hidden="true">1</span>
        <h2 id="start-h">Start a household</h2>
        <p>You'll be its owner and get an invite code to give your housemates.</p>
        ${errors(s.createProblems ?? [])}
        <form method="post" action="/household" class="stack">
          <label class="field"><span>Household name</span>
            <input name="name" required maxlength="60" placeholder="e.g. Fitzroy St, or The Flat" value="${s.name ?? ""}" autocomplete="off" /></label>
          <button class="button button-block" type="submit">${icon("plus", 16)} Create household</button>
        </form>
      </section>
      <section class="hh-door hh-door-join" aria-labelledby="join-h">
        <span class="hh-door-n" aria-hidden="true">2</span>
        <h2 id="join-h">Join with an invite code</h2>
        <p>Someone already set one up? Ask them for the code. It's on their household's Members tab and looks like <span class="mono">ABCD-EFGH</span>.</p>
        ${errors(s.joinProblems ?? [])}
        <form method="post" action="/household/join" class="stack">
          <label class="field"><span>Invite code</span>
            <input name="code" required maxlength="20" placeholder="ABCD-EFGH" value="${s.code ?? ""}" autocomplete="off" autocapitalize="characters" spellcheck="false" class="hh-code-input" /></label>
          <button class="button button-soft button-block" type="submit">Join household</button>
        </form>
      </section>
    </div>

    <section class="hh-fineprint" aria-label="Good to know">
      <div><h3>${icon("users", 16)} One at a time</h3><p>You can belong to one household. Leave it any time from its Members tab; the last person out closes it.</p></div>
      <div><h3>${icon("check", 16)} What housemates see</h3><p>The shared pantry, house calendar and shared list, and who did what in them.</p></div>
      <div><h3>${icon("close", 16)} What they don't</h3><p>Your own pantry, your personal calendar and any recipe you haven't shared with them.</p></div>
    </section>
  </div>`;
  return htmlReply(page(ctx, { title: "Household", active: "household", body }), status);
}

// A household page asked for by someone without a household: 404 (there's
// no household of theirs to show), but with the way to start or join one.
function noHouse(ctx: Ctx, what: string) {
  return welcome(ctx, { lead: `You're not in a household yet, so there's no ${what} to show. Start one or join one below.` }, 404);
}

/* ---------------- pieces ---------------- */

function itemQty(i: Pick<HouseItem, "quantity" | "unit">): string {
  return qty(i.quantity, i.unit);
}

function isSoon(i: HouseItem): boolean {
  if (!i.expiry_date || i.quantity <= 0) return false;
  const f = freshness(i.expiry_date).state;
  return f === "soon";
}

// The expiry race control on one shared item: claim it, see who has, or let go.
function tonightControl(i: HouseItem, me: number, returnTo: string): Html {
  if (i.tonight && i.tonight.user_id === me) {
    return html`<span class="hh-claim hh-claim-mine">${icon("check", 14)} You're using it tonight</span>
      <form method="post" action="/household/items/${i.id}/release" data-hh-action>${returnField(returnTo)}<button class="link-button" type="submit">Let go</button></form>`;
  }
  if (i.tonight) {
    return html`<span class="hh-claim" style="--av: ${tone(i.tonight.name)[0]}; --av-ink: ${tone(i.tonight.name)[1]}">${avatar(i.tonight.name, "sm")} ${firstName(i.tonight.name)} is using it tonight</span>`;
  }
  if (!isSoon(i)) return html``;
  return html`<form method="post" action="/household/items/${i.id}/tonight" data-hh-action>${returnField(returnTo)}
    <button class="button button-small hh-tonight-btn" type="submit" aria-label="Use the ${i.name} tonight">${icon("flame", 14)} Use tonight</button></form>`;
}

function raceList(race: HouseItem[], me: number, returnTo: string): Html {
  if (!race.length) {
    return html`<div class="hh-race-empty">${icon("leaf", 22)}<p><strong>Nothing's about to go off.</strong> Items expiring in the next three days appear here for someone to claim.</p></div>`;
  }
  return html`<ul class="hh-race">
    ${race.map((i) => {
      const f = freshness(i.expiry_date);
      return html`<li class="hh-race-item ${i.tonight ? "is-claimed" : ""}">
        <span class="hh-race-when pill pill-${f.state}">${f.label}</span>
        <span class="grow"><span class="item-name">${i.name}</span><small class="muted block">${itemQty(i)} · added by ${i.added_by === me ? "you" : firstName(i.added_by_name)}</small></span>
        <span class="hh-race-act">${tonightControl(i, me, returnTo)}</span>
      </li>`;
    })}
  </ul>`;
}

function activityFeed(list: Activity[]): Html {
  if (!list.length) return empty("Nothing yet", "When anyone adds to the pantry, plans a meal or claims something, it shows up here.");
  return html`<ul class="feed hh-feed">
    ${list.map(
      (a) => html`<li class="feed-item ${a.nudge ? "hh-nudge" : ""}">
        ${avatar(a.name, "sm")}
        <p class="grow">${a.nudge ? html`<span class="hh-nudge-tag">${icon("spark", 12)} Unlocked</span>` : ""}<strong>${a.who}</strong> ${a.text}${a.recipeId ? html` <a class="hh-feed-link" href="/recipes/${a.recipeId}">${a.nudge ? "Cook it" : "Recipe"} →</a>` : ""}
          <span class="muted">· ${ago(a.at)}</span></p>
      </li>`,
    )}
  </ul>`;
}

// The shared budget ticker: estimated shop for the week against the house's
// budget, and how much of it housemates have already claimed.
function ticker(list: HouseList, opts: { form: boolean; link?: boolean }): Html {
  const budget = list.budgetCents;
  const est = list.purchaseCents;
  const pct = budget ? Math.min(100, Math.round((est / Math.max(1, budget)) * 100)) : 0;
  const claimedPct = budget ? Math.min(pct, Math.round((list.claimedCents / Math.max(1, budget)) * 100)) : est ? Math.round((list.claimedCents / est) * 100) : 0;
  const over = budget !== null && est > budget;
  const open = list.toBuy.length - list.claimedLines;
  return html`<section class="hh-ticker ${over ? "is-over" : ""}" data-hh-region="ticker" id="budget" aria-labelledby="ticker-h">
    <header class="hh-ticker-head">
      <p class="cal-label" id="ticker-h">${icon("basket", 16)} This week's house shop</p>
      ${opts.link ? html`<a href="/household/shopping">List →</a>` : ""}
    </header>
    <p class="hh-ticker-big"><span class="tnum">${money(est)}</span> <small>at the checkout, whole packs${list.unpriced ? ` + ${list.unpriced} unpriced` : ""}</small></p>
    <div class="hh-meter ${over ? "is-over" : ""}" role="meter" aria-label="Checkout estimate against the house budget"
      aria-valuemin="0" aria-valuemax="${budget ?? Math.max(est, 1)}" aria-valuenow="${budget ? Math.min(est, budget) : est}"
      aria-valuetext="${money(est)}${budget ? ` of ${money(budget)}` : ""}">
      <span class="hh-meter-total" style="--p: ${budget ? pct : 100}%"></span>
      <span class="hh-meter-claimed" style="--p: ${claimedPct}%"></span>
    </div>
    <p class="hh-ticker-note">${budget === null
      ? html`No house budget yet${opts.form ? ". Set one below" : html`. <a href="/household/shopping#budget">Set one →</a>`}`
      : over
        ? html`<strong class="hh-over">${money(est - budget)} over</strong> the ${money(budget)} weekly budget`
        : html`<strong>${money(budget - est)} left</strong> of the ${money(budget)} weekly budget`}</p>
    <dl class="hh-ticker-split">
      <div><dt><span class="hh-key hh-key-claimed"></span>Claimed</dt><dd><span class="tnum">${money(list.claimedCents)}</span> <small>${list.claimedLines} item${list.claimedLines === 1 ? "" : "s"}</small></dd></div>
      <div><dt><span class="hh-key"></span>Still to claim</dt><dd><span class="tnum">${money(est - list.claimedCents)}</span> <small>${open} item${open === 1 ? "" : "s"}</small></dd></div>
    </dl>
    ${opts.form
      ? html`<form class="hh-budget-form" method="post" action="/household/budget">
          <label class="field"><span>Weekly house budget</span>
            <span class="input-prefix"><span>$</span><input name="budget" inputmode="decimal" placeholder="e.g. 150" value="${budget === null ? "" : (budget / 100).toFixed(2)}" /></span></label>
          <button class="button button-small button-soft" type="submit">Save</button>
        </form>
        <p class="cal-fine">Anyone in the house can change it. Prices are estimates (see “How it's worked out”), not live supermarket prices.</p>`
      : ""}
  </section>`;
}

function weekStrip(entries: HouseEntry[], me: number): Html {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i));
  return html`<ol class="hh-days">
    ${days.map((d) => {
      const meals = entries.filter((e) => e.date === d && e.status !== "cancelled");
      return html`<li class="hh-day ${d === today() ? "is-today" : ""}">
        <span class="hh-day-head"><span class="hh-dow">${d === today() ? "Today" : weekday(d)}</span><span class="hh-dnum">${parseIsoDate(d)!.getDate()}</span></span>
        ${meals.length
          ? meals.map(
              (e) => html`<a class="hh-day-meal ${e.status === "completed" ? "is-done" : ""}" href="/recipes/${e.recipe_id}">
                <span class="hh-day-kind">${e.meal}</span><span class="hh-day-title">${e.title}</span>
                <span class="hh-day-who">${avatar(e.planner_name, "sm")}<span>${e.planned_by === me ? "You" : firstName(e.planner_name)}</span></span></a>`,
            )
          : html`<a class="hh-day-free" href="/household/calendar?day=${d}#plan">${icon("plus", 14)}<span class="sr-only">Plan a meal for ${when(d)}</span></a>`}
      </li>`;
    })}
  </ol>`;
}

function membersCard(house: House, people: Member[], me: number): Html {
  return html`<section class="panel" data-hh-region="members" aria-labelledby="mem-h">
    <header class="panel-head"><h2 class="panel-title" id="mem-h">${icon("users", 16)} Who lives here</h2><a href="/household/members">Manage →</a></header>
    <ul class="people hh-people">
      ${people.map(
        (m) => html`<li class="person">${avatar(m.display_name)}<div class="grow"><a class="person-name" href="/u/${m.username}">${m.id === me ? `${m.display_name} (you)` : m.display_name}</a><small class="muted">${m.role === "owner" ? "Owner" : "Member"} · joined ${ago(m.joined_at)}</small></div></li>`,
      )}
    </ul>
    <div class="hh-invite-mini">
      <span class="muted small">Invite code</span>
      <span class="hh-code" data-copy-text="${formatCode(house.invite_code)}">${formatCode(house.invite_code)}</span>
      <button class="hh-copy" type="button" data-copy="${formatCode(house.invite_code)}" hidden>Copy</button>
    </div>
  </section>`;
}

/* ---------------- overview ---------------- */

function overviewPage(ctx: Ctx) {
  const me = ctx.user!.id;
  const o = overview(me);
  const soon = o.items.filter((i) => isSoon(i)).length;
  const expired = o.items.filter((i) => i.quantity > 0 && freshness(i.expiry_date).state === "expired").length;
  const planned = o.week.filter((e) => e.status === "planned").length;
  const claimedByMe = o.race.filter((i) => i.tonight?.user_id === me);
  const tonightMeals = o.week.filter((e) => e.date === today() && e.status !== "cancelled");
  const body = html`
    <dl class="stats hh-stats" data-hh-region="stats">
      <div><dt>Shared items</dt><dd>${o.items.length}</dd></div>
      <div class="${soon ? "stat-warn" : ""}"><dt>Use soon</dt><dd>${soon}${expired ? html`<small> + ${expired} expired</small>` : ""}</dd></div>
      <div><dt>House meals · 7 days</dt><dd>${planned}</dd></div>
      <div><dt>To buy</dt><dd>${o.list.toBuy.length}<small> · ${o.list.claimedLines} claimed</small></dd></div>
    </dl>

    <section class="panel hh-week-panel" data-hh-region="week" aria-labelledby="week-h">
      <header class="panel-head">
        <h2 class="panel-title" id="week-h">${icon("calendar", 16)} The week ahead</h2>
        <a href="/household/calendar">House calendar →</a>
      </header>
      ${tonightMeals.length
        ? html`<p class="hh-explain">Tonight: ${tonightMeals.map((e, i) => html`${i ? ", " : ""}<a href="/recipes/${e.recipe_id}">${e.title}</a>`)}, planned by ${[...new Set(tonightMeals.map((e) => (e.planned_by === me ? "you" : firstName(e.planner_name))))].join(" and ")}.</p>`
        : html`<p class="hh-explain">Nothing planned for tonight yet. Tap a free day to put a house meal on it.</p>`}
      ${weekStrip(o.week, me)}
    </section>

    <div class="hh-grid">
      <div class="hh-main">
        <section class="panel hh-race-panel" data-hh-region="race" aria-labelledby="race-h">
          <header class="panel-head">
            <h2 class="panel-title" id="race-h">${icon("timer", 16)} Expiry race</h2>
            <a href="/household/pantry">Pantry →</a>
          </header>
          <p class="hh-explain">Shared things going off in the next three days. Call one with “Use tonight” and it's yours; everyone else sees it straight away${claimedByMe.length ? html`. You've called <strong>${claimedByMe.map((i) => i.name).join(", ")}</strong>` : ""}.</p>
          ${raceList(o.race, me, "/household")}
        </section>

        <section class="panel" data-hh-region="activity" aria-labelledby="act-h">
          <header class="panel-head"><h2 class="panel-title" id="act-h">${icon("feed", 16)} House activity</h2></header>
          ${activityFeed(o.activity)}
          <p class="hint">${icon("spark", 14)} “Unlocked” lines are worked out from what's in stock: when a housemate's shop completes a house meal, or a recipe you've planned or written, Larder says so.</p>
        </section>
      </div>

      <aside class="hh-side">
        ${ticker(o.list, { form: false, link: true })}
        ${o.list.toBuy.length
          ? html`<section class="panel" data-hh-region="claims" aria-labelledby="cl-h">
              <header class="panel-head"><h2 class="panel-title" id="cl-h">${icon("shopping", 16)} On the list</h2><a href="/household/shopping">All ${o.list.toBuy.length} →</a></header>
              <ul class="compact-list hh-mini-list">
                ${o.list.toBuy.slice(0, 6).map(
                  (l) => html`<li><span class="grow"><span class="item-name">${l.name}</span><small class="muted block">${l.toBuy === null ? "some" : qty(l.toBuy, l.unit)} · ${l.meals.join(", ")}</small></span>
                    ${l.claim ? html`<span class="hh-claim hh-claim-sm" title="${l.claim.name} is buying this">${avatar(l.claim.name, "sm")}${l.claim.user_id === me ? "You" : firstName(l.claim.name)}</span>` : html`<span class="muted small">open</span>`}</li>`,
                )}
              </ul>
            </section>`
          : ""}
        ${membersCard(o.house, o.members, me)}
      </aside>
    </div>`;
  return shell(ctx, o.house, o.members, "/household", o.house.name, body);
}

/* ---------------- shared pantry ---------------- */

function itemFields(values: Record<string, string>, idPrefix: string): Html {
  return html`
    <label class="field grow-2"><span>Item</span>
      <input id="${idPrefix}-name" name="name" required maxlength="80" list="hh-catalog" placeholder="e.g. eggs" value="${values.name ?? ""}" /></label>
    <label class="field"><span>Qty</span>
      <input name="quantity" required inputmode="decimal" placeholder="12" value="${values.quantity ?? ""}" /></label>
    <label class="field"><span>Unit</span>
      <input name="unit" maxlength="20" placeholder="g, ml, pack" value="${values.unit ?? ""}" /></label>
    <label class="field"><span>Expires</span>
      <input name="expiry_date" type="date" value="${values.expiry_date ?? ""}" /></label>
    <label class="field"><span>Price paid</span>
      <span class="input-prefix"><span>$</span><input name="price" inputmode="decimal" placeholder="0.00" value="${values.price ?? ""}" /></span></label>`;
}

function pantryPage(ctx: Ctx, values: Record<string, string> = {}, problems: string[] = [], status = 200, editProblems: { id: number; values: Record<string, string>; problems: string[] } | null = null) {
  const me = ctx.user!.id;
  const house = requireHouse(me);
  const people = members(house.id);
  const items = houseItems(me);
  const mine = personalItems(me);
  const editing = editProblems?.id ?? Number(ctx.url.searchParams.get("edit"));
  let value = 0;
  let soon = 0;
  for (const i of items) {
    value += i.price_cents ?? 0;
    if (isSoon(i)) soon++;
  }
  const body = html`
    <div class="hh-pantry-top">
      <section class="panel hh-add" id="add" aria-labelledby="add-h">
        <h2 class="panel-title" id="add-h">${icon("plus", 16)} Add to the house pantry</h2>
        <p class="hh-explain">For things everyone can use: the milk, the rice, the big jar of peanut butter. Your own pantry stays yours.</p>
        ${errors(problems)}
        <form method="post" action="/household/pantry" class="inline-form">
          ${itemFields(values, "add")}
          <button class="button" type="submit">${icon("plus", 16)} Add</button>
        </form>
        <datalist id="hh-catalog">${catalogFor(me).map((c) => html`<option value="${c}"></option>`)}</datalist>
      </section>
      ${mine.length
        ? html`<section class="panel hh-move" aria-labelledby="move-h">
            <h2 class="panel-title" id="move-h">${icon("arrow", 16)} Move from my pantry</h2>
            <p class="hh-explain">Bought something for everyone? Hand it to the house; it leaves your own pantry.</p>
            <form method="post" action="/household/pantry/move" class="inline-form">
              <label class="field grow-2"><span>Your item</span>
                <select name="item_id">${mine.map((i) => html`<option value="${i.id}">${i.name} · ${qty(i.quantity, i.unit)}${i.expiry_date ? ` · ${freshness(i.expiry_date).label}` : ""}</option>`)}</select></label>
              <button class="button button-soft" type="submit">Move into the house</button>
            </form>
          </section>`
        : ""}
    </div>

    <section class="panel panel-flush hh-items-panel" data-hh-region="items" aria-labelledby="items-h">
      <header class="hh-items-head">
        <h2 class="panel-title" id="items-h">In the house <span class="count">${items.length}</span></h2>
        <span class="muted small">${soon ? html`<span class="pill pill-soon">${soon} to use soon</span> ` : ""}${money(value)} of stock</span>
      </header>
      ${items.length
        ? html`<ul class="hh-items">
            ${items.map((i) => {
              const f = freshness(i.expiry_date);
              if (i.id === editing) {
                const v = editProblems?.values ?? {
                  name: i.name,
                  quantity: String(i.quantity),
                  unit: i.unit,
                  expiry_date: i.expiry_date ?? "",
                  price: i.price_cents === null ? "" : (i.price_cents / 100).toFixed(2),
                };
                return html`<li class="hh-item is-editing">
                  ${errors(editProblems?.problems ?? [])}
                  <form method="post" action="/household/pantry/${i.id}" class="inline-form">
                    ${itemFields(v, `edit-${i.id}`)}
                    <a class="button button-ghost" href="/household/pantry">Cancel</a>
                    <button class="button" type="submit">Save</button>
                  </form>
                </li>`;
              }
              const [bg, ink] = tone(i.name);
              return html`<li class="hh-item row-${f.state}" id="item-${i.id}">
                <span class="hh-item-chip" style="--chip: ${bg}; --chip-ink: ${ink}" aria-hidden="true">${i.name.slice(0, 1).toUpperCase()}</span>
                <span class="hh-item-main">
                  <span class="item-name">${i.name}</span>
                  <small class="muted">added by ${i.added_by === me ? "you" : firstName(i.added_by_name)} · ${ago(i.added_at)}${i.price_cents !== null ? ` · ${money(i.price_cents)}` : ""}</small>
                </span>
                <span class="hh-item-qty mono">${itemQty(i)}</span>
                <span class="hh-item-exp"><span class="pill pill-${f.state}">${f.label}</span></span>
                <span class="hh-item-claim">${tonightControl(i, me, "/household/pantry")}</span>
                <span class="hh-item-actions">
                  <a class="link-button" href="/household/pantry?edit=${i.id}#item-${i.id}">Edit</a>
                  <form method="post" action="/household/pantry/${i.id}/delete" data-confirm="Take ${i.name} out of the house pantry?">
                    <button class="link-button danger" type="submit">Remove</button>
                  </form>
                </span>
              </li>`;
            })}
          </ul>`
        : html`<div class="hh-items-empty">${empty("The house pantry is empty", "Add what the house shares, or move items in from your own pantry. Expiry dates drive the expiry race, and stock comes off the shared shopping list.")}</div>`}
    </section>
    <p class="hint">${icon("timer", 14)} Anything going off within three days gets a “Use tonight” button. The first person to press it has it; the button disappears for everyone else.</p>`;
  return shell(ctx, house, people, "/household/pantry", "Shared pantry", body, status);
}

/* ---------------- house calendar ---------------- */

const MEAL_LABEL: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const DAY_TINTS = ["--sage", "--peach", "--butter", "--lavender", "--sky", "--rose", "--sage"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function photo(url: string | null, size: "small" | "medium"): string | null {
  if (!url) return null;
  return /themealdb\.com/.test(url) ? `${url}/${size}` : url;
}

function thumb(url: string | null, title: string, size: "small" | "medium" = "medium"): Html {
  const src = photo(url, size);
  if (src) return html`<img src="${src}" alt="" loading="lazy" decoding="async" />`;
  const [bg, ink] = tone(title);
  return html`<span class="cal-fallback" style="--fallback: ${bg}; --fallback-ink: ${ink}" aria-hidden="true"><span>${title.slice(0, 1)}</span>${icon("cook", 16)}</span>`;
}

function entryMenu(e: HouseEntry, returnTo: string): Html {
  const labels: Record<string, string> = { completed: "Mark as cooked", cancelled: "Skip this meal", planned: "Back to planned" };
  return html`<details class="meal-menu cal-menu">
    <summary aria-label="Change ${e.title} on ${when(e.date)}">•••</summary>
    <div class="menu">
      ${e.status === "planned" ? html`<a href="/recipes/${e.recipe_id}/cook">Cook now</a>` : ""}
      ${ENTRY_STATUSES.filter((s) => s !== e.status).map(
        (s) => html`<form method="post" action="/household/calendar/${e.id}/status" data-hh-action><input type="hidden" name="status" value="${s}" />${returnField(returnTo)}<button type="submit">${labels[s]}</button></form>`,
      )}
      <form method="post" action="/household/calendar/${e.id}/delete" data-hh-action>${returnField(returnTo)}<button type="submit" class="danger">Remove from the house</button></form>
    </div>
  </details>`;
}

function houseTile(e: HouseEntry, me: number, i: number, returnTo: string): Html {
  const who = e.planned_by === me ? "You" : firstName(e.planner_name);
  const [bg, ink] = tone(e.planner_name);
  return html`<article class="cal-tile cal-${e.status} hh-tile" style="--i: ${i}; --fr: ${bg}; --fr-ink: ${ink}">
    <a class="cal-tile-link" href="/recipes/${e.recipe_id}">
      <span class="cal-thumb">${thumb(e.image_url, e.title)}<span class="cal-kind">${MEAL_LABEL[e.meal]}</span></span>
      <span class="cal-tile-body" data-kind="${MEAL_LABEL[e.meal]}">
        <span class="cal-tile-title">${e.title}</span>
        <span class="cal-tile-meta cal-who">${avatar(e.planner_name, "sm")}<span>${e.status === "completed" ? `${who === "You" ? "You" : who} · cooked` : e.status === "cancelled" ? `${who} · skipped` : `${who} planned`}</span></span>
      </span>
    </a>
    <div class="cal-tile-tools">
      ${e.status === "planned" ? html`<a class="cal-cook" href="/recipes/${e.recipe_id}/cook" aria-label="Cook ${e.title} now">${icon("flame", 13)}<span>Cook</span></a>` : ""}
      ${entryMenu(e, returnTo)}
    </div>
  </article>`;
}

function calendarPage(ctx: Ctx, problem: string | null = null, status = 200) {
  const me = ctx.user!.id;
  const house = requireHouse(me);
  const people = members(house.id);
  const now = today();
  const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const askedDay = ctx.url.searchParams.get("day") ?? "";
  const askedWeek = ctx.url.searchParams.get("week") ?? "";
  const start = parseIsoDate(askedWeek) ? weekStart(askedWeek) : parseIsoDate(askedDay) ? weekStart(askedDay) : weekStart(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const day = parseIsoDate(askedDay) && days.includes(askedDay) ? askedDay : days.includes(now) ? now : start;
  const mealParam = ctx.url.searchParams.get("meal") ?? "dinner";
  const meal: Meal = (MEALS as readonly string[]).includes(mealParam) ? (mealParam as Meal) : "dinner";
  const { entries, hidden } = houseEntries(me, start, addDays(start, 6));
  const returnTo = `/household/calendar?week=${start}`;
  const title = now >= start && now <= addDays(start, 6) ? "This week" : addDays(start, -7) <= now && now < start ? "Next week" : `Week of ${shortDate(start)}`;
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ week: start, ...extra });
    return `/household/calendar?${p.toString()}`;
  };

  // the picker: search, or the house's usuals then photographed catalogue mains;
  // only recipes everyone in the house can open
  let choices: Recipe[];
  let heading: string;
  if (q) {
    choices = plannableByHouse(me, listVisibleRecipes(me, { query: q, limit: 40 })).slice(0, 8);
    heading = `Results for “${q}”`;
  } else {
    const usual = houseUsuals(me).map((id) => getRecipe(id)).filter((r): r is Recipe => !!r);
    const featured = listVisibleRecipes(me, { course: "main", order: "featured", limit: 30 }).filter((r) => r.source !== null && !usual.some((u) => u.id === r.id));
    choices = plannableByHouse(me, [...usual, ...featured]).slice(0, 8);
    heading = usual.length ? "House usuals and some ideas" : "Ideas to start with";
  }

  let n = 0;
  const body = html`
    <header class="hh-cal-head">
      <div>
        <h2 class="hh-h2">${title}</h2>
        <p class="muted">${shortDate(start)} – ${shortDate(addDays(start, 6))} · ${entries.filter((e) => e.status !== "cancelled").length} house meal${entries.filter((e) => e.status !== "cancelled").length === 1 ? "" : "s"}${hidden ? ` · ${hidden} hidden (a recipe you can't open)` : ""}</p>
      </div>
      <nav class="cal-pager" aria-label="Weeks">
        <a class="cal-round" href="/household/calendar?week=${addDays(start, -7)}" aria-label="Previous week">${icon("back", 16)}</a>
        <a class="cal-today" href="/household/calendar">This week</a>
        <a class="cal-round" href="/household/calendar?week=${addDays(start, 7)}" aria-label="Next week">${icon("arrow", 16)}</a>
      </nav>
    </header>

    <div class="cal-week hh-week" data-hh-region="calendar">
      ${days.map((d, di) => {
        const own = entries.filter((e) => e.date === d).sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
        const date = parseIsoDate(d)!;
        return html`<section class="cal-day ${d === now ? "is-today" : ""} ${d < now ? "is-past" : ""}" style="--tint: var(${DAY_TINTS[di]}); --d: ${di}" aria-labelledby="hday-${d}">
          <header class="cal-day-head">
            <span class="cal-dow">${weekday(d)}</span>
            <span class="cal-dnum" id="hday-${d}"><span class="sr-only">${weekday(d)} </span>${date.getDate()}<span class="sr-only"> ${MONTHS[date.getMonth()]}</span></span>
          </header>
          <div class="cal-day-body">
            ${own.map((e) => houseTile(e, me, n++, returnTo))}
            <a class="cal-add" href="${qs({ day: d, meal, ...(q ? { q } : {}) })}#plan" aria-label="Plan a house meal on ${weekday(d)} ${shortDate(d)}">${icon("plus", 15)}<span>${own.length ? "Add" : "Plan a meal"}</span></a>
          </div>
        </section>`;
      })}
    </div>

    <section class="cal-panel hh-plan" id="plan" aria-labelledby="plan-h">
      <header class="cal-panel-head">
        <span class="cal-panel-icon" style="--tint: var(--peach); --tint-ink: var(--peach-ink)">${icon("household", 18)}</span>
        <div><h2 id="plan-h">Plan a house meal</h2>
          <p>Pick a day and a recipe. House meals go on everyone's house calendar and their ingredients feed the shared shopping list. Only recipes everyone here can open are offered.</p></div>
      </header>
      ${problem ? errors([problem]) : ""}
      <form class="cal-quick-form" method="get" action="/household/calendar#plan" role="search">
        <input type="hidden" name="week" value="${start}" />
        <label class="cal-search">${icon("search", 18)}<span class="sr-only">Search recipes</span>
          <input type="search" name="q" value="${q}" placeholder="Search “curry”, “eggs”, “pasta”…" autocomplete="off" /></label>
        <div class="cal-quick-when">
          <label class="field"><span>Day</span>
            <select name="day">${days.map((d) => html`<option value="${d}" ${d === day ? raw("selected") : ""}>${d === now ? "Today" : weekday(d)} ${shortDate(d)}</option>`)}</select></label>
          <label class="field"><span>Meal</span>
            <select name="meal">${MEALS.map((m) => html`<option value="${m}" ${m === meal ? raw("selected") : ""}>${MEAL_LABEL[m]}</option>`)}</select></label>
          <button class="button button-small" type="submit">Search</button>
        </div>
      </form>
      <div class="cal-results">
        <p class="cal-results-head"><span>${heading}</span><span class="cal-when">${icon("calendar", 13)}<span>${when(day)}, ${meal}</span></span></p>
        ${choices.length
          ? html`<ul>${choices.map((r, i) => {
              const minutes = totalMinutes(r);
              return html`<li class="cal-result" style="--i: ${i}">
                <a class="cal-result-photo" href="/recipes/${r.id}" tabindex="-1" aria-hidden="true">${thumb(r.image_url, r.title, "small")}</a>
                <span class="cal-result-text">
                  <a class="cal-result-title" href="/recipes/${r.id}">${r.title}</a>
                  <span class="cal-result-meta">${[minutes ? duration(minutes) : "", r.cuisine || (r.author_id === me ? "Yours" : `by ${firstName(r.author_name)}`), `serves ${r.servings}`].filter(Boolean).join(" · ")}</span>
                </span>
                <form method="post" action="/household/calendar" class="cal-result-add">
                  <input type="hidden" name="recipe_id" value="${r.id}" />
                  <input type="hidden" name="date" value="${day}" />
                  <input type="hidden" name="meal" value="${meal}" />
                  ${returnField(returnTo)}
                  <button class="cal-add-btn" type="submit" aria-label="Add ${r.title} to ${when(day)} ${meal}">${icon("plus", 14)}<span>Add</span></button>
                </form>
              </li>`;
            })}</ul>`
          : html`<p class="cal-results-empty">${q ? `Nothing everyone here can open matches “${q}”. Try an ingredient, like “eggs” or “chickpeas”.` : "No recipes to suggest yet."}</p>`}
      </div>
    </section>`;
  return shell(ctx, house, people, "/household/calendar", "House calendar", body, status);
}

/* ---------------- shared shopping ---------------- */

function lineControl(l: HouseLine, me: number): Html {
  const action = (verb: string) => `/household/shopping/${l.ingredient_id}/${verb}`;
  if (l.claim && l.claim.user_id === me) {
    return html`<span class="hh-claim hh-claim-mine">${icon("check", 14)} You've got this</span>
      <span class="hh-line-btns">
        <form method="post" action="${action("bought")}" data-hh-action><button class="button button-small" type="submit">Bought it</button></form>
        <form method="post" action="${action("unclaim")}" data-hh-action><button class="link-button" type="submit">Unclaim</button></form>
      </span>`;
  }
  if (l.claim) {
    return html`<span class="hh-claim">${avatar(l.claim.name, "sm")} ${firstName(l.claim.name)}'s got this</span>`;
  }
  return html`<form method="post" action="${action("claim")}" data-hh-action><button class="button button-small button-soft hh-gotit" type="submit" aria-label="I'll buy the ${l.name}">I've got this</button></form>`;
}

function shopLine(l: HouseLine, me: number): Html {
  return html`<li class="hh-line ${l.claim ? (l.claim.user_id === me ? "is-mine" : "is-claimed") : ""}">
    <span class="mono qty">${l.toBuy === null ? "some" : qty(l.toBuy, l.unit === "each" ? "" : l.unit)}</span>
    <span class="grow"><span class="item-name">${l.name}</span>
      <small class="muted block">for ${l.meals.join(", ")}${l.have > 0 ? ` · house has ${qty(l.have, l.unit === "each" ? "" : l.unit)}` : ""}${l.otherUnit ? " · some in another unit, check the pantry" : ""}</small>
      ${packLine(l.pack, l.consumptionCents, l.sharesPack, l.unitClash)}</span>
    <span class="hh-line-price mono">${l.pack ? money(l.pack.costCents) : l.sharesPack ? "incl." : "—"}${l.pack ? html`<small>${l.pack.count === null ? "by weight" : l.pack.count === 1 ? "1 pack" : `${l.pack.count} packs`}</small>` : ""}</span>
    <span class="hh-line-act">${lineControl(l, me)}</span>
  </li>`;
}

function shoppingPage(ctx: Ctx) {
  const me = ctx.user!.id;
  const house = requireHouse(me);
  const people = members(house.id);
  const list = houseShopping(me);
  const groups = new Map<string, HouseLine[]>();
  for (const l of list.toBuy) groups.set(l.category, [...(groups.get(l.category) ?? []), l]);
  const mineCount = list.toBuy.filter((l) => l.claim?.user_id === me).length;
  const body = html`
    <div class="hh-shop">
      <section class="panel hh-shop-intro" data-hh-region="shop-head">
        <h2 class="hh-h2">What the house needs</h2>
        <p class="hh-explain">Ingredients for house meals from ${when(list.from)} to ${weekday(list.to)} ${shortDate(list.to)}, minus what's in the shared pantry.
          Press <strong>I've got this</strong> on anything you'll pick up, and it's taken off everyone else's list${mineCount ? html`. You're buying <strong>${mineCount}</strong> thing${mineCount === 1 ? "" : "s"}` : ""}.
          When you're back, <strong>Bought it</strong> puts it in the shared pantry.</p>
      </section>
      <div class="hh-shop-ticker">${ticker(list, { form: true })}</div>
      <div data-hh-region="lines" class="side-stack hh-shop-lines">
        ${list.meals.length === 0
          ? empty("No house meals this week", "Plan house meals on the house calendar and their ingredients appear here, minus what's already in the shared pantry.", html`<a class="button" href="/household/calendar#plan">Plan a house meal</a>`)
          : list.toBuy.length
            ? [...groups].map(
                ([category, lines]) => html`<section class="panel">
                  <h2 class="panel-title">${category === "other" ? "Everything else" : category.charAt(0).toUpperCase() + category.slice(1)}</h2>
                  <ul class="hh-lines">${lines.map((l) => shopLine(l, me))}</ul>
                </section>`,
              )
            : html`<section class="panel"><p class="empty-title">The house has everything.</p><p class="muted">The shared pantry covers every house meal this week.</p></section>`}
        ${list.covered.length
          ? html`<section class="panel">
              <h2 class="panel-title">Already in the house <span class="count">${list.covered.length}</span></h2>
              <ul class="shop-list covered">${list.covered.map(
                (l) => html`<li class="shop-line"><span class="mono qty">${l.need === null ? "some" : qty(l.need, l.unit)}</span><span class="grow"><span class="item-name">${l.name}</span><small class="muted block">for ${l.meals.join(", ")}</small></span>${icon("check", 16)}</li>`,
              )}</ul>
            </section>`
          : ""}
      </div>
      <aside class="side-stack hh-shop-side">
        ${list.meals.length
          ? html`<section class="panel" data-hh-region="shop-meals">
              <h2 class="panel-title">House meals included</h2>
              <ul class="compact-list">${list.meals.map(
                (m) => html`<li><span class="mono muted w-day">${weekday(m.date)}</span><a class="grow" href="/recipes/${m.recipe_id}">${m.title}</a><span class="muted">${m.meal}</span></li>`,
              )}</ul>
              ${list.hiddenMeals ? html`<p class="muted small hh-gap">${list.hiddenMeals} more house meal${list.hiddenMeals === 1 ? " uses a recipe" : "s use recipes"} you can't open, so ${list.hiddenMeals === 1 ? "it isn't" : "they aren't"} counted for you.</p>` : ""}
            </section>`
          : ""}
        <section class="panel">
          <h2 class="panel-title">How it's worked out</h2>
          <p class="muted small">Amounts are summed across the week's planned house meals, then the shared pantry's usable stock (unexpired, in a comparable unit) is subtracted, and the rest is bought in whole packs.
            Each line names the pack it recommends: the cheapest that covers the amount among Woolworths and ALDI shelf prices and prices a housemate recorded. The total is the checkout cost of those packs; the meals themselves use ${money(list.consumptionCents)} of it.
            Shelf prices are what the store's site showed when Larder last read them, not live prices.</p>
        </section>
      </aside>
    </div>`;
  return shell(ctx, house, people, "/household/shopping", "Shared shopping", body);
}

/* ---------------- members ---------------- */

function membersPage(ctx: Ctx, problem: string | null = null, status = 200) {
  const me = ctx.user!.id;
  const house = requireHouse(me);
  const people = members(house.id);
  const owner = house.role === "owner";
  const others = people.filter((m) => m.id !== me);
  const heir = owner && !others.some((m) => m.role === "owner") ? [...others].sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.id - b.id)[0] : undefined;
  const code = formatCode(house.invite_code);
  const body = html`
    <div class="split hh-members">
      <section class="panel" data-hh-region="members" aria-labelledby="ml-h">
        <h2 class="panel-title" id="ml-h">${icon("users", 16)} Members <span class="count">${people.length}</span></h2>
        <ul class="people">
          ${people.map(
            (m) => html`<li class="person">${avatar(m.display_name)}<div class="grow"><a class="person-name" href="/u/${m.username}">${m.display_name}${m.id === me ? " (you)" : ""}</a><small class="muted">@${m.username} · joined ${ago(m.joined_at)}</small></div>
              <span class="badge ${m.role === "owner" ? "" : "badge-private"}">${m.role === "owner" ? "Owner" : "Member"}</span></li>`,
          )}
        </ul>
        ${people.length === 1 ? html`<p class="hint">${icon("spark", 14)} It's just you so far. Give a housemate the invite code and they'll appear here.</p>` : ""}
      </section>

      <div class="side-stack">
        <section class="panel hh-invite" id="invite" aria-labelledby="inv-h">
          <h2 class="panel-title" id="inv-h">${icon("plus", 16)} Invite a housemate</h2>
          <div class="hh-code-card">
            <span class="hh-code-big" data-copy-text="${code}">${code}</span>
            <button class="button button-small" type="button" data-copy="${code}" hidden>Copy code</button>
          </div>
          <ol class="hh-steps">
            <li><span>Send them this code.</span></li>
            <li><span>They sign in to Larder (or create an account) and open <strong>Household</strong>.</span></li>
            <li><span>They type it under <strong>Join with an invite code</strong>, and they're in.</span></li>
          </ol>
          ${owner
            ? html`<form method="post" action="/household/code" data-confirm="Make a new code? The current one stops working straight away.">
                <button class="link-button" type="submit">Make a new code</button> <span class="muted small">(the old one stops working)</span>
              </form>`
            : html`<p class="muted small">Only the owner can change the code.</p>`}
        </section>

        ${owner
          ? html`<section class="panel" aria-labelledby="name-h">
              <h2 class="panel-title" id="name-h">Household name</h2>
              ${problem ? errors([problem]) : ""}
              <form method="post" action="/household/name" class="inline-form">
                <label class="field grow-2"><span class="sr-only">Name</span><input name="name" required maxlength="60" value="${house.name}" /></label>
                <button class="button button-soft" type="submit">Rename</button>
              </form>
            </section>`
          : ""}

        <section class="panel hh-leave" aria-labelledby="leave-h">
          <h2 class="panel-title" id="leave-h">Leave ${house.name}</h2>
          <p class="muted small">${others.length === 0
            ? html`You're the last one here, so leaving <strong>closes the household</strong> and deletes its shared pantry, calendar and shopping claims.`
            : html`Your claims are released for others, and everything you added stays with the house.${heir ? html` Ownership passes to <strong>${heir.display_name}</strong>.` : ""} You can rejoin with the invite code.`}</p>
          <form method="post" action="/household/leave" data-confirm="${others.length === 0 ? `Leave and close ${house.name}? Its shared pantry and calendar will be deleted.` : `Leave ${house.name}?`}">
            <button class="button button-danger button-block" type="submit">${others.length === 0 ? "Leave and close the household" : "Leave household"}</button>
          </form>
        </section>
      </div>
    </div>`;
  return shell(ctx, house, people, "/household/members", "Members", body, status);
}

/* ---------------- the live endpoint ---------------- */

// What the polling client needs: a version that moves on every change, the
// live claims, and any new lines from other people since the version it had.
function stateReply(ctx: Ctx) {
  const me = ctx.user!.id;
  if (!householdFor(me)) return json({ error: "not in a household" }, 404);
  const since = Number(ctx.url.searchParams.get("since"));
  const fresh = Number.isInteger(since) && since > 0 ? houseActivity(me, { since, limit: 6 }).filter((a) => a.actorId !== me) : [];
  return json({
    version: houseVersion(me),
    claims: houseClaims(me),
    race: expiryRace(me).map((i) => ({ item: i.name, expires: i.expiry_date, by: i.tonight?.name ?? null })),
    events: fresh.reverse().map((a) => ({ id: a.id, who: a.who, text: a.text, nudge: a.nudge })),
  });
}

/* ---------------- helpers for the handlers ---------------- */

function dollarsToCents(raw: string): number | null | undefined {
  const s = raw.trim().replace(/^\$/, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s) || Number(s) > 100000) return undefined;
  return Math.round(Number(s) * 100);
}

// Household-scoped handlers: the welcome page for anyone without a house.
function member(what: string, fn: (ctx: Ctx) => ReturnType<typeof htmlReply> | Promise<ReturnType<typeof htmlReply>>) {
  return (ctx: Ctx) => (householdFor(ctx.user!.id) ? fn(ctx) : noHouse(ctx, what));
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/household",
    auth: true,
    handler: (ctx) => (householdFor(ctx.user!.id) ? overviewPage(ctx) : welcome(ctx)),
  },
  { method: "GET", path: "/household/new", auth: true, handler: () => redirect("/household") },
  { method: "GET", path: "/household/state", auth: true, handler: stateReply },
  { method: "GET", path: "/household/pantry", auth: true, handler: member("shared pantry", (ctx) => pantryPage(ctx)) },
  { method: "GET", path: "/household/calendar", auth: true, handler: member("house calendar", (ctx) => calendarPage(ctx)) },
  { method: "GET", path: "/household/shopping", auth: true, handler: member("shared shopping list", shoppingPage) },
  { method: "GET", path: "/household/members", auth: true, handler: member("member list", (ctx) => membersPage(ctx)) },

  // create, join, leave
  {
    method: "POST",
    path: "/household",
    auth: true,
    handler: async (ctx) => {
      const name = (await ctx.form()).get("name") ?? "";
      const result = createHousehold(ctx.user!.id, name);
      if (!result.ok && result.problem === "name") {
        return welcome(ctx, { name, createProblems: ["Give the household a name (up to 60 characters)."] }, 422);
      }
      if (!result.ok) {
        setFlash(ctx, "You're already in a household. Leave it first (Members tab) to start another.");
        return redirect("/household/members");
      }
      setFlash(ctx, `Welcome to ${name.trim()}. Give housemates the invite code below to bring them in.`);
      return redirect("/household/members#invite");
    },
  },
  {
    method: "POST",
    path: "/household/join",
    auth: true,
    handler: async (ctx) => {
      const code = (await ctx.form()).get("code") ?? "";
      const result = joinHousehold(ctx.user!.id, code);
      if (result.ok) {
        setFlash(ctx, `You've joined ${result.house.name}.`);
        return redirect("/household");
      }
      if (result.problem === "already") {
        setFlash(ctx, `You're already in ${result.house?.name ?? "a household"}. Leave it first to join another.`);
        return redirect("/household/members");
      }
      return welcome(
        ctx,
        { code, joinProblems: ["No household has that code. Check it with whoever sent it: codes are eight letters and numbers, like ABCD-EFGH."] },
        422,
      );
    },
  },
  {
    method: "POST",
    path: "/household/leave",
    auth: true,
    handler: (ctx) => {
      const r = leaveHousehold(ctx.user!.id);
      if (r.left) setFlash(ctx, r.deleted ? `You left and closed ${r.name}.` : `You left ${r.name}.`);
      return redirect("/household");
    },
  },
  {
    method: "POST",
    path: "/household/code",
    auth: true,
    handler: (ctx) => {
      requireHouse(ctx.user!.id);
      const code = regenerateCode(ctx.user!.id);
      setFlash(ctx, `New invite code: ${formatCode(code)}. The old one no longer works.`);
      return redirect("/household/members#invite");
    },
  },
  {
    method: "POST",
    path: "/household/name",
    auth: true,
    handler: async (ctx) => {
      requireHouse(ctx.user!.id);
      const name = renameHousehold(ctx.user!.id, (await ctx.form()).get("name") ?? "");
      if (name === null) return membersPage(ctx, "Give the household a name (up to 60 characters).", 422);
      setFlash(ctx, `The household is now called ${name}.`);
      return redirect("/household/members");
    },
  },
  {
    method: "POST",
    path: "/household/budget",
    auth: true,
    handler: async (ctx) => {
      requireHouse(ctx.user!.id);
      const cents = dollarsToCents((await ctx.form()).get("budget") ?? "");
      if (cents === undefined) {
        setFlash(ctx, "The budget must be a dollar amount like 150 or 149.50.");
        return redirect("/household/shopping#budget");
      }
      setHouseBudget(ctx.user!.id, cents);
      setFlash(ctx, cents === null ? "House budget cleared." : `House budget set to ${money(cents)} a week.`);
      return redirect("/household/shopping#budget");
    },
  },

  // the shared pantry (the literal "move" route before ":id")
  {
    method: "POST",
    path: "/household/pantry/move",
    auth: true,
    handler: async (ctx) => {
      const name = moveFromPersonal(ctx.user!.id, Number((await ctx.form()).get("item_id")));
      setFlash(ctx, `Moved ${name} into the house pantry.`);
      return redirect("/household/pantry");
    },
  },
  {
    method: "POST",
    path: "/household/pantry",
    auth: true,
    handler: async (ctx) => {
      requireHouse(ctx.user!.id);
      const { input, values, problems } = parseItem(await ctx.form());
      if (problems.length) return pantryPage(ctx, values, problems, 422);
      addItem(ctx.user!.id, input);
      setFlash(ctx, `Added ${input.name} to the house pantry.`);
      return redirect("/household/pantry");
    },
  },
  {
    method: "POST",
    path: "/household/pantry/:id",
    auth: true,
    handler: async (ctx) => {
      const id = Number(ctx.params.id);
      houseItem(ctx.user!.id, id); // 404 unless it's this house's item
      const { input, values, problems } = parseItem(await ctx.form());
      if (problems.length) return pantryPage(ctx, {}, [], 422, { id, values, problems });
      updateItem(ctx.user!.id, id, input);
      setFlash(ctx, `Updated ${input.name}.`);
      return redirect("/household/pantry");
    },
  },
  {
    method: "POST",
    path: "/household/pantry/:id/delete",
    auth: true,
    handler: (ctx) => {
      const name = removeItem(ctx.user!.id, Number(ctx.params.id));
      setFlash(ctx, `Took ${name} out of the house pantry.`);
      return redirect("/household/pantry");
    },
  },

  // the expiry race
  {
    method: "POST",
    path: "/household/items/:id/tonight",
    auth: true,
    handler: async (ctx) => {
      const back = backTo(await ctx.form(), "/household");
      const r = claimTonight(ctx.user!.id, Number(ctx.params.id));
      setFlash(
        ctx,
        r.ok ? `The ${r.name} is yours tonight. Everyone else can see you've called it.` : r.problem === "taken" ? `Too late: ${firstName(r.by)} already called the ${r.name}.` : `The ${r.name} isn't about to go off, so there's nothing to race for.`,
      );
      return redirect(back);
    },
  },
  {
    method: "POST",
    path: "/household/items/:id/release",
    auth: true,
    handler: async (ctx) => {
      const back = backTo(await ctx.form(), "/household");
      const r = releaseTonight(ctx.user!.id, Number(ctx.params.id));
      setFlash(ctx, r.ok ? `Let go of the ${r.name}; it's up for grabs again.` : `That's ${firstName(r.by ?? "someone")}'s claim, not yours.`);
      return redirect(back);
    },
  },

  // the house calendar
  {
    method: "POST",
    path: "/household/calendar",
    auth: true,
    handler: async (ctx) => {
      requireHouse(ctx.user!.id);
      const form = await ctx.form();
      const date = form.get("date") ?? "";
      const r = planHouseMeal(ctx.user!.id, Number(form.get("recipe_id")), date, form.get("meal") ?? "");
      const back = backTo(form, `/household/calendar?week=${parseIsoDate(date) ? weekStart(date) : weekStart(today())}`);
      if (!r.ok) {
        setFlash(ctx, r.problem);
        return redirect(back.includes("#") ? back : `${back}#plan`);
      }
      setFlash(ctx, `${r.title} is on the house calendar for ${when(date)}.`);
      return redirect(back);
    },
  },
  {
    method: "POST",
    path: "/household/calendar/:id/status",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const status = form.get("status") ?? "";
      const title = setHouseEntryStatus(ctx.user!.id, Number(ctx.params.id), status);
      setFlash(ctx, status === "completed" ? `${title}: marked as cooked.` : status === "cancelled" ? `${title}: skipped.` : `${title} is planned again.`);
      return redirect(backTo(form, "/household/calendar"));
    },
  },
  {
    method: "POST",
    path: "/household/calendar/:id/delete",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const title = removeHouseEntry(ctx.user!.id, Number(ctx.params.id));
      setFlash(ctx, `Took ${title} off the house calendar.`);
      return redirect(backTo(form, "/household/calendar"));
    },
  },

  // shared shopping claims
  {
    method: "POST",
    path: "/household/shopping/:ingredient/claim",
    auth: true,
    handler: (ctx) => {
      requireHouse(ctx.user!.id);
      const r = claimLine(ctx.user!.id, Number(ctx.params.ingredient));
      setFlash(
        ctx,
        r.ok ? `You've got the ${r.name}. It's off everyone else's list.` : r.problem === "taken" ? `${firstName(r.by)} already has the ${r.name}.` : "That's no longer on the list.",
      );
      return redirect("/household/shopping");
    },
  },
  {
    method: "POST",
    path: "/household/shopping/:ingredient/unclaim",
    auth: true,
    handler: (ctx) => {
      requireHouse(ctx.user!.id);
      const r = unclaimLine(ctx.user!.id, Number(ctx.params.ingredient));
      setFlash(ctx, r.ok ? (r.name ? `Put the ${r.name} back on the list for anyone.` : "That wasn't claimed.") : `That's ${firstName(r.by ?? "someone")}'s to buy, not yours.`);
      return redirect("/household/shopping");
    },
  },
  {
    method: "POST",
    path: "/household/shopping/:ingredient/bought",
    auth: true,
    handler: (ctx) => {
      requireHouse(ctx.user!.id);
      const r = boughtLine(ctx.user!.id, Number(ctx.params.ingredient));
      setFlash(ctx, r.ok ? (r.name ? `Nice. The ${r.name} is in the house pantry now.` : "That's no longer on the list.") : `${firstName(r.by ?? "Someone")} has that one.`);
      return redirect("/household/shopping");
    },
  },
];
