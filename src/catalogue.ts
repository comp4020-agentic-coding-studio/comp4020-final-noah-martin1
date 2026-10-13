import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ingredientId, one, run, transaction } from "./db.ts";

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

// TheMealDB's categories, folded into the courses people browse by.
function course(category: string): string {
  if (category === "Dessert") return "dessert";
  if (category === "Breakfast") return "breakfast";
  if (["Starter", "Side"].includes(category)) return "starter";
  return "main";
}

function tags(r: CatalogueRecipe): string[] {
  const names = r.ingredients.map((i) => i.name).join(" | ");
  const meat = /chicken|beef|lamb|pork|bacon|chorizo|sausage|steak|mince/.test(names);
  const fish = /prawn|salmon|fish|tuna|mussel|squid|anchov|shrimp|oyster sauce/.test(names);
  const out: string[] = [];
  if (!meat && !fish) out.push("vegetarian");
  if (!meat && !fish && !/egg|milk|butter|cream|cheese|yoghurt|parmesan|pecorino|feta|paneer|mozzarella|ghee|honey|gruy/.test(names)) out.push("vegan");
  if (!/flour|bread|pasta|spaghetti|fettuccine|linguine|rigatoni|penne|macaroni|lasagne|noodle|couscous|breadcrumb|pastry|tortilla|soy sauce|biscuit|pita|naan|muffin|wonton|udon|oats/.test(names)) out.push("gluten-free");
  if (!/milk|butter|cream|cheese|yoghurt|parmesan|pecorino|feta|paneer|mozzarella|ghee|gruy|fraiche|fromage/.test(names)) out.push("dairy-free");
  if (r.prep_minutes + r.cook_minutes <= 30) out.push("quick");
  if (/chicken|beef|lamb|pork|salmon|prawn|tuna|tofu|paneer|lentil|steak|white fish/.test(names) && course(r.category) === "main") out.push("high-protein");
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

export function seedCatalogue(): number {
  const recipes: CatalogueRecipe[] = JSON.parse(readFileSync(new URL("./data/catalogue.json", import.meta.url), "utf8"));
  let added = 0;
  transaction(() => {
    const author = catalogueAuthor();
    for (const r of recipes) {
      if (one("SELECT 1 FROM recipes WHERE source = ?", r.source)) continue;
      const id = run(
        `INSERT INTO recipes (author_id, title, description, servings, visibility, dietary_tags, image_url, cuisine, course, prep_minutes, cook_minutes, source)
         VALUES (?, ?, ?, ?, 'public', ?, ?, ?, ?, ?, ?, ?)`,
        author, r.title, r.description, r.servings, JSON.stringify(tags(r)), r.image, r.cuisine, course(r.category),
        r.prep_minutes, r.cook_minutes, r.source,
      ).id;
      r.ingredients.forEach((ing, i) => {
        run(
          "INSERT INTO recipe_ingredients (recipe_id, position, ingredient_id, quantity, unit, optional, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
          id, i, ingredientId(ing.name, ing.unit), ing.quantity, ing.unit, /to serve|to garnish|garnish/.test(ing.note) ? 1 : 0, ing.note,
        );
      });
      r.steps.forEach((s, i) => {
        run("INSERT INTO recipe_steps (recipe_id, step_number, text, est_minutes) VALUES (?, ?, ?, ?)", id, i + 1, s.text, s.minutes);
      });
      added++;
    }
  });
  return added;
}
