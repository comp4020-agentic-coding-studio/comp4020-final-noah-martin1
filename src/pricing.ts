import { all, one, run } from "./db.ts";
import { addDays, today } from "./format.ts";
import { conversionFor, estimate, gramsOf, referencePrice } from "./nutrition.ts";
import { equivalentProducts, type Product, type SizeUnit } from "./products.ts";

// What groceries cost, kept as distinct quantities (CLAUDE.md, "Pricing and
// budgeting", and docs/product/pricing.md):
//
//   consumption cost   the value of the amount a recipe uses (a share of a pack)
//   purchase quantity  what's still needed after usable pantry stock, summed
//                      across every planned meal first
//   package purchase   whole packs that cover it: ceil(need / pack size)
//   purchase cost      what those packs cost at the checkout
//
// 200 g of flour with none at home buys the whole 1 kg bag; holding 500 g
// buys nothing. Unknown sizes, prices or conversions are never invented: the
// line says so and stays out of the purchase total.

/* ---------------- units ---------------- */

const MASS: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000 };
const VOLUME: Record<string, number> = { ml: 1, l: 1000, litre: 1000, tsp: 5, tbsp: 15, cup: 250 };
const COUNT = new Set(["", "each", "whole", "piece", "pieces"]);

export interface Amount {
  amount: number;
  unit: SizeUnit;
  // reached through a kitchen rule of thumb (a clove, a bunch), not a
  // measured unit or a listed conversion
  approx: boolean;
}

// An amount in one of the three base units, using only conversions that are
// exact (g/kg, ml/l/spoons) or listed for this ingredient (a cup of flour in
// grams). Kitchen units like "clove" or "bunch" go through the food table's
// rules of thumb and are marked approximate. null when nothing applies.
export function toBase(amount: number, unit: string, name: string): Amount | null {
  const u = unit.trim().toLowerCase();
  if (u in MASS) return { amount: amount * MASS[u], unit: "g", approx: false };
  const conv = conversionFor(name);
  if (u === "cup" && conv.cupGrams) return { amount: amount * conv.cupGrams, unit: "g", approx: false };
  if (u in VOLUME) return { amount: amount * VOLUME[u], unit: "ml", approx: false };
  if (COUNT.has(u)) return { amount, unit: "each", approx: false };
  const g = gramsOf({ name, quantity: amount, unit: u });
  return g === null ? null : { amount: g, unit: "g", approx: true };
}

// The same amount in another base unit, only through this ingredient's own
// listed density or weight per item. Mass, volume and count never mix
// otherwise.
export function convert(a: Amount, to: SizeUnit, name: string): Amount | null {
  if (a.unit === to) return a;
  const { density, each } = conversionFor(name);
  const grams = a.unit === "g" ? a.amount : a.unit === "ml" ? (density ? a.amount * density : null) : each ? a.amount * each : null;
  if (grams === null) return null;
  const out = to === "g" ? grams : to === "ml" ? (density ? grams / density : null) : each ? grams / each : null;
  return out === null ? null : { amount: out, unit: to, approx: a.approx };
}

/* ---------------- purchasable options ---------------- */

export type OptionKind = "user" | "retailer" | "reference";

export interface PackOption {
  kind: OptionKind;
  retailer: string;
  product: string;
  url: string | null;
  priceCents: number;
  // contents of one pack; null = sold loose by weight (priceCents per kg)
  size: { amount: number; unit: SizeUnit } | null;
  // when this price was read or recorded (ISO date or timestamp)
  checked: string;
  available: boolean;
}

// How long a retailer price reads as "checked recently" before the page
// says it may have changed. Nothing is ever called live.
export const FRESH_DAYS = 3;

export function optionLabel(o: PackOption): string {
  if (o.kind === "user") return `Your price${o.retailer ? ` at ${o.retailer}` : ""}, recorded ${o.checked.slice(0, 10)}`;
  if (o.kind === "retailer") {
    const stale = o.checked.slice(0, 10) < addDays(today(), -FRESH_DAYS);
    return `${o.retailer} shelf price, checked ${o.checked.slice(0, 10)}${stale ? " (may have changed)" : ""}`;
  }
  return `Reference shelf price, checked ${o.checked}`;
}

const RETAILER_NAME: Record<string, string> = { woolworths: "Woolworths", aldi: "ALDI" };

function fromProduct(p: Product): PackOption {
  return {
    kind: "retailer",
    retailer: RETAILER_NAME[p.retailer] ?? p.retailer,
    product: p.name,
    url: p.url,
    priceCents: p.priceCents,
    size: p.size,
    checked: p.checkedAt,
    available: p.available,
  };
}

function parseSizeText(text: string): { amount: number; unit: SizeUnit } | null {
  const m = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i.exec(text);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    return u === "kg" ? { amount: n * 1000, unit: "g" } : u === "l" ? { amount: n * 1000, unit: "ml" } : { amount: n, unit: u as SizeUnit };
  }
  const count = /\b(\d+)\s*(?:pack|eggs|x\b)/i.exec(text) ?? /^(\d+)\s/.exec(text);
  return count ? { amount: Number(count[1]), unit: "each" } : null;
}

// A shelf reading in src/data/prices.json ("ALDI shelf price: White Mill
// Plain Flour 2kg, $2.39") as a pack. "Typical" prices carry no pack, so
// they only ever feed consumption estimates.
export function referenceOption(name: string): PackOption | null {
  const ref = referencePrice(name);
  if (!ref) return null;
  const m = /^(ALDI|Woolworths) shelf price: (.+)$/.exec(ref.source);
  if (!m) return null;
  const [, retailer, rest] = m;
  const perKg = /\$(\d+(?:\.\d+)?)\s*\/\s*kg/i.exec(rest);
  const perSize = /\$(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?\s*(?:g|ml|kg|l))\b/i.exec(rest);
  const each = /\$(\d+(?:\.\d+)?)\s*each/i.exec(rest);
  const product = rest.replace(/,\s*\$.*$/, "").trim();
  const base = { kind: "reference" as const, retailer, product, url: null, checked: ref.checked, available: true };
  if (perSize) return { ...base, priceCents: Math.round(Number(perSize[1]) * 100), size: parseSizeText(perSize[2]) };
  if (perKg) return { ...base, priceCents: Math.round(Number(perKg[1]) * 100), size: null };
  if (each) return { ...base, priceCents: Math.round(Number(each[1]) * 100), size: { amount: 1, unit: "each" } };
  const price = [...rest.matchAll(/\$(\d+(?:\.\d+)?)/g)].at(-1);
  const size = parseSizeText(product);
  if (!price || !size) return null;
  return { ...base, priceCents: Math.round(Number(price[1]) * 100), size };
}

interface UserPriceRow {
  price_cents: number;
  size_amount: number;
  size_unit: SizeUnit;
  retailer: string;
  product: string;
  recorded_at: string;
}

// Every way to buy this ingredient that Larder knows about: what this
// person paid (newest per pack size), current retailer listings, and the
// dated reference shelf price. Recommendation happens in choosePack.
export function packOptions(who: number | number[] | null, ingredientIdNum: number, name: string): PackOption[] {
  const out: PackOption[] = [];
  const users = who === null ? [] : Array.isArray(who) ? who : [who];
  if (users.length) {
    const seen = new Set<string>();
    for (const r of all<UserPriceRow>(
      `SELECT price_cents, size_amount, size_unit, retailer, product, recorded_at FROM user_prices
       WHERE user_id IN (${users.map(() => "?").join(", ")}) AND ingredient_id = ? ORDER BY recorded_at DESC, id DESC`,
      ...users,
      ingredientIdNum,
    )) {
      const key = `${r.size_amount}${r.size_unit}|${r.retailer.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: "user",
        retailer: r.retailer,
        product: r.product || name,
        url: null,
        priceCents: r.price_cents,
        size: { amount: r.size_amount, unit: r.size_unit },
        checked: r.recorded_at.slice(0, 10),
        available: true,
      });
    }
  }
  for (const p of equivalentProducts(name)) if (p.available) out.push(fromProduct(p));
  const ref = referenceOption(name);
  // the dated reference is only a fallback once real listings exist
  if (ref && !out.some((o) => o.kind === "retailer")) out.push(ref);
  return out;
}

/* ---------------- choosing what to buy ---------------- */

export interface PackChoice {
  option: PackOption;
  // packs to buy; for loose produce, null (bought by weight)
  count: number | null;
  costCents: number;
  // what's left over in the base unit (0 for loose)
  leftover: number;
  why: string;
}

// The cheapest compatible way to cover `need` (in a base unit). Packs are
// whole: 200 g from 1 kg bags is one bag. Ties go to less waste. A pack in
// a different unit is only used through this ingredient's own conversion.
export function choosePack(need: Amount, options: PackOption[], name: string): { best: PackChoice | null; all: PackChoice[] } {
  const choices: PackChoice[] = [];
  for (const o of options) {
    if (o.size === null) {
      const g = convert(need, "g", name);
      if (!g) continue;
      choices.push({ option: o, count: null, costCents: Math.max(1, Math.round((g.amount / 1000) * o.priceCents)), leftover: 0, why: "" });
      continue;
    }
    const n = convert(need, o.size.unit, name);
    if (!n || o.size.amount <= 0) continue;
    const count = Math.max(1, Math.ceil(n.amount / o.size.amount - 1e-9));
    choices.push({ option: o, count, costCents: count * o.priceCents, leftover: count * o.size.amount - n.amount, why: "" });
  }
  choices.sort((a, b) => a.costCents - b.costCents || a.leftover - b.leftover || rank(a.option) - rank(b.option));
  const best = choices[0] ?? null;
  if (best) best.why = reason(best, choices);
  return { best, all: choices };
}

function rank(o: PackOption): number {
  return o.kind === "user" ? 0 : o.kind === "retailer" ? 1 : 2;
}

function reason(best: PackChoice, all: PackChoice[]): string {
  const others = all.filter((c) => c !== best && c.option.retailer !== best.option.retailer);
  const next = others[0];
  const where = best.option.kind === "user" ? "the price you paid" : best.option.retailer;
  if (!next) return all.length > 1 ? `Cheapest of ${all.length} options` : `Only option found`;
  const saving = next.costCents - best.costCents;
  if (saving > 0) return `Cheapest: ${where} saves $${(saving / 100).toFixed(2)} over ${next.option.kind === "user" ? "your price" : next.option.retailer} for the same amount`;
  return `Same cost as ${next.option.retailer}; less left over`;
}

/* ---------------- a shopping plan ---------------- */

export interface Need {
  ingredient_id: number;
  name: string;
  category: string;
  quantity: number | null;
  unit: string;
  meal: string;
}

export interface Stock {
  ingredient_id: number;
  quantity: number;
  unit: string;
}

export interface PlanLine {
  ingredient_id: number;
  name: string;
  category: string;
  // base unit of the line (g, ml, each), or the recipe's own unit when it
  // can't be converted
  unit: string;
  // null: a recipe gave no amount ("salt to taste")
  need: number | null;
  have: number;
  toBuy: number | null;
  approx: boolean;
  // the pantry holds some in a unit that can't be compared
  otherUnit: boolean;
  meals: string[];
  pack: PackChoice | null;
  // covered by the leftover of a pack another line of this ingredient buys
  sharesPack: boolean;
  // shares that pack but in a unit that can't be compared with it (a spoon
  // measure against grams, no density known): enough is assumed, and said
  unitClash?: boolean;
  alternatives: PackChoice[];
  // value of the amount actually needed, at the recommended pack's rate or
  // the reference rate; null when unknown
  consumptionCents: number | null;
}

export interface PurchasePlan {
  toBuy: PlanLine[];
  covered: PlanLine[];
  // whole packs at the checkout
  purchaseCents: number;
  // the share of those packs (or reference rates) the meals actually use
  consumptionCents: number;
  // lines to buy that have no pack price at all
  unpriced: number;
  // reference-rate value of the unpriced lines, when known (shown as an
  // estimate, never added to the purchase total)
  unpricedEstCents: number;
}

// Needs summed per ingredient first, then usable stock subtracted, then
// packs chosen once per ingredient: two meals sharing a bag of flour buy
// one bag.
export function purchasePlan(needs: Need[], stock: Stock[], optionsFor: (ingredientId: number, name: string) => PackOption[]): PurchasePlan {
  type Group = { line: PlanLine; base: SizeUnit | null; rawUnit: string };
  const groups = new Map<string, Group>();
  for (const n of needs) {
    let base: Amount | null = n.quantity === null ? null : toBase(n.quantity, n.unit, n.name);
    // fold into an existing group of this ingredient when convertible
    let key: string | null = null;
    if (base) {
      for (const [k, g] of groups) {
        if (g.line.ingredient_id !== n.ingredient_id || !g.base) continue;
        const c = convert(base, g.base, n.name);
        if (c) {
          base = c;
          key = k;
          break;
        }
      }
    }
    key ??= base ? `${n.ingredient_id}|${base.unit}` : `${n.ingredient_id}|raw:${n.quantity === null ? "" : n.unit.trim().toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        base: base?.unit ?? null,
        rawUnit: n.unit.trim().toLowerCase(),
        line: {
          ingredient_id: n.ingredient_id, name: n.name, category: n.category, unit: base?.unit ?? n.unit.trim().toLowerCase(),
          need: 0, have: 0, toBuy: 0, approx: false, otherUnit: false, meals: [], pack: null, sharesPack: false, alternatives: [], consumptionCents: null,
        },
      };
      groups.set(key, g);
    }
    const l = g.line;
    if (n.quantity === null) l.need = l.need === 0 && !base ? null : l.need;
    else if (l.need !== null) l.need += base ? base.amount : n.quantity;
    if (base?.approx) l.approx = true;
    if (!l.meals.includes(n.meal)) l.meals.push(n.meal);
  }

  const toBuy: PlanLine[] = [];
  const covered: PlanLine[] = [];
  let purchaseCents = 0;
  let consumptionCents = 0;
  let unpriced = 0;
  let unpricedEstCents = 0;
  // stock is used once: an ingredient split across groups draws from one pool
  const pool = new Map<number, Stock[]>();
  for (const s of stock) pool.set(s.ingredient_id, [...(pool.get(s.ingredient_id) ?? []), { ...s }]);
  // packs already bought per ingredient, with what's left in them, so a
  // second line of the same ingredient (another unit, or "to taste") uses
  // that leftover before buying another
  const bought = new Map<number, { pack: PackChoice; left: number }[]>();

  // lines with amounts first, so a "to taste" line can share their pack
  const ordered = [...groups.values()].sort((a, b) => Number(a.line.need === null) - Number(b.line.need === null));
  for (const { line, base, rawUnit } of ordered) {
    const held = pool.get(line.ingredient_id) ?? [];
    if (line.need === null) {
      line.have = held.reduce((s, h) => s + h.quantity, 0);
      line.toBuy = held.some((h) => h.quantity > 0) ? 0 : null;
    } else {
      let have = 0;
      for (const h of held) {
        if (h.quantity <= 0) continue;
        let a = base ? toBase(h.quantity, h.unit, line.name) : null;
        // stock is only counted through a rule of thumb ("a jar is 300 g")
        // when the recipe line was reached the same rough way; otherwise it's
        // flagged for the person to check rather than guessed away
        if (a?.approx && !line.approx && h.unit.trim().toLowerCase() !== rawUnit) a = null;
        const inLine = base && a ? convert(a, base, line.name) : !base && h.unit.trim().toLowerCase() === rawUnit ? { amount: h.quantity, unit: "each" as SizeUnit, approx: false } : null;
        if (!inLine) {
          line.otherUnit = true;
          continue;
        }
        // take only what this line needs, leaving the rest for other lines
        const take = Math.min(inLine.amount, line.need - have);
        if (take <= 0) continue;
        have += take;
        h.quantity -= inLine.amount > 0 ? (take / inLine.amount) * h.quantity : 0;
      }
      line.have = round(have);
      line.toBuy = Math.max(0, round(line.need - have));
    }
    if (line.toBuy === 0) {
      covered.push(line);
      continue;
    }
    const already = bought.get(line.ingredient_id) ?? [];
    if (line.toBuy === null && already.length) {
      line.sharesPack = true;
      toBuy.push(line);
      continue;
    }
    if (line.toBuy !== null && base) {
      const fit = already.find((b) => {
        const size = b.pack.option.size;
        if (!size) return false;
        const n = convert({ amount: line.toBuy!, unit: base, approx: line.approx }, size.unit, line.name);
        return n !== null && n.amount <= b.left + 1e-9;
      });
      if (fit) {
        const size = fit.pack.option.size!;
        const n = convert({ amount: line.toBuy, unit: base, approx: line.approx }, size.unit, line.name)!;
        fit.left -= n.amount;
        line.sharesPack = true;
        line.consumptionCents = Math.max(1, Math.round((n.amount / size.amount) * fit.pack.option.priceCents));
        consumptionCents += line.consumptionCents;
        toBuy.push(line);
        continue;
      }
    }
    const options = optionsFor(line.ingredient_id, line.name);
    // a pack of this ingredient is already bought, but this line's unit
    // can't be compared with it (a spoonful against grams, no density
    // known): say so, and don't buy a second pack on a guess
    if (already.length && line.toBuy !== null && !choosePack({ amount: line.toBuy, unit: base ?? "each", approx: true }, options, line.name).best) {
      line.sharesPack = true;
      line.unitClash = true;
      const est = estimate([{ name: line.name, quantity: line.toBuy, unit: base ?? rawUnit }]);
      line.consumptionCents = est.counted && est.costCents > 0 ? Math.max(1, Math.round(est.costCents)) : null;
      consumptionCents += line.consumptionCents ?? 0;
      toBuy.push(line);
      continue;
    }
    // no amount given and none at home: the smallest single pack
    const needAmount: Amount | null =
      line.toBuy === null
        ? null
        : base
          ? { amount: line.toBuy, unit: base, approx: line.approx }
          : null;
    if (needAmount) {
      const { best, all } = choosePack(needAmount, options, line.name);
      line.pack = best;
      line.alternatives = all;
    } else if (line.toBuy === null) {
      const singles = options.filter((o) => o.size !== null).sort((a, b) => a.priceCents - b.priceCents);
      if (singles[0]) {
        line.pack = { option: singles[0], count: 1, costCents: singles[0].priceCents, leftover: 0, why: "The recipe gives no amount, so one pack" };
        line.alternatives = [line.pack];
      }
    }
    // consumption: the needed share of the chosen pack, else reference rate
    if (line.pack && needAmount) {
      const p = line.pack;
      if (p.count === null) line.consumptionCents = p.costCents;
      else {
        const n = convert(needAmount, p.option.size!.unit, line.name)!;
        line.consumptionCents = Math.max(1, Math.round((n.amount / p.option.size!.amount) * p.option.priceCents));
      }
    } else if (needAmount || (line.toBuy !== null && line.toBuy > 0)) {
      const est = estimate([{ name: line.name, quantity: line.toBuy, unit: base ?? rawUnit }]);
      line.consumptionCents = est.counted && est.costCents > 0 ? Math.max(1, Math.round(est.costCents)) : null;
    }
    if (line.pack) {
      purchaseCents += line.pack.costCents;
      const size = line.pack.option.size;
      if (size && line.pack.count !== null) {
        const used = needAmount ? (convert(needAmount, size.unit, line.name)?.amount ?? size.amount * line.pack.count) : 0;
        bought.set(line.ingredient_id, [...already, { pack: line.pack, left: Math.max(0, size.amount * line.pack.count - used) }]);
      }
    } else {
      unpriced++;
      unpricedEstCents += line.consumptionCents ?? 0;
    }
    consumptionCents += line.consumptionCents ?? 0;
    toBuy.push(line);
  }
  const byCategory = (a: PlanLine, b: PlanLine) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
  return { toBuy: toBuy.sort(byCategory), covered: covered.sort(byCategory), purchaseCents, consumptionCents, unpriced, unpricedEstCents };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ---------------- prices people paid ---------------- */

// A pantry item entered with a price is a record of what this person paid
// for that pack (its quantity and unit). Kept until they replace it; a
// higher online price never overwrites it. Only exact units are recorded,
// so a price is never stretched to a pack size nobody bought.
export function recordPaidPrice(
  userId: number,
  ingredientIdNum: number,
  inventoryItemId: number,
  input: { name: string; quantity: number; unit: string; price_cents: number | null; store?: string },
): boolean {
  run("DELETE FROM user_prices WHERE inventory_item_id = ?", inventoryItemId);
  if (input.price_cents === null || input.price_cents <= 0 || !(input.quantity > 0)) return false;
  const size = toBase(input.quantity, input.unit, input.name);
  if (!size || size.approx) return false;
  run(
    `INSERT INTO user_prices (user_id, ingredient_id, price_cents, size_amount, size_unit, retailer, product, inventory_item_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    ingredientIdNum,
    input.price_cents,
    size.amount,
    size.unit,
    input.store ?? "",
    input.name,
    inventoryItemId,
  );
  return true;
}

export function userPriceCount(userId: number): number {
  return one<{ n: number }>("SELECT COUNT(*) AS n FROM user_prices WHERE user_id = ?", userId)?.n ?? 0;
}

/* ---------------- a recipe's purchase cost ---------------- */

// What someone would spend at the checkout to cook this recipe for
// `factor` × its servings, given their usable stock (an empty kitchen for
// visitors). Same engine as the shopping list.
export function recipePurchase(
  userId: number | null,
  lines: { ingredient_id: number; name: string; quantity: number | null; unit: string; optional: number }[],
  factor: number,
  stock: Stock[],
  title: string,
): PurchasePlan {
  const needs: Need[] = lines
    .filter((l) => !l.optional)
    .map((l) => ({ ingredient_id: l.ingredient_id, name: l.name, category: "", quantity: l.quantity === null ? null : l.quantity * factor, unit: l.unit, meal: title }));
  return purchasePlan(needs, stock, (id, name) => packOptions(userId, id, name));
}
