// Filling in what a scan can't see. A fridge photo shows "milk" but not the
// pack size, the price or the expiry; the app already knows what milk
// usually costs and comes in (the Woolworths and ALDI listings and reference
// prices recipes are costed from, or what this person paid last time) and
// roughly how long it keeps. These are suggestions the review row shows
// with their source; the person confirms or changes them. Deterministic:
// same item, same suggestion.

import { normaliseIngredient, one } from "./db.ts";
import { addDays, today } from "./format.ts";
import { conversionFor } from "./nutrition.ts";
import { fromProduct, packOptions, type PackOption } from "./pricing.ts";
import { loadProducts, productsFor } from "./products.ts";
import { shelfLife } from "./shelf-life.ts";

export interface Prefill {
  // the pack this suggestion is from, in the row's own units
  quantity: string;
  unit: string;
  price: string;
  expiry_date: string;
  // where each part came from, shown under the row
  note: string;
}

// The pack a person most likely bought: their own last purchase if there is
// one, otherwise the middle-priced available retailer pack (not the
// cheapest, which skews to bulk sizes and home brands nobody asked for),
// otherwise the dated reference price.
export function likelyPack(options: PackOption[]): PackOption | null {
  const mine = options.find((o) => o.kind === "user");
  if (mine) return mine;
  const packs = options.filter((o) => o.kind === "retailer" && o.available && o.size).sort((a, b) => a.priceCents - b.priceCents);
  if (packs.length) return packs[Math.floor((packs.length - 1) / 2)];
  return options.find((o) => o.kind === "reference") ?? null;
}

const UNIT_LABEL: Record<string, string> = { g: "g", ml: "ml", each: "" };

// Foods people count rather than weigh: whole fruit and veg, and eggs. Meat
// and fish have a per-item weight in the food table too, but they're bought
// in trays by weight, so they're priced as packs.
const COUNTED = /\b(apple|pear|orange|mandarin|lemon|lime|banana|avocado|mango|peach|nectarine|plum|kiwi|carrot|capsicum|tomato|cucumber|zucchini|eggplant|onion|potato|sweet potato|eggs?)\b/;
// made from a counted food but sold in a jar, bottle or packet: "tomato
// ketchup", "apple juice", "potato chips" are packs
const MADE_FROM = /\b(ketchup|sauce|juice|jam|paste|puree|chips|crisps|soup|chutney|relish|compote|cider|vinegar|powder|dried|canned|tinned)\b/;
// listings that aren't the whole food: a jar of smashed avocado, baby carrots
const PROCESSED = /\b(smashed|dip|puree|purée|juice|sauce|paste|dried|frozen|baby|mini|chopped|diced|sliced|odd bunch|punnet|organic|macro)\b/i;

function countedPrice(name: string, opts: PackOption[], count: number | null): { quantity: string; price: string; note: string } | null {
  const n = ` ${name.toLowerCase()} `;
  if (!COUNTED.test(n) || MADE_FROM.test(n)) return null;
  const mine = opts.find((o) => o.kind === "user");
  const plain = opts.filter((o) => o.available && !PROCESSED.test(o.product));
  const eggs = /\beggs?\b/.test(name.toLowerCase());
  // eggs come in cartons: a photo's "eggs × 1" is a closed carton, a dozen;
  // a count of loose eggs (six on a door shelf) stays as counted
  const items = eggs && (!count || count === 1) ? 12 : count && count > 0 ? count : 1;
  const perItem = plain.find((o) => o.size?.unit === "each" && o.size.amount === 1);
  if (perItem && !mine) {
    return { quantity: String(items), price: ((perItem.priceCents * items) / 100).toFixed(2), note: `priced like ${packText(perItem)}` };
  }
  const each = conversionFor(name).each;
  const bySize = mine && (mine.size?.unit === "g" || !mine.size) ? mine : likelyPack(plain.filter((o) => o.size?.unit === "g" || o.size === null)) ;
  if (!bySize) return { quantity: String(items), price: "", note: "" };
  if (eggs && bySize.size?.unit === "g") {
    // an egg listing is a carton by weight: price per egg from its count
    const inCarton = Number(/(\d{1,2})\s*pack\b/i.exec(bySize.product)?.[1]) || Math.round(bySize.size.amount / (each ?? 58));
    return { quantity: String(items), price: ((bySize.priceCents / inCarton) * items / 100).toFixed(2), note: `priced like ${packText(bySize)}` };
  }
  if (!each) return { quantity: String(items), price: "", note: "" };
  const perGram = bySize.size ? bySize.priceCents / bySize.size.amount : bySize.priceCents / 1000;
  return { quantity: String(items), price: ((perGram * each * items) / 100).toFixed(2), note: `priced like ${packText(bySize)} (~${each} g each)` };
}

// "Woolworths Full Cream Milk 2L", or "Carrots 1kg (ALDI)" when the listing
// doesn't name its shop
function packText(o: PackOption): string {
  if (o.kind === "user") return `your last ${o.retailer ? `${o.retailer} ` : ""}price`;
  if (o.kind === "reference") return `the ${o.retailer || "reference"} price`;
  return o.retailer && !o.product.toLowerCase().includes(o.retailer.toLowerCase()) ? `${o.product} (${o.retailer})` : o.product;
}

// Listings filed under this food that recipe costing rejects as not quite
// it ("Strawberry Yoghurt Pouch" for yoghurt, "Pasta Penne" for pasta): a
// photo of a yoghurt tub or a pasta packet is one of them, so for a rough
// suggestion they'll do, kids' and single-serve packs aside.
const NOT_TYPICAL = /\b(pouch|kids|snack|single|mini|multipack|organic|squeezy bottle organic)\b/i;

// food someone made, not bought: no shop price fits "fried chicken",
// "cooked rice" or "leftover pasta"
const COOKED = /\b(fried|cooked|roast(ed)?|grilled|baked|mashed|leftovers?|homemade|stew|curry|soup|salad|stir.?fry)\b/;

const words = (s: string) => s.toLowerCase().match(/[a-z]+/g) ?? [];
// plural to singular: tomatoes, peaches, berries, oranges
const stem = (w: string) => w.replace(/ies$/, "y").replace(/(o|ch|sh|x)es$/, "$1").replace(/([^s])s$/, "$1");

// what a food can be made into: a listing that is one of these, when the
// name isn't, is a different product ("Chilli Mayonnaise", "Pesto Basil")
const MADE_INTO = /\b(mayonnaise|mayo|pesto|sauce|dip|dressing|paste|jam|juice|drink|cordial|chips|crisps|crackers|biscuits?|cake|bar|spread|soup|seasoning|stock|oil|vinegar|chocolate|ice cream|yoghurt|cheese|bread|noodles|powder|flakes)\b/;

// one-word foods the listings are filed under (tuna, passata, rice): a
// listing naming one of these that the scanned name doesn't is mainly that
// other food ("Mango Chilli Tuna" for chilli)
let foods: Set<string> | null = null;
function otherFood(name: string, product: string): boolean {
  foods ??= new Set(Object.keys(loadProducts().products).filter((k) => !k.includes(" ")).map(stem));
  const mine = new Set(words(name).map(stem));
  return words(product).some((w) => foods!.has(stem(w)) && !mine.has(stem(w)));
}

// every word of the name is in the listing's name, and the listing isn't
// the food made into something else: "apple juice" is not a punnet of
// apples, "chilli" is not chilli mayonnaise, "lemon drink" not a lemon
function namesIt(name: string, product: string): boolean {
  const have = new Set(words(product).map(stem));
  if (!words(name).every((w) => have.has(stem(w)))) return false;
  // "Passata With Basil", "Lime & Chilli Tuna": flavoured with it
  const flavour = new RegExp(`(?:\\bwith|\\band|&)\\s+(?:\\w+\\s+)?${words(name)[0]}`, "i");
  if (flavour.test(product) && !flavour.test(name)) return false;
  if (otherFood(name, product)) return false;
  const made = MADE_INTO.exec(product.toLowerCase());
  return !made || name.toLowerCase().includes(made[1]);
}

function roughly(name: string): PackOption[] {
  return productsFor(name)
    .filter((p) => p.available && p.size && !NOT_TYPICAL.test(p.name) && !/\bbulk\b/i.test(p.name) && namesIt(name, p.name))
    .map(fromProduct);
}

// More than a few of one packaged food is the model counting pieces (six
// drumsticks, four pickles), not packs: one pack is the better guess.
const MOST_PACKS = 3;

// What to put in a row the scan left blank. `count` is how many the scan
// saw: three cartons is three packs. Fields the scan (or a barcode, or a
// receipt) already filled are left alone by the caller.
export function prefillFor(userId: number, name: string, count: number | null): Prefill {
  // looked up, never created: rendering a review must not add the model's
  // guesses to the catalogue (only saving does, after the person confirms)
  const id = one<{ id: number }>("SELECT id FROM ingredients WHERE name = ?", normaliseIngredient(name))?.id ?? -1;
  const cooked = COOKED.test(name.toLowerCase());
  // a listing has to name the food: the shared catalogue's loose matching
  // (fine for costing "basil" in a recipe) would offer basil pesto here
  let opts = cooked ? [] : packOptions(userId, id, name).filter((o) => o.kind === "user" || namesIt(name, o.product));
  let rough = false;
  if (!cooked && !opts.length) {
    opts = roughly(name);
    rough = opts.length > 0;
  }
  const pack = likelyPack(opts);
  const life = shelfLife(name);
  const n = count && count > 0 && count <= MOST_PACKS ? count : 1;
  const notes: string[] = [];
  let quantity = count ? String(count) : "";
  let unit = "";
  let price = "";
  // Counted produce and eggs ("9 apples", "a dozen eggs"): the count stays
  // the quantity. Priced from a per-item listing ("Hass Avocado Each") when
  // there is one, otherwise from a plain bag by the food table's weight per
  // item. Multiplying packs would turn 9 apples into 9 one-kilo bags.
  const counted = countedPrice(name, opts, count);
  if (counted) {
    quantity = counted.quantity;
    price = counted.price;
    notes.push(counted.note);
  } else if (pack) {
    if (pack.size) {
      // packs: the size times how many were seen ("2 × 1 L" is 2000 ml)
      quantity = String(+(pack.size.amount * n).toFixed(2));
      unit = UNIT_LABEL[pack.size.unit] ?? pack.size.unit;
      price = ((pack.priceCents * n) / 100).toFixed(2);
    } else {
      // loose by the kilo: the weight is unknown, so the price is too; say
      // the per-kilo price so the person can work it out at a glance
      notes.push(`$${(pack.priceCents / 100).toFixed(2)}/kg loose`);
    }
    notes.unshift(`${rough ? "roughly " : ""}${pack.size ? (n > 1 ? `${n} × ` : "") : "price per kg from "}${packText(pack)}`);
  }
  if (!quantity) quantity = count ? String(count) : "1";
  const expiry_date = life ? addDays(today(), life.days) : "";
  if (life) notes.push(`keeps ~${life.days >= 60 ? `${Math.round(life.days / 30)} months` : `${life.days} day${life.days === 1 ? "" : "s"}`} in the ${life.where}`);
  return { quantity, unit, price, expiry_date, note: notes.filter(Boolean).join(" · ") };
}
