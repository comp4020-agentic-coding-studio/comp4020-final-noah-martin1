import { all, ingredientId, one, run, transaction } from "./db.ts";
import { DIETARY_TAGS } from "./format.ts";
import { parseYouTubeId } from "./videos.ts";
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
  image_url: string | null;
  cuisine: string;
  course: string;
  prep_minutes: number | null;
  // sum of the steps' timings
  cook_minutes: number;
  source: string | null;
  video_id: string | null;
  video_title: string | null;
  video_channel: string | null;
  video_checked: string | null;
  video_status: "verified" | "unavailable" | "rejected" | "user" | null;
  ingredient_count?: number;
  step_count?: number;
}

export interface RecipeIngredient {
  ingredient_id: number;
  name: string;
  quantity: number | null;
  unit: string;
  optional: number;
  note: string;
}

export const COURSES = [
  { key: "main", label: "Mains" },
  { key: "breakfast", label: "Breakfast" },
  { key: "starter", label: "Starters & sides" },
  { key: "dessert", label: "Desserts" },
] as const;

export function totalMinutes(r: Pick<Recipe, "prep_minutes" | "cook_minutes">): number {
  return (r.prep_minutes ?? 0) + r.cook_minutes;
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
  // undefined: leave the recipe's video alone; null: remove it; string: attach this id
  video_id?: string | null;
}

const SELECT = `SELECT r.*, u.username AS author_username, u.display_name AS author_name,
  (SELECT COUNT(*) FROM recipe_ingredients ri WHERE ri.recipe_id = r.id) AS ingredient_count,
  (SELECT COUNT(*) FROM recipe_steps rs WHERE rs.recipe_id = r.id) AS step_count,
  COALESCE(r.cook_minutes, (SELECT COALESCE(SUM(est_minutes), 0) FROM recipe_steps rs WHERE rs.recipe_id = r.id)) AS cook_minutes
  FROM recipes r JOIN users u ON u.id = r.author_id`;

function hydrate(row: Record<string, unknown>): Recipe {
  return { ...(row as unknown as Recipe), dietary_tags: JSON.parse(String(row.dietary_tags ?? "[]")) };
}

export function getRecipe(id: number): Recipe | undefined {
  const row = one<Record<string, unknown>>(`${SELECT} WHERE r.id = ?`, id);
  return row ? hydrate(row) : undefined;
}

// Public catalogue recipes by exact title, for pages that refer to a dish by
// name (the live globe's sample sessions).
export function catalogueByTitle(titles: string[]): Map<string, Recipe> {
  const out = new Map<string, Recipe>();
  if (!titles.length) return out;
  const rows = all<Record<string, unknown>>(
    `${SELECT} WHERE r.source IS NOT NULL AND r.visibility = 'public' AND r.title IN (${titles.map(() => "?").join(", ")})`,
    ...titles,
  );
  for (const row of rows) {
    const r = hydrate(row);
    out.set(r.title, r);
  }
  return out;
}

export function recipeIngredients(id: number): RecipeIngredient[] {
  return all<RecipeIngredient>(
    `SELECT ri.ingredient_id, i.name, ri.quantity, ri.unit, ri.optional, ri.note
     FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
     WHERE ri.recipe_id = ? ORDER BY ri.position`,
    id,
  );
}

// Ingredient lines for many recipes in one query, for tiles that show
// nutrition and cost without a query per recipe.
export function ingredientsFor(ids: number[]): Map<number, RecipeIngredient[]> {
  const out = new Map<number, RecipeIngredient[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const rows = all<RecipeIngredient & { recipe_id: number }>(
    `SELECT ri.recipe_id, ri.ingredient_id, i.name, ri.quantity, ri.unit, ri.optional, ri.note
     FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
     WHERE ri.recipe_id IN (${ids.map(() => "?").join(", ")}) ORDER BY ri.recipe_id, ri.position`,
    ...ids,
  );
  for (const row of rows) out.get(row.recipe_id)?.push(row);
  return out;
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
  course?: string;
  cuisine?: string;
  maxMinutes?: number;
  excludeId?: number;
  order?: "newest" | "featured";
  limit?: number;
}

export function cuisines(): string[] {
  return all<{ cuisine: string }>(
    "SELECT cuisine, COUNT(*) n FROM recipes WHERE visibility = 'public' AND cuisine != '' GROUP BY cuisine ORDER BY n DESC, cuisine",
  ).map((r) => r.cuisine);
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
    // title, description, cuisine, or any ingredient: "eggs" finds shakshuka
    where.push(`(r.title LIKE ? OR r.description LIKE ? OR r.cuisine LIKE ? OR EXISTS (
      SELECT 1 FROM recipe_ingredients qi JOIN ingredients qn ON qn.id = qi.ingredient_id
      WHERE qi.recipe_id = r.id AND qn.name LIKE ?))`);
    const like = `%${opts.query}%`;
    params.push(like, like, like, like);
  }
  if (opts.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(r.dietary_tags) WHERE value = ?)");
    params.push(opts.tag);
  }
  if (opts.course) {
    where.push("r.course = ?");
    params.push(opts.course);
  }
  if (opts.cuisine) {
    where.push("r.cuisine = ?");
    params.push(opts.cuisine);
  }
  if (opts.excludeId !== undefined) {
    where.push("r.id != ?");
    params.push(opts.excludeId);
  }
  if (opts.maxMinutes !== undefined) {
    where.push(
      "COALESCE(r.prep_minutes, 0) + COALESCE(r.cook_minutes, (SELECT COALESCE(SUM(est_minutes), 0) FROM recipe_steps ms WHERE ms.recipe_id = r.id)) <= ?",
    );
    params.push(opts.maxMinutes);
  }
  params.push(opts.limit ?? 200);
  // "featured": photographed recipes first, then a stable shuffle so the
  // browse page doesn't read as an alphabetical list
  let order =
    opts.order === "featured"
      ? "(r.image_url IS NULL), ((r.id * 2654435761) % 1000), r.id"
      : "r.created_at DESC, r.id DESC";
  // a search ranks title matches first, then photographed recipes
  const orderParams: string[] = [];
  if (opts.query && opts.order !== "newest") {
    order = `(r.title NOT LIKE ?), (r.image_url IS NULL), r.title`;
    orderParams.push(`%${opts.query}%`);
  }
  const limit = params.pop()!;
  return all<Record<string, unknown>>(
    `${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`,
    ...params,
    ...orderParams,
    limit,
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

  // Optional. Blank clears it; anything else must be a YouTube video address.
  let video_id: string | null | undefined;
  if (form.has("video_url")) {
    const raw = (form.get("video_url") ?? "").trim();
    if (raw === "") video_id = null;
    else {
      video_id = parseYouTubeId(raw);
      if (!video_id) problems.push("The video link must be a YouTube video address, like https://www.youtube.com/watch?v=…");
    }
  }

  return {
    input: { title, description, servings, visibility, dietary_tags: tags, ingredients, steps, video_id },
    problems,
  };
}

// An author's own link: kept as theirs ("user"), never presented as checked.
function setVideo(recipeId: number, videoId: string | null): void {
  if (videoId === null) {
    run("UPDATE recipes SET video_id = NULL, video_title = NULL, video_channel = NULL, video_checked = NULL, video_status = NULL WHERE id = ?", recipeId);
  } else {
    run(
      "UPDATE recipes SET video_id = ?, video_title = NULL, video_channel = NULL, video_checked = NULL, video_status = 'user' WHERE id = ?",
      videoId, recipeId,
    );
  }
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
      if (input.video_id) setVideo(id, input.video_id);
    } else {
      run(
        `UPDATE recipes SET title = ?, description = ?, servings = ?, visibility = ?, dietary_tags = ?,
         updated_at = datetime('now') WHERE id = ? AND author_id = ?`,
        input.title, input.description, input.servings, input.visibility, tags, id, authorId,
      );
      if (input.video_id !== undefined) setVideo(id, input.video_id);
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

export function pantryMatch(viewerId: number, ingredients: Pick<RecipeIngredient, "ingredient_id" | "optional">[]): PantryMatch {
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
