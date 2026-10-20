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

/* ---------------- like for like ---------------- */

// A product is a fair buy for an ingredient only when it is that ingredient,
// not something made with it: "Lemon & Pepper Tuna" isn't lemons, "Garlic
// Naan" isn't garlic, ground coriander isn't a coriander bunch. The rule:
// every word of the product name must be one of the ingredient's own words
// or a qualifier (brand, grade, pack, origin). Any other food word, or a
// form the recipe didn't ask for (dried, ground, canned...), makes it a
// different product. Deterministic and checked in spec/products.test.ts.

// Words that describe a product without changing what it is.
const QUALIFIERS = new Set(
  [
    "woolworths", "essentials", "macro", "organic", "the", "odd", "bunch", "market", "value", "fare", "aldi", "brand",
    "australian", "australia", "grown", "aussie", "local", "premium", "select", "selection", "classic", "original", "originals",
    "traditional", "gourmet", "pure", "natural", "real", "quality", "finest", "everyday", "farmers", "own", "farm", "farms",
    "fresh", "free", "range", "barn", "laid", "cage", "rspca", "approved", "grass", "fed", "lean", "extra", "regular",
    "large", "small", "medium", "x", "xl", "jumbo", "mini", "baby", "whole", "half", "family", "bulk", "value", "pack",
    "pk", "bag", "box", "tub", "jar", "bottle", "punnet", "tray", "loose", "prepacked", "pre", "packed", "net", "each",
    "ea", "pcs", "piece", "pieces", "block", "fillet", "fillets", "full", "cream", "light", "lite", "skim", "reduced",
    "salt", "salted", "unsalted", "fat", "low", "no", "added", "white", "brown", "red", "yellow", "green", "golden",
    "long", "grain", "short", "fine", "coarse", "plain", "virgin", "vine", "truss", "washed", "brushed",
    "and", "with", "of", "in", "for", "co", "company", "kitchen", "pantry", "home", "style", "range", "standard",
    "deveined", "peeled", "tail", "off", "on", "skin", "boneless", "skinless", "cutlets", "thigh", "breast",
    "stonemill", "farmdale", "remano", "imperial", "lodge", "pure", "valley", "jindurra", "station", "emporium",
    "cucina", "matta", "colway", "portview", "ocean", "royale", "westacre", "dairy", "mill", "white", "asia", "garden",
    "hoyt", "hoyts", "masterfoods", "mckenzie", "mckenzies", "sunrice", "san", "remo", "bega", "western", "star",
    "pace", "lantern", "alley", "pandaroo", "annalisa", "la", "gina", "campbell", "campbells", "edgell", "inner",
    "goodness", "always", "olive", "tree", "valcom", "chef", "chefs", "s", "g", "kg", "ml", "l", "dozen", "count",
    "pail", "squeeze", "twist", "handypack", "multipack", "sachet", "carton", "pouch", "can", "tin", "duo", "trio",
    "prepack", "loose", "iodised", "table", "cooking", "blended", "spanish", "italian", "greek", "thickened", "pouring",
    "continental", "flat", "curly", "iceberg", "cos", "royal", "gala", "pink", "lady", "granny", "smith", "navel",
    "valencia", "jap", "kent", "butternut", "dutch", "cream", "creamy", "longlife", "life", "uht", "homogenised",
    "pasteurised", "unhomogenised", "lactose", "a", "permeate", "club", "vintage", "tasty", "mild", "sharp", "aged",
    "thai", "jasmine", "basmati", "sushi", "arborio", "medium", "calrose", "wholemeal", "self", "raising", "bread",
    "unbleached", "triple", "sifted", "caster", "raw", "icing", "demerara", "dark", "soft", "light", "rolled",
    "quick", "instant", "steel", "cut", "chunky", "smooth", "crunchy", "natural", "spring", "onion", "bunch",
  ].map(stem),
);

// Forms that make it a different buy unless the ingredient says so.
const FORMS = new Set(
  [
    "dried", "dry", "ground", "powder", "powdered", "canned", "tinned", "can", "diced", "crushed", "chopped", "minced",
    "frozen", "sliced", "grated", "shredded", "shaved", "smoked", "roasted", "roast", "cooked", "marinated", "pickled",
    "flaked", "flake", "puree", "concentrate", "syrup", "seed", "seeds", "leaf", "leaves", "juice", "zest", "essence",
    "extract", "flavour", "flavoured", "infused", "spray", "grinder", "crumbed", "stuffed", "kyiv", "kiev",
    "parmigiana", "gyoza", "hargow", "dumpling", "dumplings", "naan", "aioli", "rissoles", "tuna", "tea",
    "triangles", "pastizzis", "agnolotti", "spanakopita", "crispbread", "squid", "salmon", "rocket", "mix", "mixed",
    "chargrilled", "grilled", "fried", "crispy", "sushi", "mandarin", "murcott", "wheat", "flake", "flakes", "crystallised",
    "uncrystallised", "scroll", "cookies", "biscuit", "bar", "bars", "loaf", "perform", "protein", "yopro",
    "smoothie", "yoghurt", "yogurt", "muffin", "rope", "ropes", "roll", "straps", "gummies", "lolly", "cake", "bread", "chips", "chip", "lollies", "flavour",
  ].map(stem),
);

// Not food at all: the retailers' search returns these for herb and fruit
// names (lime hand wash, bay leaf bath mats).
const NOT_FOOD = new Set(
  [
    "wash", "hand", "soap", "detergent", "dishwashing", "liquid", "laundry", "cleaner", "spray", "paint", "candle",
    "mat", "towel", "cotton", "gsm", "plush", "luxurious", "shampoo", "conditioner", "body", "lotion", "fragrance",
    "diffuser", "refill", "seedling", "seeds", "plant", "pot", "yates", "jelly", "water", "rush", "cordial", "soft",
    "drink", "sparkling", "kombucha", "vodka", "gin", "beer", "wine", "lolly", "lollies", "gum", "mints", "toy",
  ].map(stem),
);

// Forms an ingredient may come in and still be the same buy.
const FORM_OK: Record<string, string[]> = {
  "canned tomatoes": ["diced", "crushed", "chopped", "whole", "peeled", "can", "canned", "tinned"],
  garlic: ["minced", "crushed"],
  ginger: ["minced", "crushed"],
  parmesan: ["grated", "shaved", "cheese", "block"],
  "ground cumin": ["ground"],
  "ground coriander": ["ground"],
  "ground ginger": ["ground"],
  cinnamon: ["ground", "quill"],
  "black pepper": ["ground", "whole", "peppercorn"],
  peas: ["frozen"],
  "mixed vegetables": ["frozen", "mixed"],
  sweetcorn: ["frozen", "canned", "kernel"],
  chickpeas: ["can", "canned"],
  "kidney beans": ["can", "canned"],
  "black beans": ["can", "canned"],
  "cannellini beans": ["can", "canned"],
  "coconut milk": ["can"],
  "chicken stock": ["liquid"],
  "beef stock": ["liquid"],
  "vegetable stock": ["liquid"],
  mozzarella: ["shredded", "grated", "cheese"],
  "cheddar cheese": ["grated", "shredded", "block"],
  tuna: ["can", "canned", "chunk", "springwater", "brine", "oil"],
};

// Words that change what a dairy, herb or seafood item is when they come
// first ("sour cream", "garlic prawns", "jalapeno chilli").
const MODIFIERS = new Set(["sour", "jalapeno", "jalapeño", "birdseye", "habanero", "smoked", "whipped", "clotted", "double"].map(stem));
// Food words that are only ever brand names in front of a product.
const BRAND_WORDS = new Set(["wings", "gem", "bird", "bare", "farmer", "harvest", "golden", "maharajah", "choice"].map(stem));

let foodWords: Set<string> | null = null;
function allFoodWords(): Set<string> {
  if (foodWords) return foodWords;
  foodWords = new Set<string>();
  for (const k of Object.keys(loadProducts().products)) for (const w of tokens(k)) foodWords.add(w);
  return foodWords;
}

export function isEquivalent(ingredient: string, productName: string): boolean {
  const key = ingredient.toLowerCase().trim();
  const ok = new Set((FORM_OK[key] ?? []).map(stem));
  // an allowed form word in the ingredient's own name ("canned") needn't be
  // in the product's ("Diced Tomatoes 400g" is a can of tomatoes)
  const core = tokens(ingredient).filter((w) => !ok.has(w)).join(" ");
  if (!core || !matchesIngredient(core, productName)) return false;
  const want = new Set(tokens(ingredient));
  const food = allFoodWords();
  const words = tokens(productName);
  // the first of the ingredient's own words: anything unknown before it is
  // read as a brand ("White Wings Plain Flour"); unknown words after it are
  // what the product is made into ("... Spinach Triangles")
  const firstOwn = words.findIndex((w) => want.has(w));
  for (const [i, w] of words.entries()) {
    if (want.has(w) || ok.has(w)) continue;
    if (NOT_FOOD.has(w) || FORMS.has(w)) return false;
    if (QUALIFIERS.has(w)) continue;
    // before the ingredient's own words, other words are the brand ("White
    // Wings", "Gem of the West"), unless they name a different food that the
    // product is mainly made of (checked by the words that follow)
    if (i < firstOwn && !food.has(w) && !MODIFIERS.has(w)) continue;
    if (i < firstOwn && BRAND_WORDS.has(w)) continue;
    return false;
  }
  return true;
}

// The products that are fair like-for-like buys for this ingredient.
export function equivalentProducts(ingredientName: string): Product[] {
  return productsFor(ingredientName).filter((p) => isEquivalent(ingredientName, p.name));
}
