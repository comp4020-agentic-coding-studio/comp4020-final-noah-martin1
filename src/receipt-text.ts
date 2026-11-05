// Reading a receipt from its printed text, with no model: the browser reads
// the text off the photo (public/receipt-ocr.mjs) and this decides what was
// bought. Each printed item line ends in a price; a weighed item's weight,
// a "2 @ $1.50 EACH" count and a discount ("OFFER -1.98", "Rabat -2,00",
// "REDUCED PRICE 0.55") sit on the lines around it; the receipt's total is
// printed after the items. What comes out has the shape the vision model's
// reply is parsed into (src/receipt-scan.ts), so the review, the total check
// and the price and expiry prefill are the same code.
//
// The food name is found, not guessed: the longest ingredient the app
// already knows that the printed words contain ("BRITISHBACON200GRAM" holds
// "bacon"), after the abbreviations Australian receipts use are spelled out
// ("CHSE" cheese, "SBERRY" strawberry). A line with no known food keeps its
// printed words, cleaned, for the person to name in the review.

import { packSize, weighed, type Receipt, type ReceiptLine } from "./receipt-scan.ts";

// A price at the end of a line: "3.99", "$16.48", "1,65", "2,99C" (Polish
// tax letter), "2.00^" or "2.00%" (promotion marks), "-1.98" (a discount).
// The Polish tax letter after a price is sometimes read as a 0 ("3,290").
const PRICE_END = /(-?)\$?\s?(\d{1,4})[.,](\d{2})(?:[0C]|\s*[A-Z^%*#])?\s*$/;

// Lines that are never an item: headers, totals, payment, tax, store details.
const NOT_ITEM = /\b(sub\s?-?total|total|totale|suma|sum|gst|tax|iva|ptu|vat|change|cash|eft|eftpos|visa|mastercard|card|credit|debit|amex|paypass|tap|purchase|approved|rounding|balance|tender|paid|pagato|pagamento|importo|rewards?|points|flybuys|savings?|saved|abn|invoice|receipt|register|store|manager|phone|served|date|time|merch|term|aid|arqc|items?\b(?!\s*\w)|thank|welcome|sprzedaz|opodatkowana|kasa|kasjer|transakcji|numer|nip|paragon|documento|commerciale|descrizione|prezzo|specials|taxable|promotional|everyday|description)\b/i;

// Store abbreviations spelled out before looking for a food name. Only
// whole printed words, so "CHSE" becomes cheese but "CHEESE" is untouched.
const ABBREVIATIONS: Record<string, string> = {
  chse: "cheese", chs: "cheese", chdr: "cheddar", ched: "cheddar", mld: "mild", wht: "white",
  sberry: "strawberry", sberries: "strawberries", stwb: "strawberry", rsbrry: "raspberry", bberry: "blueberry", bluebry: "blueberry",
  choc: "chocolate", phily: "philadelphia", philly: "philadelphia", org: "organic", organc: "organic",
  ff: "full fat", lf: "low fat", rf: "reduced fat", skm: "skim", bttr: "butter", butte: "butter",
  yog: "yoghurt", yogh: "yoghurt", yght: "yoghurt", grk: "greek", veg: "vegetable", vegs: "vegetables",
  chkn: "chicken", chick: "chicken", brst: "breast", thgh: "thigh", mnce: "mince", bf: "beef", prk: "pork",
  sausg: "sausages", saus: "sausages", tom: "tomato", toms: "tomatoes",
  potat: "potato", mush: "mushrooms", mshrm: "mushrooms", cap: "capsicum", caps: "capsicum", brocc: "broccoli",
  lett: "lettuce", cuc: "cucumber", cucumb: "cucumber", avo: "avocado", avos: "avocados", bana: "banana",
  appl: "apple", oran: "orange", mand: "mandarin", wmelon: "watermelon", rockmelon: "rockmelon",
  brd: "bread", wmeal: "wholemeal", wholeml: "wholemeal", grn: "green", blk: "black", sml: "small", lge: "large",
  doughnts: "doughnuts", dnuts: "doughnuts", ckies: "cookies", bisc: "biscuits", bscts: "biscuits",
  crm: "cream", sr: "sour", pnut: "peanut", alm: "almond", macadam: "macadamia", hazel: "hazelnut",
  fetta: "feta", feita: "feta", parm: "parmesan", mozz: "mozzarella", spag: "spaghetti",
  frankfurts: "frankfurters", fra: "frankfurters", frank: "frankfurters", franks: "frankfurters",
  macadamias: "macadamia", beets: "beetroot", beet: "beetroot", cobbettes: "corn cob", cobbette: "corn cob",
  tabouleh: "tabbouleh", flip: "yoghurt", chobani: "yoghurt", yakult: "probiotic drink", vegemite: "vegemite",
};

// Words on a line that say the food named isn't what was bought: "Croc
// Eggs" is a plum variety, "Le Snak" a cheese-and-cracker snack.
const NOT_THE_FOOD: [RegExp, string][] = [
  [/\bcroc eggs?\b/, "plum"],
];

// Words printed on receipts that a food name can't be built from.
const NOISE = /\b(?:\d+(?:[.,]\d+)?\s?(?:kg|g|gm|gram|grams|ml|l|lt|ltr|litre|liter|pk|pack|ea|each|x)?|perkg|per|kg|net|each|ea|pk|pack|ww|woolworths|coles|aldi|iga|macro|essentials|homebrand|select|p\/p|pp|loose|flesh|punnet|prepacked|bulk|value)\b/gi;

// What a food is made into. A line naming one of these as well as a known
// food is that product, not the food: POTATO CHIP is chips, PUMPKIN SOUP is
// soup, BEEF JERKY is jerky, CHEDDAR BISCUITS are biscuits. The known food
// is kept in front ("potato chips", "pumpkin soup").
const MADE_INTO: [RegExp, string][] = [
  [/\b(?:sandwich(?:es)?|sandwhich)\b/, "sandwich"],
  [/\b(?:wraps?|burritos?)\b/, "wrap"],
  [/\bsushi\b/, "sushi"],
  [/\bcongee\b/, "congee"],
  [/\b(?:noodle cup|cup noodles?|instant noodles?)\b/, "instant noodles"],
  [/\b(?:doughnuts?|donuts?|doughnts)\b/, "doughnuts"],
  [/\b(?:muffins?)\b/, "muffins"],
  [/\b(?:scrolls?|danish(?:es)?)\b/, "pastries"],
  [/\b(?:chips?|crisps?)\b/, "chips"],
  [/\bsoup\b/, "soup"],
  [/\bjerky\b/, "jerky"],
  [/\bcrackers?\b/, "crackers"],
  [/\bbiscuits?\b/, "biscuits"],
  [/\bcookies?\b/, "cookies"],
  [/\bspread\b/, "spread"],
  [/\b(?:jam|conserve)\b/, "jam"],
  [/\bmarmalade\b/, "marmalade"],
  [/\b(?:tea bags?|tea)\b/, "tea"],
  [/\b(?:capsules?|pods?)\b/, "coffee pods"],
  [/\bsachets?\b/, "sachets"],
  [/\bjuice\b/, "juice"],
  [/\b(?:drink|drinks)\b/, "drink"],
  [/\bsauce\b/, "sauce"],
  [/\bdip\b/, "dip"],
  [/\b(?:bars?)\b/, "bar"],
  [/\bcake\b/, "cake"],
  [/\bpie\b/, "pie"],
  [/\bsalad\b/, "salad"],
  [/\b(?:ice cream|icecream|gelato)\b/, "ice cream"],
];

// The line the items stop at. A count is often printed against it
// ("22 SUBTOTAL", read as "22SUBTOTAL").
const ENDS_ITEMS = /(?:\b|\d)(?:sub\s?-?total|total|totale|suma)\b/i;

// a shopping bag, not "TEA BAGS" or "FREEZER BAGS" (not food either, but
// bought): "REUSABLE BAG", "Paper Bag", "BAG 15C"
const isBag = (text: string) => /\b(?:reusable|paper|plastic|shopping|carry|calico|green)\s+bags?\b|^\W*bags?\b/i.test(text);

export interface TextLine {
  text: string;
  price_cents: number | null;
}

// One printed line split into its words and the price at its end.
export function splitPrice(line: string): TextLine {
  const t = line.replace(/\s+/g, " ").trim();
  const m = PRICE_END.exec(t);
  if (!m) return { text: t, price_cents: null };
  const cents = Number(m[2]) * 100 + Number(m[3]);
  return { text: t.slice(0, m.index).trim(), price_cents: m[1] === "-" ? -cents : cents };
}

// The printed total: the "TOTAL" line's amount (also "Total for 35 items",
// "TOTALE COMPLESSIVO", "SUMA PLN"), else the subtotal, after any rounding.
export function findTotal(lines: string[]): number | null {
  let subtotal: number | null = null;
  let total: number | null = null;
  for (const raw of lines) {
    const { text, price_cents } = splitPrice(raw);
    if (price_cents === null || price_cents <= 0) continue;
    if (/(?:\b|\d)sub\s?-?total\b/i.test(text)) subtotal ??= price_cents;
    else if (/\b(total|totale|suma pln|importo pagato)\b/i.test(text) && !/\b(gst|savings?|iva|ptu|tax|includes?)\b/i.test(text)) total ??= price_cents;
  }
  return total ?? subtotal;
}

// fruit and vegetables Woolworths and Coles print kind-first, which the
// shop listings don't always have a name for
const PRODUCE_FIRST = new Set(["plum", "plums", "grape", "grapes", "nectarine", "nectarines", "peach", "apricot", "cherry", "cherries", "melon", "kiwi", "kiwifruit", "mandarin", "mandarins", "apple", "pear", "orange", "lemon", "lime", "mango", "berry", "tomato", "potato", "onion", "capsicum", "lettuce", "cabbage", "carrot", "zucchini", "pumpkin", "mushroom", "mushrooms"]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A printed line in plain lower-case words, abbreviations spelled out.
export function receiptWords(printed: string): string {
  return printed
    // OCR reads a printed 1 or 0 inside a word as a letter's twin
    // ("Ear1Grey", "0live 0il"); put the letters back
    .replace(/(?<=[a-z])1(?=[a-z])/gi, "l")
    .replace(/\b0(?=[a-z]{2})/gi, "o")
    // words run together by the printer or OCR: "PlumYellow", "LatteCoffee"
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    // Coles prints "PERKG" and sizes straight onto the name
    // ("FLATMUSHROOMSPERKG", "BACON200GRAM")
    .replace(/perkg\b/g, " perkg")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^a-z0-9&\s/'.-]/g, " ")
    .split(/\s+/)
    .map((w) => ABBREVIATIONS[w.replace(/[^a-z]/g, "")] ?? w)
    .join(" ");
}

// The food a printed item line names, from the ingredients the app knows.
// Receipts print the food first and what it's in or with after ("TUNA
// SLICE IN OLIVE OIL", "PRINGLES CHIPOTLE & SOUR CREAM"), so a name earlier
// on the line beats a later one, and a longer name beats a shorter one at
// the same place ("sweet potato" over "potato"). Words the printer ran
// together ("BRITISHBACON200GRAM") still contain the name.
export function foodName(printed: string, known: string[]): { name: string; known: boolean } {
  const words = receiptWords(printed);
  for (const [re, name] of NOT_THE_FOOD) if (re.test(words)) return { name, known: known.includes(name) };
  const squashed = words.replace(/[^a-z]/g, "");
  // where each matching name starts, in letters from the line's start, so
  // spaced and squashed matches compare
  const letterAt = (i: number) => words.slice(0, i).replace(/[^a-z]/g, "").length;
  let best = "", bestAt = Infinity;
  for (const k of known) {
    if (k.length < 3) continue;
    const plain = k.replace(/[^a-z]/g, "");
    let at = -1;
    // whole words in the spaced text ("pea" not in "peach")
    // a plural name matches its singular on the receipt ("blackberries" in
    // "Berry Blackberry", "tomatoes" in "TOMATO")
    const one = k.replace(/ies$/, "y").replace(/(o|ch|sh|x)es$/, "$1").replace(/([^s])s$/, "$1");
    const m = new RegExp(`(^|[^a-z])(?:${escapeRe(k)}|${escapeRe(one)})(?:es|s)?($|[^a-z])`).exec(words);
    if (m) at = letterAt(m.index + m[1].length);
    // inside run-together text, for names long enough not to turn up by
    // accident ("pot" is never found in "potato"); receipts cut a long name
    // short ("PEANUT BUTTE"), so the last letter may be missing
    else if (plain.length >= 5) {
      // the name must end where a printed word ends ("PEANUT BUTTERCUP" is
      // a lolly, not peanut butter); receipts also cut a long name short
      // ("PEANUT BUTTE"), so for long names the last letter may be missing
      const run = words.replace(/[^a-z0-9]/g, "");
      const ending = (p: string) => new RegExp(`${escapeRe(p)}(?![a-z])`).exec(run);
      const full = ending(plain) ?? (plain.length >= 8 ? ending(plain.slice(0, -1)) : null);
      if (full) at = run.slice(0, full.index).replace(/[^a-z]/g, "").length;
    }
    if (at < 0) continue;
    // "sweet potato" (starting earlier, or the same place and longer) wins
    // over "potato"; a later name loses unless it covers the earlier one
    const ends = at + plain.length, bestEnds = bestAt + best.replace(/[^a-z]/g, "").length;
    if (!best || at < bestAt && ends >= bestAt || (at <= bestAt && ends > bestEnds) || (at < bestAt && ends <= bestAt && at + 2 < bestAt)) {
      best = k;
      bestAt = at;
    }
  }
  // a known food made into something else: "potato" in POTATO CHIP,
  // "beef" in BEEF JERKY. The product word wins; the food stays in front
  // when it's printed before it ("potato chips"). In run-together text
  // ("POTATOSALAD250GRAM") only where the word ends the run, so "Salada"
  // crackers aren't a salad and teacakes aren't tea
  // when two are printed ("JAM DOUGHNUTS") the last is what it is
  const madeHere = MADE_INTO.map((m) => ({ m, at: words.search(m[0]) })).filter((x) => x.at >= 0).sort((a, b) => b.at - a.at)[0]?.m;
  const made = madeHere
    ?? MADE_INTO.find(([, word]) => new RegExp(`[a-z]${word.replace(/ /g, "")}(?:\\d|$|[^a-z])`).test(words.replace(/\s+(?=\d)/g, "")));
  if (best && made && !made[0].test(best) && !best.includes(made[1])) {
    // where the printed product word starts, in the same letter count as
    // the food's position
    const hit = made[0].exec(words);
    const madeAt = hit ? letterAt(hit.index) : squashed.indexOf(made[1].replace(/ /g, "").replace(/s$/, ""));
    // in front of the product word the food is singular: "almond spread",
    // "strawberry jam", not "almonds spread"
    const one = best.replace(/ies$/, "y").replace(/(o|ch|sh|x)es$/, "$1").replace(/([^s])s$/, "$1");
    const name = bestAt < madeAt ? `${one} ${made[1]}` : made[1];
    return { name, known: false };
  }
  if (best) return { name: best, known: true };
  if (made) return { name: made[1], known: false };
  const left = words
    .replace(/\b(?:pk|pack)?\d+(?:[.,]\d+)?\s?(?:kg|g|gm|gram|grams|ml|l|lt|ltr|litre|pk|pack)\b/g, " ")
    .replace(NOISE, " ")
    .replace(/[^a-z\s&'-]/g, " ")
    .replace(/(?:^|\s)[&'-]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // loose produce is printed kind first, then variety ("PLUM YELLOW",
  // "GRAPE BLACK", "NECTARINE YELLOW FLESH"): the kind is the food
  const first = left.split(" ")[0] ?? "";
  if (PRODUCE_FIRST.has(first)) return { name: first, known: false };
  return { name: left.split(" ").slice(0, 4).join(" "), known: false };
}

/**
 * Printed lines in reading order → the receipt, in receipt-scan's shape.
 * `known` is the ingredient names a food name is matched against.
 */
export function parseReceiptText(lines: string[], known: string[]): Receipt {
  const total_cents = findTotal(lines);
  // the item block ends at the first total line; header lines before the
  // first priced line are skipped
  const items: ReceiptLine[] = [];
  let other_cents = 0;
  let pendingName: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const { text, price_cents } = splitPrice(lines[i]);
    if (ENDS_ITEMS.test(text)) break;
    const prev = items.at(-1);
    // a weight line belongs to the item above, or to the name printed just
    // before it: "APPLE PINK LADY" / "0.217 kg NET @ $3.90/kg 0.85"
    const w = weighed(text);
    if (w?.grams && /^\s*\d/.test(text)) {
      if (pendingName && price_cents !== null && price_cents > 0) {
        items.push(line(pendingName, `${pendingName} ${text}`, price_cents, known, w.grams));
        pendingName = null;
      } else if (prev && prev.grams === null && !prev.size) {
        // the name line had the price ("BANANAS PERKG 2.37" / "0.676 kg NET
        // @ $3.50/kg"): this is its weight, and any figure the reader
        // picked up beside it isn't a second price
        prev.by_weight = true;
        prev.grams = w.grams;
        prev.text = `${prev.text} ${text}`.slice(0, 120);
      }
      continue;
    }
    // "4 @ $2.20 EACH", "Qty 2 @ $0.25 each", "6 X 0,22": a count for the
    // item above (or below, on receipts that print it first)
    const count = /^(?:qty\s*)?(\d{1,3})\s*(?:@|x)\s*\$?\d/i.exec(text);
    if (count && !/[a-z]{3}/i.test(text.replace(/each|qty/gi, ""))) {
      const n = Number(count[1]);
      if (prev && price_cents === null) prev.qty = n;
      else if (price_cents !== null && pendingName) {
        // "#Woolworths Paper Bag" / "Qty 2 @ $0.25 each 0.50": in the
        // total, but not food
        if (isBag(pendingName)) other_cents += price_cents;
        else items.push({ ...line(pendingName, pendingName, price_cents, known, null), qty: n });
        pendingName = null;
      }
      continue;
    }
    // a discount: off the item above
    if (price_cents !== null && price_cents < 0) {
      if (prev?.price_cents != null && prev.price_cents + price_cents >= 0) prev.price_cents += price_cents;
      continue;
    }
    // "REDUCED PRICE 0.55": the item above was marked down to this
    if (/\breduced price\b/i.test(text)) {
      if (price_cents !== null && (prev || pendingName)) {
        if (pendingName) {
          items.push(line(pendingName, pendingName, price_cents, known, null));
          pendingName = null;
        } else if (prev) prev.price_cents = price_cents;
      }
      continue;
    }
    if (/^\s*rabat\b/i.test(text)) continue;
    if (!/[a-z]{2}/i.test(text) || NOT_ITEM.test(text)) {
      pendingName = null;
      continue;
    }
    if (price_cents === null) {
      // a name whose price is on the next line (weighed produce, a
      // "REDUCED PRICE" line, a Polish price line); an earlier pending name
      // with no price at all was a header
      pendingName = text;
      continue;
    }
    pendingName = null;
    // bags are in the printed total but aren't food
    if (isBag(text)) {
      other_cents += price_cents;
      continue;
    }
    items.push(line(text, text, price_cents, known, null));
  }
  const priced = items.filter((l) => l.price_cents !== null);
  const sum_cents = priced.reduce((a, l) => a + l.price_cents!, 0) + other_cents;
  const check = total_cents !== null && priced.length === items.length && items.length
    ? { sum_cents, matches: Math.abs(sum_cents - total_cents) <= 5 }
    : null;
  return { lines: items, total_cents, other_cents, check };
}

function line(nameText: string, printed: string, price_cents: number, known: string[], grams: number | null): ReceiptLine {
  const clean = nameText.replace(/^[^a-z0-9]+/i, "").trim();
  const { name } = foodName(clean, known);
  const w = grams !== null ? { grams } : weighed(printed);
  const size = w ? null : packSize(printed);
  return {
    text: printed.slice(0, 120),
    name,
    qty: 1,
    price_cents,
    size,
    by_weight: !!w,
    grams: w?.grams ?? null,
  };
}
