import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { all, db, ingredientId, normaliseIngredient, one, run, transaction } from "./db.ts";

// The shared recipe catalogue (src/data/catalogue.json, built from TheMealDB
// with cleaned-up quantities and glanceable steps, many since rewritten to
// match their videos). It belongs to a system account nobody can sign in as,
// is public, and is loaded on boot: rows are keyed by `source`, and a recipe
// whose entry changed (its hash differs) is rewritten in place, keeping its id.

export const CATALOGUE_USERNAME = "larder";

export interface CatalogueRecipe {
  source: string;
  title: string;
  description: string;
  servings: number;
  cuisine: string;
  category: string;
  image: string;
  prep_minutes: number;
  cook_minutes: number;
  ingredients: { name: string; quantity: number | null; unit: string; note: string }[];
  steps: { text: string; minutes: number | null }[];
}

// TheMealDB's categories, folded into the courses people browse by. Every
// other category (Beef, Seafood, Vegetarian, Goat, Pasta, Miscellaneous...)
// is a main.
function course(category: string): string {
  if (category === "Dessert") return "dessert";
  if (category === "Breakfast") return "breakfast";
  if (["Starter", "Side"].includes(category)) return "starter";
  return "main";
}

// Dietary tags from canonical ingredient names. Word boundaries keep "goat's
// cheese", "kidney beans" and "butter beans" from reading as meat or dairy.
const MEAT = /chicken|beef|lamb|pork|bacon|chorizo|sausage|steak|mince|\bham\b|prosciutto|\bgoat\b(?!'s)|duck|turkey|veal|oxtail|kidney(?! beans)|liver|black pudding|lard|suet|gelatine|frog|conch|\bmeat\b/;
const FISH = /prawn|salmon|fish|tuna|mussel|squid|anchov|shrimp|oyster|\bcod\b|haddock|hake|trout|sardine|mackerel|herring|clam|crab|lobster|snapper|barramundi|sea bass|monkfish|seafood/;
const ANIMAL = /egg|milk|butter|cream|cheese|yoghurt|parmesan|pecorino|feta|paneer|mozzarella|ghee|honey|gruy|ricotta|mascarpone|custard|brie|gouda|stilton|manchego|halloumi|quark|fromage|condensed|evaporated|dulce de leche|ice cream|mayonnaise|aioli|marshmallow/;
const GLUTEN = /flour|bread|pasta|spaghetti|fettuccine|linguine|rigatoni|penne|macaroni|lasagne|noodle|couscous|breadcrumb|pastry|tortilla|soy sauce|biscuit|pita|naan|muffin|wonton|udon|oats|bulgur|semolina|farfalle|barley|rye|beer|baguette|ciabatta|rolls|wrappers|taco shells|kataifi|freekeh|cake/;
const DAIRY = /milk(?! chocolate)|butter(?! beans)|cream|cheese|yoghurt|parmesan|pecorino|feta|paneer|mozzarella|ghee|gruy|fraiche|fromage|ricotta|mascarpone|custard|brie|gouda|stilton|manchego|halloumi|quark|condensed|evaporated|dulce de leche|ice cream|milk chocolate|white chocolate/;
const PROTEIN = /chicken|beef|lamb|pork|salmon|prawn|tuna|tofu|paneer|lentil|steak|white fish|\bcod\b|haddock|trout|turkey|duck|\bgoat\b(?!'s)|veal|mackerel|sardine|crab|lobster|chickpea|tempeh|snapper|barramundi|sea bass|hake|monkfish|seafood|mussel|squid/;

// Plant foods whose names contain an animal word ("butter beans", "coconut
// milk", "vegan butter"), removed before the animal and dairy checks.
const PLANT = /\b(?:vegan|plant|dairy-free|oat|soy|almond|rice|cashew|coconut|peanut|nut|cocoa) (?:butter|milk|cream|cheese|yoghurt|mayonnaise|mayo|aioli)s?\b|\bbutter ?beans?\b|\bbutternut\b|\bcream of tartar\b|\beggplants?\b|\bnutritional yeast\b/g;

export function tags(r: Pick<CatalogueRecipe, "ingredients" | "category" | "prep_minutes" | "cook_minutes">): string[] {
  const names = r.ingredients.map((i) => i.name).join(" | ").replace(PLANT, "plant");
  const meat = MEAT.test(names);
  const fish = FISH.test(names);
  const out: string[] = [];
  if (!meat && !fish) out.push("vegetarian");
  if (!meat && !fish && !ANIMAL.test(names)) out.push("vegan");
  if (!GLUTEN.test(names)) out.push("gluten-free");
  if (!DAIRY.test(names)) out.push("dairy-free");
  if (r.prep_minutes + r.cook_minutes <= 30) out.push("quick");
  if (PROTEIN.test(names) && course(r.category) === "main") out.push("high-protein");
  return out;
}

function catalogueAuthor(): number {
  const existing = one<{ id: number }>("SELECT id FROM users WHERE username = ?", CATALOGUE_USERNAME);
  if (existing) return existing.id;
  // a random hash no password can match: the account exists only to own rows
  return run(
    "INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)",
    CATALOGUE_USERNAME,
    "Larder Kitchen",
    `locked$${randomBytes(16).toString("hex")}`,
  ).id;
}

// Lines a cook can leave out or already has to hand: garnishes, and oil for
// deep-frying (the recipe says how much, but it isn't eaten or bought per dish).
const OPTIONAL = /to serve|to garnish|garnish|for deep-frying/;

// The fingerprint of a catalogue entry: any change to it, however small,
// marks the seeded copy as out of date.
export function catalogueHash(r: CatalogueRecipe): string {
  return createHash("sha256").update(JSON.stringify(r)).digest("hex").slice(0, 16);
}

// Whether a recipe row already holds this entry: every column seeding writes
// (bar the dietary tags, which are derived), its ingredients and its steps.
function sameAsSeeded(id: number, r: CatalogueRecipe): boolean {
  const row = one<{ title: string; description: string; servings: number; image_url: string; cuisine: string; course: string; prep_minutes: number; cook_minutes: number }>(
    "SELECT title, description, servings, image_url, cuisine, course, prep_minutes, cook_minutes FROM recipes WHERE id = ?",
    id,
  );
  if (
    !row || row.title !== r.title || row.description !== r.description || row.servings !== r.servings || row.image_url !== r.image ||
    row.cuisine !== r.cuisine || row.course !== course(r.category) || row.prep_minutes !== r.prep_minutes || row.cook_minutes !== r.cook_minutes
  ) return false;
  const lines = all<{ name: string; quantity: number | null; unit: string; note: string }>(
    `SELECT i.name, ri.quantity, ri.unit, ri.note FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
     WHERE ri.recipe_id = ? ORDER BY ri.position`,
    id,
  );
  const steps = all<{ text: string }>("SELECT text FROM recipe_steps WHERE recipe_id = ? ORDER BY step_number", id);
  return (
    lines.length === r.ingredients.length &&
    lines.every((l, i) => {
      const g = r.ingredients[i];
      return l.name === normaliseIngredient(g.name) && l.quantity === g.quantity && l.unit === g.unit && (l.note ?? "") === g.note;
    }) &&
    steps.length === r.steps.length &&
    steps.every((s, i) => s.text === r.steps[i].text)
  );
}

// Adds catalogue recipes that aren't in the database yet and rewrites ones
// whose entry has changed since they were seeded. A revised recipe keeps its
// row and id; its ingredients and steps are replaced. One that someone is
// cooking right now is left until a later boot, so a live session's step
// count stays true. Returns how many recipes were added or revised.
export function seedCatalogue(file: URL | string = new URL("./data/catalogue.json", import.meta.url)): number {
  const recipes: CatalogueRecipe[] = JSON.parse(readFileSync(file, "utf8"));
  const seeded = new Map(
    all<{ id: number; source: string; source_hash: string | null }>(
      "SELECT id, source, source_hash FROM recipes WHERE source LIKE 'themealdb:%'",
    ).map((r) => [r.source, r]),
  );
  let changed = 0;
  transaction(() => {
    const author = catalogueAuthor();
    const addRecipe = db.prepare(
      `INSERT INTO recipes (author_id, title, description, servings, visibility, dietary_tags, image_url, cuisine, course, prep_minutes, cook_minutes, source, source_hash)
       VALUES (?, ?, ?, ?, 'public', ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const reviseRecipe = db.prepare(
      `UPDATE recipes SET title = ?, description = ?, servings = ?, dietary_tags = ?, image_url = ?, cuisine = ?, course = ?,
         prep_minutes = ?, cook_minutes = ?, source_hash = ?, updated_at = datetime('now')
       WHERE id = ?`,
    );
    const cooking = db.prepare("SELECT 1 FROM cook_sessions WHERE recipe_id = ? AND ended_at IS NULL");
    const addLine = db.prepare(
      "INSERT INTO recipe_ingredients (recipe_id, position, ingredient_id, quantity, unit, optional, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const addStep = db.prepare("INSERT INTO recipe_steps (recipe_id, step_number, text, est_minutes) VALUES (?, ?, ?, ?)");
    for (const r of recipes) {
      const hash = catalogueHash(r);
      const row = seeded.get(r.source);
      let id: number;
      if (!row) {
        id = Number(
          addRecipe.run(
            author, r.title, r.description, r.servings, JSON.stringify(tags(r)), r.image, r.cuisine, course(r.category),
            r.prep_minutes, r.cook_minutes, r.source, hash,
          ).lastInsertRowid,
        );
      } else {
        if (row.source_hash === hash) continue;
        // seeded before revisions were tracked: if it already holds this entry,
        // stamp it and refresh its derived tags rather than rewrite it
        if (row.source_hash === null && sameAsSeeded(row.id, r)) {
          run("UPDATE recipes SET source_hash = ?, dietary_tags = ? WHERE id = ?", hash, JSON.stringify(tags(r)), row.id);
          continue;
        }
        if (cooking.get(row.id)) continue;
        id = row.id;
        reviseRecipe.run(
          r.title, r.description, r.servings, JSON.stringify(tags(r)), r.image, r.cuisine, course(r.category),
          r.prep_minutes, r.cook_minutes, hash, id,
        );
        run("DELETE FROM recipe_ingredients WHERE recipe_id = ?", id);
        run("DELETE FROM recipe_steps WHERE recipe_id = ?", id);
      }
      r.ingredients.forEach((ing, i) => {
        addLine.run(id, i, ingredientId(ing.name, ing.unit), ing.quantity, ing.unit, OPTIONAL.test(ing.note) ? 1 : 0, ing.note);
      });
      r.steps.forEach((s, i) => addStep.run(id, i + 1, s.text, s.minutes));
      changed++;
    }
  });
  return changed;
}
