import { ago } from "../format.ts";
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
import type { Route } from "../server.ts";
import { avatar, empty, page, pageHeader } from "../views/layout.ts";

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

function friendsPage(ctx: Ctx): Html {
  const me = ctx.user!.id;
  const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 40);
  const all = connections(me);
  const incoming = all.filter((c) => c.status === "pending" && c.requested_by !== me);
  const outgoing = all.filter((c) => c.status === "pending" && c.requested_by === me);
  const friends = all.filter((c) => c.status === "accepted");
  const results = q ? searchPeople(me, q) : [];

  const section = (title: string, list: Connection[], meta: (c: Connection) => string, actions: (c: Connection) => Html) =>
    list.length
      ? html`<section class="panel">
          <h2 class="panel-title">${title} <span class="count">${list.length}</span></h2>
          <ul class="people">${list.map((c) => personRow(c, meta(c), actions(c)))}</ul>
        </section>`
      : "";

  return html`
    ${pageHeader("Friends", "Friends see the recipes and meals you share with them — nobody else does.")}
    <section class="panel">
      <h2 class="panel-title">Find people</h2>
      <form method="get" action="/friends" class="inline-form" role="search">
        <label class="field grow-2"><span>Username or name</span>
          <input type="search" name="q" value="${q}" placeholder="e.g. alice" autocapitalize="none" /></label>
        <button class="button" type="submit">Search</button>
      </form>
      ${q
        ? results.length
          ? html`<ul class="people">${results.map((p) => personRow(p, "", searchActions(ctx, p)))}</ul>`
          : html`<p class="muted">Nobody matches “${q}”.</p>`
        : ""}
    </section>
    ${section("Requests for you", incoming, (c) => `asked ${ago(c.since)}`, (c) =>
      html`${action(c.username, "accept", "Accept", "")}${action(c.username, "remove", "Decline")}`,
    )}
    ${section("Sent", outgoing, (c) => `sent ${ago(c.since)}`, (c) => action(c.username, "remove", "Cancel"))}
    ${friends.length
      ? section("Your friends", friends, (c) => `friends since ${ago(c.since)}`, (c) =>
          action(c.username, "remove", "Remove", "button-ghost", `Remove ${c.display_name} as a friend?`),
        )
      : empty("No friends yet", "Search for someone by username to send a request. Once they accept, you'll see each other's shared recipes and meals.")}`;
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
