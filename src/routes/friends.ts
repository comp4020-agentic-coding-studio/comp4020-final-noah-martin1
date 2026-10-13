import { addDays, ago, today } from "../format.ts";
import { type Html, html } from "../html.ts";
import { type Ctx, HttpError, htmlReply, redirect, setFlash } from "../http.ts";
import {
  acceptFriend,
  type Connection,
  connections,
  findUser,
  friendship,
  type Person,
  removeFriendship,
  requestFriend,
  searchPeople,
} from "../friends.ts";
import { listVisibleRecipes } from "../recipes.ts";
import type { Route } from "../server.ts";
import { avatar, empty, icon, page, pageHeader } from "../views/layout.ts";
import { friendMeals } from "./calendar.ts";
import { feedItem, friendFeed } from "./home.ts";

function action(username: string, verb: string, label: string, kind = "button-ghost", confirm?: string): Html {
  return html`<form method="post" action="/friends/${username}/${verb}" ${confirm ? html`data-confirm="${confirm}"` : ""}>
    <button class="button button-small ${kind}" type="submit">${label}</button>
  </form>`;
}

function personRow(p: Person, meta: Html | string, actions: Html): Html {
  return html`<li class="person">
    ${avatar(p.display_name)}
    <div class="grow">
      <a href="/u/${p.username}" class="person-name">${p.display_name}</a>
      <small class="muted">@${p.username} · ${meta}</small>
    </div>
    <div class="person-actions">${actions}</div>
  </li>`;
}

function searchActions(ctx: Ctx, p: Person): Html {
  const f = friendship(ctx.user!.id, p.id);
  if (!f) return action(p.username, "request", "Add friend", "");
  if (f.status === "accepted") return html`<span class="pill pill-fresh">Friends</span>`;
  if (f.requested_by === ctx.user!.id) return html`<span class="pill pill-none">Requested</span>`;
  return action(p.username, "accept", "Accept", "");
}

// Friends is a whole place on its own: what friends are, finding people,
// requests, and what your friends are sharing, all on one page (the old feed
// lives here now).
function friendsPage(ctx: Ctx): Html {
  const me = ctx.user!.id;
  const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 40);
  const all = connections(me);
  const incoming = all.filter((c) => c.status === "pending" && c.requested_by !== me);
  const outgoing = all.filter((c) => c.status === "pending" && c.requested_by === me);
  const friends = all.filter((c) => c.status === "accepted");
  const results = q ? searchPeople(me, q) : [];
  const feed = friendFeed(me, 30);
  // what each friend has coming up this week, for the "Your friends" list
  const week = friendMeals(me, friends.map((f) => f.id), today(), addDays(today(), 6));
  const plannedBy = new Map<number, number>();
  for (const m of week) plannedBy.set(m.owner_id, (plannedBy.get(m.owner_id) ?? 0) + 1);
  const sharedBy = new Map<number, number>();
  if (friends.length) {
    for (const r of listVisibleRecipes(me, { authorIds: friends.map((f) => f.id), limit: 200 })) {
      sharedBy.set(r.author_id, (sharedBy.get(r.author_id) ?? 0) + 1);
    }
  }

  const section = (title: string, list: Connection[], meta: (c: Connection) => string, actions: (c: Connection) => Html, cls = "") =>
    list.length
      ? html`<section class="panel ${cls}">
          <h2 class="panel-title">${title} <span class="count">${list.length}</span></h2>
          <ul class="people">${list.map((c) => personRow(c, meta(c), actions(c)))}</ul>
        </section>`
      : "";

  const friendMeta = (c: Connection) => {
    const bits = [];
    const r = sharedBy.get(c.id) ?? 0;
    const m = plannedBy.get(c.id) ?? 0;
    if (r) bits.push(`${r} recipe${r === 1 ? "" : "s"}`);
    if (m) bits.push(`${m} meal${m === 1 ? "" : "s"} this week`);
    return bits.length ? bits.join(" · ") : `friends since ${ago(c.since)}`;
  };

  return html`
    ${pageHeader("Friends", "Cook with the people you know. Friends see what you choose to share with them, and nobody else does.")}

    ${!friends.length
      ? html`<section class="fr-how" aria-label="How friends work">
          <div class="fr-step"><span class="fr-step-n">1</span>${icon("search", 20)}<h3>Find someone</h3><p>Search by username or name below and send a request.</p></div>
          <div class="fr-step"><span class="fr-step-n">2</span>${icon("check", 20)}<h3>They accept</h3><p>A friendship only starts once both of you agree. Either of you can end it any time.</p></div>
          <div class="fr-step"><span class="fr-step-n">3</span>${icon("calendar", 20)}<h3>Share as you like</h3><p>Friends-only recipes and the meals you mark shared show up for them here, on their calendar overlay and first on the live globe.</p></div>
        </section>`
      : ""}

    <div class="fr-layout">
      <div class="fr-main">
        ${section("Requests for you", incoming, (c) => `asked ${ago(c.since)}`, (c) =>
          html`${action(c.username, "accept", "Accept", "")}${action(c.username, "remove", "Decline")}`, "fr-requests",
        )}
        <section class="panel" id="activity" aria-labelledby="activity-h">
          <header class="panel-head">
            <h2 class="panel-title" id="activity-h">What friends are sharing</h2>
            ${friends.length ? html`<a href="/calendar?with=${friends.map((f) => f.username).join(",")}">See their week on your calendar →</a>` : ""}
          </header>
          ${feed.length
            ? html`<ul class="feed">${feed.map(feedItem)}</ul>`
            : friends.length
              ? empty("Quiet for now", "When friends share a recipe or plan a shared meal, it shows up here.")
              : empty("Nothing here yet", "Add a friend and their shared recipes and planned meals will appear here, newest first.")}
        </section>
      </div>

      <aside class="fr-side">
        <section class="panel">
          <h2 class="panel-title">Find people</h2>
          <form method="get" action="/friends" class="fr-search" role="search">
            <label class="sr-only" for="fr-q">Username or name</label>
            ${icon("search", 16)}
            <input id="fr-q" type="search" name="q" value="${q}" placeholder="Username or name" autocapitalize="none" />
            <button class="button button-small" type="submit">Search</button>
          </form>
          ${q
            ? results.length
              ? html`<ul class="people">${results.map((p) => personRow(p, "", searchActions(ctx, p)))}</ul>`
              : html`<p class="muted small fr-none">Nobody matches “${q}”. Usernames are lowercase, like <span class="mono">alice</span>.</p>`
            : ""}
        </section>
        ${friends.length
          ? section("Your friends", friends, friendMeta, (c) =>
              action(c.username, "remove", "Remove", "button-ghost", `Remove ${c.display_name} as a friend?`),
            )
          : ""}
        ${section("Sent", outgoing, (c) => `sent ${ago(c.since)}`, (c) => action(c.username, "remove", "Cancel"))}
        <section class="panel fr-privacy">
          <h2 class="panel-title">What friends can see</h2>
          <ul class="fr-list">
            <li>${icon("check", 14)} Recipes you mark <strong>Friends</strong> or <strong>Public</strong></li>
            <li>${icon("check", 14)} Calendar meals you mark <strong>Shared</strong></li>
            <li>${icon("check", 14)} When you cook live, you appear first on their globe</li>
            <li class="fr-no">${icon("close", 14)} Never your pantry, prices or private recipes</li>
          </ul>
        </section>
      </aside>
    </div>`;
}

function target(ctx: Ctx): Person {
  const p = findUser(ctx.params.username ?? "");
  if (!p) throw new HttpError(404, "There's nobody with that username.");
  return p;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/friends",
    auth: true,
    handler: (ctx) => htmlReply(page(ctx, { title: "Friends", active: "friends", body: friendsPage(ctx) })),
  },
  {
    method: "POST",
    path: "/friends/:username/request",
    auth: true,
    handler: (ctx) => {
      const p = target(ctx);
      const outcome = requestFriend(ctx.user!.id, p.id);
      const messages = {
        sent: `Friend request sent to ${p.display_name}.`,
        accepted: `You and ${p.display_name} are now friends.`,
        "already-friends": `You're already friends with ${p.display_name}.`,
        "already-sent": `You've already asked ${p.display_name}.`,
        self: "You can't friend yourself.",
      };
      setFlash(ctx, messages[outcome]);
      return redirect("/friends");
    },
  },
  {
    method: "POST",
    path: "/friends/:username/accept",
    auth: true,
    handler: (ctx) => {
      const p = target(ctx);
      if (!acceptFriend(ctx.user!.id, p.id)) {
        throw new HttpError(403, "There's no request from that person for you to accept.");
      }
      setFlash(ctx, `You and ${p.display_name} are now friends.`);
      return redirect("/friends");
    },
  },
  {
    method: "POST",
    path: "/friends/:username/remove",
    auth: true,
    handler: (ctx) => {
      const p = target(ctx);
      removeFriendship(ctx.user!.id, p.id);
      return redirect("/friends");
    },
  },
];
