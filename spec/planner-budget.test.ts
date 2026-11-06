import { describe, expect, it } from "vitest";
import { seedCatalogue } from "../src/catalogue.ts";
import { addDays, today } from "../src/format.ts";
import { ingredientId, run } from "../src/db.ts";
import { generatePlan } from "../src/planner.ts";
import { isMeal } from "../src/recipes.ts";

// The week planner (src/planner.ts) suggests dinners, and with a budget it
// spends that budget: a $100 week comes to nearly $100 at the checkout, never
// more. Run on this file's own throwaway database (spec/unit-db.ts).

describe("what counts as a dinner", () => {
  it("a condiment, preserve, dip or bread on its own isn't one", () => {
    for (const t of [
      "Beetroot & red cabbage sauerkraut",
      "Quick pickled red onions",
      "Hummus",
      "Muraba-E-Kadu (Pumpkin Jam)",
      "Ají de Aguacate (Colombian Spicy Avocado Sauce)",
      "Syrian Bread",
      "Yorkshire Puddings",
      "Pa amb tomàquet (Catalan tomato bread)",
    ]) {
      expect(isMeal(t), t).toBe(false);
    }
  });

  it("a dish served in or with a sauce, or made with sauerkraut, is", () => {
    for (const t of [
      "Pollo en Salsa",
      "Chicken shawarma with garlic sauce",
      "Rigatoni with fennel sausage sauce",
      "Pork and sauerkraut goulash (Segedin)",
      "Sauerkraut and mushroom pierogi",
      "Spaghetti Bolognese",
      "Turkey Bánh mì",
    ]) {
      expect(isMeal(t), t).toBe(true);
    }
  });
});

describe("planning a week to a budget", () => {
  seedCatalogue();
  // a kitchen with the basics most people keep (from an empty one, every
  // dinner buys a whole bag of flour and bottle of oil)
  const user = run("INSERT INTO users (username, display_name, password_hash) VALUES ('planner_budget', 'P', 'x')").id;
  const empty = run("INSERT INTO users (username, display_name, password_hash) VALUES ('planner_empty', 'P', 'x')").id;
  for (const [name, quantity, unit] of [["olive oil", 1000, "ml"], ["salt", 1000, "g"], ["black pepper", 100, "g"], ["plain flour", 2000, "g"], ["garlic", 300, "g"], ["onion", 2000, "g"], ["butter", 500, "g"], ["eggs", 12, ""], ["rice", 2000, "g"], ["sugar", 1000, "g"]] as const) {
    run("INSERT INTO inventory_items (owner_type, owner_id, ingredient_id, quantity, unit, expiry_date, added_by) VALUES ('user', ?, ?, ?, ?, ?, ?)", user, ingredientId(name), quantity, unit, addDays(today(), 60), user);
  }
  const plan = (budget: number, seed: number, who = user) =>
    generatePlan(who, { from: addDays(today(), 1), nights: 5, budgetCents: budget * 100, interests: new Set(["budget"]), seed, keep: [], exclude: [] });

  it("spends the budget it's given, never more", () => {
    for (const budget of [45, 100]) {
      for (const seed of [1, 2, 3]) {
        const p = plan(budget, seed);
        expect(p.picks.length, `$${budget} seed ${seed}`).toBe(5);
        expect(p.totalCents, `$${budget} seed ${seed}`).toBeLessThanOrEqual(budget * 100);
        // nearly all of it: an $45 week isn't $22 of omelettes
        expect(p.totalCents, `$${budget} seed ${seed}`).toBeGreaterThanOrEqual(budget * 100 * 0.85);
      }
    }
  });

  it("from an empty kitchen it still never goes over, leaving a night open and saying so if it must", () => {
    const p = plan(45, 1, empty);
    expect(p.totalCents).toBeLessThanOrEqual(4500);
    if (p.picks.length < 5) expect(p.notes.join(" ")).toMatch(/fit in \$45\.00/);
  });

  it("a bigger budget buys bigger dinners", () => {
    const small = plan(30, 1).totalCents;
    const big = plan(100, 1).totalCents;
    expect(big).toBeGreaterThan(small * 2);
  });

  it("sharing ingredients: each dinner's price is what it adds, and they add up to the week", () => {
    const share = (budget: number, seed: number) =>
      generatePlan(empty, { from: addDays(today(), 1), nights: 5, budgetCents: budget * 100, interests: new Set(["budget", "share"]), seed, keep: [], exclude: [] });
    for (const seed of [1, 2]) {
      const p = share(100, seed);
      expect(p.picks.length).toBeGreaterThan(0);
      const sum = p.picks.reduce((s, x) => s + (x.addsCents ?? NaN), 0);
      expect(sum).toBe(p.totalCents);
      expect(p.totalCents).toBeLessThanOrEqual(10000);
      // a later night reusing what an earlier one bought costs less than on its own
      expect(p.picks.some((x) => x.addsCents! < x.toBuyCents)).toBe(true);
    }
    // without it, each dinner is priced on its own
    expect(plan(100, 1).picks.every((x) => x.addsCents === null)).toBe(true);
  });

  it("from an empty kitchen, sharing fits more dinner into the same budget", () => {
    const share = generatePlan(empty, { from: addDays(today(), 1), nights: 5, budgetCents: 4500, interests: new Set(["budget", "share"]), seed: 1, keep: [], exclude: [] });
    const alone = plan(45, 1, empty);
    expect(share.totalCents).toBeLessThanOrEqual(4500);
    expect(share.picks.length).toBeGreaterThanOrEqual(alone.picks.length);
  });

  it("never suggests something that isn't a meal", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const pick of plan(60, seed).picks) expect(isMeal(pick.recipe.title), pick.recipe.title).toBe(true);
    }
  });
});
