import { logActivity } from "../activity.ts";
import { all, one, run, transaction } from "../db.ts";
import { addDays, money, parseIsoDate, shortDate, sized, today, weekday, weekStart } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { type Ctx, HttpError, htmlReply, redirect, setFlash } from "../http.ts";
import {
  cachedOptions,
  type Costed,
  costLines,
  generatePlan,
  INTERESTS,
  type InterestKey,
  isInterest,
  type Plan,
  type PlanRequest,
  servingsFactor,
  weekPurchase,
} from "../planner.ts";
import { usableStock } from "../shopping.ts";
import { prefsFor } from "../prefs.ts";
import { getRecipe, ingredientsFor, listVisibleRecipes, pantryMatch, type Recipe, totalMinutes } from "../recipes.ts";
import type { Route } from "../server.ts";
import { canSeeCalendarEntry, canSeeRecipe, friendIds } from "../visibility.ts";
import { avatar, icon, page, tone } from "../views/layout.ts";
import { duration } from "./recipes.ts";

export interface CalendarEntry {
  id: number;
  owner_id: number;
  recipe_author_id: number;
  recipe_visibility: string;
  date: string;
  meal: "breakfast" | "lunch" | "dinner";
  recipe_id: number;
  title: string;
  status: "planned" | "live" | "completed" | "cancelled";
  shared: number;
  image_url: string | null;
  servings: number;
  cuisine: string;
}

const MEALS = ["breakfast", "lunch", "dinner"] as const;
type Meal = (typeof MEALS)[number];
const STATUSES = ["planned", "completed", "cancelled"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// A person's calendar entries between two dates, filtered to what the viewer
// may see (all of them when viewer and owner are the same person).
export function entriesBetween(viewerId: number, ownerId: number, from: string, to: string): CalendarEntry[] {
  return all<CalendarEntry>(
    `SELECT c.id, c.owner_id, c.date, c.meal, c.recipe_id, r.title, c.status, c.shared,
            r.author_id AS recipe_author_id, r.visibility AS recipe_visibility,
            r.image_url, r.servings, r.cuisine
     FROM calendar_entries c JOIN recipes r ON r.id = c.recipe_id
     WHERE c.owner_type = 'user' AND c.owner_id = ? AND c.date BETWEEN ? AND ?
     ORDER BY c.date, CASE c.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END, c.id`,
    ownerId,
    from,
    to,
  ).filter((e) => canSeeCalendarEntry(viewerId, e));
}

export interface FriendMeal extends CalendarEntry {
  username: string;
  display_name: string;
  created_at: string;
}

// Friends' shared meals in a date range that the viewer may see, newest plan first.
export function friendMeals(viewerId: number, friendIds: number[], from: string, to: string): FriendMeal[] {
  if (!friendIds.length) return [];
  return all<FriendMeal>(
    `SELECT c.id, c.owner_id, c.date, c.meal, c.recipe_id, r.title, c.status, c.shared, c.created_at,
            r.author_id AS recipe_author_id, r.visibility AS recipe_visibility, u.username, u.display_name,
            r.image_url, r.servings, r.cuisine
     FROM calendar_entries c JOIN recipes r ON r.id = c.recipe_id JOIN users u ON u.id = c.owner_id
     WHERE c.owner_type = 'user' AND c.shared = 1 AND c.status != 'cancelled'
       AND c.owner_id IN (${friendIds.map(() => "?").join(", ")}) AND c.date BETWEEN ? AND ?
     ORDER BY c.created_at DESC, c.id DESC LIMIT 100`,
    ...friendIds,
    from,
    to,
  ).filter((e) => canSeeCalendarEntry(viewerId, e));
}

export function mealChip(e: CalendarEntry, editable: boolean, returnTo = ""): Html {
  return html`<div class="meal meal-${e.status}">
    <span class="meal-kind">${e.meal}</span>
    <a href="/recipes/${e.recipe_id}" class="meal-title">${e.title}</a>
    <span class="meal-meta">
      ${e.status !== "planned" ? html`<span class="pill pill-${e.status === "completed" ? "fresh" : "none"}">${e.status}</span>` : ""}
      ${e.shared ? html`<span class="muted" title="Shared with friends">Shared</span>` : html`<span class="muted">Private</span>`}
    </span>
    ${editable ? entryMenu(e, returnTo, "meal-menu") : ""}
  </div>`;
}

function entryMenu(e: CalendarEntry, returnTo: string, cls: string): Html {
  return html`<details class="${cls}">
    <summary aria-label="Change ${e.title} on ${weekday(e.date)} ${shortDate(e.date)}">•••</summary>
    <div class="menu">
      ${e.status === "planned" ? html`<a href="/recipes/${e.recipe_id}/cook?entry=${e.id}">Cook now</a>` : ""}
      ${STATUSES.filter((s) => s !== e.status).map(
        (s) => html`<form method="post" action="/calendar/${e.id}/status"><input type="hidden" name="status" value="${s}" /><input type="hidden" name="return_to" value="${returnTo}" /><button type="submit">${s === "completed" ? "Mark as cooked" : s === "cancelled" ? "Skip this meal" : "Back to planned"}</button></form>`,
      )}
      <form method="post" action="/calendar/${e.id}/share"><input type="hidden" name="return_to" value="${returnTo}" /><button type="submit">${e.shared ? "Make private" : "Share with friends"}</button></form>
      <form method="post" action="/calendar/${e.id}/delete"><input type="hidden" name="return_to" value="${returnTo}" /><button type="submit" class="danger">Remove</button></form>
    </div>
  </details>`;
}

/* ---------------- page state, all in the URL so every view works without JS ---------------- */

interface PlanParams {
  interests: Set<InterestKey>;
  budgetCents: number | null;
  nights: number;
  seed: number;
  from: string;
  keep: number[];
  exclude: number[];
}

interface CalState {
  view: "week" | "month";
  // Monday of the week shown, or of the week holding the 1st in month view
  start: string;
  // first of the month, in month view
  month: string;
  // friends to overlay, as their usernames (lower case)
  with: string[];
  q: string;
  day: string;
  meal: Meal;
  share: boolean;
  plan: PlanParams | null;
}

function intList(raw: string | null): number[] {
  return (raw ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0)
    .slice(0, 14);
}

function dollarsToCents(raw: string | null): number | null {
  const s = (raw ?? "").trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s) || Number(s) > 100000) return null;
  return Math.round(Number(s) * 100);
}

function stateFrom(ctx: Ctx): CalState {
  const q = ctx.url.searchParams;
  const now = today();
  const view = q.get("view") === "month" ? "month" : "week";
  const requested = q.get("week");
  const anchor = requested && parseIsoDate(requested) ? requested : now;
  const m = q.get("m");
  const monthAnchor = m && /^\d{4}-\d{2}$/.test(m) && parseIsoDate(`${m}-01`) ? `${m}-01` : `${anchor.slice(0, 7)}-01`;
  const start = view === "month" ? weekStart(monthAnchor) : weekStart(anchor);
  const withNames = (q.get("with") ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9_]{1,40}$/.test(s))
    .slice(0, 12);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i));
  const dayParam = q.get("day") ?? "";
  const day = parseIsoDate(dayParam) ? dayParam : days.includes(now) ? now : days[0];
  const mealParam = q.get("meal") ?? "dinner";
  const shares = q.getAll("share");

  let plan: PlanParams | null = null;
  if (q.get("plan") === "1") {
    const nights = Number(q.get("nights") ?? 5);
    const seed = Number(q.get("seed") ?? 0);
    const from = q.get("from") ?? "";
    plan = {
      interests: new Set(q.getAll("i").filter(isInterest)),
      budgetCents: dollarsToCents(q.get("budget")),
      nights: Number.isInteger(nights) && nights >= 1 && nights <= 7 ? nights : 5,
      seed: Number.isInteger(seed) && seed >= 0 && seed < 1e6 ? seed : 0,
      from: parseIsoDate(from) && from >= now ? from : planStart(start, now),
      keep: intList(q.get("keep")),
      exclude: intList(q.get("exclude")),
    };
  }
  return {
    view,
    start,
    month: monthAnchor,
    with: withNames,
    q: (q.get("q") ?? "").trim().slice(0, 60),
    day,
    meal: (MEALS as readonly string[]).includes(mealParam) ? (mealParam as Meal) : "dinner",
    share: shares.length ? shares.includes("1") : true,
    plan,
  };
}

// The planner fills dinners from today, or from the Monday of a future week
// being looked at.
function planStart(start: string, now: string): string {
  return start > now ? start : now;
}

function planParams(p: PlanParams, change: Partial<PlanParams> = {}): [string, string][] {
  const v = { ...p, ...change };
  const out: [string, string][] = [["plan", "1"]];
  for (const i of v.interests) out.push(["i", i]);
  if (v.budgetCents !== null) out.push(["budget", (v.budgetCents / 100).toFixed(2).replace(/\.00$/, "")]);
  out.push(["nights", String(v.nights)], ["from", v.from]);
  if (v.seed) out.push(["seed", String(v.seed)]);
  if (v.keep.some((k) => k)) out.push(["keep", v.keep.join(",")]);
  if (v.exclude.length) out.push(["exclude", v.exclude.join(",")]);
  return out;
}

function calHref(s: CalState, change: Partial<CalState> = {}, hash = ""): string {
  const v = { ...s, ...change };
  const params = new URLSearchParams();
  if (v.view === "month") {
    params.set("view", "month");
    params.set("m", v.month.slice(0, 7));
  } else params.set("week", v.start);
  if (v.with.length) params.set("with", v.with.join(","));
  if (v.plan) for (const [k, val] of planParams(v.plan)) params.append(k, val);
  return `/calendar?${params}${hash}`;
}

/* ---------------- money ---------------- */

interface Money {
  byEntry: Map<number, Costed>;
  // per day: the ingredients that day's meals use beyond the pantry
  // (consumption cost), since packs are bought for the week, not the day
  byDay: Map<string, number>;
  // checkout cost of the whole packs for the still-planned meals, shared
  // ingredients pooled across the week, after usable pantry stock
  totalCents: number;
  estimatedCents: number;
  unpriced: number;
  usesCents: number;
}

// What the week's own meals cost, through the shopping list's engine.
// Cooked and cancelled meals no longer need buying.
function weekMoney(userId: number, entries: CalendarEntry[]): Money {
  const prefs = prefsFor(userId);
  const stock = usableStock("user", userId);
  const options = cachedOptions(userId);
  const lines = ingredientsFor([...new Set(entries.map((e) => e.recipe_id))]);
  const byEntry = new Map<number, Costed>();
  const byDay = new Map<string, number>();
  let usesCents = 0;
  const toBuy: { lines: typeof lines extends Map<number, infer V> ? V : never; factor: number; title: string }[] = [];
  for (const e of entries) {
    const factor = servingsFactor(prefs, e.servings);
    const c = costLines(lines.get(e.recipe_id) ?? [], factor, stock, options);
    byEntry.set(e.id, c);
    if (e.status !== "planned") continue;
    byDay.set(e.date, (byDay.get(e.date) ?? 0) + c.usesCents);
    usesCents += c.usesCents;
    toBuy.push({ lines: lines.get(e.recipe_id) ?? [], factor, title: e.title });
  }
  const week = weekPurchase(toBuy, stock, options);
  return { byEntry, byDay, totalCents: week.purchaseCents, estimatedCents: week.estimatedCents, unpriced: week.unpriced, usesCents };
}

/* ---------------- friends overlay ---------------- */

interface Friend {
  id: number;
  username: string;
  display_name: string;
}

function friendsOf(userId: number): Friend[] {
  const ids = friendIds(userId);
  if (!ids.length) return [];
  return all<Friend>(
    `SELECT id, username, display_name FROM users WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY display_name COLLATE NOCASE`,
    ...ids,
  );
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

/* ---------------- pieces ---------------- */

function photo(url: string | null, size: "small" | "medium"): string | null {
  if (!url) return null;
  return sized(url, size);
}

function thumb(url: string | null, title: string, size: "small" | "medium" = "medium"): Html {
  const src = photo(url, size);
  if (src) return html`<img src="${src}" alt="" loading="lazy" decoding="async" />`;
  const [bg, ink] = tone(title);
  return html`<span class="cal-fallback" style="--fallback: ${bg}; --fallback-ink: ${ink}" aria-hidden="true"><span>${title.slice(0, 1)}</span>${icon("cook", 16)}</span>`;
}

const MEAL_LABEL: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const STATUS_LABEL: Record<string, string> = { completed: "Cooked", cancelled: "Skipped", live: "Cooking" };

function tile(e: CalendarEntry, cost: Costed | undefined, i: number, returnTo: string): Html {
  return html`<article class="cal-tile cal-${e.status}" style="--i: ${i}" data-entry="${e.id}" data-date="${e.date}" data-recipe="${e.recipe_id}">
    <a class="cal-tile-link" href="/recipes/${e.recipe_id}">
      <span class="cal-thumb">${thumb(e.image_url, e.title)}<span class="cal-kind">${MEAL_LABEL[e.meal]}</span></span>
      <span class="cal-tile-body" data-kind="${MEAL_LABEL[e.meal]}">
        <span class="cal-tile-title">${e.title}</span>
        <span class="cal-tile-meta">
          ${e.status !== "planned"
            ? html`<span class="cal-status">${e.status === "completed" ? icon("check", 12) : ""}${STATUS_LABEL[e.status]}</span>`
            : cost && cost.counted
              ? html`<span class="mono" title="Bought on its own: whole packs after your pantry">${cost.toBuyCents ? money(cost.toBuyCents) : "In pantry"}</span>`
              : ""}
          ${e.shared ? html`<span class="cal-shared" title="Shared with friends">${icon("users", 13)}<span class="sr-only">Shared with friends</span></span>` : ""}
        </span>
      </span>
    </a>
    <div class="cal-tile-tools">
      ${e.status === "planned" ? html`<a class="cal-cook" href="/recipes/${e.recipe_id}/cook?entry=${e.id}" aria-label="Cook ${e.title} now">${icon("flame", 13)}<span>Cook</span></a>` : ""}
      ${entryMenu(e, returnTo, "meal-menu cal-menu")}
    </div>
  </article>`;
}

function ghostTile(m: FriendMeal, i: number): Html {
  const [bg, ink] = tone(m.display_name);
  return html`<a class="cal-tile cal-ghost" href="/recipes/${m.recipe_id}" style="--i: ${i}; --fr: ${bg}; --fr-ink: ${ink}" data-friend="${m.username}" data-date="${m.date}" data-recipe="${m.recipe_id}">
    <span class="cal-thumb">${thumb(m.image_url, m.title)}<span class="cal-kind">${MEAL_LABEL[m.meal]}</span></span>
    <span class="cal-tile-body" data-kind="${MEAL_LABEL[m.meal]}">
      <span class="cal-tile-title">${m.title}</span>
      <span class="cal-tile-meta cal-who">${avatar(m.display_name, "sm")}<span>${firstName(m.display_name)}${m.status === "completed" ? " cooked this" : m.status === "live" ? " is cooking" : ""}</span></span>
    </span>
  </a>`;
}

function draftTile(p: Plan["picks"][number], i: number): Html {
  return html`<a class="cal-tile cal-draft" href="/recipes/${p.recipe.id}" style="--i: ${i}">
    <span class="cal-thumb">${thumb(p.recipe.image_url, p.recipe.title)}<span class="cal-kind">Draft</span></span>
    <span class="cal-tile-body" data-kind="Suggested dinner">
      <span class="cal-tile-title">${p.recipe.title}</span>
      <span class="cal-tile-meta"><span class="mono">${money(p.toBuyCents)}</span><span>suggested</span></span>
    </span>
  </a>`;
}

/* ---------------- header, friends, budget ---------------- */

function header(s: CalState, summary: Html): Html {
  const now = today();
  const end = addDays(s.start, 6);
  const isMonth = s.view === "month";
  const m = parseIsoDate(s.month)!;
  const title = isMonth
    ? `${MONTHS[m.getMonth()]} ${m.getFullYear()}`
    : now >= s.start && now <= end
      ? "This week"
      : addDays(s.start, -7) <= now && now < s.start
        ? "Next week"
        : `Week of ${shortDate(s.start)}`;
  const prevMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1);
  const nextMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1);
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const prev = isMonth ? calHref(s, { month: ym(prevMonth) }) : calHref(s, { start: addDays(s.start, -7) });
  const next = isMonth ? calHref(s, { month: ym(nextMonth) }) : calHref(s, { start: addDays(s.start, 7) });
  const todayHref = isMonth ? calHref(s, { month: `${now.slice(0, 7)}-01` }) : calHref(s, { start: weekStart(now) });
  const weekOfMonth = s.month.slice(0, 7) === now.slice(0, 7) ? weekStart(now) : weekStart(s.month);
  return html`<header class="cal-hero" data-cal-region="head">
    <div class="cal-hero-text">
      <p class="eyebrow">Meal calendar</p>
      <h1>${title}</h1>
      <p class="lede">${isMonth ? html`${MONTHS[m.getMonth()]} at a glance. Pick a day to plan it.` : html`${shortDate(s.start)} – ${shortDate(end)} · ${summary}`}</p>
    </div>
    <div class="cal-controls">
      <nav class="cal-seg" aria-label="Calendar view">
        <a href="${calHref(s, { view: "week", start: weekOfMonth })}" data-cal-nav ${!isMonth ? raw('aria-current="page"') : ""}>Week</a>
        <a href="${calHref(s, { view: "month", month: `${s.start.slice(0, 7)}-01` })}" data-cal-nav ${isMonth ? raw('aria-current="page"') : ""}>Month</a>
      </nav>
      <nav class="cal-pager" aria-label="${isMonth ? "Months" : "Weeks"}">
        <a class="cal-round" href="${prev}" data-cal-nav data-dir="prev" aria-label="Previous ${isMonth ? "month" : "week"}">${icon("back", 16)}</a>
        <a class="cal-today" href="${todayHref}" data-cal-nav>Today</a>
        <a class="cal-round" href="${next}" data-cal-nav data-dir="next" aria-label="Next ${isMonth ? "month" : "week"}">${icon("arrow", 16)}</a>
      </nav>
    </div>
  </header>`;
}

function friendsBar(s: CalState, friends: Friend[], counts: Map<number, number>): Html {
  if (!friends.length) {
    return html`<div class="cal-friends" data-cal-region="friends">
      <span class="cal-label">${icon("users", 16)} Overlay friends</span>
      <p class="cal-friends-empty">When friends share planned meals, you can lay their week over yours here. <a href="/friends">Find friends →</a></p>
    </div>`;
  }
  return html`<div class="cal-friends" data-cal-region="friends">
    <span class="cal-label">${icon("users", 16)} Overlay friends</span>
    <div class="cal-fchips" role="group" aria-label="Show a friend's shared meals on your calendar">
      ${friends.map((f) => {
        const on = s.with.includes(f.username.toLowerCase());
        const next = on ? s.with.filter((u) => u !== f.username.toLowerCase()) : [...s.with, f.username.toLowerCase()];
        const [bg, ink] = tone(f.display_name);
        const n = counts.get(f.id) ?? 0;
        return html`<a class="cal-fchip" href="${calHref(s, { with: next })}" data-cal-nav="overlay" aria-pressed="${on ? "true" : "false"}" style="--fr: ${bg}; --fr-ink: ${ink}">
          ${avatar(f.display_name, "sm")}<span>${firstName(f.display_name)}</span>${on ? html`<span class="cal-fcount">${n}</span>` : ""}
        </a>`;
      })}
      ${s.with.length ? html`<a class="cal-fclear" href="${calHref(s, { with: [] })}" data-cal-nav="overlay">Clear</a>` : ""}
    </div>
  </div>`;
}

function budgetCard(userId: number, days: string[], money_: Money, returnTo: string): Html {
  const budget = prefsFor(userId).weekly_budget_cents;
  const spend = money_.totalCents;
  const pct = budget ? Math.min(100, Math.round((spend / Math.max(budget, 1)) * 100)) : 0;
  const over = budget !== null && spend > budget;
  const peak = Math.max(1, ...days.map((d) => money_.byDay.get(d) ?? 0));
  const now = today();
  return html`<section class="cal-budget" data-cal-region="budget" aria-label="Week budget">
    <div class="cal-budget-main">
      <p class="cal-label">${icon("basket", 16)} This week's shop</p>
      <p class="cal-big"><span class="tnum">${money(spend)}</span> <small>at the checkout</small></p>
      ${budget !== null
        ? html`<div class="cal-meter ${over ? "cal-meter-over" : ""}" role="meter" aria-label="Planned spend against your weekly budget" aria-valuemin="0" aria-valuemax="${budget}" aria-valuenow="${Math.min(spend, budget)}" aria-valuetext="${money(spend)} of ${money(budget)}"><span style="--p: ${pct}%"></span></div>
            <p class="cal-budget-note">${over ? html`<strong class="cal-over">${money(spend - budget)} over</strong>` : html`<strong>${money(budget - spend)} left</strong>`} of ${money(budget)} budget</p>`
        : html`<p class="cal-budget-note">No weekly budget set yet. Add one and the planner keeps every week under it.</p>`}
    </div>
    <ol class="cal-bars" aria-label="Spend by day">
      ${days.map((d) => {
        const v = money_.byDay.get(d) ?? 0;
        return html`<li class="${d === now ? "is-today" : ""}" title="${weekday(d)} ${shortDate(d)}: uses ${money(v)} of groceries">
          <span class="cal-bar-val mono">${v ? `$${Math.round(v / 100)}` : ""}</span>
          <span class="cal-bar"><span style="--h: ${v ? Math.max(6, Math.round((v / peak) * 100)) : 0}%"></span></span>
          <span class="cal-bar-day">${weekday(d).slice(0, 1)}<span class="sr-only">${weekday(d).slice(1)} ${money(v)}</span></span>
        </li>`;
      })}
    </ol>
    <form class="cal-budget-form" method="post" action="/calendar/budget">
      <input type="hidden" name="return_to" value="${returnTo}" />
      <label class="field"><span>Weekly budget</span>
        <span class="input-prefix"><span>$</span><input name="weekly_budget" inputmode="decimal" placeholder="e.g. 100" value="${budget === null ? "" : (budget / 100).toFixed(2)}" aria-label="Weekly grocery budget in dollars" /></span></label>
      <button class="button button-small button-soft" type="submit">Save</button>
    </form>
    <p class="cal-fine">The whole packs this week's planned meals need, scaled to ${prefsFor(userId).default_servings} serves, after what's in your pantry, with shared ingredients bought once (the same total as your <a href="/shopping">shopping list</a>). The meals themselves use ${money(money_.usesCents)} of it; daily bars show what each day uses.${money_.estimatedCents ? ` Includes about ${money(money_.estimatedCents)} of estimates for ${money_.unpriced} item${money_.unpriced === 1 ? "" : "s"} with no pack price.` : ""} Shelf prices from Woolworths and ALDI as last read, and prices you paid; not live.</p>
  </section>`;
}

/* ---------------- week & month grids ---------------- */

const DAY_TINTS = ["--sage", "--peach", "--butter", "--lavender", "--sky", "--rose", "--sage"];

function weekGrid(
  s: CalState,
  entries: CalendarEntry[],
  ghosts: FriendMeal[],
  drafts: Plan["picks"],
  money_: Money,
  returnTo: string,
): Html {
  const now = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(s.start, i));
  let n = 0;
  return html`<div class="cal-week" data-cal-region="grid">
    ${days.map((d, di) => {
      const own = entries.filter((e) => e.date === d);
      // breakfast, lunch, dinner; within a meal yours first, then a draft, then friends'
      const items = [
        ...own.map((e) => ({ meal: e.meal, rank: 0, render: () => tile(e, money_.byEntry.get(e.id), n++, returnTo) })),
        ...drafts.filter((p) => p.date === d).map((p) => ({ meal: "dinner" as Meal, rank: 1, render: () => draftTile(p, n++) })),
        ...ghosts.filter((g) => g.date === d).map((g) => ({ meal: g.meal, rank: 2, render: () => ghostTile(g, n++) })),
      ].sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.rank - b.rank);
      const spend = money_.byDay.get(d) ?? 0;
      const date = parseIsoDate(d)!;
      return html`<section class="cal-day ${d === now ? "is-today" : ""} ${d < now ? "is-past" : ""}" style="--tint: var(${DAY_TINTS[di]}); --d: ${di}" aria-labelledby="day-${d}">
        <header class="cal-day-head">
          <span class="cal-dow">${weekday(d)}</span>
          <span class="cal-dnum" id="day-${d}"><span class="sr-only">${weekday(d)} </span>${date.getDate()}<span class="sr-only"> ${MONTHS[date.getMonth()]}</span></span>
        </header>
        <div class="cal-day-body">
          ${items.map((it) => it.render())}
          <a class="cal-add" href="${calHref(s, {}, "")}&day=${d}#quick-add" data-quick-open="${d}" aria-label="Add a meal on ${weekday(d)} ${shortDate(d)}">${icon("plus", 15)}<span>${items.length ? "Add" : "Add a meal"}</span></a>
        </div>
        <footer class="cal-day-foot" title="What this day's meals use beyond your pantry (a share of the packs bought for the week)"><span>Uses</span><span class="mono">${spend ? money(spend) : "—"}</span></footer>
      </section>`;
    })}
  </div>`;
}

function monthGrid(s: CalState, entries: CalendarEntry[], ghosts: FriendMeal[], money_: Money): Html {
  const now = today();
  const first = parseIsoDate(s.month)!;
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const last = `${s.month.slice(0, 8)}${String(lastDay.getDate()).padStart(2, "0")}`;
  const weeks = Math.ceil((Math.round((parseIsoDate(last)!.getTime() - parseIsoDate(s.start)!.getTime()) / 86_400_000) + 1) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(s.start, i));
  return html`<div class="cal-month-wrap" data-cal-region="grid">
    <div class="cal-month-head" aria-hidden="true">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => html`<span>${d}</span>`)}</div>
    <ol class="cal-month" style="--rows: ${weeks}">
      ${cells.map((d, i) => {
        const inMonth = d.slice(0, 7) === s.month.slice(0, 7);
        const own = entries.filter((e) => e.date === d && e.status !== "cancelled");
        const theirs = ghosts.filter((g) => g.date === d);
        const shown = own.slice(0, 3);
        const more = own.length - shown.length;
        const spend = money_.byDay.get(d) ?? 0;
        const date = parseIsoDate(d)!;
        return html`<li class="cal-mcell ${inMonth ? "" : "is-out"} ${d === now ? "is-today" : ""} ${d < now ? "is-past" : ""}" style="--i: ${i}">
          <a href="${calHref(s, { view: "week", start: weekStart(d) })}" data-cal-nav aria-label="${weekday(d)} ${date.getDate()} ${MONTHS[date.getMonth()]}: ${own.length ? `${own.length} meal${own.length === 1 ? "" : "s"}` : "nothing planned"}${theirs.length ? `, ${theirs.length} from friends` : ""}">
            <span class="cal-mtop"><span class="cal-mnum">${date.getDate()}</span>${spend ? html`<span class="cal-mspend mono">$${Math.round(spend / 100)}</span>` : ""}</span>
            <span class="cal-mlist">
              ${shown.map((e) => html`<span class="cal-mpill ${e.status === "completed" ? "is-done" : ""}">${photo(e.image_url, "small") ? html`<img src="${photo(e.image_url, "small")}" alt="" loading="lazy" />` : html`<span class="cal-mdot" style="--fr: ${tone(e.title)[0]}; --fr-ink: ${tone(e.title)[1]}">${e.title.slice(0, 1)}</span>`}<span>${e.title}</span></span>`)}
              ${more > 0 ? html`<span class="cal-mmore">+${more} more</span>` : ""}
            </span>
            ${theirs.length
              ? html`<span class="cal-mfriends">${[...new Map(theirs.map((g) => [g.username, g])).values()].slice(0, 4).map((g) => {
                  const [bg, ink] = tone(g.display_name);
                  return html`<span class="cal-mfriend" style="--fr: ${bg}; --fr-ink: ${ink}" title="${firstName(g.display_name)}: ${g.title}">${firstName(g.display_name).slice(0, 1)}</span>`;
                })}</span>`
              : ""}
          </a>
        </li>`;
      })}
    </ol>
  </div>`;
}

/* ---------------- quick add ---------------- */

function hiddenNav(s: CalState): Html {
  return html`${s.view === "month" ? html`<input type="hidden" name="view" value="month" /><input type="hidden" name="m" value="${s.month.slice(0, 7)}" />` : html`<input type="hidden" name="week" value="${s.start}" />`}
  ${s.with.length ? html`<input type="hidden" name="with" value="${s.with.join(",")}" />` : ""}`;
}

function quickChoices(userId: number, q: string): { recipes: Recipe[]; heading: string } {
  if (q) return { recipes: listVisibleRecipes(userId, { query: q, limit: 8 }), heading: `Results for “${q}”` };
  // no search yet: your usuals first, then photographed catalogue mains
  const usual = all<{ recipe_id: number }>(
    `SELECT recipe_id FROM calendar_entries WHERE owner_type = 'user' AND owner_id = ? AND status != 'cancelled'
     GROUP BY recipe_id ORDER BY COUNT(*) DESC, MAX(date) DESC LIMIT 4`,
    userId,
  )
    .map((r) => getRecipe(r.recipe_id))
    .filter((r): r is Recipe => !!r && canSeeRecipe(userId, r));
  const featured = listVisibleRecipes(userId, { course: "main", order: "featured", limit: 24 }).filter(
    (r) => r.source !== null && !usual.some((u) => u.id === r.id),
  );
  return { recipes: [...usual, ...featured].slice(0, 8), heading: usual.length ? "Your usuals and some ideas" : "Ideas to start with" };
}

function quickResults(s: CalState, userId: number, returnTo: string): Html {
  const { recipes, heading } = quickChoices(userId, s.q);
  const prefs = prefsFor(userId);
  const stock = usableStock("user", userId);
  const options = cachedOptions(userId);
  const lines = ingredientsFor(recipes.map((r) => r.id));
  const when = `${s.day === today() ? "Today" : `${weekday(s.day)} ${shortDate(s.day)}`}, ${s.meal}`;
  return html`<div class="cal-results" data-quick-results aria-live="polite">
    <p class="cal-results-head"><span>${heading}</span><span class="cal-when">${icon("calendar", 13)}<span data-when>${when}</span></span></p>
    ${recipes.length
      ? html`<ul>${recipes.map((r, i) => {
          const c = costLines(lines.get(r.id) ?? [], servingsFactor(prefs, r.servings), stock, options);
          const minutes = totalMinutes(r);
          return html`<li class="cal-result" style="--i: ${i}">
            <a class="cal-result-photo" href="/recipes/${r.id}" tabindex="-1" aria-hidden="true">${thumb(r.image_url, r.title, "small")}</a>
            <span class="cal-result-text">
              <a class="cal-result-title" href="/recipes/${r.id}">${r.title}</a>
              <span class="cal-result-meta">${[minutes ? duration(minutes) : "", r.cuisine || (r.author_id === userId ? "Yours" : `by ${firstName(r.author_name)}`), c.counted >= 2 ? `${c.toBuyCents ? `${money(c.toBuyCents)} to buy` : "all in your pantry"}` : ""].filter(Boolean).join(" · ")}</span>
            </span>
            <form method="post" action="/calendar" class="cal-result-add">
              <input type="hidden" name="recipe_id" value="${r.id}" />
              <input type="hidden" name="date" value="${s.day}" data-sync="day" />
              <input type="hidden" name="meal" value="${s.meal}" data-sync="meal" />
              ${s.share ? html`<input type="hidden" name="shared" value="1" data-sync="share" />` : html`<input type="hidden" name="shared" value="0" data-sync="share" />`}
              <input type="hidden" name="return_to" value="${returnTo}" />
              <button class="cal-add-btn" type="submit" aria-label="Add ${r.title} to ${weekday(s.day)} ${shortDate(s.day)} ${s.meal}">${icon("plus", 14)}<span>Add</span></button>
            </form>
          </li>`;
        })}</ul>`
      : html`<p class="cal-results-empty">Nothing matches “${s.q}”. Try an ingredient you have, like “eggs” or “chickpeas”.</p>`}
  </div>`;
}

function quickAdd(s: CalState, userId: number, returnTo: string): Html {
  const now = today();
  // the days you can drop a meal on: the week shown, or the next fortnight in month view
  const base = s.view === "month" ? (s.month.slice(0, 7) === now.slice(0, 7) ? now : s.month) : s.start;
  const days = Array.from({ length: s.view === "month" ? 14 : 7 }, (_, i) => addDays(base, i));
  if (!days.includes(s.day)) days.unshift(s.day);
  return html`<section class="cal-panel cal-quick" id="quick-add" data-cal-region="quick" data-quick aria-labelledby="quick-title">
    <header class="cal-panel-head">
      <span class="cal-panel-icon" style="--tint: var(--sky); --tint-ink: var(--sky-ink)">${icon("search", 18)}</span>
      <div><h2 id="quick-title">Quick add</h2><p>Search Larder's recipes, pick a day and drop it in.</p></div>
    </header>
    <form class="cal-quick-form" method="get" action="/calendar#quick-add" role="search" data-quick-form>
      ${hiddenNav(s)}
      <label class="cal-search">${icon("search", 18)}<span class="sr-only">Search recipes</span>
        <input type="search" name="q" value="${s.q}" placeholder="Search “curry”, “eggs”, “pasta”…" autocomplete="off" data-quick-q /></label>
      <div class="cal-quick-when">
        <label class="field"><span>Day</span>
          <select name="day" data-quick-day>${days.map((d) => html`<option value="${d}" ${d === s.day ? raw("selected") : ""}>${d === now ? "Today" : weekday(d)} ${shortDate(d)}</option>`)}</select></label>
        <label class="field"><span>Meal</span>
          <select name="meal" data-quick-meal>${MEALS.map((m) => html`<option value="${m}" ${m === s.meal ? raw("selected") : ""}>${MEAL_LABEL[m]}</option>`)}</select></label>
        <input type="hidden" name="share" value="0" />
        <label class="check-inline cal-share"><input type="checkbox" name="share" value="1" ${s.share ? raw("checked") : ""} data-quick-share /> <span>Share with friends</span></label>
        <button class="button button-small" type="submit">Search</button>
      </div>
    </form>
    ${quickResults(s, userId, returnTo)}
  </section>`;
}

/* ---------------- plan my week ---------------- */

const INTEREST_ICON: Record<InterestKey, string> = {
  budget: "basket",
  mix: "bolt",
  lessmeat: "leaf",
  usuals: "heart",
  new: "global",
  season: "leaf",
  fridge: "pantry",
};

const DEFAULT_INTERESTS: InterestKey[] = ["budget", "mix", "fridge"];

const HOW: Record<InterestKey, string> = {
  budget: "A hard ceiling: the dinners' cost to buy (after your pantry) never adds up past it. Pricier picks are swapped for cheaper ones, and a night is left open rather than going over.",
  mix: "No two nights in a row share a cuisine or a main protein.",
  lessmeat: "At most two dinners with meat; meat-free nights get a lift.",
  usuals: "Recipes you've planned or cooked before rank first, most-made first.",
  new: "Anything already in your calendar history is left out.",
  season: "Recipes using produce in season in Australia this month rank higher.",
  fridge: "Recipes using what you hold rank higher, most of all items about to expire, timed to land before they do.",
};

function plannerPanel(s: CalState, userId: number, plan: Plan | null, returnTo: string): Html {
  const prefs = prefsFor(userId);
  const p = s.plan;
  const chosen = p ? p.interests : new Set(DEFAULT_INTERESTS);
  const budgetCents = p?.budgetCents ?? prefs.weekly_budget_cents ?? 10000;
  const budgetValue = (budgetCents / 100).toFixed(2).replace(/\.00$/, "");
  const nights = p?.nights ?? 5;
  const from = p?.from ?? planStart(s.start, today());
  return html`<section class="cal-panel cal-planner" id="plan" data-cal-region="plan" aria-labelledby="plan-title">
    <div class="cal-planner-intro">
      <header class="cal-panel-head">
        <span class="cal-panel-icon" style="--tint: var(--lavender); --tint-ink: var(--lavender-ink)">${icon("planner", 18)}</span>
        <div><h2 id="plan-title">Plan my week for me</h2>
          <p>Choose what matters this week. Larder fills your free dinners from ${weekday(from)} ${shortDate(from)} using what's in your pantry and what you've cooked before${prefs.dietary_prefs.length ? html`, keeping to your diet (${prefs.dietary_prefs.join(", ")})` : ""}${prefs.dislikes ? html` and skipping ${prefs.dislikes}` : ""}.</p></div>
      </header>
      <form class="cal-plan-form" method="get" action="/calendar#plan" data-plan-form>
        ${hiddenNav(s)}
        <input type="hidden" name="plan" value="1" />
        <input type="hidden" name="from" value="${from}" />
        <fieldset class="cal-interests">
          <legend class="sr-only">What matters this week</legend>
          <div class="cal-int cal-int-money">
            <label class="cal-amt"><span aria-hidden="true">$</span><input name="budget" inputmode="decimal" value="${budgetValue}" aria-label="Budget for the week, in dollars" /></label>
            <label class="cal-int-toggle"><input type="checkbox" name="i" value="budget" ${chosen.has("budget") ? raw("checked") : ""} /><span>for the week</span></label>
          </div>
          ${INTERESTS.filter((x) => x.key !== "budget").map(
            (x) => html`<label class="cal-int"><input type="checkbox" name="i" value="${x.key}" ${chosen.has(x.key) ? raw("checked") : ""} /><span>${icon(INTEREST_ICON[x.key], 15)}${x.label}</span></label>`,
          )}
        </fieldset>
        <div class="cal-plan-go">
          <label class="field cal-nights"><span>Dinners</span>
            <select name="nights">${[3, 4, 5, 6, 7].map((n) => html`<option value="${n}" ${n === nights ? raw("selected") : ""}>${n} dinners</option>`)}</select></label>
          <button class="button button-accent" type="submit">${icon("planner", 16)} ${plan ? "Plan again" : "Plan my week"}</button>
        </div>
      </form>
      <details class="cal-how">
        <summary>How picks are made</summary>
        <p>Fixed rules decide every pick, so the same choices give the same week; no AI chooses what you eat. Only recipes you can see, that fit every diet tag you follow and avoid your dislikes, are considered. Then each choice you tick adds a rule:</p>
        <dl>${INTERESTS.map((x) => html`<div><dt>${x.key === "budget" ? "$ for the week" : x.label}</dt><dd>${HOW[x.key]}</dd></div>`)}</dl>
        <p>Each dinner's cost is the whole packs it needs bought on its own, after your pantry, scaled to the ${prefs.default_servings} serves you cook for; the week's total pools shared ingredients, so it's never more than the dinners added up. Your past weeks also give cuisines you plan often a small lift.</p>
      </details>
    </div>
    ${plan && p ? planResult(s, plan, p, returnTo) : ""}
  </section>`;
}

function planResult(s: CalState, plan: Plan, p: PlanParams, returnTo: string): Html {
  const pct = plan.budgetCents ? Math.min(100, Math.round((plan.totalCents / Math.max(plan.budgetCents, 1)) * 100)) : 0;
  const ids = plan.dates.map((d) => plan.picks.find((x) => x.date === d)?.recipe.id ?? 0);
  const swapHref = (i: number) => {
    const keep = ids.map((id, j) => (j === i ? 0 : id));
    return calHref({ ...s, plan: { ...p, keep, exclude: [...new Set([...p.exclude, ids[i]])].slice(-14) } }, {}, "#plan");
  };
  const shuffle = calHref({ ...s, plan: { ...p, seed: p.seed + 1, keep: [], exclude: [] } }, {}, "#plan");
  return html`<div class="cal-plan" data-total-cents="${plan.totalCents}" data-budget-cents="${plan.budgetCents ?? ""}">
    <div class="cal-plan-summary">
      <div class="cal-plan-sum-text">
        <p class="cal-label">Your draft week</p>
        <p class="cal-plan-total"><span class="tnum">${money(plan.totalCents)}</span> <small>at the checkout for ${plan.picks.length} dinner${plan.picks.length === 1 ? "" : "s"}</small></p>
        ${plan.budgetCents !== null
          ? html`<div class="cal-meter cal-meter-plan" role="meter" aria-label="Draft week cost against budget" aria-valuemin="0" aria-valuemax="${plan.budgetCents}" aria-valuenow="${plan.totalCents}" aria-valuetext="${money(plan.totalCents)} of ${money(plan.budgetCents)}"><span style="--p: ${pct}%"></span></div>
              <p class="cal-budget-note"><strong>${money(plan.budgetCents - plan.totalCents)} under</strong> your ${money(plan.budgetCents)}</p>`
          : html`<p class="cal-budget-note">Tick “for the week” to keep it under a budget.</p>`}
      </div>
      <div class="cal-plan-actions">
        <a class="button button-ghost button-small" href="${shuffle}" data-cal-nav="plan">${icon("bolt", 15)} Shuffle</a>
        ${plan.picks.length
          ? html`<form method="post" action="/calendar/plan" class="cal-accept">
              ${plan.picks.map((x) => html`<input type="hidden" name="pick" value="${x.date}|${x.recipe.id}" />`)}
              <input type="hidden" name="return_to" value="${returnTo}" />
              <label class="check-inline"><input type="checkbox" name="shared" value="1" checked /> <span>Share</span></label>
              <button class="button" type="submit">${icon("check", 16)} Add all to calendar</button>
            </form>`
          : ""}
      </div>
    </div>
    ${plan.notes.length ? html`<p class="cal-plan-note">${plan.notes.join(" ")}</p>` : ""}
    <ol class="cal-picks">
      ${plan.dates.map((d, i) => {
        const pick = plan.picks.find((x) => x.date === d);
        if (!pick) {
          return html`<li class="cal-pick cal-pick-open" style="--i: ${i}">
            <span class="cal-pick-day">${weekday(d)} ${shortDate(d)}</span>
            <p>Left open${plan.budgetCents !== null ? " to stay in budget" : ""}.</p>
          </li>`;
        }
        return html`<li class="cal-pick" style="--i: ${i}" data-pick-recipe="${pick.recipe.id}" data-pick-date="${d}" data-cost-cents="${pick.toBuyCents}">
          <a class="cal-pick-photo" href="/recipes/${pick.recipe.id}" tabindex="-1" aria-hidden="true">
            ${thumb(pick.recipe.image_url, pick.recipe.title)}
            <span class="cal-pick-day">${weekday(d)} ${shortDate(d)}</span>
            <span class="cal-pick-cost">${money(pick.toBuyCents)}<small> on its own</small></span>
          </a>
          <div class="cal-pick-body">
            <h3><a href="/recipes/${pick.recipe.id}">${pick.recipe.title}</a></h3>
            <ul class="cal-why">${pick.reasons.map((r) => html`<li>${r}</li>`)}</ul>
            <a class="cal-swap" href="${swapHref(i)}" data-cal-nav="plan" aria-label="Swap ${pick.recipe.title} for something else">${icon("bolt", 13)} Swap</a>
          </div>
        </li>`;
      })}
    </ol>
  </div>`;
}

/* ---------------- the page ---------------- */

function calendarPage(ctx: Ctx, s: CalState): Html {
  const user = ctx.user!;
  const now = today();
  const range =
    s.view === "month"
      ? (() => {
          const first = parseIsoDate(s.month)!;
          const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
          return { from: s.start, to: addDays(weekStart(`${s.month.slice(0, 8)}${String(last.getDate()).padStart(2, "0")}`), 6) };
        })()
      : { from: s.start, to: addDays(s.start, 6) };
  const entries = entriesBetween(user.id, user.id, range.from, range.to);
  const money_ = weekMoney(user.id, entries);
  const friends = friendsOf(user.id);
  // only accepted friends can be overlaid: anyone else named in ?with is ignored
  const overlaid = friends.filter((f) => s.with.includes(f.username.toLowerCase()));
  const ghosts = friendMeals(user.id, overlaid.map((f) => f.id), range.from, range.to);
  const counts = new Map<number, number>();
  for (const g of ghosts) counts.set(g.owner_id, (counts.get(g.owner_id) ?? 0) + 1);
  const returnTo = calHref({ ...s, plan: null });
  const plan = s.plan
    ? generatePlan(user.id, {
        from: s.plan.from,
        nights: s.plan.nights,
        budgetCents: s.plan.budgetCents ?? prefsFor(user.id).weekly_budget_cents ?? 10000,
        interests: s.plan.interests,
        seed: s.plan.seed,
        keep: s.plan.keep,
        exclude: s.plan.exclude,
      } satisfies PlanRequest)
    : null;
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(s.start, i));
  const weekEntries = entries.filter((e) => e.date >= weekDays[0] && e.date <= weekDays[6] && e.status !== "cancelled");
  const weekSpend = s.view === "month" ? 0 : money_.totalCents;
  const summary = html`${weekEntries.length} meal${weekEntries.length === 1 ? "" : "s"} planned${weekSpend ? html` · ${money(weekSpend)} at the checkout` : ""}${ghosts.length ? html` · ${ghosts.length} from friends` : ""}`;
  // the budget card always speaks for one week: the one shown, or this week in month view
  const budgetDays = s.view === "month" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(s.month.slice(0, 7) === now.slice(0, 7) ? now : s.month), i)) : weekDays;
  const budgetMoney: Money =
    s.view === "month"
      ? weekMoney(user.id, entriesBetween(user.id, user.id, budgetDays[0], budgetDays[6]))
      : money_;

  return html`
    ${header(s, summary)}
    <div class="cal-top">
      ${friendsBar(s, friends, counts)}
      <a class="button button-ghost button-small cal-jump" href="#plan">${icon("planner", 15)} Plan my week</a>
      <a class="button button-small cal-jump" href="${calHref(s)}&day=${s.day}#quick-add" data-quick-open="${s.day}">${icon("plus", 15)} Quick add</a>
    </div>
    ${s.view === "month" ? monthGrid(s, entries, ghosts, money_) : weekGrid(s, entries, ghosts, plan?.picks ?? [], money_, returnTo)}
    <div class="cal-lower">
      ${plannerPanel(s, user.id, plan, returnTo)}
      <div class="cal-side">
        ${budgetCard(user.id, budgetDays, budgetMoney, returnTo)}
        ${quickAdd(s, user.id, returnTo)}
      </div>
    </div>`;
}

function entryTitle(id: number): string {
  return one<{ title: string }>("SELECT r.title FROM calendar_entries c JOIN recipes r ON r.id = c.recipe_id WHERE c.id = ?", id)?.title ?? "";
}

function ownEntry(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? one("SELECT 1 FROM calendar_entries WHERE id = ? AND owner_type = 'user' AND owner_id = ?", id, ctx.user!.id)
    : undefined;
  if (!row) throw new HttpError(404, "That calendar entry doesn't exist.");
  return id;
}

function back(form: URLSearchParams): string {
  const to = form.get("return_to") ?? "";
  return to.startsWith("/") && !to.startsWith("//") ? to : "/calendar";
}

// After adding to a day, show the week (or month) that holds it, keeping the
// friends overlaid.
function backTo(form: URLSearchParams, date: string): string {
  const to = back(form);
  if (!to.startsWith("/calendar")) return to;
  const url = new URL(to, "http://x");
  const params = new URLSearchParams();
  if (url.searchParams.get("view") === "month") {
    params.set("view", "month");
    params.set("m", date.slice(0, 7));
  } else params.set("week", weekStart(date));
  const withList = url.searchParams.get("with");
  if (withList) params.set("with", withList);
  return `/calendar?${params}`;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/calendar",
    auth: true,
    handler: (ctx) => {
      const s = stateFrom(ctx);
      // live search in quick add swaps just the results
      if (ctx.url.searchParams.get("partial") === "quickadd") {
        return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: quickResults(s, ctx.user!.id, calHref({ ...s, plan: null })).value };
      }
      return htmlReply(
        page(ctx, {
          title: "Calendar",
          active: "calendar",
          body: calendarPage(ctx, s),
          headExtra: html`<script type="module" src="/assets/calendar.mjs"></script>`,
        }),
      );
    },
  },
  {
    method: "POST",
    path: "/calendar",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const recipe = getRecipe(Number(form.get("recipe_id")));
      const date = form.get("date") ?? "";
      const meal = form.get("meal") ?? "dinner";
      // you can only plan a recipe you're allowed to see
      if (!recipe || !canSeeRecipe(ctx.user!.id, recipe)) throw new HttpError(404, "That recipe doesn't exist.");
      if (!parseIsoDate(date)) throw new HttpError(422, "That isn't a valid date.");
      if (!(MEALS as readonly string[]).includes(meal)) throw new HttpError(422, "Choose breakfast, lunch or dinner.");
      run(
        `INSERT INTO calendar_entries (owner_type, owner_id, date, meal, recipe_id, planned_by, shared)
         VALUES ('user', ?, ?, ?, ?, ?, ?)`,
        ctx.user!.id,
        date,
        meal,
        recipe.id,
        ctx.user!.id,
        form.get("shared") === "1" ? 1 : 0,
      );
      logActivity({ actor: ctx.user, action: "calendar.plan", subject: recipe.title, detail: { recipe: recipe.id, date, meal, shared: form.get("shared") === "1" } });
      setFlash(ctx, `Planned ${recipe.title} for ${weekday(date)} ${shortDate(date)}.`);
      return redirect(backTo(form, date));
    },
  },
  {
    // "Add all to calendar" from the week planner. The form only carries
    // date|recipe pairs; each is checked again here, never trusted.
    method: "POST",
    path: "/calendar/plan",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const userId = ctx.user!.id;
      const picks = form.getAll("pick").slice(0, 14).map((raw) => {
        const [date, id] = raw.split("|");
        const recipe = getRecipe(Number(id));
        if (!recipe || !canSeeRecipe(userId, recipe)) throw new HttpError(404, "That recipe doesn't exist.");
        if (!parseIsoDate(date)) throw new HttpError(422, "That isn't a valid date.");
        return { date, recipe };
      });
      if (!picks.length) throw new HttpError(422, "There was nothing to add.");
      const shared = form.get("shared") === "1" ? 1 : 0;
      transaction(() => {
        for (const p of picks) {
          run(
            `INSERT INTO calendar_entries (owner_type, owner_id, date, meal, recipe_id, planned_by, shared)
             VALUES ('user', ?, ?, 'dinner', ?, ?, ?)`,
            userId,
            p.date,
            p.recipe.id,
            userId,
            shared,
          );
        }
      });
      const first = picks.map((p) => p.date).sort()[0];
      logActivity({ actor: ctx.user, action: "calendar.plan", subject: `${picks.length} dinners from the planner`, detail: { count: picks.length, from: first } });
      setFlash(ctx, `Added ${picks.length} dinner${picks.length === 1 ? "" : "s"} to your calendar. Your shopping list is updated.`);
      return redirect(backTo(form, first));
    },
  },
  {
    // the week's budget, edited right on the calendar; the same column the
    // settings page writes
    method: "POST",
    path: "/calendar/budget",
    auth: true,
    handler: async (ctx) => {
      const form = await ctx.form();
      const raw = (form.get("weekly_budget") ?? "").trim();
      const cents = raw === "" ? null : dollarsToCents(raw);
      if (raw !== "" && cents === null) throw new HttpError(422, "Budget must be a dollar amount like 80 or 80.50.");
      run("UPDATE users SET weekly_budget_cents = ? WHERE id = ?", cents, ctx.user!.id);
      logActivity({ actor: ctx.user, action: "settings.update", subject: "weekly budget", detail: { budget_cents: cents } });
      setFlash(ctx, cents === null ? "Weekly budget cleared." : `Weekly budget set to ${money(cents)}.`);
      return redirect(back(form));
    },
  },
  {
    method: "POST",
    path: "/calendar/:id/status",
    auth: true,
    handler: async (ctx) => {
      const id = ownEntry(ctx);
      const form = await ctx.form();
      const status = form.get("status") ?? "";
      if (!(STATUSES as readonly string[]).includes(status)) throw new HttpError(422, "Unknown status.");
      run("UPDATE calendar_entries SET status = ? WHERE id = ?", status, id);
      logActivity({ actor: ctx.user, action: "calendar.status", subject: entryTitle(id), detail: { entry: id, status } });
      return redirect(back(form));
    },
  },
  {
    method: "POST",
    path: "/calendar/:id/share",
    auth: true,
    handler: async (ctx) => {
      const id = ownEntry(ctx);
      const form = await ctx.form();
      run("UPDATE calendar_entries SET shared = 1 - shared WHERE id = ?", id);
      return redirect(back(form));
    },
  },
  {
    method: "POST",
    path: "/calendar/:id/delete",
    auth: true,
    handler: async (ctx) => {
      const id = ownEntry(ctx);
      const form = await ctx.form();
      logActivity({ actor: ctx.user, action: "calendar.remove", subject: entryTitle(id), detail: { entry: id } });
      run("DELETE FROM calendar_entries WHERE id = ?", id);
      setFlash(ctx, "Removed from calendar.");
      return redirect(back(form));
    },
  },
];
