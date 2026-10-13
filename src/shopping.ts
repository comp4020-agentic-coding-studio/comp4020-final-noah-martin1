import { all } from "./db.ts";
import { estimate, priceSource } from "./nutrition.ts";
import { canSeeRecipe } from "./visibility.ts";

// The shopping list is arithmetic, not a guess: ingredients of the meals you
// have planned in a date range, minus what your pantry holds (fresh only),
// priced at what you last paid, or else estimated for the amount from the
// reference shelf prices (labelled as such, never a live price).

export interface ShoppingLine {
  ingredient_id: number;
  name: string;
  category: string;
  unit: string;
  // null when a recipe gives no amount ("salt", "some coriander")
  need: number | null;
  have: number;
  toBuy: number | null;
  // the pantry holds this ingredient, but in a different unit
  otherUnit: boolean;
  priceCents: number | null;
  // "paid": the last price you entered for a pack; "est": reference estimate
  priceKind: "paid" | "est" | null;
  priceRef: { source: string; checked: string } | null;
  meals: string[];
}

export interface ShoppingList {
  toBuy: ShoppingLine[];
  covered: ShoppingLine[];
  meals: { date: string; meal: string; title: string; recipe_id: number }[];
  estCents: number;
  unpriced: number;
}

interface Row {
  entry_id: number;
  date: string;
  meal: string;
  recipe_id: number;
  title: string;
  author_id: number;
  visibility: string;
  ingredient_id: number;
  name: string;
  category: string;
  quantity: number | null;
  unit: string;
}

export function shoppingList(userId: number, from: string, to: string): ShoppingList {
  const rows = all<Row>(
    `SELECT c.id AS entry_id, c.date, c.meal, r.id AS recipe_id, r.title, r.author_id, r.visibility,
            i.id AS ingredient_id, i.name, i.category, ri.quantity, ri.unit
     FROM calendar_entries c
     JOIN recipes r ON r.id = c.recipe_id
     JOIN recipe_ingredients ri ON ri.recipe_id = r.id AND ri.optional = 0
     JOIN ingredients i ON i.id = ri.ingredient_id
     WHERE c.owner_type = 'user' AND c.owner_id = ? AND c.status = 'planned' AND c.date BETWEEN ? AND ?
     ORDER BY c.date, ri.position`,
    userId,
    from,
    to,
  ).filter((r) => canSeeRecipe(userId, { author_id: r.author_id, visibility: r.visibility }));

  const meals = new Map<number, ShoppingList["meals"][number]>();
  const lines = new Map<string, ShoppingLine>();
  for (const r of rows) {
    meals.set(r.entry_id, { date: r.date, meal: r.meal, title: r.title, recipe_id: r.recipe_id });
    const unit = r.unit.trim().toLowerCase();
    const key = `${r.ingredient_id}|${unit}`;
    let line = lines.get(key);
    if (!line) {
      line = { ingredient_id: r.ingredient_id, name: r.name, category: r.category, unit, need: 0, have: 0, toBuy: 0, otherUnit: false, priceCents: null, priceKind: null, priceRef: null, meals: [] };
      lines.set(key, line);
    }
    line.need = line.need === null || r.quantity === null ? null : line.need + r.quantity;
    if (!line.meals.includes(r.title)) line.meals.push(r.title);
  }

  const pantry = all<{ ingredient_id: number; quantity: number; unit: string }>(
    `SELECT ingredient_id, quantity, unit FROM inventory_items
     WHERE owner_type = 'user' AND owner_id = ? AND quantity > 0
       AND (expiry_date IS NULL OR expiry_date >= date('now', 'localtime'))`,
    userId,
  );
  const prices = new Map<number, number>();
  for (const p of all<{ ingredient_id: number; price_cents: number }>(
    `SELECT ingredient_id, price_cents FROM inventory_items
     WHERE owner_type = 'user' AND owner_id = ? AND price_cents IS NOT NULL ORDER BY updated_at`,
    userId,
  )) prices.set(p.ingredient_id, p.price_cents);

  const toBuy: ShoppingLine[] = [];
  const covered: ShoppingLine[] = [];
  let estCents = 0;
  let unpriced = 0;
  for (const line of lines.values()) {
    const held = pantry.filter((p) => p.ingredient_id === line.ingredient_id);
    line.have = held.filter((p) => p.unit.trim().toLowerCase() === line.unit).reduce((s, p) => s + p.quantity, 0);
    line.otherUnit = held.some((p) => p.unit.trim().toLowerCase() !== line.unit);
    if (line.need === null) {
      // no amount given: holding any is enough
      line.toBuy = held.length ? 0 : null;
    } else {
      line.toBuy = Math.max(0, Math.round((line.need - line.have) * 100) / 100);
    }
    const paid = prices.get(line.ingredient_id);
    const est = line.toBuy ? estimate([{ name: line.name, quantity: line.toBuy, unit: line.unit }]) : null;
    if (paid !== undefined) {
      line.priceCents = paid;
      line.priceKind = "paid";
    } else if (est && est.counted && est.costCents > 0) {
      line.priceCents = Math.max(1, Math.round(est.costCents));
      line.priceKind = "est";
      line.priceRef = priceSource(line.name);
    }
    // A unit mismatch (recipe wants g, pantry holds "pack") can't be
    // subtracted, so the line stays on the list with otherUnit flagged.
    if (line.toBuy === 0) covered.push(line);
    else {
      toBuy.push(line);
      if (line.priceCents === null) unpriced++;
      else estCents += line.priceCents;
    }
  }

  const byCategory = (a: ShoppingLine, b: ShoppingLine) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
  return { toBuy: toBuy.sort(byCategory), covered: covered.sort(byCategory), meals: [...meals.values()], estCents, unpriced };
}
