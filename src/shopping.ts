import { all } from "./db.ts";
import { stockParams, stockSql } from "./expiry.ts";
import { type Need, packOptions, type PlanLine, purchasePlan, type Stock } from "./pricing.ts";
import { prefsFor } from "./prefs.ts";
import { canSeeRecipe } from "./visibility.ts";

// The shopping list is arithmetic, not a guess: the ingredients of every meal
// you have planned in a date range, each scaled to the servings you cook
// for, summed per ingredient, minus usable pantry stock, then bought in
// whole packs (src/pricing.ts). Two meals sharing one bag of flour buy one bag.

export type ShoppingLine = PlanLine;

export interface ShoppingList {
  toBuy: ShoppingLine[];
  covered: ShoppingLine[];
  meals: { date: string; meal: string; title: string; recipe_id: number }[];
  // checkout total for whole packs
  purchaseCents: number;
  // what the planned meals actually use of them
  consumptionCents: number;
  unpriced: number;
  unpricedEstCents: number;
}

interface Row {
  entry_id: number;
  date: string;
  meal: string;
  recipe_id: number;
  title: string;
  servings: number;
  author_id: number;
  visibility: string;
  ingredient_id: number;
  name: string;
  category: string;
  quantity: number | null;
  unit: string;
}

// Personal stock that counts: listed, unexpired (or kept), with some left.
export function usableStock(ownerType: "user" | "household", ownerId: number): Stock[] {
  return all<Stock>(
    `SELECT ingredient_id, quantity, unit FROM inventory_items
     WHERE owner_type = ? AND owner_id = ? AND ${stockSql("")}`,
    ownerType,
    ownerId,
    ...stockParams(),
  );
}

export function shoppingList(userId: number, from: string, to: string): ShoppingList {
  const factorFor = (recipeServings: number) => Math.max(1, prefsFor(userId).default_servings) / Math.max(1, recipeServings);
  const rows = all<Row>(
    `SELECT c.id AS entry_id, c.date, c.meal, r.id AS recipe_id, r.title, r.servings, r.author_id, r.visibility,
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
  const needs: Need[] = [];
  for (const r of rows) {
    meals.set(r.entry_id, { date: r.date, meal: r.meal, title: r.title, recipe_id: r.recipe_id });
    const f = factorFor(r.servings);
    needs.push({ ingredient_id: r.ingredient_id, name: r.name, category: r.category, quantity: r.quantity === null ? null : r.quantity * f, unit: r.unit, meal: r.title });
  }
  const plan = purchasePlan(needs, usableStock("user", userId), (id, name) => packOptions(userId, id, name));
  return { ...plan, meals: [...meals.values()] };
}
