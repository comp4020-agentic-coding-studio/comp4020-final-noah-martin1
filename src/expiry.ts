import { logActivity } from "./activity.ts";
import { addDays, today } from "./format.ts";
import { all, run } from "./db.ts";

// What happens to food after its expiry date, in one place. Every page that
// reads the kitchen (fridge, pantry, recipes, planner, shopping lists, the
// household) asks this module what counts, so they always agree.
//
//   expiry date E      usable through the end of E
//   E + 1              grace day: still listed, not counted as stock, and the
//                      owner is asked "Do you still have this?"
//   E + 2 onwards      removed from the active kitchen by itself (the row is
//                      kept with removed_at set, so history isn't lost)
//
// Saying "I still have it" sets kept_at: the item counts as stock again and
// is never removed because of that date. Changing the expiry date clears
// kept_at, so the new date governs. Removal never depends on anyone having a
// page open: every read applies the same rule, and a sweep (on boot and
// hourly) writes it down and logs it.

export const GRACE_DAYS = 1;

// The first day an unanswered expired item is gone from the kitchen.
export function removalDate(expiry: string): string {
  return addDays(expiry, GRACE_DAYS + 1);
}

export type ExpiryState = "fresh" | "none" | "grace" | "kept" | "removed";

export function expiryState(item: { expiry_date: string | null; kept_at: string | null; removed_at?: string | null }, on = today()): ExpiryState {
  if (item.removed_at) return "removed";
  if (!item.expiry_date) return "none";
  if (item.expiry_date >= on) return "fresh";
  if (item.kept_at) return "kept";
  return removalDate(item.expiry_date) <= on ? "removed" : "grace";
}

// SQL for an inventory row (aliased `it`, or bare when alias is "") that is
// still in the kitchen: not removed and not past its grace day unanswered.
// Bind `listedParams(on)`.
export function listedSql(alias = "it"): string {
  const a = alias ? `${alias}.` : "";
  return `(${a}removed_at IS NULL AND (${a}expiry_date IS NULL OR ${a}kept_at IS NOT NULL OR ${a}expiry_date >= ?))`;
}
export function listedParams(on = today()): string[] {
  // last expiry date still listed: today − 1 (the grace day)
  return [addDays(on, -GRACE_DAYS)];
}

// SQL for a row that counts as usable stock: listed, has some left, and not
// expired (or expired and kept by its owner). Bind `stockParams(on)`.
export function stockSql(alias = "it"): string {
  const a = alias ? `${alias}.` : "";
  return `(${a}removed_at IS NULL AND ${a}quantity > 0 AND (${a}expiry_date IS NULL OR ${a}kept_at IS NOT NULL OR ${a}expiry_date >= ?))`;
}
export function stockParams(on = today()): string[] {
  return [on];
}

// Writes down what the read rule already says: every unanswered item past
// its grace day is marked removed, once, with a log line per owner.
export function sweepExpiredItems(on = today()): number {
  const cutoff = addDays(on, -GRACE_DAYS);
  const due = all<{ id: number; owner_type: string; owner_id: number; name: string; expiry_date: string }>(
    `SELECT it.id, it.owner_type, it.owner_id, i.name, it.expiry_date
     FROM inventory_items it JOIN ingredients i ON i.id = it.ingredient_id
     WHERE it.removed_at IS NULL AND it.kept_at IS NULL AND it.expiry_date IS NOT NULL AND it.expiry_date < ?`,
    cutoff,
  );
  for (const item of due) {
    const changed = run(
      "UPDATE inventory_items SET removed_at = datetime('now'), removed_reason = 'expired' WHERE id = ? AND removed_at IS NULL AND kept_at IS NULL",
      item.id,
    ).changes;
    if (changed) {
      logActivity({
        action: "pantry.auto_remove",
        subject: item.name,
        detail: { item: item.id, owner: `${item.owner_type}:${item.owner_id}`, expired: item.expiry_date, removed_on: on },
      });
    }
  }
  return due.length;
}

export function startExpirySweep(): void {
  const tick = () => {
    try {
      sweepExpiredItems();
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "pantry.sweep_failed", error: String(err) }));
    }
  };
  tick();
  setInterval(tick, 60 * 60_000).unref();
}
