// Filling in what a scan can't see. A fridge photo shows "milk" but not the
// pack size, the price or the expiry; the app already knows what milk
// usually costs and comes in (the Woolworths and ALDI listings and reference
// prices recipes are costed from, or what this person paid last time) and
// roughly how long it keeps. These are suggestions the review row shows
// with their source; the person confirms or changes them. Deterministic:
// same item, same suggestion.

import { ingredientId } from "./db.ts";
import { addDays, today } from "./format.ts";
import { conversionFor } from "./nutrition.ts";
import { packOptions, type PackOption } from "./pricing.ts";
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
// listings that aren't the whole food: a jar of smashed avocado, baby carrots
const PROCESSED = /\b(smashed|dip|puree|purée|juice|sauce|paste|dried|frozen|baby|mini|chopped|diced|sliced|odd bunch|punnet|organic|macro)\b/i;

function countedPrice(name: string, opts: PackOption[], count: number | null): { quantity: string; price: string; note: string } | null {
  if (!COUNTED.test(` ${name.toLowerCase()} `)) return null;
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

// What to put in a row the scan left blank. `count` is how many the scan
// saw: three cartons is three packs. Fields the scan (or a barcode, or a
// receipt) already filled are left alone by the caller.
export function prefillFor(userId: number, name: string, count: number | null): Prefill {
  const opts = packOptions(userId, ingredientId(name), name);
  const pack = likelyPack(opts);
  const life = shelfLife(name);
  const n = count && count > 0 ? count : 1;
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
    notes.unshift(`${pack.size ? (n > 1 ? `${n} × ` : "") : "price per kg from "}${packText(pack)}`);
  }
  if (!quantity) quantity = count ? String(count) : "1";
  const expiry_date = life ? addDays(today(), life.days) : "";
  if (life) notes.push(`keeps ~${life.days >= 60 ? `${Math.round(life.days / 30)} months` : `${life.days} day${life.days === 1 ? "" : "s"}`} in the ${life.where}`);
  return { quantity, unit, price, expiry_date, note: notes.filter(Boolean).join(" · ") };
}
