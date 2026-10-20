import { addDays, money, qty, shortDate, today, weekday } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { htmlReply } from "../http.ts";
import { optionLabel, type PackChoice } from "../pricing.ts";
import { dataAge } from "../products.ts";
import { prefsFor } from "../prefs.ts";
import type { Route } from "../server.ts";
import { type ShoppingLine, shoppingList } from "../shopping.ts";
import { empty, icon, page, pageHeader } from "../views/layout.ts";

const RANGES = [3, 7, 14];

// "2 × Plain Flour 2kg" or "about 300 g, sold loose"
export function packText(p: PackChoice): string {
  if (p.count === null) return `${p.option.product}, sold by weight`;
  return `${p.count} × ${p.option.product}`;
}

function priceSourceNote(p: PackChoice): Html {
  const o = p.option;
  return html`<small class="shop-src shop-src-${o.kind}">${optionLabel(o)}</small>`;
}

export function packLine(p: PackChoice | null, consumption: number | null, shares = false, clash = false): Html {
  if (shares) {
    return html`<span class="shop-pack"><span class="muted small">${clash ? "Measured differently from the other line for this; that pack should cover it — check" : "Comes out of the pack on the other line for this"}${consumption !== null ? html` · uses about <span class="mono">${money(consumption)}</span>` : ""}</span></span>`;
  }
  if (!p) {
    return html`<span class="shop-pack shop-pack-none">
      <span class="muted small">No pack price known${consumption !== null ? html` · uses about <span class="mono">${money(consumption)}</span> (estimate)` : ""}</span>
    </span>`;
  }
  const o = p.option;
  const name = o.url ? html`<a href="${o.url}" rel="noopener noreferrer" target="_blank">${packText(p)}</a>` : html`${packText(p)}`;
  return html`<span class="shop-pack">
    <span class="shop-pack-name">${o.kind === "retailer" ? html`<span class="shop-store shop-store-${o.retailer.toLowerCase()}">${o.retailer}</span>` : o.kind === "user" ? html`<span class="shop-store shop-store-you">You paid</span>` : html`<span class="shop-store">${o.retailer} ref.</span>`} ${name}</span>
    ${priceSourceNote(p)}
    ${p.why ? html`<small class="shop-why">${p.why}</small>` : ""}
  </span>`;
}

function line(l: ShoppingLine, checkable: boolean): Html {
  const amount = l.toBuy === null ? "some" : qty(checkable ? l.toBuy : l.need, l.unit === "each" ? "" : l.unit);
  return html`<li class="shop-line">
    ${checkable ? html`<input type="checkbox" data-shop-item="${l.ingredient_id}|${l.unit}" aria-label="Got ${l.name}" />` : ""}
    <span class="mono qty">${l.approx && checkable ? "~" : ""}${amount}</span>
    <span class="grow"><span class="item-name">${l.name}</span>
      <small class="muted block">for ${l.meals.join(", ")}${l.have > 0 && checkable ? ` · you have ${qty(l.have, l.unit === "each" ? "" : l.unit)}` : ""}${l.otherUnit && checkable ? " · you hold some in a unit that can't be compared — check" : ""}</small>
      ${checkable ? packLine(l.pack, l.consumptionCents, l.sharesPack, l.unitClash) : ""}</span>
    ${checkable
      ? html`<span class="hh-line-price mono" title="${l.pack ? `Checkout price for ${packText(l.pack)}` : l.sharesPack ? "Already bought on another line" : "No pack price known"}">${l.pack ? money(l.pack.costCents) : l.sharesPack ? "incl." : "—"}${l.pack ? html`<small>${l.pack.count === null ? "by weight" : l.pack.count === 1 ? "1 pack" : `${l.pack.count} packs`}</small>` : ""}</span>`
      : ""}
  </li>`;
}

const categoryTitle = (c: string) => (!c || c === "other" ? "Everything else" : c.charAt(0).toUpperCase() + c.slice(1));

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
      const age = dataAge().generatedAt;

      const groups = new Map<string, ShoppingLine[]>();
      for (const l of list.toBuy) groups.set(l.category, [...(groups.get(l.category) ?? []), l]);

      const body = html`
        ${pageHeader(
          "Shopping list",
          html`What your planned meals need from <strong>${weekday(from)} ${shortDate(from)}</strong> to ${weekday(to)} ${shortDate(to)}, minus what's in your pantry, in whole packs.`,
          html`<nav class="pager" aria-label="Range">${RANGES.map(
            (d) => html`<a class="button button-ghost" href="/shopping?days=${d}" ${d === days ? raw('aria-current="page"') : ""}>${d} days</a>`,
          )}</nav><button class="button button-ghost" type="button" data-print>Print</button>`,
        )}
        <dl class="stats">
          <div><dt>Meals planned</dt><dd>${list.meals.length}</dd></div>
          <div><dt>To buy</dt><dd>${list.toBuy.length}</dd></div>
          <div data-shop-total><dt>At the checkout</dt><dd>${money(list.purchaseCents)}${list.unpriced ? html`<small> + ${list.unpriced} unpriced</small>` : ""}</dd></div>
          <div class="${budget !== null && list.purchaseCents > budget ? "stat-bad" : ""}"><dt>Budget (${days}d)</dt><dd>${budget === null ? html`<a href="/settings" class="set-link">Set →</a>` : money(budget - list.purchaseCents)}${budget !== null ? html`<small> left</small>` : ""}</dd></div>
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
                <section class="panel shop-totals" aria-labelledby="shop-totals-h">
                  <h2 class="panel-title" id="shop-totals-h">What it costs</h2>
                  <dl class="shop-split">
                    <div><dt>At the checkout</dt><dd class="mono" data-purchase-cents="${list.purchaseCents}">${money(list.purchaseCents)}</dd><small>whole packs you'd buy</small></div>
                    <div><dt>Used by these meals</dt><dd class="mono" data-consumption-cents="${list.consumptionCents}">${money(list.consumptionCents)}</dd><small>the share of those packs the recipes use</small></div>
                  </dl>
                  <p class="muted small">The difference stays in your kitchen for next time. Your budget is compared against the checkout total.${list.unpriced ? ` ${list.unpriced} item${list.unpriced === 1 ? " has" : "s have"} no pack price${list.unpricedEstCents ? `, worth about ${money(list.unpricedEstCents)} at reference rates (not included)` : ""}.` : ""}</p>
                </section>
                <section class="panel">
                  <h2 class="panel-title">Meals included</h2>
                  <ul class="compact-list">${list.meals.map(
                    (m) => html`<li><span class="mono muted w-day">${weekday(m.date)}</span><a class="grow" href="/recipes/${m.recipe_id}">${m.title}</a><span class="muted">${m.meal}</span></li>`,
                  )}</ul>
                </section>
                <section class="panel">
                  <h2 class="panel-title">How it's worked out</h2>
                  <p class="muted small">Each meal is scaled to the ${prefs.default_servings} serves you cook for. Amounts are summed across meals, then what you hold (unexpired, in a comparable unit) is subtracted, and the rest is bought in whole packs: 200 g of flour from an empty pantry is a whole bag.
                    For each item Larder compares the packs it knows: <strong>Woolworths</strong> and <strong>ALDI</strong> shelf prices${age ? ` (last read ${age.slice(0, 10)})` : ""}, and <strong>prices you paid</strong> when you recorded them on a pantry item. The cheapest pack that covers what you need wins, compared for the same amount, and a price you paid is never replaced by a higher shelf price.
                    Shelf prices are what the store's website showed when Larder last read them; they aren't live and can change. Ticks are remembered in this browser only.</p>
                </section>
                <a class="button button-ghost button-block" href="/calendar#plan">${icon("spark", 16)} Plan a cheaper week</a>
              </aside>
            </div>`}`;
      return htmlReply(page(ctx, { title: "Shopping list", active: "shopping", body }));
    },
  },
];
