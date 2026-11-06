// Builds src/data/price-sources.json from a reviewed set of decisions: for
// each ingredient, which supermarket products are that food (by store
// product code), a stand-in product with a note, another ingredient it is
// bought as, or free (tap water). Run by hand after a review; the app only
// reads the JSON.
//
//   node scripts/build-price-sources.ts <candidates.json> <links.json> <decisions-1.json> [...more]
//
// candidates.json  Woolworths search results per ingredient (name, price,
//                  size, unit price, stockcode, url) with the time they were read
// links.json       ingredient -> { ingredient, unit, parent, note }: bought as another
// decisions-*.json ingredient -> { products: [code...] } | { similar: [code...], note }
//                  | { none: true, why }
// Optional, by environment:
//   KEPT=file      ingredient -> [listed products] kept after review, as stored
//                  in src/data/products.json (Woolworths and ALDI)
//   RESEARCH=file  ingredient -> { products: [code...] }: products found under
//                  another ingredient's search (looked up across all candidates)
//   REFERENCE=file [ingredient...] priced only from its dated reference shelf
//                  price (fresh produce whose listings were jars or tins)
//   OVERRIDES=file { estimates: { ingredient: estimate }, each: { ingredient:
//                  { amount, unit } } }: dated estimates with a pack, and what
//                  one counted piece amounts to
//
// It refuses to write when a decision names a product that wasn't found for
// that ingredient, when a link points at an ingredient with no price, or
// when one product would price two different ingredients (the same food
// under two names belongs on one entry, linked from the other).
import { readFileSync, writeFileSync } from "node:fs";
import { parseSize, perKgFromCup, type PriceSource, type Product, rangeMidGrams } from "../src/products.ts";

interface Candidate {
  stockcode: number;
  name: string;
  price: number | null;
  size: string;
  cup: string;
  available: boolean;
  url: string;
}
type Decision = { products?: number[]; similar?: number[]; note?: string; none?: boolean; why?: string };

const [candFile, linkFile, ...decisionFiles] = process.argv.slice(2);
const candidates = JSON.parse(readFileSync(candFile, "utf8")) as Record<string, Record<string, Candidate[]>>;
const links = JSON.parse(readFileSync(linkFile, "utf8")) as Record<string, { ingredient: string; unit: "g" | "ml" | "each"; parent: number; note?: string }>;
delete (links as Record<string, unknown>)._comment;
const decisions: Record<string, Decision> = {};
for (const f of decisionFiles) Object.assign(decisions, JSON.parse(readFileSync(f, "utf8")));
// when the candidates were read (the file's own time, passed in to keep it honest)
const readAt = process.env.READ_AT ?? new Date().toISOString();

const problems: string[] = [];
// every product read, for a product found under another ingredient's search
const everywhere = new Map<number, Candidate>();
for (const byTerm of Object.values(candidates)) for (const list of Object.values(byTerm)) for (const c of list) if (!everywhere.has(c.stockcode)) everywhere.set(c.stockcode, c);
function product(ingredient: string, code: number, anywhere = false): Product | null {
  const all = Object.values(candidates[ingredient] ?? {}).flat();
  const c = all.find((x) => x.stockcode === code) ?? (anywhere ? everywhere.get(code) : undefined);
  if (!c) {
    problems.push(`${ingredient}: product ${code} wasn't among its candidates`);
    return null;
  }
  if (!c.price || !c.available) {
    problems.push(`${ingredient}: product ${code} (${c.name}) has no current price`);
    return null;
  }
  const base = { retailer: "woolworths" as const, name: c.name, url: c.url, priceCents: Math.round(c.price * 100), checkedAt: readAt, available: true, stockcode: c.stockcode };
  // a piece cut to no fixed weight: bought by the kilogram at its shelf unit price
  // a whole piece cut to no fixed weight ("Lamb Shoulder Roast 1.1kg -
  // 1.7kg", $18/kg): bought whole, so one is a pack of its middle weight at
  // the per-kg price (its shelf price is the heaviest one's)
  const mid = rangeMidGrams(c.size);
  if (mid) {
    const perKg = perKgFromCup(c.cup);
    if (!perKg) {
      problems.push(`${ingredient}: ${c.name} is sold by weight but has no per-kg price (${c.cup})`);
      return null;
    }
    return { ...base, priceCents: Math.round((perKg * mid) / 1000), size: { amount: mid, unit: "g" }, perKgCents: perKg };
  }
  // sold loose by weight ("per 250g", "per kg"): bought by the gram
  if (/^per\s/i.test(c.size)) {
    const perKg = perKgFromCup(c.cup);
    if (!perKg) {
      problems.push(`${ingredient}: ${c.name} is sold by weight but has no per-kg price (${c.cup})`);
      return null;
    }
    return { ...base, size: { amount: 1000, unit: "g" }, perKgCents: perKg, loose: true };
  }
  const size = parseSize(c.size) ?? parseSize(c.name);
  if (!size) {
    problems.push(`${ingredient}: no pack size for ${c.name} (${c.size})`);
    return null;
  }
  return { ...base, size };
}

const out: Record<string, PriceSource> = {};
for (const [ing, d] of Object.entries(decisions)) {
  if (ing === "water") continue;
  if (d.products?.length) {
    const ps = d.products.map((c) => product(ing, c)).filter((p): p is Product => !!p);
    if (ps.length) out[ing] = { products: ps };
  } else if (d.similar?.length) {
    const ps = d.similar.map((c) => product(ing, c)).filter((p): p is Product => !!p);
    if (!d.note) problems.push(`${ing}: a stand-in product needs a note`);
    if (ps.length) out[ing] = { similar: { note: d.note ?? "", products: ps } };
  }
}
// listed products kept after review (they keep their own read time)
if (process.env.KEPT) {
  const kept = JSON.parse(readFileSync(process.env.KEPT, "utf8")) as Record<string, Product[]>;
  for (const [ing, ps] of Object.entries(kept)) if (!out[ing] && ps.length) out[ing] = { products: ps };
}
if (process.env.RESEARCH) {
  const found = JSON.parse(readFileSync(process.env.RESEARCH, "utf8")) as Record<string, { products: number[] }>;
  for (const [ing, d] of Object.entries(found)) {
    if (out[ing]) continue;
    const ps = d.products.map((c) => product(ing, c, true)).filter((p): p is Product => !!p);
    if (ps.length) out[ing] = { products: ps };
  }
}
if (process.env.REFERENCE) {
  for (const ing of JSON.parse(readFileSync(process.env.REFERENCE, "utf8")) as string[]) if (!out[ing]) out[ing] = { reference: true };
}
for (const [ing, l] of Object.entries(links)) {
  if (out[ing]) continue;
  out[ing] = { from: { ingredient: l.ingredient, unit: l.unit, parent: l.parent, ...(l.note ? { note: l.note } : {}) } };
}
out.water = { free: true };

// hand-checked additions: dated estimates with a pack, and what one counted
// piece amounts to in the unit recipes use (a tea bag brews 220 ml)
if (process.env.OVERRIDES) {
  const o = JSON.parse(readFileSync(process.env.OVERRIDES, "utf8")) as {
    estimates?: Record<string, NonNullable<PriceSource["estimate"]>>;
    each?: Record<string, { amount: number; unit: "g" | "ml" | "each" }>;
  };
  for (const [ing, e] of Object.entries(o.estimates ?? {})) out[ing] = { estimate: e };
  for (const [ing, each] of Object.entries(o.each ?? {})) {
    const s = out[ing];
    for (const p of [...(s?.products ?? []), ...(s?.similar?.products ?? [])]) if (p.size.unit === "each") p.each = each;
  }
}

// every "bought as" chain ends at a priced ingredient (one with products here,
// or one the app already prices from its searched listings or reference)
const priceable = new Set(process.env.PRICED?.split("|") ?? []);
for (const [ing, s] of Object.entries(out)) {
  if (!s.from) continue;
  let k = s.from.ingredient;
  for (let i = 0; i < 4 && out[k]?.from; i++) k = out[k].from!.ingredient;
  if (!out[k]?.products && !out[k]?.similar && !out[k]?.reference && !out[k]?.estimate && !priceable.has(k)) problems.push(`${ing}: bought as "${s.from.ingredient}", which has no price`);
}

// one product prices one ingredient: the same food under two names is one
// entry, linked from the other
const owner = new Map<number | string, string>();
for (const [ing, s] of Object.entries(out)) {
  for (const p of [...(s.products ?? []), ...(s.similar?.products ?? [])]) {
    // by product page: the same product from two sources has two codes at most
    const id = p.url;
    const prev = owner.get(id);
    if (prev && prev !== ing) problems.push(`product ${id} (${p.name}) prices both "${prev}" and "${ing}": link one to the other`);
    else owner.set(id, ing);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`${problems.length} problem(s); nothing written`);
  process.exit(1);
}
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(new URL("../src/data/price-sources.json", import.meta.url), `${JSON.stringify(sorted, null, 1)}\n`);
const count = (f: (s: PriceSource) => boolean) => Object.values(out).filter(f).length;
console.log(JSON.stringify({ ingredients: Object.keys(out).length, products: count((s) => !!s.products), similar: count((s) => !!s.similar), from: count((s) => !!s.from), reference: count((s) => !!s.reference), free: count((s) => !!s.free) }));
