import { initials } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import type { Ctx } from "../http.ts";

// 20px stroke icons, drawn on a 24 grid so they stay crisp at 1px strokes.
const ICONS: Record<string, string> = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  feed: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  recipes: '<path d="M6 3h11a1 1 0 0 1 1 1v16l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 12h6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  pantry: '<rect x="4" y="3" width="16" height="18"/><path d="M4 12h16M10 7.5h4M10 16.5h4"/>',
  friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
  household: '<path d="M3 20h18M5 20V9l7-5 7 5v11"/><path d="M10 20v-6h4v6"/>',
  planner: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
  live: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>',
  shopping: '<path d="M3 4h2.5l2.2 11h10.6L20.5 7H7"/><circle cx="9" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><rect x="14" y="5" width="4" height="4"/><rect x="8" y="15" width="4" height="4"/>',
  more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  cook: '<path d="M4 11h16v2a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7v-2Z"/><path d="M8 7c0-1.5 1-1.5 1-3M12 7c0-1.5 1-1.5 1-3M16 7c0-1.5 1-1.5 1-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
};

export function icon(name: string, size = 20): Html {
  return raw(
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" aria-hidden="true">${ICONS[name] ?? ""}</svg>`,
  );
}

export function avatar(name: string, size: "sm" | "md" | "lg" = "md"): Html {
  return html`<span class="avatar avatar-${size}" aria-hidden="true">${initials(name)}</span>`;
}

export interface NavItem {
  key: string;
  href: string;
  label: string;
  // set while the section is a preview of a later phase
  phase?: string;
}

// The whole platform's map. Sections still being built carry their phase so
// the sidebar says so; the /more page and the mobile tab bar read this too.
export const NAV_GROUPS: { heading: string | null; items: NavItem[] }[] = [
  {
    heading: null,
    items: [
      { key: "home", href: "/", label: "Home" },
      { key: "feed", href: "/feed", label: "Feed" },
    ],
  },
  {
    heading: "Kitchen",
    items: [
      { key: "pantry", href: "/pantry", label: "Pantry" },
      { key: "recipes", href: "/recipes", label: "Recipes" },
      { key: "calendar", href: "/calendar", label: "Calendar" },
      { key: "shopping", href: "/shopping", label: "Shopping list" },
    ],
  },
  {
    heading: "Together",
    items: [
      { key: "friends", href: "/friends", label: "Friends" },
      { key: "household", href: "/household", label: "Household", phase: "Crit 9" },
      { key: "live", href: "/live", label: "Live cooking", phase: "Crit 9" },
    ],
  },
  {
    heading: "Plan",
    items: [{ key: "planner", href: "/planner", label: "Meal planner", phase: "Crit 10" }],
  },
];

const TABS: NavItem[] = [
  { key: "home", href: "/", label: "Home" },
  { key: "pantry", href: "/pantry", label: "Pantry" },
  { key: "recipes", href: "/recipes", label: "Recipes" },
  { key: "calendar", href: "/calendar", label: "Calendar" },
  { key: "more", href: "/more", label: "More" },
];

interface PageOptions {
  title: string;
  active?: string;
  body: Html;
}

function head(title: string): Html {
  return html`<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · Larder</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" />
    <link rel="stylesheet" href="/assets/app.css" />
    <script src="/assets/app.js" defer></script>
  </head>`;
}

function flash(ctx: Ctx): Html {
  return ctx.flash ? html`<div class="flash" role="status">${ctx.flash}</div>` : html``;
}

function brand(): Html {
  return html`<a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>Larder</a>`;
}

// The signed-in shell: sidebar on wide screens, top bar + bottom tabs on phones.
export function appPage(ctx: Ctx, { title, active, body }: PageOptions): Html {
  const user = ctx.user!;
  const link = (n: NavItem) =>
    html`<a href="${n.href}" class="nav-link ${n.phase ? "nav-soon" : ""}" ${n.key === active ? raw('aria-current="page"') : ""}>${icon(n.key)}<span>${n.label}</span>${n.phase ? html`<small>${n.phase}</small>` : ""}</a>`;
  // on phones, sections without their own tab light up "More"
  const tabActive = TABS.some((t) => t.key === active) ? active : "more";
  const tab = (n: NavItem) =>
    html`<a href="${n.href}" class="nav-link" ${n.key === tabActive ? raw('aria-current="page"') : ""}>${icon(n.key)}<span>${n.label}</span></a>`;
  return html`<html lang="en-AU">
    ${head(title)}
    <body class="app">
      <a class="skip" href="#main">Skip to content</a>
      <aside class="sidebar">
        ${brand()}
        <nav aria-label="Main">
          ${NAV_GROUPS.map(
            (g) => html`${g.heading ? html`<p class="nav-heading">${g.heading}</p>` : ""}${g.items.map(link)}`,
          )}
        </nav>
        <div class="sidebar-foot">
          <a class="me" href="/u/${user.username}">${avatar(user.display_name, "sm")}<span><strong>${user.display_name}</strong><small>@${user.username}</small></span></a>
          <a class="icon-button" href="/settings" title="Settings" aria-label="Settings" ${active === "settings" ? raw('aria-current="page"') : ""}>${icon("settings")}</a>
          <form method="post" action="/logout">
            <button class="icon-button" type="submit" title="Sign out" aria-label="Sign out">${icon("logout")}</button>
          </form>
        </div>
      </aside>
      <header class="topbar">
        ${brand()}
        <a class="me" href="/u/${user.username}" aria-label="Your profile">${avatar(user.display_name, "sm")}</a>
      </header>
      <main id="main" class="main">
        ${flash(ctx)}
        ${body}
      </main>
      <nav class="tabbar" aria-label="Main (mobile)">
        ${TABS.map(tab)}
      </nav>
    </body>
  </html>`;
}

// Signed-out pages: landing, sign in, register, and /readme/ for visitors.
export function publicPage(ctx: Ctx, { title, body }: PageOptions): Html {
  return html`<html lang="en-AU">
    ${head(title)}
    <body class="public">
      <a class="skip" href="#main">Skip to content</a>
      <header class="public-bar">
        ${brand()}
        <nav aria-label="Account">
          <a href="/readme/">About</a>
          <a href="/login">Sign in</a>
          <a class="button button-small" href="/register">Create account</a>
        </nav>
      </header>
      <main id="main" class="public-main">
        ${flash(ctx)}
        ${body}
      </main>
    </body>
  </html>`;
}

export function page(ctx: Ctx, opts: PageOptions): Html {
  return ctx.user ? appPage(ctx, opts) : publicPage(ctx, opts);
}

export function pageHeader(title: string, subtitle?: string | Html, actions?: Html): Html {
  return html`<header class="page-header">
    <div>
      <h1>${title}</h1>
      ${subtitle ? html`<p class="lede">${subtitle}</p>` : ""}
    </div>
    ${actions ? html`<div class="page-actions">${actions}</div>` : ""}
  </header>`;
}

// Banner over every page that shows sample data for a later phase.
export function previewBanner(phase: string, what: string): Html {
  return html`<div class="preview-banner" role="note">
    <span class="badge">${phase}</span>
    <span>Preview with sample data. ${what}</span>
  </div>`;
}

// Secondary tabs inside a section, e.g. Household → Pantry / Calendar.
export function subnav(label: string, items: { href: string; label: string }[], current: string): Html {
  return html`<nav class="subnav" aria-label="${label}">
    ${items.map((i) => html`<a href="${i.href}" ${i.href === current ? raw('aria-current="page"') : ""}>${i.label}</a>`)}
  </nav>`;
}

export function empty(title: string, body: string, action?: Html): Html {
  return html`<div class="empty">
    <p class="empty-title">${title}</p>
    <p>${body}</p>
    ${action ?? ""}
  </div>`;
}

export function errors(list: string[]): Html {
  if (!list.length) return html``;
  return html`<div class="form-errors" role="alert">
    <p>Please fix the following:</p>
    <ul>${list.map((e) => html`<li>${e}</li>`)}</ul>
  </div>`;
}
