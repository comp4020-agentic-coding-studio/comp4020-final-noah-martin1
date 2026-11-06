// Deleting an account. What was the person's alone goes with them: their
// recipes (and the reviews on them), pantry, planned meals, photos, friends,
// sessions and scans. What they gave to others stays, without their name or
// picture: reviews and replies on other people's recipes (migration 012),
// and what they added to a shared household's pantry or calendar, which
// passes to the household's owner. They leave their household first, the
// same way leaving it by hand works (src/household.ts).

import { one, run, transaction } from "./db.ts";
import { householdFor, leaveHousehold } from "./household.ts";

export interface DeletionSummary {
  recipes: number;
  reviewsKept: number;
  household: "none" | "left" | "deleted";
}

// What deleting would do, for the confirmation page.
export function deletionPreview(userId: number): { recipes: number; reviewsKept: number; household: string | null } {
  return {
    recipes: one<{ n: number }>("SELECT COUNT(*) AS n FROM recipes WHERE author_id = ?", userId)!.n,
    // reviews and replies on other people's recipes, which stay
    reviewsKept: one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM reviews v JOIN recipes r ON r.id = v.recipe_id
       WHERE v.author_id = ? AND r.author_id != ? AND v.deleted_at IS NULL`,
      userId,
      userId,
    )!.n,
    household: householdFor(userId)?.name ?? null,
  };
}

export function deleteAccount(userId: number): DeletionSummary {
  const preview = deletionPreview(userId);
  // leaving first, by the household's own rules (its own transaction)
  const house = householdFor(userId);
  let household: DeletionSummary["household"] = "none";
  if (house) {
    const left = leaveHousehold(userId);
    household = left.deleted ? "deleted" : "left";
    if (!left.deleted) {
      // what they added to the shared pantry and calendar stays the
      // household's, credited to whoever owns it now
      const owner = one<{ user_id: number }>(
        "SELECT user_id FROM household_members WHERE household_id = ? ORDER BY role = 'owner' DESC, joined_at, user_id LIMIT 1",
        house.id,
      );
      if (owner) {
        run("UPDATE inventory_items SET added_by = ? WHERE owner_type = 'household' AND owner_id = ? AND added_by = ?", owner.user_id, house.id, userId);
        run("UPDATE calendar_entries SET planned_by = ? WHERE owner_type = 'household' AND owner_id = ? AND planned_by = ?", owner.user_id, house.id, userId);
      }
    }
  }
  transaction(() => {
    // their own pantry and calendar (no foreign key to clean these up)
    run("DELETE FROM inventory_items WHERE owner_type = 'user' AND owner_id = ?", userId);
    run("DELETE FROM calendar_entries WHERE owner_type = 'user' AND owner_id = ?", userId);
    // what they added to households they left earlier is still those
    // households': credited to each one's owner (or first member) now. Only
    // a household with nobody in it (none exist: the last out deletes it)
    // would lose them.
    for (const table of [["inventory_items", "added_by"], ["calendar_entries", "planned_by"]] as const) {
      run(
        `UPDATE ${table[0]} SET ${table[1]} = (
           SELECT m.user_id FROM household_members m WHERE m.household_id = ${table[0]}.owner_id
           ORDER BY m.role = 'owner' DESC, m.joined_at, m.user_id LIMIT 1)
         WHERE ${table[1]} = ? AND owner_type = 'household'
           AND EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = ${table[0]}.owner_id)`,
        userId,
      );
      run(`DELETE FROM ${table[0]} WHERE ${table[1]} = ?`, userId);
    }
    // planned meals elsewhere that point at their recipes (which go)
    run("DELETE FROM calendar_entries WHERE recipe_id IN (SELECT id FROM recipes WHERE author_id = ?)", userId);
    // the rest cascades from users (recipes, sessions, friendships, photos,
    // likes...); reviews on others' recipes keep their words, author cleared
    run("DELETE FROM users WHERE id = ?", userId);
  });
  return { recipes: preview.recipes, reviewsKept: preview.reviewsKept, household };
}
