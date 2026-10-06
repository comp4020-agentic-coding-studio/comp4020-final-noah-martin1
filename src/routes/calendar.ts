import { all, one, run } from "../db.ts";
import { addDays, parseIsoDate, shortDate, today, weekday, weekStart } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { type Ctx, HttpError, htmlReply, redirect, setFlash } from "../http.ts";
import { getRecipe, listVisibleRecipes } from "../recipes.ts";
import type { Route } from "../server.ts";
import { canSeeCalendarEntry, canSeeRecipe } from "../visibility.ts";
import { icon, page, pageHeader } from "../views/layout.ts";

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
}

const MEALS = ["breakfast", "lunch", "dinner"] as const;
const STATUSES = ["planned", "completed", "cancelled"] as const;

// A person's calendar entries between two dates, filtered to what the viewer
// may see (all of them when viewer and owner are the same person).
export function entriesBetween(viewerId: number, ownerId: number, from: string, to: string): CalendarEntry[] {
  return all<CalendarEntry>(
    `SELECT c.id, c.owner_id, c.date, c.meal, c.recipe_id, r.title, c.status, c.shared,
            r.author_id AS recipe_author_id, r.visibility AS recipe_visibility
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
            r.author_id AS recipe_author_id, r.visibility AS recipe_visibility, u.username, u.display_name
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
    ${editable
      ? html`<details class="meal-menu">
          <summary aria-label="Change ${e.title} on ${e.date}">•••</summary>
          <div class="menu">
            ${e.status === "planned" ? html`<a href="/recipes/${e.recipe_id}/cook?entry=${e.id}">Cook now</a>` : ""}
            ${STATUSES.filter((s) => s !== e.status).map(
              (s) => html`<form method="post" action="/calendar/${e.id}/status"><input type="hidden" name="status" value="${s}" /><input type="hidden" name="return_to" value="${returnTo}" /><button type="submit">Mark ${s}</button></form>`,
            )}
            <form method="post" action="/calendar/${e.id}/share"><input type="hidden" name="return_to" value="${returnTo}" /><button type="submit">${e.shared ? "Make private" : "Share with friends"}</button></form>
            <form method="post" action="/calendar/${e.id}/delete"><input type="hidden" name="return_to" value="${returnTo}" /><button type="submit" class="danger">Remove</button></form>
          </div>
        </details>`
      : ""}
  </div>`;
}

function calendarPage(ctx: Ctx): Html {
  const user = ctx.user!;
  const requested = ctx.url.searchParams.get("week");
  const start = weekStart(requested && parseIsoDate(requested) ? requested : today());
  const end = addDays(start, 6);
  const entries = entriesBetween(user.id, user.id, start, end);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const now = today();
  const returnTo = `/calendar?week=${start}`;
  const choices = [
    ...listVisibleRecipes(user.id, { authorId: user.id }),
    ...listVisibleRecipes(user.id, { excludeAuthorId: user.id, limit: 50 }),
  ];
  const defaultDate = now >= start && now <= end ? now : start;
  const planned = entries.filter((e) => e.status !== "cancelled").length;

  return html`
    ${pageHeader(
      "Meal calendar",
      html`Week of <strong>${shortDate(start)}</strong> – ${shortDate(end)} · ${planned} meal${planned === 1 ? "" : "s"} planned`,
      html`<nav class="pager" aria-label="Weeks">
        <a class="button button-ghost" href="/calendar?week=${addDays(start, -7)}" aria-label="Previous week">←</a>
        <a class="button button-ghost" href="/calendar">This week</a>
        <a class="button button-ghost" href="/calendar?week=${addDays(start, 7)}" aria-label="Next week">→</a>
      </nav>`,
    )}

    <section class="panel">
      <h2 class="panel-title">Plan a meal</h2>
      ${choices.length
        ? html`<form method="post" action="/calendar" class="inline-form">
            <input type="hidden" name="return_to" value="${returnTo}" />
            <label class="field grow-2"><span>Recipe</span>
              <select name="recipe_id" required>
                ${choices.map((r) => html`<option value="${r.id}">${r.title}${r.author_id !== user.id ? ` — ${r.author_name}` : ""}</option>`)}
              </select></label>
            <label class="field"><span>Date</span><input type="date" name="date" required value="${defaultDate}" /></label>
            <label class="field"><span>Meal</span>
              <select name="meal">${MEALS.map((m) => html`<option value="${m}" ${m === "dinner" ? raw("selected") : ""}>${m[0].toUpperCase() + m.slice(1)}</option>`)}</select></label>
            <label class="check-inline"><input type="checkbox" name="shared" value="1" checked /> <span>Share</span></label>
            <button class="button" type="submit">${icon("plus", 16)} Add</button>
          </form>`
        : html`<p class="muted">You need a recipe to plan with. <a href="/recipes/new">Write one</a> or find one in <a href="/recipes?tab=discover">Discover</a>.</p>`}
    </section>

    <div class="week">
      ${days.map((d) => {
        const dayEntries = entries.filter((e) => e.date === d);
        return html`<section class="day ${d === now ? "day-today" : ""} ${d < now ? "day-past" : ""}" aria-label="${weekday(d)} ${shortDate(d)}">
          <header class="day-head"><span class="day-name">${weekday(d)}</span><span class="day-date mono">${shortDate(d)}</span></header>
          <div class="day-body">
            ${dayEntries.length ? dayEntries.map((e) => mealChip(e, true, returnTo)) : html`<p class="day-empty">—</p>`}
          </div>
        </section>`;
      })}
    </div>
    <p class="hint">${icon("household", 16)} Household calendars — plan together and see who's cooking — arrive in crit 9.</p>`;
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

export const routes: Route[] = [
  {
    method: "GET",
    path: "/calendar",
    auth: true,
    handler: (ctx) => htmlReply(page(ctx, { title: "Calendar", active: "calendar", body: calendarPage(ctx) })),
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
      setFlash(ctx, `Planned ${recipe.title} for ${weekday(date)} ${shortDate(date)}.`);
      return redirect(back(form).startsWith("/calendar") ? `/calendar?week=${weekStart(date)}` : back(form));
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
      run("DELETE FROM calendar_entries WHERE id = ?", id);
      setFlash(ctx, "Removed from calendar.");
      return redirect(back(form));
    },
  },
];
