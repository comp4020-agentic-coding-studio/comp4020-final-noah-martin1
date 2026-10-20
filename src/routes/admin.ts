import { ACTION_LABEL, type ActivityRow, recentActivity } from "../activity.ts";
import { type Html, html, raw } from "../html.ts";
import { type Ctx, HttpError, htmlReply, json } from "../http.ts";
import type { Route } from "../server.ts";
import { page, pageHeader } from "../views/layout.ts";

// The operator's view of who did what, updating as it happens: what the
// cook narrates from at the crit. Only accounts named in ADMIN_USERNAMES
// (a Fly secret or env var) may see it; anyone else gets a 404, so the page
// doesn't advertise itself.

function admins(): Set<string> {
  return new Set((process.env.ADMIN_USERNAMES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

function requireAdmin(ctx: Ctx): void {
  if (!ctx.user || !admins().has(ctx.user.username.toLowerCase())) throw new HttpError(404, "There's nothing at this address.");
}

function rowJson(a: ActivityRow) {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(a.detail);
  } catch {
    // stored as written; never fails the feed
  }
  return { id: a.id, at: a.at, who: a.username ?? "system", action: a.action, label: ACTION_LABEL[a.action] ?? a.action, outcome: a.outcome, subject: a.subject, detail };
}

function row(a: ReturnType<typeof rowJson>): Html {
  const facts = Object.entries(a.detail).filter(([, v]) => v !== null && v !== false && v !== "").map(([k, v]) => `${k}=${v}`).join(" ");
  return html`<li class="act-row act-${a.outcome}" data-id="${a.id}">
    <time class="mono" datetime="${a.at}">${a.at.slice(11, 19)}</time>
    <span class="act-who">${a.who}</span>
    <span class="act-what">${a.label}${a.subject ? html` <strong>${a.subject}</strong>` : ""}${a.outcome !== "ok" ? html` <span class="pill pill-${a.outcome === "failed" ? "expired" : "soon"}">${a.outcome}</span>` : ""}</span>
    <code class="act-facts">${a.action}${facts ? ` ${facts}` : ""}</code>
  </li>`;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/admin/activity",
    auth: true,
    handler: (ctx) => {
      requireAdmin(ctx);
      const rows = recentActivity(100).map(rowJson);
      const body = html`
        ${pageHeader("Activity", "Who did what, as the server recorded it. New entries appear as they happen.")}
        <section class="panel panel-flush">
          <ol class="act-list" data-activity data-since="${rows.at(-1)?.id ?? 0}" aria-live="polite">${rows.map(row)}</ol>
        </section>
        <p class="muted small">Also in <code>fly logs</code> (one JSON line per event) and <code>node scripts/activity.ts --follow</code>.</p>
        <script type="module">${raw(`
          const list = document.querySelector("[data-activity]");
          let since = Number(list.dataset.since) || 0;
          const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
          async function tick() {
            try {
              const res = await fetch("/admin/activity.json?since=" + since, { headers: { accept: "application/json" } });
              if (res.ok) {
                const { rows } = await res.json();
                for (const a of rows) {
                  const facts = Object.entries(a.detail).filter(([, v]) => v !== null && v !== false && v !== "").map(([k, v]) => k + "=" + v).join(" ");
                  const li = document.createElement("li");
                  li.className = "act-row act-" + esc(a.outcome) + " act-new";
                  li.dataset.id = a.id;
                  li.innerHTML = '<time class="mono">' + esc(a.at.slice(11, 19)) + '</time><span class="act-who">' + esc(a.who) + '</span><span class="act-what">' + esc(a.label) + (a.subject ? " <strong>" + esc(a.subject) + "</strong>" : "") + (a.outcome !== "ok" ? ' <span class="pill">' + esc(a.outcome) + "</span>" : "") + '</span><code class="act-facts">' + esc(a.action) + (facts ? " " + esc(facts) : "") + "</code>";
                  list.append(li);
                  since = a.id;
                }
                if (rows.length) list.lastElementChild?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
              }
            } catch {}
            setTimeout(tick, 1000);
          }
          tick();
        `)}</script>`;
      return htmlReply(page(ctx, { title: "Activity", body }));
    },
  },
  {
    method: "GET",
    path: "/admin/activity.json",
    auth: true,
    handler: (ctx) => {
      requireAdmin(ctx);
      const since = Number(ctx.url.searchParams.get("since"));
      return json({ rows: recentActivity(200, Number.isSafeInteger(since) && since > 0 ? since : 0).map(rowJson) });
    },
  },
];
