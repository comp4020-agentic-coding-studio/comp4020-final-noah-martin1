import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { db, ingredientId, one, run, transaction } from "./db.ts";

// The shared recipe catalogue (src/data/catalogue.json, built from TheMealDB
// with cleaned-up quantities and glanceable steps). It belongs to a system
// account nobody can sign in as, is public, and is loaded once per recipe on
// boot: rows are keyed by `source`, so re-running it changes nothing.

export const CATALOGUE_USERNAME = "larder";

interface CatalogueRecipe {
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

function tags(r: CatalogueRecipe): string[] {
  const names = r.ingredients.map((i) => i.name).join(" | ");
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

export function seedCatalogue(): number {
  const file = new URL("./data/catalogue.json", import.meta.url);
  const text = readFileSync(file, "utf8");
  // Already seeded (the usual boot): count sources without building ~750
  // recipe objects, so a restart doesn't pay for parsing the whole file.
  const listed = (text.match(/"source": "/g) ?? []).length;
  const seeded = one<{ n: number }>("SELECT COUNT(*) AS n FROM recipes WHERE source LIKE 'themealdb:%'")?.n ?? 0;
  if (listed > 0 && seeded >= listed) return 0;

  const recipes: CatalogueRecipe[] = JSON.parse(text);
  let added = 0;
  transaction(() => {
    const author = catalogueAuthor();
    const exists = db.prepare("SELECT 1 FROM recipes WHERE source = ?");
    const addRecipe = db.prepare(
      `INSERT INTO recipes (author_id, title, description, servings, visibility, dietary_tags, image_url, cuisine, course, prep_minutes, cook_minutes, source)
       VALUES (?, ?, ?, ?, 'public', ?, ?, ?, ?, ?, ?, ?)`,
    );
    const addLine = db.prepare(
      "INSERT INTO recipe_ingredients (recipe_id, position, ingredient_id, quantity, unit, optional, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const addStep = db.prepare("INSERT INTO recipe_steps (recipe_id, step_number, text, est_minutes) VALUES (?, ?, ?, ?)");
    for (const r of recipes) {
      if (exists.get(r.source)) continue;
      const id = Number(
        addRecipe.run(
          author, r.title, r.description, r.servings, JSON.stringify(tags(r)), r.image, r.cuisine, course(r.category),
          r.prep_minutes, r.cook_minutes, r.source,
        ).lastInsertRowid,
      );
      r.ingredients.forEach((ing, i) => {
        addLine.run(id, i, ingredientId(ing.name, ing.unit), ing.quantity, ing.unit, OPTIONAL.test(ing.note) ? 1 : 0, ing.note);
      });
      r.steps.forEach((s, i) => addStep.run(id, i + 1, s.text, s.minutes));
      added++;
    }
  });
  return added;
}
