import { describe, expect, it } from "vitest";
import { all, one, run } from "../src/db.ts";
import { seedDemo } from "../src/demo.ts";
import { seedCatalogue } from "../src/catalogue.ts";
import { addDays, today } from "../src/format.ts";

// The demo accounts are shared, so a visitor can add anything to them. Each
// boot rebuilds their content; these hold on this file's own throwaway
// database (spec/unit-db.ts), never the app's.
describe("refreshing the shared demo kitchen", () => {
  const demoRecipes = () =>
    all<{ title: string; image_url: string }>(
      "SELECT r.title, r.image_url FROM recipes r JOIN users u ON u.id = r.author_id WHERE u.username IN ('alice','sam','bo','jo') ORDER BY r.id",
    );
  const userId = (name: string) => one<{ id: number }>("SELECT id FROM users WHERE username = ?", name)!.id;

  it("clears what a visitor added, gives every recipe a photo, and dates the week from today", async () => {
    seedCatalogue();
    await seedDemo("test-v1");
    const alice = userId("alice");
    run("INSERT INTO recipes (author_id, title, visibility, image_url) VALUES (?, 'Fried Field Lizards', 'public', '/assets/x.svg')", alice);
    run("UPDATE users SET display_name = 'hacked' WHERE id = ?", alice);

    await seedDemo("test-v2");
    const titles = demoRecipes().map((r) => r.title);
    expect(titles).not.toContain("Fried Field Lizards");
    expect(titles).toHaveLength(new Set(titles).size);
    expect(demoRecipes().every((r) => r.image_url.startsWith("http"))).toBe(true);
    expect(one<{ display_name: string }>("SELECT display_name FROM users WHERE id = ?", alice)!.display_name).toBe("Alice Ng");
    const soonest = one<{ d: string }>("SELECT MIN(expiry_date) AS d FROM inventory_items WHERE owner_type = 'user' AND owner_id = ?", alice)!.d;
    expect(soonest >= today()).toBe(true);
    const first = one<{ d: string }>("SELECT MIN(date) AS d FROM calendar_entries WHERE owner_type = 'user' AND owner_id = ?", alice)!.d;
    expect(first).toBe(today());
  });

  it("keeps a demo recipe someone else has planned, refreshed in place, and their plan with it", async () => {
    await seedDemo("test-v3");
    const sam = userId("sam");
    const shakshuka = one<{ id: number }>("SELECT id FROM recipes WHERE author_id = ? AND title = 'Shakshuka'", sam)!.id;
    run("UPDATE recipes SET description = 'scribbled on' WHERE id = ?", shakshuka);
    const other = run("INSERT INTO users (username, display_name, password_hash) VALUES ('planner_x', 'P', 'x')").id;
    run("INSERT INTO calendar_entries (owner_type, owner_id, date, meal, recipe_id, planned_by) VALUES ('user', ?, ?, 'lunch', ?, ?)", other, addDays(today(), 2), shakshuka, other);

    await seedDemo("test-v4");
    const theirs = one<{ recipe_id: number }>("SELECT recipe_id FROM calendar_entries WHERE owner_id = ? AND owner_type = 'user'", other);
    expect(theirs?.recipe_id).toBe(shakshuka);
    expect(one<{ description: string }>("SELECT description FROM recipes WHERE id = ?", shakshuka)!.description).not.toBe("scribbled on");
    expect(demoRecipes().filter((r) => r.title === "Shakshuka")).toHaveLength(1);
  });

  it("a restart without a new version leaves what visitors added, so it persists", async () => {
    await seedDemo("stable");
    const alice = userId("alice");
    run("INSERT INTO inventory_items (owner_type, owner_id, ingredient_id, quantity, unit, added_by) VALUES ('user', ?, (SELECT id FROM ingredients LIMIT 1), 1, '', ?)", alice, alice);
    const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM inventory_items WHERE owner_type = 'user' AND owner_id = ?", alice)!.n;
    expect(await seedDemo("stable")).toBe(false);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM inventory_items WHERE owner_type = 'user' AND owner_id = ?", alice)!.n).toBe(before);
  });

  it("rebuilds the shared household once, with its pantry and meals, leaving no orphans", async () => {
    await seedDemo("test-v5");
    await seedDemo("test-v6");
    const houses = all<{ id: number }>(
      "SELECT DISTINCT hm.household_id AS id FROM household_members hm JOIN users u ON u.id = hm.user_id WHERE u.username IN ('alice','sam','bo')",
    );
    expect(houses).toHaveLength(1);
    const meals = one<{ n: number }>("SELECT COUNT(*) AS n FROM calendar_entries WHERE owner_type = 'household' AND owner_id = ?", houses[0].id)!.n;
    expect(meals).toBe(5);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM inventory_items WHERE owner_type = 'household' AND owner_id NOT IN (SELECT id FROM households)")!.n).toBe(0);
  });
});
