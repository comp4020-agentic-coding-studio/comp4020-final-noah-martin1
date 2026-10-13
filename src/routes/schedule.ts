import { type Html, html } from "../html.ts";
import { type Ctx, htmlReply } from "../http.ts";
import { DRAFT_RECIPE, SCHEDULE_PRESENCE, SCHEDULE_WEEK } from "../samples.ts";
import type { Route } from "../server.ts";
import { avatar, icon, page, pageHeader, previewBanner } from "../views/layout.ts";

// Friends & family schedule: a shared meal calendar where everyone sees who's
// looking at and picking which night live, plus a friend's in-progress
// recipe draft that others can watch and comment on before it's published.
// Preview only until crit 9 (CLAUDE.md phase 2).

function presenceBar(): Html {
  return html`<p class="hint presence-bar">
    ${SCHEDULE_PRESENCE.map((p) => html`<span class="pill pill-soon">${avatar(p.who, "sm")} ${p.who} is looking at ${p.lookingAt}</span>`)}
  </p>`;
}

function sharedCalendar(): Html {
  return html`
    <section class="panel">
      <header class="panel-head"><h2 class="panel-title">This week</h2></header>
      ${presenceBar()}
      <div class="week">
        ${SCHEDULE_WEEK.map(
          (d) => html`<section class="day" aria-label="${d.day} ${d.date}">
            <header class="day-head"><span class="day-name">${d.day}</span><span class="day-date mono">${d.date}</span></header>
            <div class="day-body">
              ${d.meals.length
                ? d.meals.map(
                    (m) => html`<div class="meal meal-planned">
                      <span class="meal-kind">${m.meal}</span>
                      <span class="meal-title">${m.title}</span>
                      <span class="meal-meta">${avatar(m.cook, "sm")} ${m.cook}</span>
                    </div>`,
                  )
                : html`<fieldset disabled class="bare"><button class="claim" type="button">${icon("plus", 16)} I'll cook</button></fieldset>`}
            </div>
          </section>`,
        )}
      </div>
      <p class="hint">Picking a night updates for everyone instantly, so two people don't claim the same one.</p>
    </section>`;
}

function draftRecipe(): Html {
  return html`
    <section class="panel">
      <header class="panel-head">
        <h2 class="panel-title">${avatar(DRAFT_RECIPE.author, "sm")} ${DRAFT_RECIPE.author} is drafting a recipe</h2>
        <span class="muted">${DRAFT_RECIPE.watching.length} watching</span>
      </header>
      <h3>${DRAFT_RECIPE.title}</h3>
      <ol class="steps live-steps compact">
        ${DRAFT_RECIPE.steps.map(
          (text, i) => html`<li>
            <span class="step-index mono">${String(i + 1).padStart(2, "0")}</span><p class="grow">${text}</p>
            ${DRAFT_RECIPE.comments.filter((c) => c.onStep === i + 1).length
              ? html`<span class="pill pill-soon">${DRAFT_RECIPE.comments.filter((c) => c.onStep === i + 1).length} comment${DRAFT_RECIPE.comments.filter((c) => c.onStep === i + 1).length === 1 ? "" : "s"}</span>`
              : ""}
          </li>`,
        )}
      </ol>
      <fieldset disabled class="bare">
        <form class="inline-form message-form">
          <label class="field grow-2"><span class="sr-only">Comment</span><input placeholder="Leave a comment on a step…" /></label>
          <button class="button button-ghost" type="button">Comment</button>
        </form>
      </fieldset>
      <ul class="feed reactions-list">
        ${DRAFT_RECIPE.comments.map(
          (c) => html`<li class="feed-item">${avatar(c.who, "sm")}<p class="grow"><strong>${c.who}</strong> on step ${c.onStep}: ${c.text} <span class="muted">· ${c.when}</span></p></li>`,
        )}
      </ul>
      <p class="hint">Comments land while the recipe is still being written — the author sees them before publishing.</p>
    </section>`;
}

function schedulePage(_ctx: Ctx): Html {
  return html`
    ${pageHeader("Schedule", "Plan meals with friends and family live, and watch a recipe come together before it's shared.")}
    ${previewBanner("Crit 9", "Night claims and draft comments will sync to everyone watching in under a second over WebSockets.")}
    <div class="split split-wide">
      ${sharedCalendar()}
      <aside class="side-stack">${draftRecipe()}</aside>
    </div>`;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/schedule",
    auth: true,
    handler: (ctx) => htmlReply(page(ctx, { title: "Schedule", active: "schedule", body: schedulePage(ctx) })),
  },
];
