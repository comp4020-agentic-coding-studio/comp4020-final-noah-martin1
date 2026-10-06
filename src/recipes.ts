import { all, ingredientId, one, run, transaction } from "./db.ts";
import { DIETARY_TAGS } from "./format.ts";
import { visibleRecipeSql } from "./visibility.ts";

export interface Recipe {
  id: number;
  author_id: number;
  author_username: string;
  author_name: string;
  title: string;
  description: string;
  servings: number;
  visibility: "public" | "friends" | "private";
  dietary_tags: string[];
  created_at: string;
  updated_at: string;
  ingredient_count?: number;
  step_count?: number;
}

export interface RecipeIngredient {
  ingredient_id: number;
  name: string;
  quantity: number | null;
  unit: string;
  optional: number;
}

export interface RecipeStep {
  step_number: number;
  text: string;
  est_minutes: number | null;
}

export interface RecipeInput {
  title: string;
  description: string;
  servings: number;
  visibility: Recipe["visibility"];
  dietary_tags: string[];
  ingredients: { name: string; quantity: number | null; unit: string; optional: boolean }[];
  steps: { text: string; est_minutes: number | null }[];
}

const SELECT = `SELECT r.*, u.username AS author_username, u.display_name AS author_name,
  (SELECT COUNT(*) FROM recipe_ingredients ri WHERE ri.recipe_id = r.id) AS ingredient_count,
  (SELECT COUNT(*) FROM recipe_steps rs WHERE rs.recipe_id = r.id) AS step_count
  FROM recipes r JOIN users u ON u.id = r.author_id`;

function hydrate(row: Record<string, unknown>): Recipe {
  return { ...(row as unknown as Recipe), dietary_tags: JSON.parse(String(row.dietary_tags ?? "[]")) };
}

export function getRecipe(id: number): Recipe | undefined {
  const row = one<Record<string, unknown>>(`${SELECT} WHERE r.id = ?`, id);
  return row ? hydrate(row) : undefined;
}

export function recipeIngredients(id: number): RecipeIngredient[] {
  return all<RecipeIngredient>(
    `SELECT ri.ingredient_id, i.name, ri.quantity, ri.unit, ri.optional
     FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
     WHERE ri.recipe_id = ? ORDER BY ri.position`,
    id,
  );
}

export function recipeSteps(id: number): RecipeStep[] {
  return all<RecipeStep>(
    "SELECT step_number, text, est_minutes FROM recipe_steps WHERE recipe_id = ? ORDER BY step_number",
    id,
  );
}

interface ListOptions {
  authorId?: number;
  authorIds?: number[];
  excludeAuthorId?: number;
  query?: string;
  tag?: string;
  limit?: number;
}

// Recipes the viewer may see, newest first. Visibility comes from
// visibility.ts; the filters here only narrow what is already allowed.
export function listVisibleRecipes(viewerId: number | null, opts: ListOptions = {}): Recipe[] {
  const vis = visibleRecipeSql(viewerId);
  const where = [vis.where];
  const params: (number | string)[] = [...vis.params];
  if (opts.authorId !== undefined) {
    where.push("r.author_id = ?");
    params.push(opts.authorId);
  }
  if (opts.authorIds !== undefined) {
    if (!opts.authorIds.length) return [];
    where.push(`r.author_id IN (${opts.authorIds.map(() => "?").join(", ")})`);
    params.push(...opts.authorIds);
  }
  if (opts.excludeAuthorId !== undefined) {
    where.push("r.author_id != ?");
    params.push(opts.excludeAuthorId);
  }
  if (opts.query) {
    where.push("(r.title LIKE ? OR r.description LIKE ?)");
    params.push(`%${opts.query}%`, `%${opts.query}%`);
  }
  if (opts.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(r.dietary_tags) WHERE value = ?)");
    params.push(opts.tag);
  }
  params.push(opts.limit ?? 100);
  return all<Record<string, unknown>>(
    `${SELECT} WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    ...params,
  ).map(hydrate);
}

export function parseRecipeForm(form: URLSearchParams): { input: RecipeInput; problems: string[] } {
  const problems: string[] = [];
  const title = (form.get("title") ?? "").trim();
  const description = (form.get("description") ?? "").trim();
  const servings = Number(form.get("servings") ?? 2);
  const visibility = form.get("visibility") as Recipe["visibility"];
  const tags = form.getAll("tags").filter((t) => (DIETARY_TAGS as readonly string[]).includes(t));

  if (!title || title.length > 120) problems.push("Give the recipe a title (up to 120 characters).");
  if (description.length > 2000) problems.push("Keep the description under 2000 characters.");
  if (!Number.isInteger(servings) || servings < 1 || servings > 50) problems.push("Servings must be a whole number from 1 to 50.");
  if (!["public", "friends", "private"].includes(visibility)) problems.push("Choose who can see this recipe.");

  const names = form.getAll("ing_name");
  const qtys = form.getAll("ing_qty");
  const units = form.getAll("ing_unit");
  const optionals = new Set(form.getAll("ing_optional"));
  const ingredients: RecipeInput["ingredients"] = [];
  names.forEach((raw, i) => {
    const name = raw.trim();
    if (!name) return;
    const q = (qtys[i] ?? "").trim();
    const quantity = q === "" ? null : Number(q);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) {
      problems.push(`Quantity for "${name}" must be a positive number.`);
    }
    ingredients.push({ name: name.slice(0, 80), quantity, unit: (units[i] ?? "").trim().slice(0, 20), optional: optionals.has(String(i)) });
  });
  if (!ingredients.length) problems.push("Add at least one ingredient.");

  const stepTexts = form.getAll("step_text");
  const stepMins = form.getAll("step_minutes");
  const steps: RecipeInput["steps"] = [];
  stepTexts.forEach((raw, i) => {
    const text = raw.trim();
    if (!text) return;
    const m = (stepMins[i] ?? "").trim();
    const est = m === "" ? null : Number(m);
    if (est !== null && (!Number.isInteger(est) || est < 0 || est > 1440)) {
      problems.push(`Step ${steps.length + 1}: minutes must be a whole number.`);
    }
    steps.push({ text: text.slice(0, 1000), est_minutes: est });
  });
  if (!steps.length) problems.push("Add at least one step.");

  return {
    input: { title, description, servings, visibility, dietary_tags: tags, ingredients, steps },
    problems,
  };
}

export function saveRecipe(authorId: number, input: RecipeInput, recipeId?: number): number {
  return transaction(() => {
    let id = recipeId;
    const tags = JSON.stringify(input.dietary_tags);
    if (id === undefined) {
      id = run(
        `INSERT INTO recipes (author_id, title, description, servings, visibility, dietary_tags)
         VALUES (?, ?, ?, ?, ?, ?)`,
        authorId, input.title, input.description, input.servings, input.visibility, tags,
      ).id;
    } else {
      run(
        `UPDATE recipes SET title = ?, description = ?, servings = ?, visibility = ?, dietary_tags = ?,
         updated_at = datetime('now') WHERE id = ? AND author_id = ?`,
        input.title, input.description, input.servings, input.visibility, tags, id, authorId,
      );
      run("DELETE FROM recipe_ingredients WHERE recipe_id = ?", id);
      run("DELETE FROM recipe_steps WHERE recipe_id = ?", id);
    }
    input.ingredients.forEach((ing, i) => {
      run(
        "INSERT INTO recipe_ingredients (recipe_id, position, ingredient_id, quantity, unit, optional) VALUES (?, ?, ?, ?, ?, ?)",
        id!, i, ingredientId(ing.name, ing.unit), ing.quantity, ing.unit, ing.optional ? 1 : 0,
      );
    });
    input.steps.forEach((step, i) => {
      run(
        "INSERT INTO recipe_steps (recipe_id, step_number, text, est_minutes) VALUES (?, ?, ?, ?)",
        id!, i + 1, step.text, step.est_minutes,
      );
    });
    return id;
  });
}

// What the viewer's own pantry says about a recipe: which ingredients they
// hold (fresh, not expired) and what the rest would cost at the prices they
// last paid. Deterministic on purpose: the AI planner in a later phase builds
// on this rather than replacing it (CLAUDE.md invariant 6).
export interface PantryMatch {
  have: Set<number>;
  missing: number;
  // how many of the missing ingredients have a known price
  priced: number;
  estCents: number;
}

export function pantryMatch(viewerId: number, ingredients: RecipeIngredient[]): PantryMatch {
  const held = all<{ ingredient_id: number }>(
    `SELECT ingredient_id FROM inventory_items
     WHERE owner_type = 'user' AND owner_id = ? AND quantity > 0
       AND (expiry_date IS NULL OR expiry_date >= date('now', 'localtime'))`,
    viewerId,
  );
  const have = new Set(held.map((h) => h.ingredient_id));
  // price per item row as entered (a pack price), latest known per ingredient
  const prices = new Map<number, number>();
  for (const row of all<{ ingredient_id: number; price_cents: number }>(
    `SELECT ingredient_id, price_cents FROM inventory_items
     WHERE owner_type = 'user' AND owner_id = ? AND price_cents IS NOT NULL
     ORDER BY updated_at`,
    viewerId,
  )) prices.set(row.ingredient_id, row.price_cents);

  let missing = 0;
  let est = 0;
  let priced = 0;
  for (const ing of ingredients) {
    if (ing.optional) continue;
    if (!have.has(ing.ingredient_id)) {
      missing++;
      const p = prices.get(ing.ingredient_id);
      if (p !== undefined) {
        est += p;
        priced++;
      }
    }
  }
  return { have, missing, priced, estCents: est };
}

export function deleteRecipe(id: number, authorId: number): boolean {
  return run("DELETE FROM recipes WHERE id = ? AND author_id = ?", id, authorId).changes > 0;
}
