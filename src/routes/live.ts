import { type Html, html, raw } from "../html.ts";
import { type Ctx, HttpError, htmlReply } from "../http.ts";
import { type SampleSession, SESSIONS } from "../samples.ts";
import type { Route } from "../server.ts";
import { avatar, icon, page, pageHeader, previewBanner } from "../views/layout.ts";

// Live cooking: who's cooking right now, a session's detail, and cooking
// along with a friend. Preview only until crit 9 (CLAUDE.md phase 2, item 13).

const REACTIONS = ["🔥", "😋", "👏", "👀"];

function firstName(name: string): string {
  return name.split(" ")[0];
}

function progress(s: SampleSession): Html {
  const pct = Math.round((s.step / s.steps.length) * 100);
  return html`<span class="progress" style="--p: ${pct}%" role="img" aria-label="Step ${s.step} of ${s.steps.length}"><span></span></span>`;
}

export function livePreviewCard(): Html {
  return html`<section class="panel live-card">
    <header class="panel-head"><h2 class="panel-title"><span class="live-dot" aria-hidden="true"></span> Live now</h2><a href="/live">All →</a></header>
    <ul class="compact-list">
      ${SESSIONS.slice(0, 2).map(
        (s) => html`<li>${avatar(s.cook, "sm")}<a class="grow" href="/live/${s.id}"><strong>${firstName(s.cook)}</strong> is cooking ${s.recipe}</a><span class="mono muted">${s.step}/${s.steps.length}</span></li>`,
      )}
    </ul>
    <p class="hint">Sample data — live cooking arrives in crit 9.</p>
  </section>`;
}

function sessionFor(ctx: Ctx): SampleSession {
  const s = SESSIONS.find((x) => x.id === Number(ctx.params.id));
  if (!s) throw new HttpError(404, "That cooking session has ended or never existed.");
  return s;
}

function stepList(s: SampleSession, current: number, cls = ""): Html {
  return html`<ol class="steps live-steps ${cls}">
    ${s.steps.map(
      (text, i) => html`<li class="${i + 1 < current ? "done" : i + 1 === current ? "current" : ""}">
        <span class="step-index mono">${String(i + 1).padStart(2, "0")}</span><p>${text}</p>
        ${i + 1 === current ? html`<span class="pill pill-soon">Now</span>` : ""}
      </li>`,
    )}
  </ol>`;
}

function reactionsPanel(s: SampleSession): Html {
  return html`<section class="panel">
    <h2 class="panel-title">Reactions</h2>
    <fieldset disabled class="bare">
      <div class="reaction-bar">${REACTIONS.map((e) => html`<button class="reaction" type="button" aria-label="React ${e}">${e}</button>`)}</div>
      <form class="inline-form message-form">
        <label class="field grow-2"><span class="sr-only">Message</span><input placeholder="Say something to ${firstName(s.cook)}…" /></label>
        <button class="button button-ghost" type="button">Send</button>
      </form>
    </fieldset>
    ${s.reactions.length
      ? html`<ul class="feed reactions-list">${s.reactions.map(
          (r) => html`<li class="feed-item">${avatar(r.who, "sm")}<p class="grow"><strong>${r.who}</strong> <span class="emoji">${r.emoji}</span> ${r.text ?? ""} <span class="muted">· ${r.when}</span></p></li>`,
        )}</ul>`
      : html`<p class="muted">No reactions yet.</p>`}
  </section>`;
}

function listPage(): Html {
  return html`
    ${pageHeader("Live cooking", "Friends cooking right now. Follow along, react, or cook the same recipe with them.", html`<a class="button" href="/recipes">${icon("cook", 16)} Cook something</a>`)}
    ${previewBanner("Crit 9", "Sessions will appear and advance in under a second over WebSockets, and only friends can see them.")}
    <div class="live-index">
      ${SESSIONS.map(
        (s) => html`<a class="card live-tile" href="/live/${s.id}">
          <div class="card-top"><span class="live-tag"><span class="live-dot" aria-hidden="true"></span> Live</span><span class="muted mono">${s.started}</span></div>
          <div class="live-tile-who">${avatar(s.cook)}<div><strong>${firstName(s.cook)} is cooking</strong><span class="h-md">${s.recipe}</span></div></div>
          <div class="live-tile-step"><span class="mono">Step ${s.step}/${s.steps.length}</span>${progress(s)}</div>
          <p class="clamp muted">${s.steps[s.step - 1]}</p>
          <footer class="card-foot"><span class="muted">Cooking for ${s.serves}</span><span class="muted">${s.watchers.length ? `${s.watchers.length} watching` : "No one watching yet"}</span></footer>
        </a>`,
      )}
    </div>
    <section class="panel how">
      <h2 class="panel-title">How it works</h2>
      <ol class="how-steps">
        <li><strong>Start cooking</strong> any recipe from its page or your calendar.</li>
        <li><strong>Go live</strong> and friends see “you're cooking X” in their feed.</li>
        <li><strong>Advance steps</strong> as you go; watchers see your progress instantly.</li>
        <li><strong>Cook along</strong> — friends follow the same recipe at their own pace beside yours.</li>
      </ol>
    </section>`;
}

function sessionPage(s: SampleSession): Html {
  return html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/live">Live cooking</a><span>/</span><span>${s.cook}</span></nav>
    <header class="page-header">
      <div>
        <p class="eyebrow"><span class="live-tag"><span class="live-dot" aria-hidden="true"></span> Live · started ${s.started}</span></p>
        <h1>${firstName(s.cook)} is cooking ${s.recipe}</h1>
        <p class="byline">${avatar(s.cook, "sm")} <a href="/u/${s.username}">${s.cook}</a> · cooking for ${s.serves} (×${s.scale} recipe)</p>
      </div>
      <div class="page-actions">
        <a class="button" href="/live/${s.id}/along">${icon("friends", 16)} Cook with ${firstName(s.cook)}</a>
      </div>
    </header>
    ${previewBanner("Crit 9", "This page will follow the cook's progress live, with no refresh.")}
    <dl class="stats">
      <div><dt>Step</dt><dd>${s.step} / ${s.steps.length}</dd></div>
      <div><dt>Started</dt><dd>${s.started.replace(" ago", "")}</dd></div>
      <div><dt>Watching</dt><dd>${s.watchers.length}</dd></div>
      <div><dt>Scale</dt><dd>×${s.scale}</dd></div>
    </dl>
    <div class="live-session">
      <section class="panel">
        <h2 class="panel-title">Quantities for ${s.serves}</h2>
        <ul class="ingredient-list">${s.ingredients.map(([q, n]) => html`<li><span class="mono qty">${q}</span><span class="grow">${n}</span></li>`)}</ul>
      </section>
      <section class="panel">
        <header class="panel-head"><h2 class="panel-title">Method</h2>${progress(s)}</header>
        ${stepList(s, s.step)}
      </section>
      <aside class="side-stack">
        <section class="panel">
          <h2 class="panel-title">Watching</h2>
          ${s.watchers.length
            ? html`<ul class="compact-list">${s.watchers.map((w) => html`<li>${avatar(w, "sm")}<span class="grow">${w}</span></li>`)}</ul>`
            : html`<p class="muted">Nobody yet.</p>`}
        </section>
        ${reactionsPanel(s)}
      </aside>
    </div>`;
}

// Cooking along: your own progress beside the friend's. Your step controls
// work now (in the browser only); syncing with the friend lands in crit 9.
function alongPage(s: SampleSession): Html {
  return html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/live">Live cooking</a><span>/</span><a href="/live/${s.id}">${s.cook}</a><span>/</span><span>Cook along</span></nav>
    ${pageHeader(`Cooking ${s.recipe} with ${firstName(s.cook)}`, "Go at your own pace — you'll see each other's step.", html`<a class="button button-ghost" href="/live/${s.id}">Leave</a>`)}
    ${previewBanner("Crit 9", `Your steps work now; ${firstName(s.cook)}'s side will update live once sessions sync.`)}
    <div class="along" data-cook-mode data-steps="${s.steps.length}">
      <section class="panel along-them">
        <header class="panel-head"><h2 class="panel-title">${avatar(s.cook, "sm")} ${firstName(s.cook)} · step ${s.step}/${s.steps.length}</h2>${progress(s)}</header>
        ${stepList(s, s.step, "compact")}
      </section>
      <section class="panel along-you">
        <header class="panel-head"><h2 class="panel-title">You · step <span data-step-label>1</span>/${s.steps.length}</h2></header>
        <ol class="cook-steps">
          ${s.steps.map(
            (text, i) => html`<li data-step="${i + 1}" ${i === 0 ? raw('class="current"') : ""}>
              <span class="step-index mono">${String(i + 1).padStart(2, "0")}</span><p>${text}</p>
            </li>`,
          )}
        </ol>
        <div class="cook-controls">
          <button class="button button-ghost" type="button" data-step-prev>← Back</button>
          <button class="button" type="button" data-step-next>Next step →</button>
        </div>
        <p class="hint">Tip: use ← and → keys.</p>
      </section>
    </div>`;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/live",
    auth: true,
    handler: (ctx) => htmlReply(page(ctx, { title: "Live cooking", active: "live", body: listPage() })),
  },
  {
    method: "GET",
    path: "/live/:id",
    auth: true,
    handler: (ctx) => {
      const s = sessionFor(ctx);
      return htmlReply(page(ctx, { title: `${firstName(s.cook)} is cooking`, active: "live", body: sessionPage(s) }));
    },
  },
  {
    method: "GET",
    path: "/live/:id/along",
    auth: true,
    handler: (ctx) => {
      const s = sessionFor(ctx);
      return htmlReply(page(ctx, { title: `Cook with ${firstName(s.cook)}`, active: "live", body: alongPage(s) }));
    },
  },
];
