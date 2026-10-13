import { randomInt } from "node:crypto";
import { all, ingredientId, normaliseIngredient, one, run, transaction } from "./db.ts";
import { addDays, money, parseIsoDate, qty, SOON_DAYS, shortDate, today, weekday } from "./format.ts";
import { HttpError } from "./http.ts";
import { estimate, priceSource } from "./nutrition.ts";
import { catalogueByTitle, getRecipe, ingredientsFor } from "./recipes.ts";
import { canSeeRecipe } from "./visibility.ts";

// Households: people who live together sharing one pantry, one meal calendar
// and one shopping list. This module is the single home of the membership
// rule, the way src/visibility.ts is for recipes: every household read or
// write takes the viewer's user id and resolves *their* household here, so a
// route can never name somebody else's. Anything household-scoped that the
// viewer isn't a member of answers 404, never 403, so outsiders can't probe
// what exists. Recipe visibility inside a house still goes through
// visibility.ts (canSeeRecipe).

export type Role = "owner" | "member";

export interface House {
  id: number;
  name: string;
  invite_code: string;
  weekly_budget_cents: number | null;
  created_by: number | null;
  created_at: string;
  role: Role;
}

export interface Member {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  joined_at: string;
}

/* ---------------- membership ---------------- */

export function householdFor(userId: number): House | undefined {
  return one<House>(
    `SELECT h.id, h.name, h.invite_code, h.weekly_budget_cents, h.created_by, h.created_at, m.role
     FROM household_members m JOIN households h ON h.id = m.household_id
     WHERE m.user_id = ?`,
    userId,
  );
}

export function isMember(userId: number, householdId: number): boolean {
  return !!one("SELECT 1 FROM household_members WHERE user_id = ? AND household_id = ?", userId, householdId);
}

export function members(householdId: number): Member[] {
  return all<Member>(
    `SELECT u.id, u.username, u.display_name, m.role, m.joined_at
     FROM household_members m JOIN users u ON u.id = m.user_id
     WHERE m.household_id = ?
     ORDER BY m.role = 'owner' DESC, m.joined_at, u.id`,
    householdId,
  );
}

// The viewer's household, or a 404 for anything household-scoped.
export function requireHouse(userId: number): House {
  const house = householdFor(userId);
  if (!house) throw new HttpError(404, "You're not in a household, so there's nothing here for you.");
  return house;
}

/* ---------------- invite codes ---------------- */

// Eight characters from an alphabet with no look-alikes (no 0/O, 1/I/L), so a
// code read aloud across a kitchen survives. Shown as ABCD-EFGH.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

function newCode(): string {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

// A fresh code that no other household holds (collisions are ~1 in 10^12,
// but checked anyway).
function uniqueCode(): string {
  for (let i = 0; i < 10; i++) {
    const code = newCode();
    if (!one("SELECT 1 FROM households WHERE invite_code = ?", code)) return code;
  }
  throw new Error("could not generate a unique invite code");
}

/* ---------------- the activity log ---------------- */

export type EventKind =
  | "created" | "joined" | "left" | "renamed" | "code" | "budget"
  | "added" | "moved" | "updated" | "removed" | "bought"
  | "planned" | "cooked" | "skipped" | "unplanned"
  | "claimed" | "unclaimed" | "tonight" | "released" | "nudge";

interface LogExtra {
  subject?: string;
  recipeId?: number | null;
  refDate?: string | null;
  forUser?: number | null;
  // a SQLite date modifier like "-2 hours", for seeded history only
  ago?: string;
}

function log(houseId: number, actorId: number | null, kind: EventKind, extra: LogExtra = {}): void {
  run(
    `INSERT INTO household_events (household_id, actor_id, kind, subject, recipe_id, ref_date, for_user, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
    houseId,
    actorId,
    kind,
    extra.subject ?? "",
    extra.recipeId ?? null,
    extra.refDate ?? null,
    extra.forUser ?? null,
    extra.ago ?? "+0 seconds",
  );
}

interface EventRow {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  kind: EventKind;
  subject: string;
  recipe_id: number | null;
  ref_date: string | null;
  for_user: number | null;
  created_at: string;
  title: string | null;
  author_id: number | null;
  visibility: string | null;
}

export interface Activity {
  id: number;
  kind: EventKind;
  actorId: number | null;
  // "You" for the viewer, otherwise the actor's display name
  who: string;
  name: string;
  text: string;
  recipeId: number | null;
  nudge: boolean;
  at: string;
}

const FULL_DAYS: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

function dayName(iso: string | null): string {
  if (!iso) return "the";
  if (iso === today()) return "tonight's";
  if (iso === addDays(today(), 1)) return "tomorrow's";
  return `${FULL_DAYS[weekday(iso)] ?? weekday(iso)}'s`;
}

// "dinner today", "lunch on Thu 15 Oct"
function slot(meal: string, iso: string | null): string {
  if (!iso) return meal;
  const day = iso === today() ? "today" : iso === addDays(today(), 1) ? "tomorrow" : `on ${weekday(iso)} ${shortDate(iso)}`;
  return `${meal || "a meal"} ${day}`.trim();
}

// One line of plain text per event, worded for the person reading it. A
// recipe the reader can't see is never named.
function describe(e: EventRow, viewerId: number): string | null {
  const seen = e.recipe_id !== null && e.title !== null && canSeeRecipe(viewerId, { author_id: e.author_id!, visibility: e.visibility! });
  const title = seen ? e.title! : "a meal";
  const when = slot(e.subject, e.ref_date);
  // every line reads after either a name or "You", so no verb agrees with a person
  switch (e.kind) {
    case "created": return `started the household${e.subject ? ` “${e.subject}”` : ""}`;
    case "joined": return "joined the household";
    case "left": return "left the household";
    case "renamed": return `renamed the house to “${e.subject}”`;
    case "code": return "made a new invite code (the old one stopped working)";
    case "budget": return e.subject ? `set the weekly house budget to ${e.subject}` : "cleared the weekly house budget";
    case "added": return `added ${e.subject} to the house pantry`;
    case "moved": return `moved ${e.subject} from their own pantry into the house`;
    case "updated": return `updated ${e.subject}`;
    case "removed": return `took ${e.subject} out of the house pantry`;
    case "bought": return `bought ${e.subject} for the house`;
    case "planned": return `planned ${title} for ${when}`;
    case "cooked": return `cooked ${title} for the house`;
    case "skipped": return `skipped ${title} (${when})`;
    case "unplanned": return `took ${title} off the house calendar (${when})`;
    case "claimed": return `claimed ${e.subject} on the shopping list`;
    case "unclaimed": return `put ${e.subject} back on the list for anyone to buy`;
    case "tonight": return `called the ${e.subject} for tonight, before it goes off`;
    case "released": return `let go of the ${e.subject}, so it's up for grabs again`;
    case "nudge":
      if (!seen) return null;
      return e.for_user === null
        ? `added ${e.subject}, so ${dayName(e.ref_date)} ${title} is now fully covered by the house pantry`
        : `added ${e.subject}, so you can now make ${title}`;
  }
}

// What happened in the viewer's house, newest first. A nudge worked out from
// one person's own pantry is shown to that person only.
export function houseActivity(viewerId: number, opts: { limit?: number; since?: number } = {}): Activity[] {
  const house = requireHouse(viewerId);
  const rows = all<EventRow>(
    `SELECT e.id, e.actor_id, u.display_name AS actor_name, e.kind, e.subject, e.recipe_id, e.ref_date, e.for_user,
            e.created_at, r.title, r.author_id, r.visibility
     FROM household_events e
     LEFT JOIN users u ON u.id = e.actor_id
     LEFT JOIN recipes r ON r.id = e.recipe_id
     WHERE e.household_id = ? AND (e.for_user IS NULL OR e.for_user = ?) AND e.id > ?
     ORDER BY e.id DESC LIMIT ?`,
    house.id,
    viewerId,
    opts.since ?? 0,
    opts.limit ?? 20,
  );
  const out: Activity[] = [];
  for (const e of rows) {
    const text = describe(e, viewerId);
    if (text === null) continue;
    out.push({
      id: e.id,
      kind: e.kind,
      actorId: e.actor_id,
      who: e.actor_id === viewerId ? "You" : (e.actor_name ?? "Someone"),
      name: e.actor_name ?? "Someone",
      text,
      recipeId: e.kind === "nudge" || e.kind === "planned" ? e.recipe_id : null,
      nudge: e.kind === "nudge",
      at: e.created_at,
    });
  }
  return out;
}

// Bumps on every write anyone in the house makes that the viewer could see:
// the polling client compares it to know when to refresh.
export function houseVersion(viewerId: number): number {
  const house = requireHouse(viewerId);
  return (
    one<{ v: number | null }>(
      "SELECT MAX(id) AS v FROM household_events WHERE household_id = ? AND (for_user IS NULL OR for_user = ?)",
      house.id,
      viewerId,
    )?.v ?? 0
  );
}

// Every live claim in the viewer's house, for the polling endpoint.
export function houseClaims(viewerId: number): {
  shopping: { ingredient: string; by: string; at: string }[];
  tonight: { item: string; by: string; forDate: string; at: string }[];
} {
  const house = requireHouse(viewerId);
  return {
    shopping: all<{ ingredient: string; by: string; at: string }>(
      `SELECT i.name AS ingredient, u.display_name AS by, c.claimed_at AS at
       FROM shopping_claims c JOIN ingredients i ON i.id = c.ingredient_id JOIN users u ON u.id = c.claimed_by
       WHERE c.household_id = ? ORDER BY c.claimed_at`,
      house.id,
    ),
    tonight: all<{ item: string; by: string; forDate: string; at: string }>(
      `SELECT i.name AS item, u.display_name AS by, c.for_date AS forDate, c.claimed_at AS at
       FROM item_claims c JOIN inventory_items it ON it.id = c.inventory_item_id
       JOIN ingredients i ON i.id = it.ingredient_id JOIN users u ON u.id = c.claimed_by
       WHERE it.owner_type = 'household' AND it.owner_id = ? AND c.for_date >= date('now', 'localtime')
       ORDER BY c.claimed_at`,
      house.id,
    ),
  };
}

/* ---------------- create, join, leave ---------------- */

export function validName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 60 ? name : null;
}

export type CreateResult = { ok: true; id: number } | { ok: false; problem: "name" | "already" };

export function createHousehold(userId: number, rawName: string): CreateResult {
  const name = validName(rawName);
  if (!name) return { ok: false, problem: "name" };
  return transaction(() => {
    if (householdFor(userId)) return { ok: false as const, problem: "already" as const };
    const id = run(
      "INSERT INTO households (name, invite_code, created_by) VALUES (?, ?, ?)",
      name,
      uniqueCode(),
      userId,
    ).id;
    run("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')", id, userId);
    log(id, userId, "created", { subject: name });
    return { ok: true as const, id };
  });
}

export type JoinResult = { ok: true; house: House } | { ok: false; problem: "code" | "already"; house?: House };

export function joinHousehold(userId: number, rawCode: string): JoinResult {
  const code = normaliseCode(rawCode);
  return transaction(() => {
    const current = householdFor(userId);
    if (current) return { ok: false as const, problem: "already" as const, house: current };
    const target = code.length === CODE_LENGTH ? one<{ id: number }>("SELECT id FROM households WHERE invite_code = ?", code) : undefined;
    if (!target) return { ok: false as const, problem: "code" as const };
    run("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')", target.id, userId);
    log(target.id, userId, "joined");
    return { ok: true as const, house: householdFor(userId)! };
  });
}

// Leaving drops the leaver's claims (nobody waits on a purchase from someone
// who's gone). An owner leaving hands the house to the longest-standing
// member; the last person out deletes the household and everything shared:
// its pantry, its calendar, its claims and its log.
export function leaveHousehold(userId: number): { left: boolean; deleted: boolean; name: string } {
  return transaction(() => {
    const house = householdFor(userId);
    if (!house) return { left: false, deleted: false, name: "" };
    run("DELETE FROM household_members WHERE household_id = ? AND user_id = ?", house.id, userId);
    run("DELETE FROM shopping_claims WHERE household_id = ? AND claimed_by = ?", house.id, userId);
    run(
      `DELETE FROM item_claims WHERE claimed_by = ? AND inventory_item_id IN
         (SELECT id FROM inventory_items WHERE owner_type = 'household' AND owner_id = ?)`,
      userId,
      house.id,
    );
    const rest = members(house.id);
    if (!rest.length) {
      run("DELETE FROM inventory_items WHERE owner_type = 'household' AND owner_id = ?", house.id);
      run("DELETE FROM calendar_entries WHERE owner_type = 'household' AND owner_id = ?", house.id);
      run("DELETE FROM households WHERE id = ?", house.id);
      return { left: true, deleted: true, name: house.name };
    }
    if (house.role === "owner" && !rest.some((m) => m.role === "owner")) {
      const heir = [...rest].sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.id - b.id)[0];
      run("UPDATE household_members SET role = 'owner' WHERE household_id = ? AND user_id = ?", house.id, heir.id);
    }
    log(house.id, userId, "left");
    return { left: true, deleted: false, name: house.name };
  });
}

function requireOwner(userId: number): House {
  const house = requireHouse(userId);
  if (house.role !== "owner") throw new HttpError(403, "Only the household's owner can do that.");
  return house;
}

export function regenerateCode(userId: number): string {
  const house = requireOwner(userId);
  const code = uniqueCode();
  run("UPDATE households SET invite_code = ? WHERE id = ?", code, house.id);
  log(house.id, userId, "code");
  return code;
}

export function renameHousehold(userId: number, rawName: string): string | null {
  const house = requireOwner(userId);
  const name = validName(rawName);
  if (!name) return null;
  if (name !== house.name) {
    run("UPDATE households SET name = ? WHERE id = ?", name, house.id);
    log(house.id, userId, "renamed", { subject: name });
  }
  return name;
}

export function setHouseBudget(userId: number, cents: number | null): void {
  const house = requireHouse(userId);
  if (cents === house.weekly_budget_cents) return;
  run("UPDATE households SET weekly_budget_cents = ? WHERE id = ?", cents, house.id);
  log(house.id, userId, "budget", { subject: cents === null ? "" : money(cents) });
}

/* ---------------- the shared pantry ---------------- */

export interface ItemInput {
  name: string;
  quantity: number;
  unit: string;
  expiry_date: string | null;
  price_cents: number | null;
}

// The same rules as the personal pantry (src/routes/pantry.ts): a name, a
// quantity of zero or more, an ISO expiry date and a non-negative price. The
// table's CHECK constraints back this up.
export function parseItem(form: URLSearchParams): { input: ItemInput; values: Record<string, string>; problems: string[] } {
  const values = {
    name: (form.get("name") ?? "").trim(),
    quantity: (form.get("quantity") ?? "").trim(),
    unit: (form.get("unit") ?? "").trim(),
    expiry_date: (form.get("expiry_date") ?? "").trim(),
    price: (form.get("price") ?? "").trim().replace(/^\$/, ""),
  };
  const problems: string[] = [];
  if (!values.name || values.name.length > 80) problems.push("Name the item (up to 80 characters).");
  const quantity = Number(values.quantity);
  if (values.quantity === "" || !Number.isFinite(quantity) || quantity < 0 || quantity > 100000) {
    problems.push("Quantity must be a number of zero or more.");
  }
  if (values.expiry_date && !parseIsoDate(values.expiry_date)) problems.push("Expiry must be a valid date.");
  let price_cents: number | null = null;
  if (values.price !== "") {
    const dollars = Number(values.price);
    if (!/^\d+(\.\d{1,2})?$/.test(values.price) || !Number.isFinite(dollars) || dollars > 10000) {
      problems.push("Price must be a dollar amount like 4.50.");
    } else {
      price_cents = Math.round(dollars * 100);
    }
  }
  return {
    input: { name: values.name, quantity, unit: values.unit.slice(0, 20), expiry_date: values.expiry_date || null, price_cents },
    values,
    problems,
  };
}

export interface Claim {
  user_id: number;
  name: string;
  at: string;
}

export interface HouseItem {
  id: number;
  ingredient_id: number;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  expiry_date: string | null;
  price_cents: number | null;
  added_by: number;
  added_by_name: string;
  added_at: string;
  // an active "use tonight" claim (for today or later)
  tonight: (Claim & { for_date: string }) | null;
}

interface ItemRow extends Omit<HouseItem, "tonight"> {
  claim_user: number | null;
  claim_name: string | null;
  claim_date: string | null;
  claim_at: string | null;
}

const ITEM_SELECT = `SELECT it.id, it.ingredient_id, i.name, i.category, it.quantity, it.unit, it.expiry_date, it.price_cents,
    it.added_by, u.display_name AS added_by_name, it.added_at,
    c.claimed_by AS claim_user, cu.display_name AS claim_name, c.for_date AS claim_date, c.claimed_at AS claim_at
  FROM inventory_items it
  JOIN ingredients i ON i.id = it.ingredient_id
  JOIN users u ON u.id = it.added_by
  LEFT JOIN item_claims c ON c.inventory_item_id = it.id AND c.for_date >= date('now', 'localtime')
  LEFT JOIN users cu ON cu.id = c.claimed_by`;

function hydrateItem(r: ItemRow): HouseItem {
  const { claim_user, claim_name, claim_date, claim_at, ...rest } = r;
  return {
    ...rest,
    tonight: claim_user !== null ? { user_id: claim_user, name: claim_name ?? "Someone", for_date: claim_date!, at: claim_at! } : null,
  };
}

// Soonest expiry first; undated items last.
export function houseItems(viewerId: number): HouseItem[] {
  const house = requireHouse(viewerId);
  return all<ItemRow>(
    `${ITEM_SELECT} WHERE it.owner_type = 'household' AND it.owner_id = ?
     ORDER BY it.expiry_date IS NULL, it.expiry_date, i.name`,
    house.id,
  ).map(hydrateItem);
}

// One shared item, only if it belongs to the viewer's house; otherwise 404,
// whether it's another house's item, someone's personal item or no item.
export function houseItem(viewerId: number, itemId: number): HouseItem {
  const house = requireHouse(viewerId);
  const row = Number.isInteger(itemId)
    ? one<ItemRow>(`${ITEM_SELECT} WHERE it.id = ? AND it.owner_type = 'household' AND it.owner_id = ?`, itemId, house.id)
    : undefined;
  if (!row) throw new HttpError(404, "That item isn't in your household's pantry.");
  return hydrateItem(row);
}

function isFresh(quantity: number, expiry: string | null): boolean {
  return quantity > 0 && (expiry === null || expiry >= today());
}

function itemLabel(name: string, quantity: number, unit: string): string {
  return `${normaliseIngredient(name)} (${qty(quantity, unit)})`;
}

export function addItem(viewerId: number, input: ItemInput): number {
  const house = requireHouse(viewerId);
  return transaction(() => {
    const ing = ingredientId(input.name, input.unit);
    const id = run(
      `INSERT INTO inventory_items (owner_type, owner_id, ingredient_id, quantity, unit, expiry_date, price_cents, added_by)
       VALUES ('household', ?, ?, ?, ?, ?, ?, ?)`,
      house.id, ing, input.quantity, input.unit, input.expiry_date, input.price_cents, viewerId,
    ).id;
    log(house.id, viewerId, "added", { subject: itemLabel(input.name, input.quantity, input.unit) });
    if (isFresh(input.quantity, input.expiry_date)) nudge(house.id, viewerId, ing, normaliseIngredient(input.name), [id]);
    return id;
  });
}

export function updateItem(viewerId: number, itemId: number, input: ItemInput): void {
  const old = houseItem(viewerId, itemId);
  const house = requireHouse(viewerId);
  transaction(() => {
    const ing = ingredientId(input.name, input.unit);
    run(
      `UPDATE inventory_items SET ingredient_id = ?, quantity = ?, unit = ?, expiry_date = ?, price_cents = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_type = 'household' AND owner_id = ?`,
      ing, input.quantity, input.unit, input.expiry_date, input.price_cents, itemId, house.id,
    );
    log(house.id, viewerId, "updated", { subject: normaliseIngredient(input.name) });
    // only an edit that brings an ingredient into stock can unlock a meal
    const wasStock = isFresh(old.quantity, old.expiry_date) && old.ingredient_id === ing;
    if (!wasStock && isFresh(input.quantity, input.expiry_date)) nudge(house.id, viewerId, ing, normaliseIngredient(input.name), [itemId]);
  });
}

export function removeItem(viewerId: number, itemId: number): string {
  const item = houseItem(viewerId, itemId);
  const house = requireHouse(viewerId);
  transaction(() => {
    run("DELETE FROM inventory_items WHERE id = ? AND owner_type = 'household' AND owner_id = ?", itemId, house.id);
    log(house.id, viewerId, "removed", { subject: item.name });
  });
  return item.name;
}

// The viewer's own pantry, for the "move into the house" picker.
export function personalItems(viewerId: number): { id: number; name: string; quantity: number; unit: string; expiry_date: string | null }[] {
  return all(
    `SELECT it.id, i.name, it.quantity, it.unit, it.expiry_date
     FROM inventory_items it JOIN ingredients i ON i.id = it.ingredient_id
     WHERE it.owner_type = 'user' AND it.owner_id = ?
     ORDER BY it.expiry_date IS NULL, it.expiry_date, i.name`,
    viewerId,
  );
}

// Moves one of the viewer's own pantry items into the house pantry. Only
// their own: anyone else's personal item is a 404.
export function moveFromPersonal(viewerId: number, personalItemId: number): string {
  const house = requireHouse(viewerId);
  const row = Number.isInteger(personalItemId)
    ? one<{ id: number; ingredient_id: number; name: string; quantity: number; unit: string; expiry_date: string | null }>(
        `SELECT it.id, it.ingredient_id, i.name, it.quantity, it.unit, it.expiry_date
         FROM inventory_items it JOIN ingredients i ON i.id = it.ingredient_id
         WHERE it.id = ? AND it.owner_type = 'user' AND it.owner_id = ?`,
        personalItemId,
        viewerId,
      )
    : undefined;
  if (!row) throw new HttpError(404, "That item isn't in your pantry.");
  transaction(() => {
    run(
      `UPDATE inventory_items SET owner_type = 'household', owner_id = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_type = 'user' AND owner_id = ?`,
      house.id,
      row.id,
      viewerId,
    );
    log(house.id, viewerId, "moved", { subject: itemLabel(row.name, row.quantity, row.unit) });
    if (isFresh(row.quantity, row.expiry_date)) nudge(house.id, viewerId, row.ingredient_id, row.name, [row.id]);
  });
  return row.name;
}

/* ---------------- the expiry race ---------------- */

// Shared items that go off within SOON_DAYS (today included), with whoever
// has called "I'll use it tonight".
export function expiryRace(viewerId: number): HouseItem[] {
  const house = requireHouse(viewerId);
  return all<ItemRow>(
    `${ITEM_SELECT} WHERE it.owner_type = 'household' AND it.owner_id = ? AND it.quantity > 0
       AND it.expiry_date BETWEEN ? AND ?
     ORDER BY it.expiry_date, i.name`,
    house.id,
    today(),
    addDays(today(), SOON_DAYS),
  ).map(hydrateItem);
}

export type TonightResult =
  | { ok: true; name: string }
  | { ok: false; problem: "taken"; name: string; by: string }
  | { ok: false; problem: "not-soon"; name: string };

// First claim wins. A claim from an earlier day has lapsed and can be taken.
export function claimTonight(viewerId: number, itemId: number): TonightResult {
  const item = houseItem(viewerId, itemId);
  const house = requireHouse(viewerId);
  const now = today();
  if (item.quantity <= 0 || !item.expiry_date || item.expiry_date < now || item.expiry_date > addDays(now, SOON_DAYS)) {
    return { ok: false, problem: "not-soon", name: item.name };
  }
  return transaction(() => {
    run(
      `INSERT INTO item_claims (inventory_item_id, claimed_by, for_date) VALUES (?, ?, ?)
       ON CONFLICT (inventory_item_id) DO UPDATE SET claimed_by = excluded.claimed_by, for_date = excluded.for_date,
         claimed_at = datetime('now')
       WHERE item_claims.for_date < excluded.for_date`,
      itemId,
      viewerId,
      now,
    );
    const holder = one<{ claimed_by: number; display_name: string }>(
      "SELECT c.claimed_by, u.display_name FROM item_claims c JOIN users u ON u.id = c.claimed_by WHERE c.inventory_item_id = ?",
      itemId,
    )!;
    if (holder.claimed_by !== viewerId) return { ok: false as const, problem: "taken" as const, name: item.name, by: holder.display_name };
    if (!item.tonight || item.tonight.user_id !== viewerId) log(house.id, viewerId, "tonight", { subject: item.name });
    return { ok: true as const, name: item.name };
  });
}

export function releaseTonight(viewerId: number, itemId: number): { ok: boolean; name: string; by?: string } {
  const item = houseItem(viewerId, itemId);
  const house = requireHouse(viewerId);
  if (!item.tonight) return { ok: true, name: item.name };
  if (item.tonight.user_id !== viewerId) return { ok: false, name: item.name, by: item.tonight.name };
  transaction(() => {
    run("DELETE FROM item_claims WHERE inventory_item_id = ? AND claimed_by = ?", itemId, viewerId);
    log(house.id, viewerId, "released", { subject: item.name });
  });
  return { ok: true, name: item.name };
}

/* ---------------- the house calendar ---------------- */

export const MEALS = ["breakfast", "lunch", "dinner"] as const;
export type Meal = (typeof MEALS)[number];

export interface HouseEntry {
  id: number;
  date: string;
  meal: Meal;
  recipe_id: number;
  title: string;
  image_url: string | null;
  servings: number;
  status: "planned" | "live" | "completed" | "cancelled";
  planned_by: number;
  planner_name: string;
  author_id: number;
  visibility: string;
}

// House meals between two dates that the viewer may see. A recipe the viewer
// can't open (made private after it was planned, say) is counted, not shown.
export function houseEntries(viewerId: number, from: string, to: string): { entries: HouseEntry[]; hidden: number } {
  const house = requireHouse(viewerId);
  const rows = all<HouseEntry>(
    `SELECT c.id, c.date, c.meal, c.recipe_id, r.title, r.image_url, r.servings, c.status, c.planned_by,
            u.display_name AS planner_name, r.author_id, r.visibility
     FROM calendar_entries c JOIN recipes r ON r.id = c.recipe_id JOIN users u ON u.id = c.planned_by
     WHERE c.owner_type = 'household' AND c.owner_id = ? AND c.date BETWEEN ? AND ?
     ORDER BY c.date, CASE c.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END, c.id`,
    house.id,
    from,
    to,
  );
  const entries = rows.filter((e) => canSeeRecipe(viewerId, { author_id: e.author_id, visibility: e.visibility }));
  return { entries, hidden: rows.length - entries.length };
}

function houseEntry(viewerId: number, entryId: number): HouseEntry & { house: House } {
  const house = requireHouse(viewerId);
  const row = Number.isInteger(entryId)
    ? one<HouseEntry>(
        `SELECT c.id, c.date, c.meal, c.recipe_id, r.title, r.image_url, r.servings, c.status, c.planned_by,
                u.display_name AS planner_name, r.author_id, r.visibility
         FROM calendar_entries c JOIN recipes r ON r.id = c.recipe_id JOIN users u ON u.id = c.planned_by
         WHERE c.id = ? AND c.owner_type = 'household' AND c.owner_id = ?`,
        entryId,
        house.id,
      )
    : undefined;
  if (!row || !canSeeRecipe(viewerId, { author_id: row.author_id, visibility: row.visibility })) {
    throw new HttpError(404, "That meal isn't on your household's calendar.");
  }
  return { ...row, house };
}

export type PlanResult = { ok: true; title: string } | { ok: false; problem: string };

// A house meal must be a recipe everyone in the house can open, so the
// shared calendar reads the same for all of them and never leaks a title.
export function planHouseMeal(viewerId: number, recipeId: number, date: string, meal: string): PlanResult {
  const house = requireHouse(viewerId);
  const recipe = Number.isInteger(recipeId) ? getRecipe(recipeId) : undefined;
  if (!recipe || !canSeeRecipe(viewerId, recipe)) return { ok: false, problem: "That recipe doesn't exist." };
  if (!parseIsoDate(date)) return { ok: false, problem: "Pick a valid day." };
  if (!(MEALS as readonly string[]).includes(meal)) return { ok: false, problem: "Pick breakfast, lunch or dinner." };
  const blind = members(house.id).filter((m) => !canSeeRecipe(m.id, recipe));
  if (blind.length) {
    const names = blind.map((m) => m.display_name.split(/\s+/)[0]).join(" and ");
    return {
      ok: false,
      problem: `${names} can't open “${recipe.title}”, so it can't go on the house calendar. Pick a public recipe, or make this one visible to them first.`,
    };
  }
  transaction(() => {
    run(
      `INSERT INTO calendar_entries (owner_type, owner_id, date, meal, recipe_id, planned_by, shared)
       VALUES ('household', ?, ?, ?, ?, ?, 0)`,
      house.id, date, meal, recipe.id, viewerId,
    );
    log(house.id, viewerId, "planned", { recipeId: recipe.id, refDate: date, subject: meal });
  });
  return { ok: true, title: recipe.title };
}

export const ENTRY_STATUSES = ["planned", "completed", "cancelled"] as const;

export function setHouseEntryStatus(viewerId: number, entryId: number, status: string): string {
  const e = houseEntry(viewerId, entryId);
  if (!(ENTRY_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, "Unknown status.");
  if (status === e.status) return e.title;
  transaction(() => {
    run("UPDATE calendar_entries SET status = ? WHERE id = ? AND owner_type = 'household' AND owner_id = ?", status, e.id, e.house.id);
    const kind: EventKind = status === "completed" ? "cooked" : status === "cancelled" ? "skipped" : "planned";
    log(e.house.id, viewerId, kind, { recipeId: e.recipe_id, refDate: e.date, subject: e.meal });
    pruneClaims(e.house.id);
  });
  return e.title;
}

export function removeHouseEntry(viewerId: number, entryId: number): string {
  const e = houseEntry(viewerId, entryId);
  transaction(() => {
    run("DELETE FROM calendar_entries WHERE id = ? AND owner_type = 'household' AND owner_id = ?", e.id, e.house.id);
    log(e.house.id, viewerId, "unplanned", { recipeId: e.recipe_id, refDate: e.date, subject: e.meal });
    pruneClaims(e.house.id);
  });
  return e.title;
}

// Of these recipes, the ones every member of the viewer's house can open:
// the only ones that can go on the house calendar.
export function plannableByHouse<T extends { author_id: number; visibility: string }>(viewerId: number, recipes: T[]): T[] {
  const house = requireHouse(viewerId);
  const everyone = members(house.id);
  return recipes.filter((r) => everyone.every((m) => canSeeRecipe(m.id, r)));
}

// Recipes the house has planned before, most often first, that the viewer may
// still see: the "house usuals" in the plan-a-meal picker.
export function houseUsuals(viewerId: number, limit = 4): number[] {
  const house = requireHouse(viewerId);
  return all<{ recipe_id: number; author_id: number; visibility: string }>(
    `SELECT c.recipe_id, r.author_id, r.visibility FROM calendar_entries c JOIN recipes r ON r.id = c.recipe_id
     WHERE c.owner_type = 'household' AND c.owner_id = ? AND c.status != 'cancelled'
     GROUP BY c.recipe_id ORDER BY COUNT(*) DESC, MAX(c.date) DESC LIMIT 20`,
    house.id,
  )
    .filter((r) => canSeeRecipe(viewerId, r))
    .slice(0, limit)
    .map((r) => r.recipe_id);
}

/* ---------------- the shared shopping list ---------------- */

export interface HouseLine {
  ingredient_id: number;
  name: string;
  category: string;
  unit: string;
  need: number | null;
  have: number;
  toBuy: number | null;
  otherUnit: boolean;
  meals: string[];
  priceCents: number | null;
  // "est": Larder's reference shelf price for the amount; "paid": the last
  // price a housemate entered for a pack of it
  priceSource: "est" | "paid" | null;
  // for "est": where the reference price was read and the month ("2026-10")
  priceRef: { source: string; checked: string } | null;
  claim: Claim | null;
}

export interface HouseList {
  from: string;
  to: string;
  toBuy: HouseLine[];
  covered: HouseLine[];
  meals: { date: string; meal: string; title: string; recipe_id: number }[];
  hiddenMeals: number;
  estCents: number;
  unpriced: number;
  claimedCents: number;
  claimedLines: number;
  budgetCents: number | null;
}

export const LIST_DAYS = 7;

// The same arithmetic as the personal list (src/shopping.ts) over the house:
// ingredients of planned house meals for the next week, minus the house
// pantry's fresh stock in the same unit. Priced as estimates, never as live
// supermarket prices.
export function houseShopping(viewerId: number): HouseList {
  const house = requireHouse(viewerId);
  const from = today();
  const to = addDays(from, LIST_DAYS - 1);
  const rows = all<{
    entry_id: number; date: string; meal: string; recipe_id: number; title: string; author_id: number; visibility: string;
    ingredient_id: number; name: string; category: string; quantity: number | null; unit: string;
  }>(
    `SELECT c.id AS entry_id, c.date, c.meal, r.id AS recipe_id, r.title, r.author_id, r.visibility,
            i.id AS ingredient_id, i.name, i.category, ri.quantity, ri.unit
     FROM calendar_entries c
     JOIN recipes r ON r.id = c.recipe_id
     JOIN recipe_ingredients ri ON ri.recipe_id = r.id AND ri.optional = 0
     JOIN ingredients i ON i.id = ri.ingredient_id
     WHERE c.owner_type = 'household' AND c.owner_id = ? AND c.status = 'planned' AND c.date BETWEEN ? AND ?
     ORDER BY c.date, ri.position`,
    house.id,
    from,
    to,
  );
  const hiddenEntries = new Set<number>();
  const meals = new Map<number, HouseList["meals"][number]>();
  const lines = new Map<string, HouseLine>();
  for (const r of rows) {
    if (!canSeeRecipe(viewerId, { author_id: r.author_id, visibility: r.visibility })) {
      hiddenEntries.add(r.entry_id);
      continue;
    }
    meals.set(r.entry_id, { date: r.date, meal: r.meal, title: r.title, recipe_id: r.recipe_id });
    const unit = r.unit.trim().toLowerCase();
    const key = `${r.ingredient_id}|${unit}`;
    let line = lines.get(key);
    if (!line) {
      line = {
        ingredient_id: r.ingredient_id, name: r.name, category: r.category, unit, need: 0, have: 0, toBuy: 0,
        otherUnit: false, meals: [], priceCents: null, priceSource: null, priceRef: null, claim: null,
      };
      lines.set(key, line);
    }
    line.need = line.need === null || r.quantity === null ? null : line.need + r.quantity;
    if (!line.meals.includes(r.title)) line.meals.push(r.title);
  }

  const stock = all<{ ingredient_id: number; quantity: number; unit: string }>(
    `SELECT ingredient_id, quantity, unit FROM inventory_items
     WHERE owner_type = 'household' AND owner_id = ? AND quantity > 0
       AND (expiry_date IS NULL OR expiry_date >= date('now', 'localtime'))`,
    house.id,
  );
  const paid = new Map<number, number>();
  for (const p of all<{ ingredient_id: number; price_cents: number }>(
    `SELECT ingredient_id, price_cents FROM inventory_items
     WHERE owner_type = 'household' AND owner_id = ? AND price_cents IS NOT NULL ORDER BY updated_at`,
    house.id,
  )) paid.set(p.ingredient_id, p.price_cents);
  const claims = new Map<number, Claim>();
  for (const c of all<{ ingredient_id: number; claimed_by: number; display_name: string; claimed_at: string }>(
    `SELECT c.ingredient_id, c.claimed_by, u.display_name, c.claimed_at
     FROM shopping_claims c JOIN users u ON u.id = c.claimed_by WHERE c.household_id = ?`,
    house.id,
  )) claims.set(c.ingredient_id, { user_id: c.claimed_by, name: c.display_name, at: c.claimed_at });

  const toBuy: HouseLine[] = [];
  const covered: HouseLine[] = [];
  let estCents = 0;
  let unpriced = 0;
  let claimedCents = 0;
  let claimedLines = 0;
  for (const line of lines.values()) {
    const held = stock.filter((s) => s.ingredient_id === line.ingredient_id);
    line.have = held.filter((s) => s.unit.trim().toLowerCase() === line.unit).reduce((n, s) => n + s.quantity, 0);
    line.otherUnit = held.some((s) => s.unit.trim().toLowerCase() !== line.unit);
    line.toBuy = line.need === null ? (held.length ? 0 : null) : Math.max(0, Math.round((line.need - line.have) * 100) / 100);
    if (line.toBuy === 0) {
      covered.push(line);
      continue;
    }
    const est = line.toBuy === null ? null : estimate([{ name: line.name, quantity: line.toBuy, unit: line.unit }]);
    if (est && est.counted && est.costCents > 0) {
      line.priceCents = Math.max(1, Math.round(est.costCents));
      line.priceSource = "est";
      line.priceRef = priceSource(line.name);
    } else if (paid.has(line.ingredient_id)) {
      line.priceCents = paid.get(line.ingredient_id)!;
      line.priceSource = "paid";
    }
    line.claim = claims.get(line.ingredient_id) ?? null;
    if (line.priceCents === null) unpriced++;
    else estCents += line.priceCents;
    if (line.claim) {
      claimedLines++;
      claimedCents += line.priceCents ?? 0;
    }
    toBuy.push(line);
  }
  const byCategory = (a: HouseLine, b: HouseLine) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
  return {
    from,
    to,
    toBuy: toBuy.sort(byCategory),
    covered: covered.sort(byCategory),
    meals: [...meals.values()],
    hiddenMeals: hiddenEntries.size,
    estCents,
    unpriced,
    claimedCents,
    claimedLines,
    budgetCents: house.weekly_budget_cents,
  };
}

function lineFor(viewerId: number, ingredientIdNum: number): HouseLine[] {
  if (!Number.isInteger(ingredientIdNum)) return [];
  return houseShopping(viewerId).toBuy.filter((l) => l.ingredient_id === ingredientIdNum);
}

// Drops claims on ingredients no planned house meal in the list's window
// still uses (the meal was removed or skipped), so a stale claim never
// resurfaces on a later list. The same for every member, whatever recipes
// they can open.
function pruneClaims(houseId: number): void {
  run(
    `DELETE FROM shopping_claims WHERE household_id = ? AND ingredient_id NOT IN (
       SELECT ri.ingredient_id FROM calendar_entries c
       JOIN recipe_ingredients ri ON ri.recipe_id = c.recipe_id AND ri.optional = 0
       WHERE c.owner_type = 'household' AND c.owner_id = ? AND c.status = 'planned' AND c.date BETWEEN ? AND ?)`,
    houseId,
    houseId,
    today(),
    addDays(today(), LIST_DAYS - 1),
  );
}

export type ClaimResult = { ok: true; name: string } | { ok: false; problem: "gone" } | { ok: false; problem: "taken"; name: string; by: string };

// "I've got this": the first claim wins, for things still on the list.
export function claimLine(viewerId: number, ingredientIdNum: number): ClaimResult {
  const house = requireHouse(viewerId);
  const lines = lineFor(viewerId, ingredientIdNum);
  if (!lines.length) return { ok: false, problem: "gone" };
  const name = lines[0].name;
  return transaction(() => {
    const inserted = run(
      "INSERT INTO shopping_claims (household_id, ingredient_id, claimed_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      house.id,
      ingredientIdNum,
      viewerId,
    ).changes;
    if (!inserted) {
      const holder = one<{ claimed_by: number; display_name: string }>(
        "SELECT c.claimed_by, u.display_name FROM shopping_claims c JOIN users u ON u.id = c.claimed_by WHERE c.household_id = ? AND c.ingredient_id = ?",
        house.id,
        ingredientIdNum,
      )!;
      if (holder.claimed_by !== viewerId) return { ok: false as const, problem: "taken" as const, name, by: holder.display_name };
      return { ok: true as const, name };
    }
    log(house.id, viewerId, "claimed", { subject: name });
    return { ok: true as const, name };
  });
}

export function unclaimLine(viewerId: number, ingredientIdNum: number): { ok: boolean; name: string; by?: string } {
  const house = requireHouse(viewerId);
  const holder = Number.isInteger(ingredientIdNum)
    ? one<{ claimed_by: number; display_name: string; name: string }>(
        `SELECT c.claimed_by, u.display_name, i.name FROM shopping_claims c
         JOIN users u ON u.id = c.claimed_by JOIN ingredients i ON i.id = c.ingredient_id
         WHERE c.household_id = ? AND c.ingredient_id = ?`,
        house.id,
        ingredientIdNum,
      )
    : undefined;
  if (!holder) return { ok: true, name: "" };
  if (holder.claimed_by !== viewerId) return { ok: false, name: holder.name, by: holder.display_name };
  transaction(() => {
    run("DELETE FROM shopping_claims WHERE household_id = ? AND ingredient_id = ? AND claimed_by = ?", house.id, ingredientIdNum, viewerId);
    log(house.id, viewerId, "unclaimed", { subject: holder.name });
  });
  return { ok: true, name: holder.name };
}

// "Bought it": what the list said to buy goes into the house pantry, so it
// drops off everyone's list, and the claim is done.
export function boughtLine(viewerId: number, ingredientIdNum: number): { ok: boolean; name: string; by?: string } {
  const house = requireHouse(viewerId);
  const lines = lineFor(viewerId, ingredientIdNum);
  if (!lines.length) return { ok: true, name: "" };
  const claim = lines[0].claim;
  if (claim && claim.user_id !== viewerId) return { ok: false, name: lines[0].name, by: claim.name };
  transaction(() => {
    const added = lines.map(
      (l) =>
        run(
          `INSERT INTO inventory_items (owner_type, owner_id, ingredient_id, quantity, unit, added_by)
           VALUES ('household', ?, ?, ?, ?, ?)`,
          house.id, l.ingredient_id, l.toBuy ?? 1, l.unit, viewerId,
        ).id,
    );
    run("DELETE FROM shopping_claims WHERE household_id = ? AND ingredient_id = ?", house.id, ingredientIdNum);
    log(house.id, viewerId, "bought", { subject: lines.map((l) => itemLabel(l.name, l.toBuy ?? 1, l.unit)).join(", ") });
    nudge(house.id, viewerId, ingredientIdNum, lines[0].name, added);
  });
  return { ok: true, name: lines[0].name };
}

/* ---------------- nudges ---------------- */

// Seasonings every kitchen has; a recipe isn't "missing" them.
const STAPLES = new Set(["water", "salt", "pepper", "black pepper", "sea salt", "salt and pepper", "ice", "boiling water", "cold water", "warm water"]);

// What an owner held, fresh, before the given items arrived.
function freshHeld(ownerType: "user" | "household", ownerId: number, except: number[]): Set<number> {
  const ids = except.length ? except : [0];
  return new Set(
    all<{ ingredient_id: number }>(
      `SELECT ingredient_id FROM inventory_items
       WHERE owner_type = ? AND owner_id = ? AND quantity > 0
         AND (expiry_date IS NULL OR expiry_date >= date('now', 'localtime'))
         AND id NOT IN (${ids.map(() => "?").join(", ")})`,
      ownerType,
      ownerId,
      ...ids,
    ).map((r) => r.ingredient_id),
  );
}

// Does adding `ing` complete the recipe, given what was held before?
function completes(recipeId: number, required: Map<number, number[]>, before: Set<number>, ing: number): boolean {
  const need = required.get(recipeId) ?? [];
  if (!need.includes(ing) || before.has(ing)) return false;
  return need.every((id) => id === ing || before.has(id));
}

// When someone adds a shared item, work out deterministically (no AI) which
// meals it unlocks: a planned house meal now fully covered by the house
// pantry (told to everyone), and for each other member, a recipe they've
// planned or written that their own pantry plus the house's now covers (told
// to them alone, since it was worked out from their pantry).
function nudge(houseId: number, actorId: number, ing: number, name: string, newItems: number[]): void {
  const label = normaliseIngredient(name);
  const now = today();
  const until = addDays(now, 14);
  const houseBefore = freshHeld("household", houseId, newItems);

  const requiredFor = (ids: number[]): Map<number, number[]> => {
    const out = new Map<number, number[]>();
    for (const [id, lines] of ingredientsFor(ids)) {
      out.set(id, [...new Set(lines.filter((l) => !l.optional && !STAPLES.has(l.name)).map((l) => l.ingredient_id))]);
    }
    return out;
  };

  // house meals coming up that use it
  const houseMeals = all<{ recipe_id: number; date: string }>(
    `SELECT c.recipe_id, MIN(c.date) AS date FROM calendar_entries c
     JOIN recipe_ingredients ri ON ri.recipe_id = c.recipe_id AND ri.ingredient_id = ? AND ri.optional = 0
     WHERE c.owner_type = 'household' AND c.owner_id = ? AND c.status = 'planned' AND c.date BETWEEN ? AND ?
     GROUP BY c.recipe_id`,
    ing,
    houseId,
    now,
    until,
  );
  const houseReq = requiredFor(houseMeals.map((m) => m.recipe_id));
  const told = new Set<number>();
  for (const m of houseMeals) {
    if (completes(m.recipe_id, houseReq, houseBefore, ing)) {
      log(houseId, actorId, "nudge", { subject: label, recipeId: m.recipe_id, refDate: m.date });
      told.add(m.recipe_id);
    }
  }

  for (const member of members(houseId)) {
    if (member.id === actorId) continue;
    const candidates = all<{ id: number; author_id: number; visibility: string }>(
      `SELECT DISTINCT r.id, r.author_id, r.visibility FROM recipes r
       JOIN recipe_ingredients ri ON ri.recipe_id = r.id AND ri.ingredient_id = ? AND ri.optional = 0
       WHERE r.id IN (
         SELECT recipe_id FROM calendar_entries
           WHERE owner_type = 'user' AND owner_id = ? AND status = 'planned' AND date BETWEEN ? AND ?
         UNION SELECT id FROM recipes WHERE author_id = ?)`,
      ing,
      member.id,
      now,
      until,
      member.id,
    ).filter((r) => !told.has(r.id) && canSeeRecipe(member.id, r));
    if (!candidates.length) continue;
    const before = new Set([...houseBefore, ...freshHeld("user", member.id, newItems)]);
    const req = requiredFor(candidates.map((c) => c.id));
    let sent = 0;
    for (const c of candidates) {
      if (sent >= 2) break;
      if (completes(c.id, req, before, ing)) {
        log(houseId, actorId, "nudge", { subject: label, recipeId: c.id, forUser: member.id });
        sent++;
      }
    }
  }
}

/* ---------------- summary for the overview ---------------- */

export interface Overview {
  house: House;
  members: Member[];
  items: HouseItem[];
  race: HouseItem[];
  week: HouseEntry[];
  list: HouseList;
  activity: Activity[];
  version: number;
}

export function overview(viewerId: number): Overview {
  const house = requireHouse(viewerId);
  const now = today();
  return {
    house,
    members: members(house.id),
    items: houseItems(viewerId),
    race: expiryRace(viewerId),
    week: houseEntries(viewerId, now, addDays(now, 6)).entries,
    list: houseShopping(viewerId),
    activity: houseActivity(viewerId, { limit: 14 }),
    version: houseVersion(viewerId),
  };
}

/* ---------------- demo ---------------- */

// TEMPORARY, with DEMO_MODE (src/demo.ts): alice, sam and bo share "Fitzroy
// St" with a stocked pantry (some of it about to go off), this week's house
// meals and a claim or two. Idempotent: does nothing once alice is in a
// household, or if the demo users don't exist.
export function seedHouseholdDemo(): boolean {
  const id = (u: string) => one<{ id: number }>("SELECT id FROM users WHERE username = ?", u)?.id;
  const alice = id("alice");
  const sam = id("sam");
  const bo = id("bo");
  if (!alice || !sam || !bo || householdFor(alice)) return false;
  const housemates = [sam, bo].filter((u) => !householdFor(u));
  const now = today();

  transaction(() => {
    const house = run(
      "INSERT INTO households (name, invite_code, weekly_budget_cents, created_by, created_at) VALUES (?, ?, ?, ?, datetime('now', '-21 days'))",
      "Fitzroy St",
      uniqueCode(),
      12000,
      alice,
    ).id;
    run("INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?, ?, 'owner', datetime('now', '-21 days'))", house, alice);
    log(house, alice, "created", { subject: "Fitzroy St", ago: "-21 days" });
    housemates.forEach((u, i) => {
      const ago = `-${20 - i * 3} days`;
      run("INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?, ?, 'member', datetime('now', ?))", house, u, ago);
      log(house, u, "joined", { ago });
    });
    const inHouse = (u: number) => u === alice || housemates.includes(u);

    // [name, qty, unit, days to expiry (null = none), cents, who]
    const shop: [string, number, string, number | null, number | null, number][] = [
      ["spinach", 150, "g", 0, 300, alice],
      ["bread", 1, "loaf", 1, 450, bo],
      ["milk", 2000, "ml", 2, 310, bo],
      ["greek yoghurt", 500, "g", 3, 450, sam],
      ["chicken thigh", 800, "g", 5, 980, alice],
      ["onion", 6, "", 25, 300, bo],
      ["capsicum", 3, "", 6, 330, bo],
      ["garlic", 8, "clove", 30, 150, sam],
      ["canned tomatoes", 800, "g", 400, 240, sam],
      ["coconut milk", 400, "ml", 300, 200, alice],
      ["rice", 2000, "g", null, 400, sam],
      ["spaghetti", 500, "g", 300, 200, alice],
      ["olive oil", 750, "ml", null, 1200, sam],
    ];
    for (const [name, q, unit, days, cents, who] of shop) {
      const by = inHouse(who) ? who : alice;
      run(
        `INSERT INTO inventory_items (owner_type, owner_id, ingredient_id, quantity, unit, expiry_date, price_cents, added_by, added_at)
         VALUES ('household', ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 days'))`,
        house, ingredientId(name, unit), q, unit, days === null ? null : addDays(now, days), cents, by,
      );
    }

    // this week's house meals: catalogue recipes everyone can open, plus
    // Sam's public shakshuka
    const cat = catalogueByTitle(["Spaghetti Bolognese", "Thai Green Curry", "Spanish Tortilla", "Pad Thai"]);
    const shakshuka = one<{ id: number }>("SELECT id FROM recipes WHERE author_id = ? AND title = 'Shakshuka' AND visibility = 'public'", sam)?.id;
    const plan = (offset: number, meal: Meal, recipe: number | undefined, who: number, status = "planned") => {
      if (!recipe) return;
      const by = inHouse(who) ? who : alice;
      run(
        `INSERT INTO calendar_entries (owner_type, owner_id, date, meal, recipe_id, planned_by, status, created_at)
         VALUES ('household', ?, ?, ?, ?, ?, ?, datetime('now', '-1 days'))`,
        house, addDays(now, offset), meal, recipe, by, status,
      );
      log(house, by, status === "completed" ? "cooked" : "planned", { recipeId: recipe, refDate: addDays(now, offset), subject: meal, ago: "-20 hours" });
    };
    plan(-1, "dinner", cat.get("Pad Thai")?.id, bo, "completed");
    plan(0, "dinner", shakshuka, sam);
    plan(1, "dinner", cat.get("Spaghetti Bolognese")?.id, alice);
    plan(3, "dinner", cat.get("Thai Green Curry")?.id, bo);
    plan(5, "lunch", cat.get("Spanish Tortilla")?.id, alice);

    // a claim on each list: Bo is using the spinach tonight, Sam is buying the mince
    const spinach = one<{ id: number }>(
      "SELECT it.id FROM inventory_items it JOIN ingredients i ON i.id = it.ingredient_id WHERE it.owner_type = 'household' AND it.owner_id = ? AND i.name = 'spinach'",
      house,
    )?.id;
    if (spinach && inHouse(bo)) {
      run("INSERT INTO item_claims (inventory_item_id, claimed_by, for_date) VALUES (?, ?, ?)", spinach, bo, now);
      log(house, bo, "tonight", { subject: "spinach", ago: "-50 minutes" });
    }
    if (inHouse(sam)) {
      run("INSERT INTO shopping_claims (household_id, ingredient_id, claimed_by) VALUES (?, ?, ?)", house, ingredientId("beef mince", "g"), sam);
      log(house, sam, "claimed", { subject: "beef mince", ago: "-35 minutes" });
    }
  });

  // the last shop goes in through the real path, so its nudges are computed
  // exactly as they would be for anyone
  const by = housemates.includes(sam) ? sam : alice;
  addItem(by, { name: "eggs", quantity: 12, unit: "", expiry_date: addDays(now, 2), price_cents: 650 });
  console.log("seeded demo household Fitzroy St");
  return true;
}
