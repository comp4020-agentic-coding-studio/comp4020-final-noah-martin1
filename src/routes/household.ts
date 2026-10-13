import { money } from "../format.ts";
import { type Html, html } from "../html.ts";
import { type Ctx, htmlReply } from "../http.ts";
import { BUDGET_TICKER, HOUSE_ACTIVITY, HOUSE_WEEK, HOUSEHOLD, PANTRY_NUDGES, SHARED_PANTRY, SHOPPING_CLAIMS } from "../samples.ts";
import type { Route } from "../server.ts";
import { avatar, icon, page, pageHeader, previewBanner, subnav } from "../views/layout.ts";

// Household section: a shared pantry, calendar and shopping list for people
// who live together. Preview only until crit 9 (CLAUDE.md phase 2, items
// 11–12); every form sits in a disabled fieldset so nothing here pretends to
// save.

const TABS = [
  { href: "/household", label: "Overview" },
  { href: "/household/pantry", label: "Shared pantry" },
  { href: "/household/calendar", label: "House calendar" },
  { href: "/household/shopping", label: "Shared shopping" },
  { href: "/household/members", label: "Members" },
];

function shell(ctx: Ctx, path: string, title: string, body: Html) {
  const header = pageHeader(
    HOUSEHOLD.name,
    html`<span class="avatars">${HOUSEHOLD.members.map((m) => avatar(m.name, "sm"))}</span> ${HOUSEHOLD.members.length} members · shared pantry and calendar`,
    html`<a class="button button-ghost" href="/household/members">Invite</a><a class="button button-ghost" href="/household/new">Switch household</a>`,
  );
  return htmlReply(
    page(ctx, {
      title,
      active: "household",
      body: html`${header}
        ${previewBanner("Crit 9", "Reservations will sync to everyone in the house in under a second, and two people can never reserve the same last unit.")}
        ${subnav("Household", TABS, path)}
        ${body}`,
    }),
  );
}

function reserved(item: (typeof SHARED_PANTRY)[number]): number {
  return item.reservations.reduce((sum, r) => sum + r.quantity, 0);
}

function availability(item: (typeof SHARED_PANTRY)[number]): Html {
  const held = reserved(item);
  const pct = item.quantity ? Math.min(100, Math.round((held / item.quantity) * 100)) : 0;
  return html`<div class="avail">
    <span class="meter" style="--p: ${pct}%"><span></span></span>
    <small class="mono muted">${item.quantity - held}${item.unit ? ` ${item.unit}` : ""} free</small>
  </div>`;
}

function overview(): Html {
  const reservations = SHARED_PANTRY.flatMap((i) => i.reservations.map((r) => ({ ...r, item: i.name, unit: i.unit })));
  const expiring = SHARED_PANTRY.filter((i) => i.state === "soon" || i.state === "expired");
  const tonight = HOUSE_WEEK[2];
  return html`
    <dl class="stats">
      <div><dt>Shared items</dt><dd>${SHARED_PANTRY.length}</dd></div>
      <div><dt>Reservations</dt><dd>${reservations.length}</dd></div>
      <div class="stat-warn"><dt>Use soon</dt><dd>${expiring.length}</dd></div>
      <div><dt>Meals this week</dt><dd>${HOUSE_WEEK.reduce((n, d) => n + d.meals.length, 0)}</dd></div>
    </dl>
    <div class="dash">
      <section class="panel">
        <header class="panel-head"><h2 class="panel-title">Tonight</h2><a href="/household/calendar">Calendar →</a></header>
        <ul class="compact-list">
          ${tonight.meals.map(
            (m) => html`<li>${avatar(m.cook === "You" ? "You" : m.cook, "sm")}<span class="grow"><strong>${m.cook}</strong> ${m.cook === "You" ? "are" : "is"} cooking ${m.title}</span><span class="muted">${m.eating} eating</span></li>`,
          )}
        </ul>
        <fieldset disabled class="bare"><button class="button button-ghost button-block" type="button">I'll eat tonight</button></fieldset>
      </section>
      <section class="panel">
        <header class="panel-head"><h2 class="panel-title">Live reservations</h2><a href="/household/pantry">Pantry →</a></header>
        <ul class="compact-list">
          ${reservations.map(
            (r) => html`<li><span class="mono qty">${r.quantity}${r.unit ? ` ${r.unit}` : ""}</span><span class="grow">${r.item}<small class="muted block">${r.who} · ${r.forMeal}</small></span></li>`,
          )}
        </ul>
      </section>
      <section class="panel">
        <header class="panel-head"><h2 class="panel-title">Use soon · claim it</h2></header>
        <ul class="compact-list">
          ${expiring.map(
            (i) => html`<li><span class="grow">${i.name}</span><span class="pill pill-${i.state}">${i.expires}</span><fieldset disabled class="bare inline"><button class="button button-small button-ghost" type="button">Use tonight</button></fieldset></li>`,
          )}
        </ul>
        <p class="hint">First to start cooking with it locks it — everyone else sees that live.</p>
      </section>
      <section class="panel dash-wide">
        <header class="panel-head"><h2 class="panel-title">House activity</h2></header>
        <ul class="feed">
          ${HOUSE_ACTIVITY.map(
            (a) => html`<li class="feed-item">${avatar(a.who, "sm")}<p class="grow"><strong>${a.who}</strong> ${a.what} <span class="muted">· ${a.when}</span></p></li>`,
          )}
          ${PANTRY_NUDGES.map(
            (n) => html`<li class="feed-item">${avatar(n.who, "sm")}<p class="grow"><strong>${n.who}</strong> ${n.what} <span class="muted">· ${n.when}</span></p></li>`,
          )}
        </ul>
      </section>
    </div>`;
}

function sharedPantry(): Html {
  return html`
    <section class="panel">
      <h2 class="panel-title">Add to the house pantry</h2>
      <fieldset disabled class="bare">
        <form class="inline-form">
          <label class="field grow-2"><span>Item</span><input placeholder="e.g. eggs" /></label>
          <label class="field"><span>Qty</span><input placeholder="12" /></label>
          <label class="field"><span>Unit</span><input placeholder="g, ml, pack" /></label>
          <label class="field"><span>Expires</span><input type="date" /></label>
          <label class="field"><span>Price paid</span><span class="input-prefix"><span>$</span><input placeholder="0.00" /></span></label>
          <button class="button" type="button">${icon("plus", 16)} Add</button>
        </form>
      </fieldset>
    </section>
    <section class="panel panel-flush">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th scope="col">Item</th><th scope="col" class="num">Qty</th><th scope="col">Reserved by</th><th scope="col">Available</th><th scope="col">Expiry</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            ${SHARED_PANTRY.map(
              (i) => html`<tr class="row-${i.state}">
                <td><span class="item-name">${i.name}</span><small class="muted">added by ${i.addedBy} · ${i.price}</small></td>
                <td class="num mono">${i.quantity}${i.unit ? ` ${i.unit}` : ""}</td>
                <td>${i.reservations.length
                  ? html`<ul class="reservations">${i.reservations.map((r) => html`<li><strong>${r.who}</strong> <span class="mono">${r.quantity}${i.unit ? ` ${i.unit}` : ""}</span> <small class="muted">${r.forMeal}</small></li>`)}</ul>`
                  : html`<span class="muted">—</span>`}</td>
                <td>${availability(i)}</td>
                <td><span class="pill pill-${i.state}">${i.expires}</span></td>
                <td class="row-actions"><fieldset disabled class="bare inline"><button class="button button-small button-ghost" type="button">Reserve</button></fieldset></td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
    </section>
    <p class="hint">Reserving holds a quantity for a planned meal. If two people try to take the last unit at once, exactly one succeeds and the other sees it go instantly.</p>`;
}

function sharedShopping(): Html {
  const spentPct = Math.min(100, Math.round((BUDGET_TICKER.spentCents / BUDGET_TICKER.budgetCents) * 100));
  return html`
    <section class="panel">
      <header class="panel-head"><h2 class="panel-title">${BUDGET_TICKER.label}</h2></header>
      <div class="budget">
        <span class="meter ${spentPct > 100 ? "meter-over" : ""}" style="--p: ${spentPct}%"><span></span></span>
        <small class="muted">${money(BUDGET_TICKER.spentCents)} claimed of ${money(BUDGET_TICKER.budgetCents)} budget</small>
      </div>
      <p class="hint">Updates live as housemates claim items, so nobody overspends without seeing it coming.</p>
    </section>
    <section class="panel panel-flush">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th scope="col">Item</th><th scope="col">For</th><th scope="col" class="num">Est.</th><th scope="col">Claimed by</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            ${SHOPPING_CLAIMS.map(
              (c) => html`<tr>
                <td><span class="item-name">${c.item}</span></td>
                <td class="muted">${c.forMeal}</td>
                <td class="num mono">${c.estPrice}</td>
                <td>${c.claimedBy ? html`<span class="badge">${c.claimedBy}</span>` : html`<span class="muted">Unclaimed</span>`}</td>
                <td class="row-actions">
                  <fieldset disabled class="bare inline">
                    <button class="button button-small ${c.claimedBy ? "button-ghost" : ""}" type="button">${c.claimedBy ? "Unclaim" : "I've got this"}</button>
                  </fieldset>
                </td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
    </section>
    <p class="hint">Claiming an item hides the "I've got this" button for everyone else instantly, so two people don't buy the same thing.</p>`;
}

function houseCalendar(): Html {
  return html`
    <div class="week">
      ${HOUSE_WEEK.map(
        (d) => html`<section class="day ${d.day === "Wed" ? "day-today" : ""}" aria-label="${d.day} ${d.date}">
          <header class="day-head"><span class="day-name">${d.day}</span><span class="day-date mono">${d.date}</span></header>
          <div class="day-body">
            ${d.meals.length
              ? d.meals.map(
                  (m) => html`<div class="meal meal-${m.status ?? "planned"}">
                    <span class="meal-kind">${m.meal}</span>
                    <span class="meal-title">${m.title}</span>
                    <span class="meal-meta">${avatar(m.cook, "sm")} ${m.cook} · ${m.eating} eating</span>
                  </div>`,
                )
              : html`<fieldset disabled class="bare"><button class="claim" type="button">${icon("plus", 16)} I'll cook</button></fieldset>`}
          </div>
        </section>`,
      )}
    </div>
    <p class="hint">Claiming a night says who's cooking; housemates mark whether they're eating so the cook knows how much to make.</p>`;
}

function members(): Html {
  return html`
    <div class="split">
      <section class="panel">
        <h2 class="panel-title">Members</h2>
        <ul class="people">
          ${HOUSEHOLD.members.map(
            (m) => html`<li class="person">${avatar(m.name)}<div class="grow"><a class="person-name" href="/u/${m.username}">${m.name}</a><small class="muted">@${m.username} · joined ${m.joined}</small></div>
              <span class="badge">${m.role}</span></li>`,
          )}
        </ul>
      </section>
      <section class="panel stack">
        <h2 class="panel-title">Invite a housemate</h2>
        <fieldset disabled class="bare stack">
          <label class="field"><span>Username</span><input placeholder="e.g. bo" /></label>
          <button class="button" type="button">Send invite</button>
        </fieldset>
        <div>
          <h3 class="micro">Pending</h3>
          <ul class="compact-list">${HOUSEHOLD.invites.map((i) => html`<li><span class="grow">@${i.username}</span><span class="muted">sent ${i.sent}</span></li>`)}</ul>
        </div>
        <hr />
        <fieldset disabled class="bare"><button class="button button-danger button-block" type="button">Leave household</button></fieldset>
      </section>
    </div>`;
}

function create(ctx: Ctx) {
  return htmlReply(
    page(ctx, {
      title: "Start or join a household",
      active: "household",
      body: html`
        ${pageHeader("Start or join a household", "A household shares one pantry and one meal calendar. You can belong to one at a time.")}
        ${previewBanner("Crit 9", "Creating and joining households arrives with the shared pantry.")}
        <div class="split">
          <section class="panel stack">
            <h2 class="panel-title">Start a household</h2>
            <p class="muted">You'll be its owner and can invite housemates by username.</p>
            <fieldset disabled class="bare stack">
              <label class="field"><span>Household name</span><input placeholder="e.g. 12 Example St" /></label>
              <label class="check-inline"><input type="checkbox" checked /> <span>Move my pantry items into the shared pantry</span></label>
              <button class="button" type="button">Create household</button>
            </fieldset>
          </section>
          <section class="panel stack">
            <h2 class="panel-title">Join with an invite</h2>
            <p class="muted">Invites from housemates appear here.</p>
            <ul class="people">
              <li class="person">${avatar("Alice Ng")}<div class="grow"><strong>${HOUSEHOLD.name}</strong><small class="muted">invited by Alice Ng · 2d ago</small></div>
                <fieldset disabled class="bare inline"><button class="button button-small" type="button">Join</button></fieldset></li>
            </ul>
          </section>
        </div>`,
    }),
  );
}

export const routes: Route[] = [
  { method: "GET", path: "/household", auth: true, handler: (ctx) => shell(ctx, "/household", "Household", overview()) },
  { method: "GET", path: "/household/pantry", auth: true, handler: (ctx) => shell(ctx, "/household/pantry", "Shared pantry", sharedPantry()) },
  { method: "GET", path: "/household/calendar", auth: true, handler: (ctx) => shell(ctx, "/household/calendar", "House calendar", houseCalendar()) },
  { method: "GET", path: "/household/shopping", auth: true, handler: (ctx) => shell(ctx, "/household/shopping", "Shared shopping", sharedShopping()) },
  { method: "GET", path: "/household/members", auth: true, handler: (ctx) => shell(ctx, "/household/members", "Members", members()) },
  { method: "GET", path: "/household/new", auth: true, handler: create },
];
