// The reviews section of a recipe page, and its parts the page's script
// swaps in when someone posts, likes or filters (public/reviews.mjs). Every
// part works as a plain page without the script: stars are radio buttons,
// filters are links, posting is a form.

import { shortDate } from "../format.ts";
import { type Html, html } from "../html.ts";
import type { Ctx } from "../http.ts";
import { t, th, tn } from "../i18n.ts";
import { LANGUAGES, languageName, TRANSLATABLE } from "../language.ts";
import type { Recipe } from "../recipes.ts";
import { type Filters, LINKS_MAX, PHOTOS_MAX, REVIEW_MAX, type Review, type Summary } from "../reviews.ts";
import { avatar, icon, previewBanner } from "./layout.ts";

// "4.3" with its stars drawn: whole and half stars, the rest empty
export function stars(value: number, size = 16): Html {
  const out: Html[] = [];
  for (let i = 1; i <= 5; i++) {
    const fill = value >= i ? "full" : value >= i - 0.5 ? "half" : "empty";
    out.push(html`<span class="star star-${fill}" style="--s: ${size}px">${icon("star", size)}</span>`);
  }
  return html`<span class="stars" role="img" aria-label="${t("{value} out of 5 stars", { value })}">${out}</span>`;
}

// When something was written: "3h ago" up to a month, then the date.
// Review times are ISO UTC ("2026-11-06T02:10:00Z").
export function when(iso: string): Html {
  const then = new Date(iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  const mins = Math.max(0, Math.round((Date.now() - then.getTime()) / 60_000));
  const text =
    mins < 1 ? t("just now") : mins < 60 ? t("{n}m ago", { n: mins }) : mins < 1440 ? t("{n}h ago", { n: Math.round(mins / 60) }) : mins < 43200 ? t("{n}d ago", { n: Math.round(mins / 1440) }) : shortDate(then.toISOString().slice(0, 10));
  return html`<time datetime="${then.toISOString()}" title="${then.toUTCString()}">${text}</time>`;
}

// The star average at the top of the recipe page, linking to the reviews.
export function ratingBadge(summary: Summary): Html {
  if (!summary.count) return html`<a class="rd-rating rd-rating-none" href="#reviews">${icon("star", 15)} ${t("No reviews yet")}</a>`;
  return html`<a class="rd-rating" href="#reviews">${stars(summary.average!, 15)}<strong>${summary.average!.toFixed(1)}</strong><span>${tn(summary.count, "{n} review", "{n} reviews")}</span></a>`;
}

// The review's words: kept as written, line breaks and all, escaped. An
// "@name" at the start of a reply is shown as who it answers.
function body(r: Review): Html {
  const paras = r.body.split(/\n{2,}/);
  return html`<div class="rv-text" lang="${r.lang === "und" ? "" : r.lang}" data-rv-text data-lang="${r.lang}">${paras.map((p) => html`<p>${p.split("\n").map((l, i) => (i ? html`<br />${l}` : l))}</p>`)}</div>`;
}

function who(r: Review): Html {
  if (r.author_name === null) return html`<span class="rv-who rv-gone">${t("Deleted account")}</span>`;
  // a sample reviewer has no profile to link to
  if (r.author_sample) return html`<span class="rv-who">${r.author_name}</span><span class="rv-badge rv-badge-sample" title="${t("An example review, not written by a real person")}">${t("Sample")}</span>`;
  return html`<a class="rv-who" href="/u/${r.author_username}">${r.author_name}</a>`;
}

function photos(r: Review): Html {
  if (!r.photos.length) return html``;
  return html`<div class="rv-photos rv-photos-${Math.min(r.photos.length, 4)}">${r.photos.map(
    (p, i) => html`<a class="rv-photo" href="/reviews/photos/${p.id}" target="_blank" rel="noopener" data-rv-photo>
      <img src="/reviews/photos/${p.id}" alt="${r.author_name === null ? (r.parent_id ? t("Photo {n} from a deleted account's reply", { n: i + 1 }) : t("Photo {n} from a deleted account's review", { n: i + 1 })) : r.parent_id ? t("Photo {n} from {name}'s reply", { n: i + 1, name: r.author_name }) : t("Photo {n} from {name}'s review", { n: i + 1, name: r.author_name })}" loading="lazy" decoding="async"
        ${p.width && p.height ? html`width="${p.width}" height="${p.height}"` : ""} /></a>`,
  )}</div>`;
}

function links(r: Review): Html {
  if (!r.links.length) return html``;
  return html`<ul class="rv-links" aria-label="${t("Recipes mentioned")}">${r.links.map(
    (l) => html`<li><a class="rv-link" href="/recipes/${l.id}">
      ${l.image_url ? html`<img src="${l.image_url}" alt="" loading="lazy" />` : html`<span class="rv-link-blank">${icon("recipes", 16)}</span>`}
      <span>${l.title}</span>${icon("arrow", 14)}</a></li>`,
  )}</ul>`;
}

// One review or reply. `me` decides which actions show; the server checks
// every action again.
export function reviewItem(ctx: Ctx, recipe: Recipe, r: Review, opts: { reply?: boolean } = {}): Html {
  const me = ctx.user?.id ?? null;
  const reply = !!opts.reply;
  const id = `rv-${r.id}`;
  if (r.deleted_at) {
    return html`<li class="rv rv-deleted" id="${id}" data-rv="${r.id}">
      <div class="rv-main"><p class="rv-deleted-note">${icon("trash", 14)} ${t("This review was deleted.")}</p></div>
      ${replies(ctx, recipe, r)}
    </li>`;
  }
  const mine = me !== null && r.author_id === me;
  const canLike = me !== null && !mine;
  const translatable = TRANSLATABLE.has(r.lang);
  const foreign = r.lang !== "en" && r.lang !== "und";
  return html`<li class="rv ${reply ? "rv-reply" : ""} ${mine ? "rv-mine" : ""}" id="${id}" data-rv="${r.id}" data-parent="${r.parent_id ?? r.id}">
    ${avatar(r.author_name, reply ? "sm" : "md", r.author_avatar)}
    <div class="rv-main">
      <header class="rv-head">
        ${who(r)}
        ${!reply && r.rating ? stars(r.rating, 14) : ""}
        <span class="rv-meta">${when(r.created_at)}${r.edited_at ? html` · <span title="${t("Edited {when}", { when: r.edited_at })}">${t("edited")}</span>` : ""}${recipe.author_id === r.author_id && r.author_id !== null ? html` · <span class="rv-badge">${t("Recipe author")}</span>` : ""}</span>
      </header>
      ${reply && r.reply_to_name ? html`<p class="rv-to">${icon("reply", 12)} ${t("to {name}", { name: r.reply_to_name })}</p>` : reply && r.reply_to_id ? html`<p class="rv-to">${icon("reply", 12)} ${t("to a deleted account")}</p>` : ""}
      ${body(r)}
      ${translatable ? html`<p class="rv-translated" data-rv-translated hidden></p>` : ""}
      ${photos(r)}
      ${links(r)}
      <div class="rv-actions">
        ${canLike
          ? html`<form method="post" action="/recipes/${recipe.id}/reviews/${r.id}/like" data-rv-like>
              <button class="rv-act ${r.liked ? "is-on" : ""}" type="submit" aria-pressed="${r.liked ? "true" : "false"}">${icon("heart", 15)}<span data-rv-likes>${r.likes || ""}</span><span class="sr-only">${r.liked ? t("Unlike") : t("Like")}</span></button>
            </form>`
          : html`<span class="rv-act rv-act-static" title="${mine ? t("Likes on your writing") : t("Sign in to like")}">${icon("heart", 15)}<span data-rv-likes>${r.likes || ""}</span><span class="sr-only">${tn(r.likes, "{n} like", "{n} likes")}</span></span>`}
        ${me !== null
          ? html`<a class="rv-act" href="/recipes/${recipe.id}/reviews/${r.id}/reply#reply" data-rv-reply="${r.id}" data-rv-to="${r.author_name ?? ""}">${icon("reply", 15)}<span>${t("Reply")}</span></a>`
          : ""}
        ${translatable
          ? html`<button class="rv-act" type="button" data-rv-translate data-lang="${r.lang}" hidden>${icon("translate", 15)}<span>${t("Translate from {language}", { language: t(languageName(r.lang)) })}</span></button>`
          : foreign ? html`<span class="rv-act rv-act-static rv-lang">${icon("translate", 15)}<span>${t("Written in {language}", { language: t(languageName(r.lang)) })}</span></span>` : ""}
        ${mine && reply
          ? html`<a class="rv-act" href="/recipes/${recipe.id}/reviews/${r.id}/edit#edit" data-rv-edit="${r.id}">${icon("edit", 15)}<span>${t("Edit")}</span></a>`
          : ""}
        ${mine
          ? html`<form method="post" action="/recipes/${recipe.id}/reviews/${r.id}/delete" data-confirm="${reply ? t("Delete your reply? This can't be undone.") : t("Delete your review? This can't be undone.")}" data-rv-delete>
              <button class="rv-act rv-act-danger" type="submit">${icon("trash", 15)}<span>${t("Delete")}</span></button>
            </form>`
          : ""}
      </div>
    </div>
    ${reply ? "" : replies(ctx, recipe, r)}
  </li>`;
}

function replies(ctx: Ctx, recipe: Recipe, r: Review): Html {
  const more = r.reply_count - r.replies.length;
  return html`<div class="rv-thread" data-rv-thread="${r.id}">
    ${r.replies.length ? html`<ol class="rv-replies">${r.replies.map((x) => reviewItem(ctx, recipe, x, { reply: true }))}</ol>` : html`<ol class="rv-replies"></ol>`}
    ${more > 0
      ? html`<a class="rv-more-replies" href="/recipes/${recipe.id}/reviews/${r.id}#rv-${r.id}" data-rv-all-replies="${r.id}">${tn(more, "Show {n} more reply", "Show {n} more replies")}</a>`
      : ""}
    <div class="rv-reply-slot" data-rv-reply-slot="${r.id}"></div>
  </div>`;
}

// The summary at the head of the section: average, a bar per star (each a
// link that filters to it), and how many have photos.
function summaryBlock(recipe: Recipe, s: Summary, f: Filters): Html {
  if (!s.count) return html`<div class="rv-summary rv-summary-empty"><p class="rv-big">${t("No reviews yet")}</p><p class="muted small">${t("Cooked it? Be the first to say how it went.")}</p></div>`;
  const max = Math.max(...s.stars);
  return html`<div class="rv-summary">
    <div class="rv-avg"><p class="rv-big" data-rv-average>${s.average!.toFixed(1)}</p>${stars(s.average!, 18)}<p class="muted small" data-rv-count>${tn(s.count, "{n} review", "{n} reviews")}</p></div>
    <ol class="rv-bars" aria-label="${t("Reviews by stars")}">${[5, 4, 3, 2, 1].map((n) => {
      const c = s.stars[n - 1];
      return html`<li><a href="${filterHref(recipe, f, { stars: f.stars === n ? undefined : n })}#reviews" class="${f.stars === n ? "is-on" : ""}" aria-label="${tn(c, "{n} {stars}-star review", "{n} {stars}-star reviews", { stars: n })}${f.stars === n ? t(", showing only these") : ""}" ${c ? "" : html`aria-disabled="true"`}>
        <span class="rv-bar-n">${n}${icon("star", 11)}</span><span class="rv-bar"><span style="width: ${max ? Math.round((c / max) * 100) : 0}%"></span></span><span class="rv-bar-c">${c}</span></a></li>`;
    })}</ol>
  </div>`;
}

export function filterHref(recipe: Recipe, f: Filters, change: Partial<Filters>): string {
  const n = { ...f, ...change };
  const p = new URLSearchParams();
  if (n.sort && n.sort !== "top") p.set("sort", n.sort);
  if (n.photos) p.set("photos", "1");
  if (n.lang) p.set("lang", n.lang);
  if (n.stars) p.set("stars", String(n.stars));
  const q = p.toString();
  return `/recipes/${recipe.id}${q ? `?${q}` : ""}`;
}

// a language's name on its own, as a chip label: Spanish writes "español"
// mid-sentence but "Español" alone
const capitalised = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

function filters(recipe: Recipe, s: Summary, f: Filters): Html {
  if (!s.count) return html``;
  const sorts: [NonNullable<Filters["sort"]>, string][] = [["top", t("Most helpful")], ["newest", t("Newest")], ["oldest", t("Oldest")], ["highest", t("Highest rated")], ["lowest", t("Lowest rated")]];
  const any = f.photos || f.lang || f.stars;
  return html`<div class="rv-filters" data-rv-filters>
    <form class="rv-sort" method="get" action="/recipes/${recipe.id}#reviews" data-rv-sort>
      ${f.photos ? html`<input type="hidden" name="photos" value="1" />` : ""}
      ${f.lang ? html`<input type="hidden" name="lang" value="${f.lang}" />` : ""}
      ${f.stars ? html`<input type="hidden" name="stars" value="${f.stars}" />` : ""}
      <label><span class="sr-only">${t("Sort reviews")}</span>
        <select name="sort">${sorts.map(([k, l]) => html`<option value="${k}" ${(f.sort ?? "top") === k ? html`selected` : ""}>${l}</option>`)}</select></label>
      <noscript><button class="button button-small button-ghost" type="submit">${t("Sort")}</button></noscript>
    </form>
    <nav class="rv-chips" aria-label="${t("Filter reviews")}">
      <a class="rx-chip" href="${filterHref(recipe, f, { photos: !f.photos })}#reviews" aria-pressed="${f.photos ? "true" : "false"}" data-rv-filter>${icon("image", 15)} ${t("With photos")} <span class="rv-chip-n">${s.with_photos}</span></a>
      ${s.languages.filter((l) => l.code !== "und").length > 1 || s.languages.some((l) => l.code !== "en" && l.code !== "und")
        ? s.languages.filter((l) => l.code !== "und").map(
            (l) => html`<a class="rx-chip" href="${filterHref(recipe, f, { lang: f.lang === l.code ? undefined : l.code })}#reviews" aria-pressed="${f.lang === l.code ? "true" : "false"}" data-rv-filter>${capitalised(t(languageName(l.code)))} <span class="rv-chip-n">${l.count}</span></a>`,
          )
        : ""}
      ${any ? html`<a class="rx-chip rv-clear" href="${filterHref(recipe, f, { photos: false, lang: undefined, stars: undefined })}#reviews" data-rv-filter>${icon("close", 14)} ${t("Clear filters")}</a>` : ""}
    </nav>
  </div>`;
}

export interface ComposerState {
  // what was typed, carried back when a post is refused
  body?: string;
  rating?: number | null;
  problem?: string;
  photoIds?: number[];
  links?: { id: number; title: string }[];
}

// The box for writing a review (or editing yours). Signed out: an
// invitation to sign in. The recipe's author: a note that they reply rather
// than rate.
export function composer(ctx: Ctx, recipe: Recipe, existing: Review | null, state: ComposerState = {}): Html {
  if (!ctx.user) {
    return html`<div class="rv-compose rv-compose-out" id="write">
      <p><strong>${t("Cooked this?")}</strong> ${th("{signin} to rate it and share how it went.", { signin: html`<a href="/login?next=${encodeURIComponent(`/recipes/${recipe.id}#write`)}">${t("Sign in")}</a>` })}</p>
    </div>`;
  }
  if (ctx.user.id === recipe.author_id) {
    return html`<div class="rv-compose rv-compose-own" id="write"><p class="muted">${t("This is your recipe, so you can't rate it, but you can reply to anyone's review.")}</p></div>`;
  }
  const rating = state.rating ?? existing?.rating ?? null;
  const text = state.body ?? existing?.body ?? "";
  const links = state.links ?? existing?.links.map((l) => ({ id: l.id, title: l.title })) ?? [];
  const photoIds = state.photoIds ?? existing?.photos.map((p) => p.id) ?? [];
  return html`<form class="rv-compose" id="write" method="post" action="/recipes/${recipe.id}/reviews" enctype="multipart/form-data" data-rv-compose data-recipe="${recipe.id}">
    <div class="rv-compose-head">
      ${avatar(ctx.user.display_name, "md", ctx.user.avatar)}
      <div><p class="rv-compose-title">${existing ? t("Edit your review") : t("Write a review")}</p><p class="muted small">${t("Posting as {name}", { name: ctx.user.display_name })}</p></div>
    </div>
    ${state.problem ? html`<p class="form-errors" role="alert">${state.problem}</p>` : ""}
    <fieldset class="rv-rate">
      <legend>${t("Your rating")} <span class="muted">${t("(required)")}</span></legend>
      <div class="rv-rate-stars">${[5, 4, 3, 2, 1].map(
        (n) => html`<input type="radio" id="rate-${n}" name="rating" value="${n}" ${rating === n ? html`checked` : ""} required /><label for="rate-${n}" title="${tn(n, "{n} star", "{n} stars")}">${icon("star", 26)}<span class="sr-only">${tn(n, "{n} star", "{n} stars")}</span></label>`,
      )}</div>
    </fieldset>
    <label class="field rv-field"><span>${t("Your review")}</span>
      <textarea name="body" rows="4" maxlength="${REVIEW_MAX}" required placeholder="${t("How did it turn out? Anything you'd change?")}" data-rv-body>${text}</textarea>
      <span class="rv-count muted small" data-rv-count-chars aria-live="polite">${text.length} / ${REVIEW_MAX}</span>
    </label>
    ${attachments(photoIds, links)}
    <div class="rv-compose-foot">
      <p class="muted small rv-compose-hint">${recipe.visibility === "public"
        ? t("Anyone can read reviews of this recipe.")
        : recipe.visibility === "friends"
          ? t("Only {name}'s friends can read reviews of this recipe.", { name: recipe.author_name.split(" ")[0] })
          : t("Only you and the recipe's author can read this.")}</p>
      <button class="button" type="submit" data-rv-submit>${existing ? t("Save review") : t("Post review")}</button>
    </div>
  </form>`;
}

// Photos and recipe links on a review or reply being written. Without the
// script, a plain file input sends photos with the form.
function attachments(photoIds: number[], links: { id: number; title: string }[], forReply = false): Html {
  return html`<div class="rv-attach" data-rv-attach>
    <div class="rv-attach-list" data-rv-photos>
      ${photoIds.map((id) => html`<span class="rv-thumb"><img src="/reviews/photos/${id}" alt="" /><input type="hidden" name="photo" value="${id}" /><button type="button" class="rv-thumb-x" data-rv-unphoto aria-label="${t("Remove photo")}">${icon("close", 12)}</button></span>`)}
    </div>
    <div class="rv-attach-list" data-rv-links>
      ${links.map((l) => html`<span class="rv-linkchip">${icon("link", 13)}<span>${l.title}</span><input type="hidden" name="link" value="${l.id}" /><button type="button" data-rv-unlink aria-label="${t("Remove link to {title}", { title: l.title })}">${icon("close", 12)}</button></span>`)}
    </div>
    <div class="rv-attach-tools">
      <label class="rv-tool" title="${t("Add photos (up to {n})", { n: PHOTOS_MAX })}">${icon("image", 16)}<span>${t("Photo")}</span>
        <input type="file" name="photo_file" accept="image/jpeg,image/png,image/webp" multiple data-rv-photo-input /></label>
      <button type="button" class="rv-tool" data-rv-link-open title="${t("Mention another recipe (up to {n})", { n: LINKS_MAX })}" hidden>${icon("link", 16)}<span>${t("Link a recipe")}</span></button>
      <span class="rv-tool-status muted small" data-rv-attach-status role="status" aria-live="polite"></span>
    </div>
    <div class="rv-linkpick" data-rv-linkpick hidden>
      <label class="sr-only" for="${forReply ? "rv-link-q-reply" : "rv-link-q"}">${t("Search recipes to link")}</label>
      <input type="search" id="${forReply ? "rv-link-q-reply" : "rv-link-q"}" placeholder="${t("Search recipes…")}" autocomplete="off" data-rv-link-q />
      <ul class="rv-linkpick-list" data-rv-link-results role="listbox" aria-label="${t("Recipes")}"></ul>
    </div>
  </div>`;
}

// The box for replying to a review (or editing your reply), shown under it.
export function replyForm(ctx: Ctx, recipe: Recipe, to: Review, state: ComposerState & { editing?: number } = {}): Html {
  const action = state.editing ? `/recipes/${recipe.id}/reviews/${state.editing}/edit` : `/recipes/${recipe.id}/reviews/${to.id}/reply`;
  return html`<form class="rv-replyform" id="${state.editing ? "edit" : "reply"}" method="post" action="${action}" enctype="multipart/form-data" data-rv-replyform data-recipe="${recipe.id}">
    ${state.problem ? html`<p class="form-errors" role="alert">${state.problem}</p>` : ""}
    <label class="field rv-field"><span class="sr-only">${state.editing ? t("Edit your reply") : to.author_name === null ? t("Reply to this review") : t("Reply to {name}", { name: to.author_name })}</span>
      <textarea name="body" rows="2" maxlength="${REVIEW_MAX}" required placeholder="${state.editing ? "" : to.author_name === null ? t("Reply to this review…") : t("Reply to {name}…", { name: to.author_name })}" data-rv-body>${state.body ?? ""}</textarea></label>
    ${state.editing ? "" : attachments(state.photoIds ?? [], state.links ?? [], true)}
    <div class="rv-replyform-foot">
      <a class="button button-small button-ghost" href="/recipes/${recipe.id}#rv-${to.parent_id ?? to.id}" data-rv-cancel>${t("Cancel")}</a>
      <button class="button button-small" type="submit">${state.editing ? t("Save") : t("Reply")}</button>
    </div>
  </form>`;
}

// The whole section, at the foot of the recipe page.
export function reviewsSection(
  ctx: Ctx,
  recipe: Recipe,
  data: { summary: Summary; reviews: Review[]; total: number; filters: Filters; mine: Review | null; typing: string[]; composer?: ComposerState; shown: number },
): Html {
  const { summary, reviews, total, filters: f } = data;
  const filtered = !!(f.photos || f.lang || f.stars);
  return html`<section class="rv-section" id="reviews" aria-labelledby="reviews-h" data-rv-section data-recipe="${recipe.id}" data-signed-in="${ctx.user ? "1" : "0"}">
    <div class="rv-top">
      <h2 id="reviews-h">${t("Reviews")}</h2>
      ${summaryBlock(recipe, summary, f)}
    </div>
    ${summary.samples
      ? previewBanner(t("Sample reviews"), summary.samples === summary.count
          ? t(`The reviews here are examples, marked "Sample", written so you can see how reviews work. Add a real one below.`)
          : t(`{n} of these reviews are examples, marked "Sample"; the rest are from real people.`, { n: summary.samples }))
      : ""}
    ${composer(ctx, recipe, data.mine, data.composer)}
    <p class="rv-typing" data-rv-typing aria-live="polite" ${data.typing.length ? "" : html`hidden`}>${typingText(data.typing)}</p>
    ${filters(recipe, summary, f)}
    ${reviews.length
      ? html`<ol class="rv-list" data-rv-list>${reviews.map((r) => reviewItem(ctx, recipe, r))}</ol>`
      : summary.count && filtered
        ? html`<div class="empty rv-empty"><p class="empty-title">${t("No reviews match those filters")}</p><p><a href="${filterHref(recipe, f, { photos: false, lang: undefined, stars: undefined })}#reviews">${t("Show all {n} reviews", { n: summary.count })}</a></p></div>`
        : html`<ol class="rv-list" data-rv-list></ol>`}
    ${data.shown < total
      ? html`<div class="rx-more"><a class="button button-soft" href="${filterHref(recipe, f, {})}${filterHref(recipe, f, {}).includes("?") ? "&" : "?"}shown=${data.shown + 20}#reviews" data-rv-more data-from="${data.shown}">${t("Show more reviews")}</a></div>`
      : ""}
  </section>`;
}

// "Sam is writing…", "Sam and Lee are writing…", "3 people are writing…"
export function typingText(names: string[]): Html {
  if (!names.length) return html``;
  const first = (n: string) => n.split(" ")[0];
  const label = names.length === 1 ? t("{name} is writing…", { name: first(names[0]) }) : names.length === 2 ? t("{a} and {b} are writing…", { a: first(names[0]), b: first(names[1]) }) : t("{n} people are writing…", { n: names.length });
  return html`<span class="ask-typing" aria-hidden="true"><i></i><i></i><i></i></span><span>${label}</span>`;
}

export function languageOptions(): [string, string][] {
  return Object.entries(LANGUAGES).filter(([k]) => k !== "und");
}
