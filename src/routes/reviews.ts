// Reviews on recipe pages: posting, replying, liking, deleting, photos, the
// recipe-link picker, and a live stream of new reviews and who's writing.
// The rules are in src/reviews.ts; these routes read forms and answer.
// Anything about a recipe the viewer can't see is a 404.
//
// Each action answers a plain form post with a redirect back to the page
// (so it all works without JavaScript), and the page's script
// (public/reviews.mjs) with JSON or a fragment of HTML.

import { logActivity } from "../activity.ts";
import { checkImage, MAX_IMAGE_BYTES, readMultipart } from "../images.ts";
import { html } from "../html.ts";
import { t } from "../i18n.ts";
import { type Ctx, HttpError, htmlReply, json, redirect, setFlash, type Reply } from "../http.ts";
import { listVisibleRecipes, type Recipe } from "../recipes.ts";
import {
  deleteReview,
  editReply,
  photoAllowance,
  getReview,
  PHOTOS_MAX,
  photoFor,
  type Problem,
  problemText,
  repliesFor,
  reviewBus,
  type ReviewEvent,
  savePhoto,
  setTyping,
  summaryFor,
  toggleLike,
  typingOn,
  visibleRecipeFor,
  writeReply,
  writeReview,
} from "../reviews.ts";
import type { Route } from "../server.ts";
import { page, pageHeader } from "../views/layout.ts";
import { replyForm, reviewItem, type ComposerState } from "../views/reviews.ts";
import { renderReviewsPage } from "./recipes.ts";

const wantsJson = (ctx: Ctx) => (ctx.req.headers.accept ?? "").includes("application/json");

// The recipe, if the viewer may see it. Otherwise a 404, as JSON for the
// page's script; an error page for a browser.
class NotFoundJson extends Error {}
function recipeOr404(ctx: Ctx): Recipe {
  const id = Number(ctx.params.id);
  const r = Number.isSafeInteger(id) && id > 0 ? visibleRecipeFor(ctx.user?.id ?? null, id) : undefined;
  if (!r) {
    if (wantsJson(ctx)) throw new NotFoundJson();
    throw new HttpError(404, "There's no recipe at this address.");
  }
  return r;
}

// every review route: a JSON caller gets a JSON 404 for a hidden recipe
function jsonAware(route: Route): Route {
  const handler = route.handler;
  return {
    ...route,
    handler: async (ctx) => {
      try {
        return await handler(ctx);
      } catch (err) {
        if (err instanceof NotFoundJson) return json({ error: t("There's no recipe at this address."), problem: "not-found" }, 404);
        throw err;
      }
    },
  };
}

function reviewId(ctx: Ctx): number {
  const id = Number(ctx.params.rid);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, "That review isn't there any more.");
  return id;
}

interface Posted {
  fields: URLSearchParams;
  files: Buffer[];
}

// A review form: multipart when it carries photo files (no script), else
// urlencoded. Photos uploaded by the script arrive as `photo` ids.
async function readPosted(ctx: Ctx): Promise<Posted> {
  const type = ctx.req.headers["content-type"] ?? "";
  if (type.startsWith("multipart/form-data")) {
    // up to PHOTOS_MAX photos of 5 MB each, and the words
    const { fields, fileList } = await readMultipart(ctx.req, PHOTOS_MAX * MAX_IMAGE_BYTES + 256 * 1024);
    return { fields, files: fileList.filter((f) => f.name === "photo_file").map((f) => f.bytes) };
  }
  return { fields: await ctx.form(), files: [] };
}

const ids = (v: string[]) => [...new Set(v.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];

// Photos sent with a no-script form become uploads first, then are attached
// like the script's. A bad one stops the post with its reason.
function storeFiles(ctx: Ctx, files: Buffer[]): { ids: number[] } | { problem: string } {
  const out: number[] = [];
  if (files.length > PHOTOS_MAX) return { problem: problemText("too-many-photos") };
  for (const bytes of files) {
    const allowed = photoAllowance(ctx.user!.id);
    if (allowed !== "ok") return { problem: t(ALLOWANCE_TEXT[allowed]) };
    const check = checkImage(bytes);
    if (!check.ok) return { problem: t(check.problem.replace("of the dish", "")) };
    out.push(savePhoto(ctx.user!.id, bytes, check.mime, check.width, check.height));
  }
  return { ids: out };
}

const ALLOWANCE_TEXT = {
  "too-many-loose": "You have a lot of photos waiting to be posted. Post or remove some first.",
  "too-many-today": "That's a lot of photos for one day. Try again tomorrow.",
};

function problemReply(ctx: Ctx, recipe: Recipe, problem: Problem | string, state: ComposerState, status = 422): Reply {
  const text = problemText(problem);
  const code = problem === "not-found" ? 404 : problem === "too-soon" ? 429 : problem === "not-yours" ? 403 : status;
  if (wantsJson(ctx)) return json({ error: text, problem }, code);
  if (problem === "not-found") throw new HttpError(404, text);
  return renderReviewsPage(ctx, recipe, { ...state, problem: text }, code);
}

function back(recipe: Recipe, anchor: string): Reply {
  return redirect(`/recipes/${recipe.id}#${anchor}`);
}

/* ---------------- the live stream ---------------- */

interface Conn {
  recipeId: number;
  viewerId: number | null;
  // who's connecting, for the per-person limit: the user, or the client's IP
  key: string;
  write: (event: string, data: unknown) => void;
}
const conns = new Set<Conn>();
const MAX_STREAMS = 400;
// one person with a few tabs open; not one script taking every slot
const MAX_PER_VIEWER = 6;
const HEARTBEAT_MS = 25_000;

reviewBus.on("event", (e: ReviewEvent) => {
  for (const c of conns) {
    if (c.recipeId !== e.recipeId) continue;
    // the recipe may have become hidden since the stream opened
    if (!visibleRecipeFor(c.viewerId, c.recipeId)) continue;
    if (e.kind === "typing") c.write("typing", { names: typingOn(c.recipeId, c.viewerId) });
    else c.write(e.kind, e);
  }
});

const heartbeat = setInterval(() => {
  for (const c of conns) c.write("ping", {});
}, HEARTBEAT_MS);
heartbeat.unref();

function stream(ctx: Ctx, recipe: Recipe): Reply {
  const viewerId = ctx.user?.id ?? null;
  const key = viewerId !== null ? `u${viewerId}` : `ip${String(ctx.req.headers["fly-client-ip"] ?? ctx.req.socket.remoteAddress ?? "")}`;
  const mine = [...conns].filter((c) => c.key === key).length;
  if (conns.size >= MAX_STREAMS || mine >= MAX_PER_VIEWER) return { status: 429, headers: { "retry-after": "30", "content-type": "text/plain" }, body: "Busy" };
  return {
    status: 200,
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
    body: "",
    stream: (res) => {
      const c: Conn = {
        recipeId: recipe.id,
        viewerId,
        key,
        write: (event, data) => {
          if (res.writableLength > 256 * 1024) return void res.destroy();
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        },
      };
      conns.add(c);
      res.write("retry: 4000\n\n");
      c.write("typing", { names: typingOn(recipe.id, viewerId) });
      res.on("close", () => {
        conns.delete(c);
        // a writer who closes the page stops "writing"
        if (viewerId !== null) setTyping(recipe.id, viewerId, "", false);
      });
    },
  };
}

/* ---------------- routes ---------------- */

const table: Route[] = [
  {
    // recipes a review may link to: ones the writer can see, by name
    method: "GET",
    path: "/recipes/:id/reviews/link-search",
    auth: true,
    handler: (ctx) => {
      const recipe = recipeOr404(ctx);
      const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 60);
      if (q.length < 2) return json({ results: [] });
      const found = listVisibleRecipes(ctx.user!.id, { query: q, excludeId: recipe.id, limit: 8 });
      return json({ results: found.map((r) => ({ id: r.id, title: r.title, image: r.image_url })) });
    },
  },
  {
    // "I'm writing" / "I've stopped", sent by the page while someone types
    method: "POST",
    path: "/recipes/:id/reviews/typing",
    auth: true,
    handler: async (ctx) => {
      const recipe = recipeOr404(ctx);
      const on = (await ctx.form()).get("on") === "1";
      setTyping(recipe.id, ctx.user!.id, ctx.user!.display_name, on);
      return { status: 204, headers: {}, body: "" };
    },
  },
  {
    method: "GET",
    path: "/recipes/:id/reviews/stream",
    handler: (ctx) => stream(ctx, recipeOr404(ctx)),
  },
  {
    // the summary and the first page of reviews again, for the script after
    // a post, a filter change or "show more"
    method: "GET",
    path: "/recipes/:id/reviews/summary",
    handler: (ctx) => {
      const recipe = recipeOr404(ctx);
      return json(summaryFor(recipe.id));
    },
  },
  {
    // posting a review, or saving your existing one
    method: "POST",
    path: "/recipes/:id/reviews",
    auth: true,
    handler: async (ctx) => {
      const recipe = recipeOr404(ctx);
      const { fields, files } = await readPosted(ctx);
      const body = fields.get("body") ?? "";
      const rating = fields.get("rating") ? Number(fields.get("rating")) : null;
      const linkIds = ids(fields.getAll("link"));
      let photoIds = ids(fields.getAll("photo"));
      const state: ComposerState = { body, rating, photoIds, links: linkIds.map((id) => ({ id, title: visibleRecipeFor(ctx.user!.id, id)?.title ?? "" })).filter((l) => l.title) };
      if (files.length) {
        const stored = storeFiles(ctx, files);
        if ("problem" in stored) return problemReply(ctx, recipe, stored.problem, state);
        photoIds = [...photoIds, ...stored.ids];
        state.photoIds = photoIds;
      }
      const r = writeReview(recipe.id, ctx.user!.id, { body, rating, photoIds, linkIds });
      setTyping(recipe.id, ctx.user!.id, "", false);
      if (!r.ok) {
        logActivity({ actor: ctx.user, action: "review.post", outcome: "denied", subject: recipe.title, detail: { recipe: recipe.id, problem: r.problem } });
        return problemReply(ctx, recipe, r.problem, state);
      }
      logActivity({ actor: ctx.user, action: r.edited ? "review.edit" : "review.post", subject: recipe.title, detail: { recipe: recipe.id, review: r.id, photos: photoIds.length, links: linkIds.length } });
      if (wantsJson(ctx)) return json({ id: r.id, edited: r.edited });
      setFlash(ctx, r.edited ? t("Your review is updated.") : t("Thanks! Your review is posted."));
      return back(recipe, `rv-${r.id}`);
    },
  },
  {
    // the reply box under a review, as its own page (no script)
    method: "GET",
    path: "/recipes/:id/reviews/:rid/reply",
    auth: true,
    handler: (ctx) => {
      const recipe = recipeOr404(ctx);
      const to = getReview(reviewId(ctx), ctx.user!.id);
      if (!to || to.recipe_id !== recipe.id || to.deleted_at) throw new HttpError(404, "That review isn't there any more.");
      return htmlReply(page(ctx, { title: `${t("Reply")} · ${recipe.title}`, active: "recipes", body: html`${pageHeader(replyHeading(to.author_name), recipe.title)}
        <section class="panel stack rv-page"><ol class="rv-list">${reviewItem(ctx, recipe, { ...to, replies: [], reply_count: 0 }, { reply: !!to.parent_id })}</ol>${replyForm(ctx, recipe, to)}</section>` }));
    },
  },
  {
    method: "POST",
    path: "/recipes/:id/reviews/:rid/reply",
    auth: true,
    handler: async (ctx) => {
      const recipe = recipeOr404(ctx);
      const toId = reviewId(ctx);
      const { fields, files } = await readPosted(ctx);
      const body = fields.get("body") ?? "";
      const linkIds = ids(fields.getAll("link"));
      let photoIds = ids(fields.getAll("photo"));
      if (files.length) {
        const stored = storeFiles(ctx, files);
        if ("problem" in stored) return wantsJson(ctx) ? json({ error: stored.problem }, 422) : replyAgain(ctx, recipe, toId, body, stored.problem);
        photoIds = [...photoIds, ...stored.ids];
      }
      const r = writeReply(recipe.id, ctx.user!.id, toId, { body, photoIds, linkIds });
      setTyping(recipe.id, ctx.user!.id, "", false);
      if (!r.ok) {
        if (wantsJson(ctx)) return json({ error: problemText(r.problem), problem: r.problem }, r.problem === "not-found" ? 404 : r.problem === "too-soon" ? 429 : 422);
        if (r.problem === "not-found") throw new HttpError(404, problemText(r.problem));
        return replyAgain(ctx, recipe, toId, body, problemText(r.problem));
      }
      logActivity({ actor: ctx.user, action: "review.reply", subject: recipe.title, detail: { recipe: recipe.id, review: r.id, parent: r.parentId } });
      if (wantsJson(ctx)) return json({ id: r.id, parentId: r.parentId, html: reviewItem(ctx, recipe, getReview(r.id, ctx.user!.id)!, { reply: true }).value });
      return back(recipe, `rv-${r.id}`);
    },
  },
  {
    method: "GET",
    path: "/recipes/:id/reviews/:rid/edit",
    auth: true,
    handler: (ctx) => {
      const recipe = recipeOr404(ctx);
      const r = getReview(reviewId(ctx), ctx.user!.id);
      if (!r || r.recipe_id !== recipe.id || r.deleted_at) throw new HttpError(404, "That review isn't there any more.");
      // a review is edited in the box at the top of the reviews
      if (!r.parent_id) return redirect(`/recipes/${recipe.id}#write`);
      if (r.author_id !== ctx.user!.id) throw new HttpError(403, problemText("not-yours"));
      return htmlReply(page(ctx, { title: `${t("Edit reply")} · ${recipe.title}`, active: "recipes", body: html`${pageHeader(t("Edit your reply"), recipe.title)}
        <section class="panel stack rv-page">${replyForm(ctx, recipe, r, { editing: r.id, body: r.body })}</section>` }));
    },
  },
  {
    method: "POST",
    path: "/recipes/:id/reviews/:rid/edit",
    auth: true,
    handler: async (ctx) => {
      const recipe = recipeOr404(ctx);
      const id = reviewId(ctx);
      const body = (await readPosted(ctx)).fields.get("body") ?? "";
      const r = editReply(recipe.id, ctx.user!.id, id, body);
      if (!r.ok) {
        if (wantsJson(ctx)) return json({ error: problemText(r.problem) }, r.problem === "not-found" ? 404 : r.problem === "not-yours" ? 403 : 422);
        if (r.problem === "not-found") throw new HttpError(404, problemText(r.problem));
        if (r.problem === "not-yours") throw new HttpError(403, problemText(r.problem));
        const to = getReview(id, ctx.user!.id)!;
        return htmlReply(page(ctx, { title: t("Edit reply"), active: "recipes", body: html`${pageHeader(t("Edit your reply"), recipe.title)}<section class="panel stack rv-page">${replyForm(ctx, recipe, to, { editing: id, body, problem: problemText(r.problem) })}</section>` }), 422);
      }
      logActivity({ actor: ctx.user, action: "review.edit", subject: recipe.title, detail: { recipe: recipe.id, review: id } });
      if (wantsJson(ctx)) return json({ id, html: reviewItem(ctx, recipe, getReview(id, ctx.user!.id)!, { reply: true }).value });
      return back(recipe, `rv-${id}`);
    },
  },
  {
    method: "POST",
    path: "/recipes/:id/reviews/:rid/delete",
    auth: true,
    handler: async (ctx) => {
      const recipe = recipeOr404(ctx);
      const id = reviewId(ctx);
      const r = deleteReview(recipe.id, ctx.user!.id, id);
      if (!r.ok) {
        if (wantsJson(ctx)) return json({ error: problemText(r.problem) }, r.problem === "not-found" ? 404 : 403);
        throw new HttpError(r.problem === "not-found" ? 404 : 403, problemText(r.problem));
      }
      logActivity({ actor: ctx.user, action: "review.delete", subject: recipe.title, detail: { recipe: recipe.id, review: id, kept: r.removed === "content" } });
      if (wantsJson(ctx)) return json({ removed: r.removed });
      setFlash(ctx, t("Deleted."));
      return back(recipe, "reviews");
    },
  },
  {
    method: "POST",
    path: "/recipes/:id/reviews/:rid/like",
    auth: true,
    handler: async (ctx) => {
      const recipe = recipeOr404(ctx);
      const id = reviewId(ctx);
      const r = toggleLike(recipe.id, ctx.user!.id, id);
      if (!r.ok) {
        if (wantsJson(ctx)) return json({ error: problemText(r.problem) }, r.problem === "not-found" ? 404 : 422);
        if (r.problem === "not-found") throw new HttpError(404, problemText(r.problem));
        setFlash(ctx, problemText(r.problem));
        return back(recipe, `rv-${id}`);
      }
      if (wantsJson(ctx)) return json({ liked: r.liked, likes: r.likes });
      return back(recipe, `rv-${id}`);
    },
  },
  {
    // every reply under a review: the script's "show more replies", or the
    // page a no-script link opens
    method: "GET",
    path: "/recipes/:id/reviews/:rid",
    handler: (ctx) => {
      const recipe = recipeOr404(ctx);
      const r = getReview(reviewId(ctx), ctx.user?.id ?? null);
      if (!r || r.recipe_id !== recipe.id || r.parent_id) throw new HttpError(404, "That review isn't there any more.");
      const all = repliesFor(r.id, ctx.user?.id ?? null);
      // a deleted review's thread, without saying whose it was
      const heading = r.deleted_at ? t("A deleted review") : r.author_name === null ? t("A deleted account's review") : t("{name}'s review", { name: r.author_name });
      if (ctx.url.searchParams.get("partial") === "replies") {
        return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: html`${all.map((x) => reviewItem(ctx, recipe, x, { reply: true }))}`.value };
      }
      return htmlReply(page(ctx, { title: `${t("Review")} · ${recipe.title}`, active: "recipes", body: html`${pageHeader(heading, recipe.title)}
        <p><a href="/recipes/${recipe.id}#reviews">${t("← Back to {title}", { title: recipe.title })}</a></p>
        <section class="rv-section"><ol class="rv-list">${reviewItem(ctx, recipe, { ...r, replies: all, reply_count: all.length })}</ol></section>` }));
    },
  },
  {
    // a review photo, uploaded while writing (raw bytes, like recipe photos)
    method: "POST",
    path: "/reviews/photos",
    auth: true,
    handler: async (ctx) => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of ctx.req) {
        size += (chunk as Buffer).length;
        if (size > MAX_IMAGE_BYTES) return json({ error: t("That photo is over 5 MB. Try a smaller one.") }, 413);
        chunks.push(chunk as Buffer);
      }
      const bytes = Buffer.concat(chunks);
      const allowed = photoAllowance(ctx.user!.id);
      if (allowed !== "ok") return json({ error: t(ALLOWANCE_TEXT[allowed]) }, 429);
      const check = checkImage(bytes);
      if (!check.ok) return json({ error: t(check.problem.replace(" of the dish", "")) }, 422);
      const id = savePhoto(ctx.user!.id, bytes, check.mime, check.width, check.height);
      return json({ id, url: `/reviews/photos/${id}`, width: check.width, height: check.height });
    },
  },
  {
    // only to someone who may see the recipe it's on (or its uploader, before
    // it's posted): a private recipe's review photos stay private
    method: "GET",
    path: "/reviews/photos/:pid",
    handler: (ctx) => {
      const id = Number(ctx.params.pid);
      const p = Number.isSafeInteger(id) ? photoFor(ctx.user?.id ?? null, id) : undefined;
      if (!p) throw new HttpError(404, "There's no photo at this address.");
      return {
        status: 200,
        // private: a photo's audience can change (a recipe made private)
        headers: { "content-type": p.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
        body: Buffer.from(p.bytes),
      };
    },
  },
];

export const routes: Route[] = table.map(jsonAware);

// "Reply to Sam", or to a review whose writer's account is gone
function replyHeading(name: string | null): string {
  return name === null ? t("Reply to a review") : t("Reply to {name}", { name });
}

function replyAgain(ctx: Ctx, recipe: Recipe, toId: number, body: string, problem: string): Reply {
  const to = getReview(toId, ctx.user!.id);
  if (!to || to.recipe_id !== recipe.id) throw new HttpError(404, "That review isn't there any more.");
  return htmlReply(
    page(ctx, { title: `${t("Reply")} · ${recipe.title}`, active: "recipes", body: html`${pageHeader(replyHeading(to.author_name), recipe.title)}
      <section class="panel stack rv-page">${replyForm(ctx, recipe, to, { body, problem })}</section>` }),
    422,
  );
}
