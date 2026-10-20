import { existsSync, readFileSync } from "node:fs";

// Real supermarket products for an ingredient, read from the retailers' own
// public pages by scripts/refresh-prices.ts and stored in
// src/data/products.json. Each product keeps its retailer, product page,
// package size, shelf price and the moment that price was read, so pages can
// say how old a price is. Nothing here fetches at request time.

export type Retailer = "woolworths" | "aldi";
export type SizeUnit = "g" | "ml" | "each";

export interface Product {
  retailer: Retailer;
  name: string;
  url: string;
  priceCents: number;
  size: { amount: number; unit: SizeUnit };
  checkedAt: string;
  available: boolean;
}

export interface ProductStats {
  ingredients: number;
  withWoolworths: number;
  withAldi: number;
  woolworthsProductsRead: number;
  aldiProductsRead: number;
  blocked: Retailer[];
}

export interface ProductData {
  generatedAt: string;
  products: Record<string, Product[]>;
  stats?: ProductStats;
}

/* ---------------- sizes ---------------- */

const NUM = "(\\d+(?:\\.\\d+)?)";
const MASS_VOL: Record<string, { mult: number; unit: SizeUnit }> = {
  g: { mult: 1, unit: "g" },
  kg: { mult: 1000, unit: "g" },
  ml: { mult: 1, unit: "ml" },
  l: { mult: 1000, unit: "ml" },
};

// "2kg" → 2000 g, "600mL" → 600 ml, "4 x 125g" → 500 g, "12 pack" → 12 each.
// Null when the text gives no fixed package (loose produce sold "per kg").
export function parseSize(text: string): { amount: number; unit: SizeUnit } | null {
  const t = text.toLowerCase().replace(/,/g, "").trim();
  if (!t) return null;
  if (/\b(per|\/)\s*(kg|100g|g)\b/.test(t) || /\bper kg\b/.test(t)) return null;
  const multi = new RegExp(`${NUM}\\s*(?:x|×)\\s*${NUM}\\s*(kg|g|ml|l)\\b`).exec(t);
  if (multi) {
    const u = MASS_VOL[multi[3]];
    const amount = Number(multi[1]) * Number(multi[2]) * u.mult;
    return amount > 0 ? { amount: Math.round(amount * 100) / 100, unit: u.unit } : null;
  }
  const single = new RegExp(`${NUM}\\s*(kg|g|ml|l)\\b`).exec(t);
  if (single) {
    const u = MASS_VOL[single[2]];
    const amount = Number(single[1]) * u.mult;
    return amount > 0 ? { amount: Math.round(amount * 100) / 100, unit: u.unit } : null;
  }
  if (/\bdozen\b/.test(t)) return { amount: 12, unit: "each" };
  const pack = new RegExp(`${NUM}\\s*(?:pack|pk|pieces?|pcs|ea|each|count|ct)\\b`).exec(t);
  if (pack && Number(pack[1]) > 0) return { amount: Number(pack[1]), unit: "each" };
  if (/^(each|ea|1 each)$/.test(t)) return { amount: 1, unit: "each" };
  return null;
}

/* ---------------- matching an ingredient to a product ---------------- */

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(o|x|ch|sh|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(stem);
}

// Words that don't make a product a different thing.
const FILLER = new Set(["fresh", "large", "small", "finely", "raw", "free", "range", "whole", "baby"]);

// A product with one of these in its name is a different food from a plain
// ingredient ("chicken stock" isn't chicken, "milk chocolate" isn't milk),
// unless the ingredient itself says so.
const OTHER_FOOD = new Set(
  [
    "stock", "broth", "chocolate", "coconut", "sauce", "soup", "chip", "crisp", "snack", "bar", "biscuit", "cookie",
    "cake", "pie", "pizza", "crumbed", "marinated", "flavoured", "flavored", "lolly", "lollies", "juice", "drink",
    "ice", "peanut", "almond", "cashew", "popcorn", "cracker", "meal", "kit", "dip", "spread", "sandwich", "wrap",
    "bite", "ball", "nugget", "schnitzel", "kiev", "burger", "pattie", "patty", "sausage", "slice", "dessert",
    "pudding", "custard", "yoghurt", "yogurt", "smoothie", "shake", "cereal", "muesli", "granola", "dressing",
    "seasoning", "mix", "pet", "dog", "cat", "kibble", "bean", "pickle", "pickled", "curry", "fried", "soy", "soya", "oat",
    "tender", "crumb", "paste", "gluten", "blend", "spreadable", "mince", "rice", "noodle", "pasta", "flavour",
    "smoked", "stuffed", "battered", "glazed", "chicken", "beef", "pork", "lamb", "croissant", "ring", "shredded",
    "bread", "pastry", "tart", "muffin", "bun", "roll", "ravioli", "tortellini", "gnocchi", "lasagne", "salad",
  ].map(stem),
);

export function matchesIngredient(ingredient: string, productName: string): boolean {
  const want = tokens(ingredient).filter((w) => !FILLER.has(w));
  if (!want.length) return false;
  const have = new Set(tokens(productName));
  if (!want.every((w) => have.has(w))) return false;
  // price is for a fixed pack: not a range ("1.5kg - 2.2kg") or per-kg item
  if (/\d\s*(kg|g)\s*-\s*\d/i.test(productName) || /\bper\s*kg\b/i.test(productName)) return false;
  const wantSet = new Set(want);
  for (const h of have) if (OTHER_FOOD.has(h) && !wantSet.has(h)) return false;
  return true;
}

// Price per gram, per ml or per item: for comparing like with like.
export function unitPrice(p: Pick<Product, "priceCents" | "size">): number {
  return p.priceCents / p.size.amount;
}

/* ---------------- the stored data ---------------- */

let cache: ProductData | null = null;
let keys: string[] = [];
let keyRegex = new Map<string, RegExp>();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function loadProducts(): ProductData {
  if (cache) return cache;
  const file = new URL("./data/products.json", import.meta.url);
  cache = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as ProductData)
    : { generatedAt: "", products: {} };
  keys = Object.keys(cache.products).sort((a, b) => b.length - a.length);
  keyRegex = new Map(keys.map((k) => [k, new RegExp(`(^|[^a-z])${escape(k)}(es|s)?($|[^a-z])`)]));
  return cache;
}

// Products for an ingredient: its own key, then the plural or singular, then
// the longest stored key that appears in the name as whole words.
export function productsFor(ingredientName: string): Product[] {
  const data = loadProducts();
  const n = ingredientName.toLowerCase().trim().replace(/\s+/g, " ");
  if (!n) return [];
  const tries = [n, `${n}s`, n.endsWith("s") ? n.slice(0, -1) : "", n.endsWith("es") ? n.slice(0, -2) : ""];
  for (const k of tries) if (k && data.products[k]?.length) return data.products[k];
  for (const k of keys) if (data.products[k].length && keyRegex.get(k)!.test(n)) return data.products[k];
  return [];
}

export function dataAge(): { generatedAt: string | null } {
  const g = loadProducts().generatedAt;
  return { generatedAt: g || null };
}
