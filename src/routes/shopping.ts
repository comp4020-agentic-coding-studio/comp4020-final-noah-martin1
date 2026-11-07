import { addDays, money, qty, shortDate, today, weekday } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { htmlReply } from "../http.ts";
import { t, th, tn } from "../i18n.ts";
import { optionLabel, type PackChoice } from "../pricing.ts";
import { dataAge } from "../products.ts";
import { prefsFor } from "../prefs.ts";
import type { Route } from "../server.ts";
import { type ShoppingLine, shoppingList } from "../shopping.ts";
import { empty, icon, page, pageHeader } from "../views/layout.ts";

const RANGES = [3, 7, 14];

// "2 × Plain Flour 2kg" or "about 300 g, sold loose"
export function packText(p: PackChoice): string {
  if (p.count === null) return t("{product}, sold by weight", { product: p.option.product });
  return `${p.count} × ${p.option.product}`;
}

function priceSourceNote(p: PackChoice): Html {
  const o = p.option;
  return html`<small class="shop-src shop-src-${o.kind}">${optionLabel(o)}</small>`;
}

export function packLine(p: PackChoice | null, consumption: number | null, shares = false, clash = false): Html {
  const about = (n: number) => th("uses about {amount}", { amount: html`<span class="mono">${money(n)}</span>` });
  if (shares) {
    return html`<span class="shop-pack"><span class="muted small">${clash ? t("Measured differently from the other line for this; that pack should cover it — check") : t("Comes out of the pack on the other line for this")}${consumption !== null ? html` · ${about(consumption)}` : ""}</span></span>`;
  }
  if (!p) {
    return html`<span class="shop-pack shop-pack-none">
      <span class="muted small">${t("No pack price known")}${consumption !== null ? html` · ${about(consumption)} ${t("(estimate)")}` : ""}</span>
    </span>`;
  }
  const o = p.option;
  const name = o.url ? html`<a href="${o.url}" rel="noopener noreferrer" target="_blank">${packText(p)}</a>` : html`${packText(p)}`;
  return html`<span class="shop-pack">
    <span class="shop-pack-name">${o.kind === "retailer" ? html`<span class="shop-store shop-store-${o.retailer.toLowerCase()}">${o.retailer}</span>` : o.kind === "user" ? html`<span class="shop-store shop-store-you">${t("You paid")}</span>` : html`<span class="shop-store">${t("{store} ref.", { store: o.retailer })}</span>`} ${name}</span>
    ${priceSourceNote(p)}
    ${p.why ? html`<small class="shop-why">${p.why}</small>` : ""}
  </span>`;
}

function line(l: ShoppingLine, checkable: boolean): Html {
  const amount = l.toBuy === null ? t("some") : qty(checkable ? l.toBuy : l.need, l.unit === "each" ? "" : l.unit);
  return html`<li class="shop-line">
    ${checkable ? html`<input type="checkbox" data-shop-item="${l.ingredient_id}|${l.unit}" aria-label="${t("Got {item}", { item: l.name })}" />` : ""}
    <span class="mono qty">${l.approx && checkable ? "~" : ""}${amount}</span>
    <span class="grow"><span class="item-name">${l.name}</span>
      <small class="muted block">${t("for {meals}", { meals: l.meals.join(", ") })}${l.have > 0 && checkable ? ` · ${t("you have {amount}", { amount: qty(l.have, l.unit === "each" ? "" : l.unit) })}` : ""}${l.otherUnit && checkable ? ` · ${t("you hold some in a unit that can't be compared — check")}` : ""}</small>
      ${checkable ? packLine(l.pack, l.consumptionCents, l.sharesPack, l.unitClash) : ""}</span>
    ${checkable
      ? html`<span class="hh-line-price mono" title="${l.pack ? t("Checkout price for {pack}", { pack: packText(l.pack) }) : l.sharesPack ? t("Already bought on another line") : t("No pack price known")}">${l.pack ? money(l.pack.costCents) : l.sharesPack ? t("incl.") : "—"}${l.pack ? html`<small>${l.pack.count === null ? t("by weight") : tn(l.pack.count, "{n} pack", "{n} packs")}</small>` : ""}</span>`
      : ""}
  </li>`;
}

// English category names, translated where shown
const categoryTitle = (c: string) => (!c || c === "other" ? t("Everything else") : t(c.charAt(0).toUpperCase() + c.slice(1)));

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
          t("Shopping list"),
          th("What your planned meals need from {from} to {to}, minus what's in your pantry, in whole packs.", {
            from: html`<strong>${weekday(from)} ${shortDate(from)}</strong>`,
            to: `${weekday(to)} ${shortDate(to)}`,
          }),
          html`<nav class="pager" aria-label="${t("Range")}">${RANGES.map(
            (d) => html`<a class="button button-ghost" href="/shopping?days=${d}" ${d === days ? raw('aria-current="page"') : ""}>${t("{n} days", { n: d })}</a>`,
          )}</nav><button class="button button-ghost" type="button" data-print>${t("Print")}</button>`,
        )}
        <dl class="stats">
          <div><dt>${t("Meals planned")}</dt><dd>${list.meals.length}</dd></div>
          <div><dt>${t("To buy")}</dt><dd>${list.toBuy.length}</dd></div>
          <div data-shop-total><dt>${t("At the checkout")}</dt><dd>${money(list.purchaseCents)}${list.unpriced ? html`<small> + ${t("{n} unpriced", { n: list.unpriced })}</small>` : ""}</dd></div>
          <div class="${budget !== null && list.purchaseCents > budget ? "stat-bad" : ""}"><dt>${t("Budget ({n}d)", { n: days })}</dt><dd>${budget === null ? html`<a href="/settings" class="set-link">${t("Set →")}</a>` : money(budget - list.purchaseCents)}${budget !== null ? html`<small> ${t("left")}</small>` : ""}</dd></div>
        </dl>

        ${list.meals.length === 0
          ? empty(t("Nothing planned"), t("Plan meals on your calendar and their ingredients appear here."), html`<a class="button" href="/calendar">${t("Open calendar")}</a>`)
          : html`<div class="split split-wide">
              <div class="side-stack">
                ${list.toBuy.length
                  ? [...groups].map(
                      ([category, lines]) => html`<section class="panel">
                        <h2 class="panel-title">${categoryTitle(category)}</h2>
                        <ul class="shop-list">${lines.map((l) => line(l, true))}</ul>
                      </section>`,
                    )
                  : html`<section class="panel"><p class="empty-title">${t("You have everything.")}</p><p class="muted">${t("Your pantry covers every planned meal in this range.")}</p></section>`}
                ${list.covered.length
                  ? html`<section class="panel">
                      <h2 class="panel-title">${t("Already in your pantry")} <span class="count">${list.covered.length}</span></h2>
                      <ul class="shop-list covered">${list.covered.map((l) => line(l, false))}</ul>
                    </section>`
                  : ""}
              </div>
              <aside class="side-stack">
                <section class="panel shop-totals" aria-labelledby="shop-totals-h">
                  <h2 class="panel-title" id="shop-totals-h">${t("What it costs")}</h2>
                  <dl class="shop-split">
                    <div><dt>${t("At the checkout")}</dt><dd class="mono" data-purchase-cents="${list.purchaseCents}">${money(list.purchaseCents)}</dd><small>${t("whole packs you'd buy")}</small></div>
                    <div><dt>${t("Used by these meals")}</dt><dd class="mono" data-consumption-cents="${list.consumptionCents}">${money(list.consumptionCents)}</dd><small>${t("the share of those packs the recipes use")}</small></div>
                  </dl>
                  <p class="muted small">${t("The difference stays in your kitchen for next time. Your budget is compared against the checkout total.")}${list.unpriced
                    ? ` ${list.unpricedEstCents
                        ? tn(list.unpriced, "{n} item has no pack price, worth about {amount} at reference rates (not included).", "{n} items have no pack price, worth about {amount} at reference rates (not included).", { amount: money(list.unpricedEstCents) })
                        : tn(list.unpriced, "{n} item has no pack price.", "{n} items have no pack price.")}`
                    : ""}</p>
                </section>
                <section class="panel">
                  <h2 class="panel-title">${t("Meals included")}</h2>
                  <ul class="compact-list">${list.meals.map(
                    (m) => html`<li><span class="mono muted w-day">${weekday(m.date)}</span><a class="grow" href="/recipes/${m.recipe_id}">${m.title}</a><span class="muted">${t(m.meal)}</span></li>`,
                  )}</ul>
                </section>
                <section class="panel">
                  <h2 class="panel-title">${t("How it's worked out")}</h2>
                  <p class="muted small">${t("Each meal is scaled to the {n} serves you cook for. Amounts are summed across meals, then what you hold (unexpired, in a comparable unit) is subtracted, and the rest is bought in whole packs: 200 g of flour from an empty pantry is a whole bag.", { n: prefs.default_servings })}
                    ${th("For each item Larder compares the packs it knows: {woolworths} and {aldi} shelf prices{age}, and {paid} when you recorded them on a pantry item. The cheapest pack that covers what you need wins, compared for the same amount, and a price you paid is never replaced by a higher shelf price.", {
                      woolworths: html`<strong>Woolworths</strong>`,
                      aldi: html`<strong>ALDI</strong>`,
                      age: age ? ` ${t("(last read {date})", { date: age.slice(0, 10) })}` : "",
                      paid: html`<strong>${t("prices you paid")}</strong>`,
                    })}
                    ${t("Shelf prices are what the store's website showed when Larder last read them; they aren't live and can change. Ticks are remembered in this browser only.")}</p>
                </section>
                <a class="button button-ghost button-block" href="/calendar#plan">${icon("spark", 16)} ${t("Plan a cheaper week")}</a>
              </aside>
            </div>`}`;
      return htmlReply(page(ctx, { title: t("Shopping list"), active: "shopping", body }));
    },
  },
];
