// Reading a shopping receipt. The vision model transcribes each line (the
// printed text, a plain food name, the line price); everything after that is
// decided here: pack sizes come from the printed text, not the model's
// guess, and the lines are checked against the receipt's own total so a
// misread price is flagged rather than saved as fact.

import { normaliseIngredient } from "./db.ts";

export const RECEIPT_PROMPT = `This is a photo of a supermarket receipt. Transcribe the grocery lines so they can be added to a kitchen inventory.

For each purchased item give:
- "text": the item's printed text, e.g. "COLES FF MILK 2L". When a weighed item's weight is on the next line, include it: "BANANA CAVENDISH 0.572 kg NET @ $2.50/kg".
- "name": the food in plain English grocery words, e.g. "milk", "banana", "tomato ketchup", even when the receipt is in another language. Not the brand or the store name.
- "qty": how many were bought (a "2 @ $1.50" or "6 X 0,22" line is 2 or 6); 1 if not shown
- "price": what was paid for that item as a number, e.g. 4.5. If a discount, offer, "Rabat" or "REDUCED PRICE" line belongs to an item, give the item's price after it, and don't list the discount separately.

Leave out lines that aren't food or drink (bags, card fees, subtotal, tax, change). Give the receipt's printed TOTAL as "total", or null if you can't read it.

Reply with only a JSON object, no prose:
{"lines":[{"text":"...","name":"...","qty":1,"price":0.0}],"total":0.0}`;

export interface ReceiptLine {
  text: string;
  name: string;
  qty: number;
  price_cents: number | null;
  // read from the printed text: "2L" → 2 l, "500G" → 500 g
  size: { quantity: number; unit: string } | null;
  // priced by weight ("BANANA KG", "1.234 kg @ $3.90/kg"); grams when the
  // weight is printed on the line
  by_weight: boolean;
  grams: number | null;
}

export interface Receipt {
  lines: ReceiptLine[];
  total_cents: number | null;
  // bags, deposits and the like: left out of the pantry, but part of the
  // printed total, so counted when checking it
  other_cents: number;
  // the lines' sum against the printed total; null when either is unknown
  check: { sum_cents: number; matches: boolean } | null;
}

const NOT_FOOD = /\b(bag|bags|reusable|discount|saving|savings|promo|voucher|card|eftpos|surcharge|subtotal|sub-total|total|gst|change|cash|rounding|deposit|refund|points|flybuys|everyday rewards)\b/i;

// A line whose *name* is a discount ("offer", Polish "rabat", "reduced
// price") was a price adjustment the model listed as an item. Only the name
// counts: a model can put the item's name in `name` and the discount line in
// `text`, and that item was really bought.
const DISCOUNT_NAME = /\b(?:offer|rabat|rebate|reduced price|price reduction|markdown|multibuy|coupon)\b/i;

// A price in cents, sign kept: a negative amount is a discount line.
const signedCents = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) && Math.abs(n) < 10000 ? Math.round(n * 100) : null;
};

const cents = (v: unknown): number | null => {
  const c = signedCents(v);
  return c !== null && c >= 0 ? c : null;
};

const toBaseUnit = (q: number, u: string): { quantity: number; unit: string } =>
  u === "KG" ? { quantity: q * 1000, unit: "g" } : u === "G" || u === "GM" || u.startsWith("GRAM") ? { quantity: q, unit: "g" } : u === "ML" ? { quantity: q, unit: "ml" } : { quantity: q * 1000, unit: "ml" };

// Pack size printed in the line: "2L", "1.5 L", "500G", "140GM", "1KG",
// "375ML", "6PK", "12 PACK", "X6", and a multipack "375ML X 10" (3.75 L in
// all). "16PK 140GM" is a 140 g pack of 16, so the weight wins over the
// count. A decimal comma ("0,5484KG") reads as a point. Only exact units;
// "LGE" or "LOOSE" are not sizes.
export function packSize(text: string): { quantity: number; unit: string } | null {
  const t = ` ${text.toUpperCase().replace(/(\d),(\d)/g, "$1.$2")} `;
  // Coles spells units out: "170GRAM", "1LITRE"
  const unitMatch = /(\d+(?:\.\d+)?)\s?(KG|GRAMS?|GM|G|ML|LITRES?|LITERS?|L|LT|LTR)(?=[\s\/@x×]|$)/.exec(t);
  // a multiplier either side of the size: "X 10" / "×10" or "10 X" (not
  // "x E 2,79/kg", which is a price per kilo)
  const times = /\b(\d{1,3})\s?(?:X|×)\s?(?=\d+(?:\.\d+)?\s?(?:KG|GM|G|ML|L)\b)/.exec(t) ?? /(?:\bX|×)\s?(\d{1,3})\b(?!\s?(?:KG|GM|G|ML|L|\.)\b)/.exec(t);
  if (unitMatch) {
    const q = Number(unitMatch[1]);
    if (q > 0 && q < 100000) {
      const one = toBaseUnit(q, unitMatch[2]);
      // "X 10" after the size multiplies it; before it ("10 X 375ML") too
      const n = times ? Number(times[1]) : 1;
      return { quantity: +(one.quantity * n).toFixed(2), unit: one.unit };
    }
  }
  const pack = /\b(\d{1,3})\s?(?:PK|PACK|PCS)\b/.exec(t);
  if (pack) return { quantity: Number(pack[1]), unit: "" };
  if (times) return { quantity: Number(times[1]), unit: "" };
  return null;
}

// A weighed line ("1.234 kg @ $3.90/kg", "BANANA KG", "$4.50/KG"): the
// weight printed is what was bought, so it's the quantity, and a bare "KG"
// means the weight isn't on this line at all.
export function weighed(text: string): { grams: number | null } | null {
  const t = text.toUpperCase().replace(/(\d),(\d)/g, "$1.$2");
  // "0.572 kg NET @", "1.234 kg @", "0,5484kg x E 2,79/kg"
  const w = /(\d+(?:\.\d+)?)\s?KG\s?(?:@|NET\b|X\b)/.exec(t);
  if (w) return { grams: Math.round(Number(w[1]) * 1000) };
  if (/(?:PER\s?KG|\/\s?KG|\bKG\b(?!\s*\d))/.test(t)) return { grams: null };
  return null;
}

export function parseReceipt(text: string): Receipt {
  const body = text.replace(/```(?:json)?/gi, "");
  let obj: { lines?: unknown; total?: unknown } = {};
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      obj = JSON.parse(body.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
    } catch {
      // salvage complete line objects below
    }
  }
  const raw: unknown[] = Array.isArray(obj.lines)
    ? obj.lines
    : [...body.matchAll(/\{[^{}]*"name"\s*:[^{}]*\}/g)].flatMap((m) => {
        try {
          return [JSON.parse(m[0].replace(/,\s*}/g, "}"))];
        } catch {
          return [];
        }
      });
  const lines: ReceiptLine[] = [];
  let other_cents = 0;
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const printed = typeof o.text === "string" ? o.text.trim().slice(0, 120) : "";
    const name = typeof o.name === "string" ? normaliseIngredient(o.name.replace(/\s*\(.*?\)\s*/g, " ")) : "";
    // a negative line ("GOLDEN PANCAK OFFER -1.98", "Rabat -2,00") is a
    // discount on the item printed above it: take it off that item's price,
    // as the prompt asks the model to (a smaller model lists it instead)
    const signed = signedCents(o.price);
    if (signed !== null && signed < 0) {
      const prev = lines.at(-1);
      if (prev?.price_cents != null && prev.price_cents + signed >= 0) prev.price_cents += signed;
      continue;
    }
    if (!name || name.length > 60 || DISCOUNT_NAME.test(name)) continue;
    // nothing was paid for it: a discount the model gave a food name to
    if (cents(o.price) === 0) continue;
    if (NOT_FOOD.test(name) || NOT_FOOD.test(printed)) {
      // a bag is in the printed total; a discount or subtotal line is not a
      // purchase and its sign is unreliable, so only positive non-total lines
      if (!/total|gst|change|cash|discount|saving|promo|voucher|points|rewards|flybuys/i.test(`${name} ${printed}`)) other_cents += cents(o.price) ?? 0;
      continue;
    }
    const q = typeof o.qty === "number" ? o.qty : Number(o.qty);
    const size = packSize(printed);
    // a weight the printed text shows wins; otherwise a fractional quantity
    // with no pack size is the model giving the weight in kilograms ("qty":
    // 0.572 for "0.572 kg NET")
    const w = weighed(printed) ?? (Number.isFinite(q) && q > 0 && q < 50 && !Number.isInteger(q) && !size ? { grams: Math.round(q * 1000) } : null);
    lines.push({
      text: printed,
      name,
      qty: w ? 1 : Number.isFinite(q) && q >= 1 && q < 100 ? Math.round(q) : 1,
      price_cents: cents(o.price),
      size: w ? null : size,
      by_weight: !!w,
      grams: w?.grams ?? null,
    });
  }
  const total_cents = cents(obj.total);
  const priced = lines.filter((l) => l.price_cents !== null);
  const sum_cents = priced.reduce((a, l) => a + l.price_cents!, 0) + other_cents;
  // a rounding cent or two is normal; a misread price is not
  const check = total_cents !== null && priced.length === lines.length && lines.length
    ? { sum_cents, matches: Math.abs(sum_cents - total_cents) <= 5 }
    : null;
  return { lines, total_cents, other_cents, check };
}

// What the review row is prefilled with: the printed pack size times the
// count when it's known, the printed weight for a weighed line, otherwise
// the count alone with no unit.
export function lineQuantity(l: ReceiptLine): { quantity: string; unit: string } {
  if (l.by_weight) return { quantity: l.grams === null ? "" : String(l.grams), unit: "g" };
  if (l.size) {
    const q = l.size.quantity * l.qty;
    return { quantity: String(+q.toFixed(2)), unit: l.size.unit };
  }
  return { quantity: String(l.qty), unit: "" };
}
