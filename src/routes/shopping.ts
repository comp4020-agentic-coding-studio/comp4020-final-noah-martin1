import { addDays, money, monthLabel, qty, shortDate, today, weekday } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { htmlReply } from "../http.ts";
import { priceReference } from "../nutrition.ts";
import { prefsFor } from "../prefs.ts";
import type { Route } from "../server.ts";
import { type ShoppingLine, shoppingList } from "../shopping.ts";
import { empty, icon, page, pageHeader } from "../views/layout.ts";

const RANGES = [3, 7, 14];

function line(l: ShoppingLine, checkable: boolean): Html {
  const amount = l.toBuy === null ? "some" : qty(checkable ? l.toBuy : l.need, l.unit);
  return html`<li class="shop-line">
    ${checkable ? html`<input type="checkbox" data-shop-item="${l.ingredient_id}|${l.unit}" aria-label="Got ${l.name}" />` : ""}
    <span class="mono qty">${amount}</span>
    <span class="grow"><span class="item-name">${l.name}</span>
      <small class="muted block">for ${l.meals.join(", ")}${l.have > 0 && checkable ? ` · you have ${qty(l.have, l.unit)}` : ""}${l.otherUnit && checkable ? " · you hold some in another unit — check" : ""}</small></span>
    ${checkable
      ? html`<span class="hh-line-price mono" title="${priceTitle(l)}">${l.priceCents === null ? "—" : money(l.priceCents)}${l.priceKind ? html`<small>${l.priceKind === "paid" ? "paid" : "est."}</small>` : ""}</span>`
      : ""}
  </li>`;
}

// Where a line's price came from (CLAUDE.md: every reference price carries
// its source and date).
function priceTitle(l: ShoppingLine): string {
  if (l.priceKind === "paid") return "What you last paid for a pack of this";
  if (l.priceKind === "est") {
    return l.priceRef
      ? `Estimate for this amount from a reference price: ${l.priceRef.source} (checked ${monthLabel(l.priceRef.checked)}). Not a live price.`
      : "Estimate for this amount at typical Australian supermarket shelf prices. Not a live price.";
  }
  return "No price known";
}

// ", checked Oct 2026", from the newest month in the price table
function referenceChecked(): string {
  const label = monthLabel(priceReference().checked);
  return label ? `, checked ${label}` : "";
}

const categoryTitle = (c: string) => (c === "other" ? "Everything else" : c.charAt(0).toUpperCase() + c.slice(1));

export const routes: Route[] = [
  {
    method: "GET",
    path: "/shopping",
    auth: true,
    handler: (ctx) => {
      const user = ctx.user!;
      const requested = Number(ctx.url.searchParams.get("days"));
      const days = RANGES.includes(requested) ? requested : 7;
      const from = today();
      const to = addDays(from, days - 1);
      const list = shoppingList(user.id, from, to);
      const prefs = prefsFor(user.id);
      const budget = prefs.weekly_budget_cents === null ? null : Math.round((prefs.weekly_budget_cents * days) / 7);

      const groups = new Map<string, ShoppingLine[]>();
      for (const l of list.toBuy) groups.set(l.category, [...(groups.get(l.category) ?? []), l]);

      const body = html`
        ${pageHeader(
          "Shopping list",
          html`What your planned meals need from <strong>${weekday(from)} ${shortDate(from)}</strong> to ${weekday(to)} ${shortDate(to)}, minus what's in your pantry.`,
          html`<nav class="pager" aria-label="Range">${RANGES.map(
            (d) => html`<a class="button button-ghost" href="/shopping?days=${d}" ${d === days ? raw('aria-current="page"') : ""}>${d} days</a>`,
          )}</nav><button class="button button-ghost" type="button" data-print>Print</button>`,
        )}
        <dl class="stats">
          <div><dt>Meals planned</dt><dd>${list.meals.length}</dd></div>
          <div><dt>To buy</dt><dd>${list.toBuy.length}</dd></div>
          <div><dt>Est. cost</dt><dd>${money(list.estCents)}${list.unpriced ? html`<small> + ${list.unpriced} unpriced</small>` : ""}</dd></div>
          <div class="${budget !== null && list.estCents > budget ? "stat-bad" : ""}"><dt>Budget (${days}d)</dt><dd>${budget === null ? html`<a href="/settings" class="set-link">Set →</a>` : money(budget - list.estCents)}${budget !== null ? html`<small> left</small>` : ""}</dd></div>
        </dl>

        ${list.meals.length === 0
          ? empty("Nothing planned", `Plan meals on your calendar and their ingredients appear here.`, html`<a class="button" href="/calendar">Open calendar</a>`)
          : html`<div class="split split-wide">
              <div class="side-stack">
                ${list.toBuy.length
                  ? [...groups].map(
                      ([category, lines]) => html`<section class="panel">
                        <h2 class="panel-title">${categoryTitle(category)}</h2>
                        <ul class="shop-list">${lines.map((l) => line(l, true))}</ul>
                      </section>`,
                    )
                  : html`<section class="panel"><p class="empty-title">You have everything.</p><p class="muted">Your pantry covers every planned meal in this range.</p></section>`}
                ${list.covered.length
                  ? html`<section class="panel">
                      <h2 class="panel-title">Already in your pantry <span class="count">${list.covered.length}</span></h2>
                      <ul class="shop-list covered">${list.covered.map((l) => line(l, false))}</ul>
                    </section>`
                  : ""}
              </div>
              <aside class="side-stack">
                <section class="panel">
                  <h2 class="panel-title">Meals included</h2>
                  <ul class="compact-list">${list.meals.map(
                    (m) => html`<li><span class="mono muted w-day">${weekday(m.date)}</span><a class="grow" href="/recipes/${m.recipe_id}">${m.title}</a><span class="muted">${m.meal}</span></li>`,
                  )}</ul>
                </section>
                <section class="panel">
                  <h2 class="panel-title">How it's worked out</h2>
                  <p class="muted small">Amounts are summed across meals, then what you hold (unexpired, same unit) is subtracted.
                    <strong>paid</strong> is the last price you entered for a pack; <strong>est.</strong> is Larder's estimate for the amount needed, from reference shelf prices read at ALDI and Woolworths${referenceChecked()} (hover a price for its source). They're estimates, not live supermarket prices.
                    Ticks are remembered in this browser only.</p>
                </section>
                <a class="button button-ghost button-block" href="/calendar#plan">${icon("spark", 16)} Plan a cheaper week</a>
              </aside>
            </div>`}`;
      return htmlReply(page(ctx, { title: "Shopping list", active: "shopping", body }));
    },
  },
];
