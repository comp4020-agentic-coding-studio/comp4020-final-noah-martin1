// Reviews of recipes: a star rating and words (with photos and links to
// other recipes), replies to them, and likes. Every rule lives here, so the
// routes stay thin and each rule can be tested on its own.
//
// Who may see and write: whoever may see the recipe (src/visibility.ts). A
// review of a recipe someone can't see doesn't exist for them (404).
// A review outlives its writer's account (migration 012): it stays, with
// no name or picture. Writing is in plain text; the page escapes it.

import { EventEmitter } from "node:events";
import { all, one, run, transaction } from "./db.ts";
import { t } from "./i18n.ts";
import { detectLanguage } from "./language.ts";
import { getRecipe, type Recipe } from "./recipes.ts";
import { canSeeRecipe } from "./visibility.ts";

export const REVIEW_MAX = 2000;
export const PHOTOS_MAX = 4;
export const LINKS_MAX = 3;
// seconds between two posts by one person, anywhere: stops a double tap
// posting twice and slows a flood
export const POST_COOLDOWN_SECONDS = 8;
// replies shown under a review before "show N more replies"
export const REPLIES_SHOWN = 3;

export interface ReviewRow {
  id: number;
  recipe_id: number;
  author_id: number | null;
  parent_id: number | null;
  reply_to_id: number | null;
  rating: number | null;
  body: string;
  lang: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  // joined: null when the account is gone
  author_name: string | null;
  author_username: string | null;
  author_avatar: string | null;
  // written by a sample reviewer (migration 013): shown labelled
  author_sample: number;
  reply_to_name: string | null;
  likes: number;
  liked: number;
}

export interface ReviewPhoto {
  id: number;
  review_id: number;
  width: number | null;
  height: number | null;
}

export interface LinkedRecipe {
  review_id: number;
  id: number;
  title: string;
  image_url: string | null;
}

export interface Review extends ReviewRow {
  photos: ReviewPhoto[];
  links: LinkedRecipe[];
  replies: Review[];
  reply_count: number;
}

export interface Summary {
  count: number;
  // how many of them are sample reviews (the page says so)
  samples: number;
  average: number | null;
  // how many reviews gave each star, [1★ … 5★]
  stars: [number, number, number, number, number];
  with_photos: number;
  languages: { code: string; count: number }[];
}

// A recipe the viewer may see, or undefined (the caller answers 404).
export function visibleRecipeFor(viewerId: number | null, recipeId: number): Recipe | undefined {
  const r = getRecipe(recipeId);
  return r && canSeeRecipe(viewerId, r) ? r : undefined;
}

// control characters, zero-width spaces and line/paragraph separators
const INVISIBLE = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u200b\\u2028\\u2029]", "g");

// Writing tidied: spaces collapsed, at most one blank line between
// paragraphs, invisible control characters dropped.
export function cleanBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------------- reading ---------------- */

export type SortKey = "newest" | "oldest" | "top" | "highest" | "lowest";
export interface Filters {
  sort?: SortKey;
  photos?: boolean;
  lang?: string;
  stars?: number;
}

const ROW = `SELECT v.*, u.display_name AS author_name, u.username AS author_username, u.avatar AS author_avatar, COALESCE(u.is_sample, 0) AS author_sample,
    ru.display_name AS reply_to_name,
    (SELECT COUNT(*) FROM review_likes l WHERE l.review_id = v.id) AS likes,
    EXISTS (SELECT 1 FROM review_likes l WHERE l.review_id = v.id AND l.user_id = ?) AS liked
  FROM reviews v
  LEFT JOIN users u ON u.id = v.author_id
  LEFT JOIN reviews rv ON rv.id = v.reply_to_id
  LEFT JOIN users ru ON ru.id = rv.author_id`;

const ORDER: Record<SortKey, string> = {
  newest: "v.created_at DESC, v.id DESC",
  oldest: "v.created_at ASC, v.id ASC",
  // most liked, then the ones with words and photos people found useful
  top: "likes DESC, (SELECT COUNT(*) FROM reviews c WHERE c.parent_id = v.id AND c.deleted_at IS NULL) DESC, v.created_at DESC",
  highest: "v.rating DESC, v.created_at DESC",
  lowest: "v.rating ASC, v.created_at DESC",
};

export function parseFilters(p: URLSearchParams): Filters {
  const sort = p.get("sort") as SortKey;
  const stars = Number(p.get("stars"));
  const lang = (p.get("lang") ?? "").slice(0, 3);
  return {
    sort: Object.hasOwn(ORDER, sort ?? "") ? sort : "top",
    photos: p.get("photos") === "1",
    lang: /^[a-z]{2,3}$/.test(lang) ? lang : undefined,
    stars: Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : undefined,
  };
}

// The reviews of one recipe for one viewer: top-level reviews filtered and
// sorted, each with its first replies, photos and the linked recipes the
// viewer may see. The caller has already checked the recipe is visible.
export function reviewsFor(recipeId: number, viewerId: number | null, f: Filters = {}, limit = 20, offset = 0): { reviews: Review[]; total: number } {
  const where = ["v.recipe_id = ?", "v.parent_id IS NULL"];
  const params: (number | string)[] = [recipeId];
  // a deleted review with no replies left isn't shown at all; with replies
  // it's shown as "[deleted]" so the thread still reads, but never in a
  // filtered list (it has no stars, words or photos to match)
  const filtered = f.photos || f.lang || f.stars;
  if (filtered) where.push("v.deleted_at IS NULL");
  else where.push("(v.deleted_at IS NULL OR EXISTS (SELECT 1 FROM reviews c WHERE c.parent_id = v.id AND c.deleted_at IS NULL))");
  if (f.photos) where.push("EXISTS (SELECT 1 FROM review_images i WHERE i.review_id = v.id)");
  if (f.lang) {
    where.push("v.lang = ?");
    params.push(f.lang);
  }
  if (f.stars) {
    where.push("v.rating = ?");
    params.push(f.stars);
  }
  const total = one<{ n: number }>(`SELECT COUNT(*) AS n FROM reviews v WHERE ${where.join(" AND ")}`, ...params)!.n;
  // deleted placeholders sink below real reviews in any order
  const rows = all<ReviewRow>(
    `${ROW} WHERE ${where.join(" AND ")} ORDER BY (v.deleted_at IS NOT NULL), ${ORDER[f.sort ?? "top"]} LIMIT ? OFFSET ?`,
    viewerId ?? 0,
    ...params,
    limit,
    offset,
  );
  return { reviews: hydrate(rows, viewerId, REPLIES_SHOWN), total };
}

// Every reply under one review, oldest first (the "show more replies" view).
export function repliesFor(parentId: number, viewerId: number | null): Review[] {
  const rows = all<ReviewRow>(`${ROW} WHERE v.parent_id = ? AND v.deleted_at IS NULL ORDER BY v.created_at, v.id`, viewerId ?? 0, parentId);
  return hydrate(rows, viewerId, 0);
}

export function getReview(id: number, viewerId: number | null = null): Review | undefined {
  const row = one<ReviewRow>(`${ROW} WHERE v.id = ?`, viewerId ?? 0, id);
  return row ? hydrate([row], viewerId, REPLIES_SHOWN)[0] : undefined;
}

// Photos, links and first replies for a page of rows, in a few queries.
function hydrate(rows: ReviewRow[], viewerId: number | null, replies: number): Review[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(", ");
  const photos = all<ReviewPhoto>(`SELECT id, review_id, width, height FROM review_images WHERE review_id IN (${marks}) ORDER BY position, id`, ...ids);
  const links = all<LinkedRecipe & { author_id: number; visibility: string }>(
    `SELECT l.review_id, r.id, r.title, r.image_url, r.author_id, r.visibility FROM review_recipe_links l
     JOIN recipes r ON r.id = l.recipe_id WHERE l.review_id IN (${marks}) ORDER BY l.position`,
    ...ids,
  ).filter((l) => canSeeRecipe(viewerId, l));
  const counts = new Map(
    all<{ parent_id: number; n: number }>(
      `SELECT parent_id, COUNT(*) AS n FROM reviews WHERE parent_id IN (${marks}) AND deleted_at IS NULL GROUP BY parent_id`,
      ...ids,
    ).map((c) => [c.parent_id, c.n]),
  );
  const firstReplies = new Map<number, Review[]>();
  if (replies > 0) {
    const replyRows = all<ReviewRow & { rn: number }>(
      `SELECT * FROM (${ROW.replace("SELECT v.*", "SELECT ROW_NUMBER() OVER (PARTITION BY v.parent_id ORDER BY v.created_at, v.id) AS rn, v.*")}
        WHERE v.parent_id IN (${marks}) AND v.deleted_at IS NULL) WHERE rn <= ?`,
      viewerId ?? 0,
      ...ids,
      replies,
    );
    for (const r of hydrate(replyRows, viewerId, 0)) firstReplies.set(r.parent_id!, [...(firstReplies.get(r.parent_id!) ?? []), r]);
  }
  return rows.map((r) => {
    const gone = !!r.deleted_at;
    return {
      ...r,
      likes: Number(r.likes),
      liked: Number(r.liked),
      // a deleted review shows nothing of what it said
      body: gone ? "" : r.body,
      rating: gone ? null : r.rating,
      photos: gone ? [] : photos.filter((p) => p.review_id === r.id),
      links: gone ? [] : links.filter((l) => l.review_id === r.id).map(({ review_id, id, title, image_url }) => ({ review_id, id, title, image_url })),
      replies: firstReplies.get(r.id) ?? [],
      reply_count: counts.get(r.id) ?? 0,
    };
  });
}

export function summaryFor(recipeId: number): Summary {
  const rows = all<{ rating: number; n: number }>(
    "SELECT rating, COUNT(*) AS n FROM reviews WHERE recipe_id = ? AND parent_id IS NULL AND deleted_at IS NULL AND rating IS NOT NULL GROUP BY rating",
    recipeId,
  );
  const stars: Summary["stars"] = [0, 0, 0, 0, 0];
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    stars[r.rating - 1] = r.n;
    sum += r.rating * r.n;
    count += r.n;
  }
  const with_photos = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM reviews v WHERE v.recipe_id = ? AND v.parent_id IS NULL AND v.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM review_images i WHERE i.review_id = v.id)`,
    recipeId,
  )!.n;
  const samples = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM reviews v JOIN users u ON u.id = v.author_id
     WHERE v.recipe_id = ? AND v.parent_id IS NULL AND v.deleted_at IS NULL AND u.is_sample = 1`,
    recipeId,
  )!.n;
  const languages = all<{ code: string; count: number }>(
    `SELECT lang AS code, COUNT(*) AS count FROM reviews WHERE recipe_id = ? AND parent_id IS NULL AND deleted_at IS NULL
     GROUP BY lang ORDER BY count DESC, lang`,
    recipeId,
  );
  // averaged to one decimal place, rounded half up, from whole stars
  return { count, samples, average: count ? Math.round((sum / count) * 10) / 10 : null, stars, with_photos, languages };
}

// Star averages for many recipes at once (recipe tiles).
export function averagesFor(recipeIds: number[]): Map<number, { average: number; count: number }> {
  const out = new Map<number, { average: number; count: number }>();
  if (!recipeIds.length) return out;
  for (const r of all<{ recipe_id: number; average: number; count: number }>(
    `SELECT recipe_id, AVG(rating) AS average, COUNT(*) AS count FROM reviews
     WHERE recipe_id IN (${recipeIds.map(() => "?").join(", ")}) AND parent_id IS NULL AND deleted_at IS NULL AND rating IS NOT NULL
     GROUP BY recipe_id`,
    ...recipeIds,
  )) {
    out.set(r.recipe_id, { average: Math.round(r.average * 10) / 10, count: r.count });
  }
  return out;
}

// The viewer's own live review of a recipe, if they've written one.
export function ownReview(recipeId: number, userId: number): ReviewRow | undefined {
  return one<ReviewRow>(
    `${ROW} WHERE v.recipe_id = ? AND v.author_id = ? AND v.parent_id IS NULL AND v.deleted_at IS NULL`,
    userId,
    recipeId,
    userId,
  );
}

/* ---------------- writing ---------------- */

export type Problem =
  | "not-found"
  | "empty"
  | "too-long"
  | "no-rating"
  | "own-recipe"
  | "too-soon"
  | "too-many-photos"
  | "bad-photo"
  | "too-many-links"
  | "not-yours"
  | "deleted";

// What each problem says, in English with its limit as {n} (the key for
// src/i18n/reviews.ts); problemText() gives it in the visitor's language.
const PROBLEM_LINE: Record<Problem, [string, number?]> = {
  "not-found": ["That review isn't there any more."],
  empty: ["Write a few words first."],
  "too-long": ["Keep it under {n} characters.", REVIEW_MAX],
  "no-rating": ["Choose a star rating from 1 to 5."],
  "own-recipe": ["You can't rate your own recipe, but you can reply to reviews of it."],
  "too-soon": ["You're posting very fast. Wait a few seconds and try again."],
  "too-many-photos": ["Add up to {n} photos.", PHOTOS_MAX],
  "bad-photo": ["One of those photos couldn't be attached. Upload it again."],
  "too-many-links": ["Link up to {n} recipes.", LINKS_MAX],
  "not-yours": ["Only the person who wrote that can change it."],
  deleted: ["That review was deleted, so it can't be replied to or liked."],
};

// A problem as the person reads it; any other text (already worded for
// them) is passed through as it is.
export function problemText(problem: Problem | string): string {
  if (!Object.hasOwn(PROBLEM_LINE, problem)) return problem;
  const [line, n] = PROBLEM_LINE[problem as Problem];
  return t(line, n === undefined ? undefined : { n });
}

export interface WriteInput {
  body: string;
  rating?: number | null;
  photoIds?: number[];
  linkIds?: number[];
}

type Result<T> = { ok: true } & T | { ok: false; problem: Problem };

function tooSoon(userId: number): boolean {
  return !!one(
    `SELECT 1 FROM reviews WHERE author_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${POST_COOLDOWN_SECONDS} seconds')`,
    userId,
  );
}

function checkBody(body: string): { clean: string } | { problem: Problem } {
  const clean = cleanBody(body);
  if (!clean) return { problem: "empty" };
  if (clean.length > REVIEW_MAX) return { problem: "too-long" };
  return { clean };
}

// Photos uploaded by this person and not yet on a review (or already on
// this one, for an edit): the only ones a review may take.
function claimablePhotos(userId: number, ids: number[], reviewId: number | null): boolean {
  if (!ids.length) return true;
  const n = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM review_images WHERE id IN (${ids.map(() => "?").join(", ")}) AND owner_id = ?
     AND (review_id IS NULL OR review_id IS ?)`,
    ...ids,
    userId,
    reviewId,
  )!.n;
  return n === ids.length;
}

// Linked recipes the writer may see, the reviewed one left out, in order.
function visibleLinks(userId: number, ids: number[], recipeId: number): number[] {
  return [...new Set(ids)].filter((id) => id !== recipeId).filter((id) => !!visibleRecipeFor(userId, id));
}

function attach(reviewId: number, photoIds: number[], linkIds: number[]): void {
  // photos taken off the review go back to being its writer's unposted
  // uploads (swept after a day); `NOT IN ()` can't be written, so none kept
  // is its own case
  if (photoIds.length) run(`UPDATE review_images SET review_id = NULL WHERE review_id = ? AND id NOT IN (${photoIds.map(() => "?").join(", ")})`, reviewId, ...photoIds);
  else run("UPDATE review_images SET review_id = NULL WHERE review_id = ?", reviewId);
  photoIds.forEach((id, i) => run("UPDATE review_images SET review_id = ?, position = ? WHERE id = ?", reviewId, i, id));
  run("DELETE FROM review_recipe_links WHERE review_id = ?", reviewId);
  linkIds.forEach((id, i) => run("INSERT INTO review_recipe_links (review_id, recipe_id, position) VALUES (?, ?, ?)", reviewId, id, i));
}

function checkExtras(userId: number, recipeId: number, input: WriteInput, reviewId: number | null): { photos: number[]; links: number[] } | { problem: Problem } {
  const photos = [...new Set(input.photoIds ?? [])];
  if (photos.length > PHOTOS_MAX) return { problem: "too-many-photos" };
  if (!claimablePhotos(userId, photos, reviewId)) return { problem: "bad-photo" };
  // links to recipes the writer can't see (or to this one) are dropped
  // first; the limit counts the links that will show
  const asked = [...new Set(input.linkIds ?? [])].slice(0, 20);
  const links = visibleLinks(userId, asked, recipeId);
  if (links.length > LINKS_MAX) return { problem: "too-many-links" };
  return { photos, links };
}

// A new review, or the writer's existing one updated: one review per
// person per recipe, so posting again edits it.
export function writeReview(recipeId: number, userId: number, input: WriteInput): Result<{ id: number; edited: boolean }> {
  const recipe = visibleRecipeFor(userId, recipeId);
  if (!recipe) return { ok: false, problem: "not-found" };
  if (recipe.author_id === userId) return { ok: false, problem: "own-recipe" };
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, problem: "no-rating" };
  const b = checkBody(input.body);
  if ("problem" in b) return { ok: false, problem: b.problem };
  const mine = ownReview(recipeId, userId);
  const extras = checkExtras(userId, recipeId, input, mine?.id ?? null);
  if ("problem" in extras) return { ok: false, problem: extras.problem };
  if (!mine && tooSoon(userId)) return { ok: false, problem: "too-soon" };
  const lang = detectLanguage(b.clean);
  return transaction(() => {
    let id: number;
    if (mine) {
      id = mine.id;
      run(
        "UPDATE reviews SET rating = ?, body = ?, lang = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
        rating,
        b.clean,
        lang,
        id,
      );
    } else {
      id = run("INSERT INTO reviews (recipe_id, author_id, rating, body, lang) VALUES (?, ?, ?, ?, ?)", recipeId, userId, rating, b.clean, lang).id;
    }
    attach(id, extras.photos, extras.links);
    publish({ kind: mine ? "edit" : "review", recipeId, reviewId: id });
    return { ok: true as const, id, edited: !!mine };
  });
}

// A reply under a review. Replying to a reply hangs it off the same review,
// naming the person answered. The recipe's author may reply.
export function writeReply(recipeId: number, userId: number, toId: number, input: WriteInput): Result<{ id: number; parentId: number }> {
  if (!visibleRecipeFor(userId, recipeId)) return { ok: false, problem: "not-found" };
  const to = one<{ id: number; recipe_id: number; parent_id: number | null; deleted_at: string | null }>(
    "SELECT id, recipe_id, parent_id, deleted_at FROM reviews WHERE id = ?",
    toId,
  );
  if (!to || to.recipe_id !== recipeId) return { ok: false, problem: "not-found" };
  if (to.deleted_at) return { ok: false, problem: "deleted" };
  const parentId = to.parent_id ?? to.id;
  const parent = one<{ deleted_at: string | null }>("SELECT deleted_at FROM reviews WHERE id = ?", parentId);
  if (!parent) return { ok: false, problem: "not-found" };
  const b = checkBody(input.body);
  if ("problem" in b) return { ok: false, problem: b.problem };
  const extras = checkExtras(userId, recipeId, input, null);
  if ("problem" in extras) return { ok: false, problem: extras.problem };
  if (tooSoon(userId)) return { ok: false, problem: "too-soon" };
  return transaction(() => {
    const { id } = run(
      "INSERT INTO reviews (recipe_id, author_id, parent_id, reply_to_id, body, lang) VALUES (?, ?, ?, ?, ?, ?)",
      recipeId,
      userId,
      parentId,
      to.parent_id ? to.id : null,
      b.clean,
      detectLanguage(b.clean),
    );
    attach(id, extras.photos, extras.links);
    publish({ kind: "reply", recipeId, reviewId: id, parentId });
    return { ok: true as const, id, parentId };
  });
}

// Changing a reply's words (a review is edited by posting it again).
export function editReply(recipeId: number, userId: number, id: number, body: string): Result<{ id: number }> {
  if (!visibleRecipeFor(userId, recipeId)) return { ok: false, problem: "not-found" };
  const r = one<{ author_id: number | null; recipe_id: number; parent_id: number | null; deleted_at: string | null }>(
    "SELECT author_id, recipe_id, parent_id, deleted_at FROM reviews WHERE id = ?",
    id,
  );
  if (!r || r.recipe_id !== recipeId || r.deleted_at) return { ok: false, problem: "not-found" };
  if (r.author_id !== userId) return { ok: false, problem: "not-yours" };
  if (r.parent_id === null) return { ok: false, problem: "not-found" };
  const b = checkBody(body);
  if ("problem" in b) return { ok: false, problem: b.problem };
  run("UPDATE reviews SET body = ?, lang = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?", b.clean, detectLanguage(b.clean), id);
  publish({ kind: "edit", recipeId, reviewId: id, parentId: r.parent_id });
  return { ok: true, id };
}

// Deleting your own review or reply. A review with replies stays as
// "[deleted]" so the thread reads; anything else is removed. Removing the
// last reply under a "[deleted]" review removes that too.
export function deleteReview(recipeId: number, userId: number, id: number): Result<{ removed: "row" | "content" }> {
  if (!visibleRecipeFor(userId, recipeId)) return { ok: false, problem: "not-found" };
  const r = one<{ author_id: number | null; recipe_id: number; parent_id: number | null; deleted_at: string | null }>(
    "SELECT author_id, recipe_id, parent_id, deleted_at FROM reviews WHERE id = ?",
    id,
  );
  if (!r || r.recipe_id !== recipeId || r.deleted_at) return { ok: false, problem: "not-found" };
  if (r.author_id !== userId) return { ok: false, problem: "not-yours" };
  return transaction(() => {
    let removed: "row" | "content" = "row";
    const hasReplies = r.parent_id === null && !!one("SELECT 1 FROM reviews WHERE parent_id = ? AND deleted_at IS NULL", id);
    if (hasReplies) {
      run("DELETE FROM review_images WHERE review_id = ?", id);
      run("DELETE FROM review_recipe_links WHERE review_id = ?", id);
      run("DELETE FROM review_likes WHERE review_id = ?", id);
      run("UPDATE reviews SET rating = NULL, body = '', deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?", id);
      removed = "content";
    } else {
      run("DELETE FROM reviews WHERE id = ?", id);
      // its parent was only kept for this thread
      if (r.parent_id !== null) {
        run(
          "DELETE FROM reviews WHERE id = ? AND deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reviews c WHERE c.parent_id = ?)",
          r.parent_id,
          r.parent_id,
        );
      }
    }
    publish({ kind: "delete", recipeId, reviewId: id, parentId: r.parent_id ?? undefined });
    return { ok: true as const, removed };
  });
}

export function toggleLike(recipeId: number, userId: number, id: number): Result<{ liked: boolean; likes: number }> {
  if (!visibleRecipeFor(userId, recipeId)) return { ok: false, problem: "not-found" };
  const r = one<{ author_id: number | null; recipe_id: number; deleted_at: string | null }>(
    "SELECT author_id, recipe_id, deleted_at FROM reviews WHERE id = ?",
    id,
  );
  if (!r || r.recipe_id !== recipeId) return { ok: false, problem: "not-found" };
  if (r.deleted_at) return { ok: false, problem: "deleted" };
  if (r.author_id === userId) return { ok: false, problem: "not-yours" };
  const had = !!one("SELECT 1 FROM review_likes WHERE review_id = ? AND user_id = ?", id, userId);
  if (had) run("DELETE FROM review_likes WHERE review_id = ? AND user_id = ?", id, userId);
  else run("INSERT OR IGNORE INTO review_likes (review_id, user_id) VALUES (?, ?)", id, userId);
  const likes = one<{ n: number }>("SELECT COUNT(*) AS n FROM review_likes WHERE review_id = ?", id)!.n;
  publish({ kind: "like", recipeId, reviewId: id, likes });
  return { ok: true, liked: !had, likes };
}

/* ---------------- photos ---------------- */

// A photo uploaded while writing, not yet on a review. Swept after a day if
// the review is never posted.
// Unposted photos one person may hold at once, and photos a day: enough to
// write several reviews, too few to fill the volume.
export const LOOSE_PHOTOS_MAX = 12;
export const PHOTOS_PER_DAY = 40;

export function photoAllowance(userId: number): "ok" | "too-many-loose" | "too-many-today" {
  const loose = one<{ n: number }>("SELECT COUNT(*) AS n FROM review_images WHERE owner_id = ? AND review_id IS NULL", userId)!.n;
  if (loose >= LOOSE_PHOTOS_MAX) return "too-many-loose";
  const today = one<{ n: number }>("SELECT COUNT(*) AS n FROM review_images WHERE owner_id = ? AND created_at > datetime('now', '-1 day')", userId)!.n;
  return today >= PHOTOS_PER_DAY ? "too-many-today" : "ok";
}

export function savePhoto(userId: number, bytes: Buffer, mime: string, width: number, height: number): number {
  run("DELETE FROM review_images WHERE review_id IS NULL AND created_at < datetime('now', '-1 day')");
  return run("INSERT INTO review_images (owner_id, mime, bytes, width, height) VALUES (?, ?, ?, ?, ?)", userId, mime, stripMetadata(bytes, mime), width, height).id;
}

// A photo's hidden metadata removed before it's stored: EXIF (where a phone
// writes the GPS position it was taken at, the camera, the time), XMP and
// comments. JPEG: the APP1-APP15 and COM segments are dropped, APP0 (JFIF)
// and the image data kept. PNG: the text and EXIF chunks. WebP: the EXIF and
// XMP chunks, with the RIFF size fixed up. The picture itself is untouched.
export function stripMetadata(bytes: Buffer, mime: string): Buffer {
  try {
    if (mime === "image/jpeg") {
      const parts: Buffer[] = [bytes.subarray(0, 2)];
      let i = 2;
      while (i + 4 <= bytes.length && bytes[i] === 0xff) {
        const marker = bytes[i + 1];
        // start of scan: the image data runs to the end
        if (marker === 0xda) break;
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          parts.push(bytes.subarray(i, i + 2));
          i += 2;
          continue;
        }
        const len = bytes.readUInt16BE(i + 2);
        const seg = bytes.subarray(i, i + 2 + len);
        if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) parts.push(seg);
        i += 2 + len;
      }
      parts.push(bytes.subarray(i));
      return Buffer.concat(parts);
    }
    if (mime === "image/png") {
      const parts: Buffer[] = [bytes.subarray(0, 8)];
      let i = 8;
      while (i + 8 <= bytes.length) {
        const len = bytes.readUInt32BE(i);
        const type = bytes.toString("ascii", i + 4, i + 8);
        const end = i + 12 + len;
        if (!["tEXt", "zTXt", "iTXt", "eXIf", "tIME"].includes(type)) parts.push(bytes.subarray(i, end));
        i = end;
      }
      return Buffer.concat(parts);
    }
    if (mime === "image/webp") {
      const parts: Buffer[] = [];
      let i = 12;
      while (i + 8 <= bytes.length) {
        const type = bytes.toString("ascii", i, i + 4);
        const len = bytes.readUInt32LE(i + 4);
        const end = i + 8 + len + (len % 2);
        if (type !== "EXIF" && type !== "XMP ") parts.push(bytes.subarray(i, end));
        i = end;
      }
      const body = Buffer.concat(parts);
      const head = Buffer.from(bytes.subarray(0, 12));
      head.writeUInt32LE(body.length + 4, 4);
      // the VP8X header's flags say which chunks follow: EXIF and XMP are gone
      const vp8x = body.indexOf("VP8X");
      if (vp8x === 0) body[8] &= ~0x0c;
      return Buffer.concat([head, body]);
    }
  } catch {
    // an unreadable layout: refuse to guess, keep it as checked
  }
  return bytes;
}

// A review photo for a viewer: only if they may see the recipe it's on, or
// it's their own photo not yet posted.
export function photoFor(viewerId: number | null, id: number): { mime: string; bytes: Uint8Array } | undefined {
  const p = one<{ mime: string; bytes: Uint8Array; review_id: number | null; owner_id: number | null; recipe_id: number | null }>(
    `SELECT i.mime, i.bytes, i.review_id, i.owner_id, v.recipe_id FROM review_images i
     LEFT JOIN reviews v ON v.id = i.review_id WHERE i.id = ?`,
    id,
  );
  if (!p) return undefined;
  if (p.review_id === null) return viewerId !== null && p.owner_id === viewerId ? p : undefined;
  return p.recipe_id !== null && visibleRecipeFor(viewerId, p.recipe_id) ? p : undefined;
}

/* ---------------- live: new reviews and who's typing ---------------- */

// One machine serves everyone (fly.toml), so an EventEmitter is the whole
// message bus, as for live cooking (src/live.ts).
export type ReviewEvent =
  | { kind: "review" | "edit" | "reply" | "delete"; recipeId: number; reviewId: number; parentId?: number }
  | { kind: "like"; recipeId: number; reviewId: number; likes: number }
  | { kind: "typing"; recipeId: number; names: string[] };

export const reviewBus = new EventEmitter();
reviewBus.setMaxListeners(0);

function publish(e: ReviewEvent): void {
  reviewBus.emit("event", e);
}

// Who is writing a review or reply on a recipe right now: refreshed by the
// page every few seconds while they type, gone after TYPING_TTL_MS without
// one, or when they post, clear the box or leave.
export const TYPING_TTL_MS = 8000;
const typing = new Map<number, Map<number, { name: string; until: number }>>();

function typingNames(recipeId: number, now = Date.now()): string[] {
  const m = typing.get(recipeId);
  if (!m) return [];
  for (const [uid, t] of m) if (t.until <= now) m.delete(uid);
  if (!m.size) typing.delete(recipeId);
  return [...(m?.values() ?? [])].map((t) => t.name);
}

// Returns the names typing now, for everyone but `forUser` (you don't see
// your own dots).
export function typingOn(recipeId: number, exceptUser: number | null): string[] {
  const m = typing.get(recipeId);
  typingNames(recipeId);
  if (!m) return [];
  return [...m].filter(([uid]) => uid !== exceptUser).map(([, t]) => t.name);
}

export function setTyping(recipeId: number, userId: number, name: string, on: boolean, now = Date.now()): void {
  const before = typingNames(recipeId, now).join("|");
  let m = typing.get(recipeId);
  if (on) {
    if (!m) typing.set(recipeId, (m = new Map()));
    m.set(userId, { name, until: now + TYPING_TTL_MS });
  } else m?.delete(userId);
  if (m && !m.size) typing.delete(recipeId);
  const after = typingNames(recipeId, now);
  if (after.join("|") !== before) publish({ kind: "typing", recipeId, names: after });
}

// Expired typers announced as gone, so dots don't hang when a tab closes.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [recipeId, m] of typing) {
    const before = m.size;
    for (const [uid, t] of m) if (t.until <= now) m.delete(uid);
    if (m.size !== before) publish({ kind: "typing", recipeId, names: [...m.values()].map((t) => t.name) });
    if (!m.size) typing.delete(recipeId);
  }
}, 2000);
sweep.unref();
