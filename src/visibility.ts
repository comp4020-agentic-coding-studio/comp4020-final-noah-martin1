import { all, one } from "./db.ts";

// Every decision about who may see another person's recipes or calendar lives
// here, so the privacy boundary (CLAUDE.md invariant 4) has exactly one home.
// Routes never write their own visibility SQL: they call these.

export type Visibility = "public" | "friends" | "private";

export function areFriends(a: number, b: number): boolean {
  if (a === b) return false;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return !!one(
    "SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'accepted'",
    lo,
    hi,
  );
}

export function friendIds(userId: number): number[] {
  return all<{ id: number }>(
    `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id
     FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'`,
    userId,
    userId,
    userId,
  ).map((r) => r.id);
}

export function canSeeRecipe(
  viewerId: number | null,
  recipe: { author_id: number; visibility: string },
): boolean {
  if (recipe.visibility === "public") return true;
  if (viewerId === null) return false;
  if (viewerId === recipe.author_id) return true;
  return recipe.visibility === "friends" && areFriends(viewerId, recipe.author_id);
}

// SQL fragment matching the recipes (aliased `r`) a viewer may see, for list
// queries. The viewer id is bound three times, in the order given.
export function visibleRecipeSql(viewerId: number | null): { where: string; params: number[] } {
  if (viewerId === null) return { where: "r.visibility = 'public'", params: [] };
  return {
    where: `(r.visibility = 'public' OR r.author_id = ? OR (r.visibility = 'friends' AND EXISTS (
      SELECT 1 FROM friendships f WHERE f.status = 'accepted'
        AND ((f.user_a = ? AND f.user_b = r.author_id) OR (f.user_b = ? AND f.user_a = r.author_id)))))`,
    params: [viewerId, viewerId, viewerId],
  };
}

// A personal calendar entry is visible to its owner, and to accepted friends
// only when marked shared AND the recipe itself is visible to them, so sharing
// a meal never leaks the title of a private recipe.
export function canSeeCalendarEntry(
  viewerId: number | null,
  entry: { owner_id: number; shared: number; recipe_author_id: number; recipe_visibility: string },
): boolean {
  if (viewerId === null) return false;
  if (viewerId === entry.owner_id) return true;
  return (
    !!entry.shared &&
    areFriends(viewerId, entry.owner_id) &&
    canSeeRecipe(viewerId, { author_id: entry.recipe_author_id, visibility: entry.recipe_visibility })
  );
}
