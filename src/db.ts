import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// The Fly volume is mounted at /data and is the only storage that survives a
// redeploy; local dev points DATA_DIR at ./data instead.
const dataDir = process.env.DATA_DIR ?? "/data";
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, "app.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

// Migrations are numbered .sql files applied once each, in order, inside a
// transaction. Never edit one that has shipped; add the next number instead.
function migrate(): void {
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    db.prepare("SELECT name FROM migrations").all().map((row) => String(row.name)),
  );
  const dir = new URL("./migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    transaction(() => {
      db.exec(readFileSync(new URL(name, dir), "utf8"));
      db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, datetime('now'))").run(name);
    });
    console.log(`migrated ${name}`);
  }
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Typed wrappers so call sites read as one line. Rows come back as plain
// objects; callers cast to the shape their SELECT produces.
export function one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLInputValue[]): { id: number; changes: number } {
  const result = db.prepare(sql).run(...params);
  return { id: Number(result.lastInsertRowid), changes: Number(result.changes) };
}

// Canonical ingredient catalog: names are trimmed, lower-cased and
// whitespace-collapsed so "Roma  Tomatoes" and "roma tomatoes" are one row.
export function normaliseIngredient(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function ingredientId(name: string, unit = ""): number {
  const clean = normaliseIngredient(name);
  run("INSERT INTO ingredients (name, default_unit) VALUES (?, ?) ON CONFLICT (name) DO NOTHING", clean, unit);
  return one<{ id: number }>("SELECT id FROM ingredients WHERE name = ?", clean)!.id;
}

// Autocomplete suggestions for one person: the seeded catalog plus names they
// have used themselves. Names other people typed stay out, since a freeform
// ingredient can say more about someone than they meant to share.
export function catalogFor(userId: number): string[] {
  return all<{ name: string }>(
    `SELECT name FROM ingredients WHERE category != 'other'
     UNION SELECT i.name FROM ingredients i JOIN inventory_items it ON it.ingredient_id = i.id
       WHERE it.owner_type = 'user' AND it.owner_id = ?
     UNION SELECT i.name FROM ingredients i JOIN recipe_ingredients ri ON ri.ingredient_id = i.id
       JOIN recipes r ON r.id = ri.recipe_id WHERE r.author_id = ?
     ORDER BY name`,
    userId,
    userId,
  ).map((r) => r.name);
}

const CATALOG: [string, string, string][] = [
  ["eggs", "", "dairy"], ["milk", "ml", "dairy"], ["butter", "g", "dairy"],
  ["cheddar cheese", "g", "dairy"], ["parmesan", "g", "dairy"], ["greek yoghurt", "g", "dairy"],
  ["chicken thigh", "g", "meat"], ["chicken breast", "g", "meat"], ["beef mince", "g", "meat"],
  ["bacon", "g", "meat"], ["salmon fillet", "g", "seafood"], ["prawns", "g", "seafood"],
  ["firm tofu", "g", "protein"], ["chickpeas", "g", "pantry"], ["black beans", "g", "pantry"],
  ["rice", "g", "pantry"], ["spaghetti", "g", "pantry"], ["rice noodles", "g", "pantry"],
  ["plain flour", "g", "pantry"], ["rolled oats", "g", "pantry"], ["bread", "", "bakery"],
  ["olive oil", "ml", "pantry"], ["soy sauce", "ml", "pantry"], ["fish sauce", "ml", "pantry"],
  ["canned tomatoes", "g", "pantry"], ["coconut milk", "ml", "pantry"], ["peanut butter", "g", "pantry"],
  ["onion", "", "produce"], ["garlic", "clove", "produce"], ["ginger", "g", "produce"],
  ["carrot", "", "produce"], ["broccoli", "g", "produce"], ["spinach", "g", "produce"],
  ["capsicum", "", "produce"], ["tomato", "", "produce"], ["potato", "g", "produce"],
  ["lemon", "", "produce"], ["lime", "", "produce"], ["coriander", "bunch", "produce"],
  ["spring onion", "", "produce"], ["mushrooms", "g", "produce"], ["banana", "", "produce"],
];

function seedCatalog(): void {
  const insert = db.prepare(
    "INSERT INTO ingredients (name, default_unit, category) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING",
  );
  for (const [name, unit, category] of CATALOG) insert.run(name, unit, category);
}

migrate();
seedCatalog();
