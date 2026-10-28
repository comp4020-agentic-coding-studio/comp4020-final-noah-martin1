import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CatalogueRecipe, seedCatalogue, tags } from "../src/catalogue.ts";
import { all, one, run } from "../src/db.ts";

// The catalogue as data (src/data/catalogue.json, src/data/videos.json) and
// the seeding that keeps a database in step with it. Seeding runs against
// this file's throwaway database (spec/unit-db.ts), from fixture files.

const catalogue: CatalogueRecipe[] = JSON.parse(readFileSync(new URL("../src/data/catalogue.json", import.meta.url), "utf8"));
const videos: Record<string, { status: string; videoId: string | null; transcribed?: true }> = JSON.parse(
  readFileSync(new URL("../src/data/videos.json", import.meta.url), "utf8"),
);

const recipe = (over: Partial<CatalogueRecipe> = {}): CatalogueRecipe => ({
  source: "themealdb:1",
  title: "Test soup",
  description: "A soup for tests.",
  servings: 2,
  cuisine: "British",
  category: "Vegetarian",
  image: "https://www.themealdb.com/images/media/meals/test.jpg",
  prep_minutes: 10,
  cook_minutes: 20,
  ingredients: [
    { name: "carrot", quantity: 2, unit: "", note: "" },
    { name: "vegetable stock", quantity: 500, unit: "ml", note: "" },
  ],
  steps: [
    { text: "Chop the carrots.", minutes: null },
    { text: "Simmer in the stock.", minutes: 20 },
  ],
  ...over,
});

const dir = mkdtempSync(join(tmpdir(), "catalogue-"));
const fixture = (recipes: CatalogueRecipe[]): string => {
  const file = join(dir, `c${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(recipes));
  return file;
};
const stepsOf = (id: number) => all<{ text: string }>("SELECT text FROM recipe_steps WHERE recipe_id = ? ORDER BY step_number", id).map((s) => s.text);
const linesOf = (id: number) =>
  all<{ name: string }>(
    "SELECT i.name FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = ? ORDER BY ri.position",
    id,
  ).map((l) => l.name);

describe("dietary tags", () => {
  const tagged = (...names: string[]) => tags({ ingredients: names.map((name) => ({ name, quantity: 1, unit: "", note: "" })), category: "Vegan", prep_minutes: 60, cook_minutes: 0 });

  it("plant foods named after dairy don't cost a recipe its vegan or dairy-free tag", () => {
    for (const name of ["vegan butter", "vegan mayonnaise", "coconut milk", "oat milk", "peanut butter", "butter beans", "butternut squash", "eggplant", "cream of tartar"]) {
      const t = tagged("tofu", name);
      expect(t, name).toContain("vegan");
      expect(t, name).toContain("dairy-free");
    }
  });

  it("real dairy and eggs still do", () => {
    for (const name of ["butter", "milk", "cream", "eggs", "mayonnaise", "cheddar cheese", "buttermilk"]) {
      expect(tagged("tofu", name), name).not.toContain("vegan");
    }
    expect(tagged("butter")).not.toContain("dairy-free");
  });
});

describe("catalogue seeding", () => {
  it("adds new recipes once, and a second boot changes nothing", () => {
    const file = fixture([recipe()]);
    expect(seedCatalogue(file)).toBe(1);
    expect(seedCatalogue(file)).toBe(0);
  });

  it("rewrites a changed recipe in place, keeping its id, ingredients and steps replaced", () => {
    const first = recipe({ source: "themealdb:2", title: "Banh mi" });
    seedCatalogue(fixture([first]));
    const id = one<{ id: number }>("SELECT id FROM recipes WHERE source = 'themealdb:2'")!.id;

    const revised = recipe({
      source: "themealdb:2",
      title: "Vegan banh mi",
      servings: 3,
      ingredients: [
        { name: "tofu", quantity: 450, unit: "g", note: "" },
        { name: "baguette", quantity: 3, unit: "", note: "" },
        { name: "daikon", quantity: 0.33, unit: "", note: "julienned" },
      ],
      steps: [{ text: "Pickle the carrot and daikon.", minutes: 20 }, { text: "Fry the tofu.", minutes: 10 }, { text: "Fill the rolls.", minutes: null }],
    });
    expect(seedCatalogue(fixture([revised]))).toBe(1);
    const row = one<{ id: number; title: string; servings: number }>("SELECT id, title, servings FROM recipes WHERE source = 'themealdb:2'")!;
    expect(row).toEqual({ id, title: "Vegan banh mi", servings: 3 });
    expect(linesOf(id)).toEqual(["tofu", "baguette", "daikon"]);
    expect(stepsOf(id)).toEqual(["Pickle the carrot and daikon.", "Fry the tofu.", "Fill the rolls."]);
  });

  it("leaves a recipe someone is cooking until a later boot, so their step count stays true", () => {
    seedCatalogue(fixture([recipe({ source: "themealdb:3" })]));
    const id = one<{ id: number }>("SELECT id FROM recipes WHERE source = 'themealdb:3'")!.id;
    const cook = run("INSERT INTO users (username, display_name, password_hash) VALUES ('cook3', 'Cook', 'x')").id;
    const session = run("INSERT INTO cook_sessions (user_id, recipe_id, serves, visibility, step_count) VALUES (?, ?, 2, 'private', 2)", cook, id).id;

    const revised = fixture([recipe({ source: "themealdb:3", steps: [{ text: "One.", minutes: null }, { text: "Two.", minutes: null }, { text: "Three.", minutes: null }] })]);
    expect(seedCatalogue(revised)).toBe(0);
    expect(stepsOf(id)).toEqual(["Chop the carrots.", "Simmer in the stock."]);

    run("UPDATE cook_sessions SET ended_at = datetime('now'), end_reason = 'finished' WHERE id = ?", session);
    expect(seedCatalogue(revised)).toBe(1);
    expect(stepsOf(id)).toEqual(["One.", "Two.", "Three."]);
  });

  it("stamps a recipe seeded before revisions were tracked without rewriting it, when it already matches, and refreshes its tags", () => {
    const coconut = recipe({ source: "themealdb:4", ingredients: [{ name: "coconut milk", quantity: 400, unit: "ml", note: "" }, { name: "tofu", quantity: 200, unit: "g", note: "" }] });
    seedCatalogue(fixture([coconut]));
    // as an old boot left it: no hash, and tagged by the old rule that read "milk" as dairy
    run("UPDATE recipes SET source_hash = NULL, updated_at = '2000-01-01', dietary_tags = '[\"vegetarian\"]' WHERE source = 'themealdb:4'");
    expect(seedCatalogue(fixture([coconut]))).toBe(0);
    const row = one<{ source_hash: string | null; updated_at: string; dietary_tags: string }>("SELECT source_hash, updated_at, dietary_tags FROM recipes WHERE source = 'themealdb:4'")!;
    expect(row.source_hash).not.toBeNull();
    expect(row.updated_at).toBe("2000-01-01");
    expect(JSON.parse(row.dietary_tags)).toEqual(expect.arrayContaining(["vegan", "dairy-free"]));
  });

  it("rewrites a recipe seeded before revisions were tracked when only its description changed", () => {
    seedCatalogue(fixture([recipe({ source: "themealdb:5" })]));
    run("UPDATE recipes SET source_hash = NULL WHERE source = 'themealdb:5'");
    expect(seedCatalogue(fixture([recipe({ source: "themealdb:5", description: "Now described from its video." })]))).toBe(1);
    expect(one<{ description: string }>("SELECT description FROM recipes WHERE source = 'themealdb:5'")!.description).toBe("Now described from its video.");
  });
});

describe("catalogue videos", () => {
  it("a video is shown (verified) only when its recipe was transcribed from it", () => {
    const shown = Object.entries(videos).filter(([, v]) => v.status === "verified");
    expect(shown.length).toBeGreaterThan(0);
    for (const [source, v] of shown) {
      expect(v.transcribed, source).toBe(true);
      expect(v.videoId, source).toMatch(/^[A-Za-z0-9_-]{11}$/);
    }
  });

  it("every video entry belongs to a catalogue recipe", () => {
    const sources = new Set(catalogue.map((r) => r.source));
    for (const source of Object.keys(videos)) expect(sources.has(source), source).toBe(true);
  });

  // Imported from TheMealDB without amounts on some main ingredients, and not
  // yet rewritten from a video. Listed so the gap stays visible; a recipe
  // leaves this list when it's rewritten, and no other may join it.
  const KNOWN_GAPS = new Set([
    "themealdb:53457", "themealdb:52999", "themealdb:52830", "themealdb:52996",
    "themealdb:52957", "themealdb:52993", "themealdb:53000",
  ]);

  it("every catalogue recipe is usable: amounts on its main ingredients, at least two steps and a photo", () => {
    for (const r of catalogue) {
      expect(r.steps.length, r.source).toBeGreaterThanOrEqual(2);
      expect(r.image, r.source).toMatch(/^https:\/\//);
      const missing = r.ingredients.filter((i) => i.quantity === null && !/to serve|to garnish|garnish|to taste|optional|for frying|for deep-frying|for greasing|for dusting/i.test(i.note));
      if (KNOWN_GAPS.has(r.source)) continue;
      expect(missing.length, `${r.source} ${r.title}: ${missing.map((i) => i.name).join(", ")}`).toBeLessThanOrEqual(2);
    }
  });

  it("the known gaps are still gaps (so the list can't hide a recipe that's been fixed)", () => {
    for (const source of KNOWN_GAPS) {
      const r = catalogue.find((x) => x.source === source);
      expect(r, source).toBeDefined();
      const missing = r!.ingredients.filter((i) => i.quantity === null && !/to serve|to garnish|garnish|to taste|optional|for frying|for deep-frying|for greasing|for dusting/i.test(i.note));
      expect(missing.length, source).toBeGreaterThan(2);
    }
  });
});
