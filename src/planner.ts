import { all } from "./db.ts";
import { addDays, daysBetween, money, parseIsoDate, weekday } from "./format.ts";
import { estimate } from "./nutrition.ts";
import { type Prefs, prefsFor } from "./prefs.ts";
import { ingredientsFor, listVisibleRecipes, pantryMatch, type Recipe, type RecipeIngredient } from "./recipes.ts";
import { canSeeRecipe, friendIds } from "./visibility.ts";

// The week planner. Deterministic on purpose (CLAUDE.md: AI is advisory
// only): the same kitchen, interests and seed always give the same week.
// Every pick carries the plain-language reasons the rules produced, and the
// budget is a hard ceiling, never a suggestion.

export const INTERESTS = [
  { key: "budget", label: "for the week" },
  { key: "mix", label: "Mix it up each day" },
  { key: "lessmeat", label: "Limit meat" },
  { key: "usuals", label: "My usuals" },
  { key: "new", label: "Something I haven't tried before" },
  { key: "season", label: "What's in season" },
  { key: "fridge", label: "What's in my fridge" },
] as const;

export type InterestKey = (typeof INTERESTS)[number]["key"];

export function isInterest(s: string): s is InterestKey {
  return INTERESTS.some((i) => i.key === s);
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// What's in season in Australia (southern hemisphere), month by month, from
// state seasonal-produce guides. Deliberately short: common produce that the
// catalogue actually uses.
const SEASONAL: string[][] = [
  /* Jan */ ["tomato", "cucumber", "courgette", "zucchini", "sweetcorn", "corn", "capsicum", "aubergine", "eggplant", "blueberries", "raspberries", "mango", "peach", "apricot", "basil", "lettuce", "green beans"],
  /* Feb */ ["tomato", "capsicum", "aubergine", "eggplant", "sweetcorn", "corn", "cucumber", "courgette", "zucchini", "plum", "peach", "basil", "green beans", "blackberries"],
  /* Mar */ ["tomato", "capsicum", "aubergine", "eggplant", "sweetcorn", "apple", "pear", "fig", "grapes", "pumpkin", "squash", "mushrooms", "basil", "green beans"],
  /* Apr */ ["apple", "pear", "pumpkin", "squash", "butternut squash", "mushrooms", "sweet potato", "cauliflower", "broccoli", "celery", "leek", "fig", "chilli"],
  /* May */ ["pumpkin", "squash", "sweet potato", "cauliflower", "broccoli", "brussels sprouts", "leek", "mushrooms", "apple", "pear", "cabbage", "celeriac", "parsnip"],
  /* Jun */ ["cabbage", "cauliflower", "broccoli", "brussels sprouts", "leek", "celeriac", "parsnip", "carrot", "potato", "kale", "lemon", "orange", "jerusalem artichokes"],
  /* Jul */ ["cabbage", "cauliflower", "broccoli", "leek", "fennel", "beetroot", "parsnip", "carrot", "potato", "kale", "lemon", "orange", "pak choi", "celeriac"],
  /* Aug */ ["cabbage", "cauliflower", "broccoli", "leek", "fennel", "lemon", "orange", "beetroot", "kale", "carrot", "celery", "spinach", "pak choi"],
  /* Sep */ ["asparagus", "broad beans", "peas", "spinach", "spring onion", "lettuce", "lemon", "avocado", "cabbage", "broccoli", "artichoke", "leek", "rocket"],
  /* Oct */ ["asparagus", "broad beans", "peas", "sugar snap peas", "spinach", "spring onion", "lettuce", "avocado", "strawberries", "artichoke", "mint", "rocket", "new potatoes"],
  /* Nov */ ["asparagus", "peas", "strawberries", "cherries", "courgette", "zucchini", "green beans", "lettuce", "cucumber", "tomato", "basil", "mint", "avocado", "sweetcorn", "mango"],
  /* Dec */ ["tomato", "cucumber", "courgette", "zucchini", "sweetcorn", "capsicum", "cherries", "blueberries", "raspberries", "mango", "apricot", "peach", "green beans", "basil", "lettuce"],
];

// Processed forms of produce aren't "in season".
const NOT_FRESH = /puree|paste|ketchup|canned|tinned|sauce|powder|dried|stock|juice|jam|cordial|zest|extract|flakes|starch|seeds?\b|oil\b/;

function seasonalIn(names: string[], month: number): string[] {
  const found: string[] = [];
  for (const produce of SEASONAL[month]) {
    const re = new RegExp(`\\b${produce}(e?s)?\\b`);
    if (names.some((n) => !NOT_FRESH.test(n) && re.test(n)) && !found.some((f) => f.includes(produce) || produce.includes(f))) {
      found.push(produce);
    }
  }
  return found;
}

const MEAT = /\b(chicken|beef|lamb|pork|bacon|chorizo|sausages?|mince|steak|ham|prosciutto|pancetta|salami|turkey|duck|veal|goat|venison|kangaroo)\b/;

const PROTEINS: [string, RegExp][] = [
  ["chicken", /\bchicken\b/],
  ["beef", /\b(beef|steak|sirloin)\b/],
  ["lamb", /\blamb\b/],
  ["pork", /\b(pork|bacon|chorizo|sausages?|ham|pancetta|prosciutto)\b/],
  ["seafood", /\b(prawns?|salmon|fish|tuna|mussels|squid|anchov\w*|cod|shrimp|crab)\b/],
  ["tofu", /\b(tofu|tempeh|paneer)\b/],
  ["legumes", /\b(chickpeas|lentils|kidney beans|black beans|borlotti beans|dal)\b/],
  ["eggs", /\beggs?\b/],
];

function isMeat(r: Recipe, names: string[]): boolean {
  if (r.dietary_tags.includes("vegetarian") || r.dietary_tags.includes("vegan")) return false;
  return names.some((n) => !/stock|broth|sauce/.test(n) && MEAT.test(n));
}

function proteinOf(names: string[]): string {
  const usable = names.filter((n) => !/stock|broth|sauce|green beans/.test(n));
  return PROTEINS.find(([, re]) => usable.some((n) => re.test(n)))?.[0] ?? "veg";
}

/* ---------------- cost ---------------- */

export interface Costed {
  // the whole dish at the servings you cook for, cents
  fullCents: number;
  // minus the ingredients already in your pantry
  toBuyCents: number;
  held: string[];
  counted: number;
  total: number;
}

// How much of a recipe you cook: your usual servings over the recipe's.
export function servingsFactor(prefs: Pick<Prefs, "default_servings">, recipeServings: number): number {
  return Math.max(1, prefs.default_servings) / Math.max(1, recipeServings);
}

// Estimated cost of a recipe's required ingredients, scaled, and what's left
// to buy after the pantry (`have`, from pantryMatch). Estimates only: the
// reference prices live in nutrition.ts and the pages say so.
export function costLines(lines: RecipeIngredient[], factor: number, have: Set<number>): Costed {
  const required = lines.filter((l) => !l.optional);
  const scale = (l: RecipeIngredient) => ({ name: l.name, unit: l.unit, quantity: l.quantity === null ? null : l.quantity * factor });
  const full = estimate(required.map(scale));
  const buy = estimate(required.filter((l) => !have.has(l.ingredient_id)).map(scale));
  return {
    fullCents: Math.round(full.costCents),
    toBuyCents: Math.round(buy.costCents),
    held: required.filter((l) => have.has(l.ingredient_id)).map((l) => l.name),
    counted: full.counted,
    total: full.total,
  };
}

/* ---------------- the kitchen: everything personal the planner reads ---------------- */

export interface Kitchen {
  userId: number;
  prefs: Prefs;
  have: Set<number>;
  // fresh pantry items with a date, earliest expiry per ingredient
  expiring: Map<number, { name: string; expiry: string }>;
  // recipe id → times on the calendar (planned, cooking or cooked)
  history: Map<number, number>;
  // cuisine → times planned
  cuisines: Map<string, number>;
}

export function kitchenFor(userId: number): Kitchen {
  const prefs = prefsFor(userId);
  const { have } = pantryMatch(userId, []);
  const expiring = new Map<number, { name: string; expiry: string }>();
  for (const row of all<{ ingredient_id: number; name: string; expiry_date: string }>(
    `SELECT it.ingredient_id, i.name, MIN(it.expiry_date) AS expiry_date
     FROM inventory_items it JOIN ingredients i ON i.id = it.ingredient_id
     WHERE it.owner_type = 'user' AND it.owner_id = ? AND it.quantity > 0
       AND it.expiry_date IS NOT NULL AND it.expiry_date >= date('now', 'localtime')
     GROUP BY it.ingredient_id`,
    userId,
  )) expiring.set(row.ingredient_id, { name: row.name, expiry: row.expiry_date });

  const history = new Map<number, number>();
  const cuisines = new Map<string, number>();
  for (const row of all<{ recipe_id: number; n: number; cuisine: string; author_id: number; visibility: string }>(
    `SELECT c.recipe_id, COUNT(*) AS n, r.cuisine, r.author_id, r.visibility
     FROM calendar_entries c JOIN recipes r ON r.id = c.recipe_id
     WHERE c.owner_type = 'user' AND c.owner_id = ? AND c.status != 'cancelled'
     GROUP BY c.recipe_id`,
    userId,
  )) {
    // a recipe that has since been hidden from you doesn't shape suggestions
    if (!canSeeRecipe(userId, row)) continue;
    history.set(row.recipe_id, row.n);
    if (row.cuisine) cuisines.set(row.cuisine, (cuisines.get(row.cuisine) ?? 0) + row.n);
  }
  return { userId, prefs, have, expiring, history, cuisines };
}

export function dislikesOf(prefs: Prefs): string[] {
  return prefs.dislikes
    .toLowerCase()
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

/* ---------------- candidates ---------------- */

export interface Candidate {
  recipe: Recipe;
  lines: RecipeIngredient[];
  names: string[];
  cost: Costed;
  meat: boolean;
  protein: string;
  history: number;
}

// Dinners the person may see and would eat: the catalogue, their own recipes
// and their friends'; mains only; every diet tag they follow; nothing they
// said they avoid; and enough priced ingredients to budget honestly.
export function candidatesFor(k: Kitchen): Candidate[] {
  const friends = new Set(friendIds(k.userId));
  const avoid = dislikesOf(k.prefs);
  const recipes = listVisibleRecipes(k.userId, { limit: 5000 }).filter(
    (r) =>
      (r.course === "main" || r.course === "") &&
      (r.source !== null || r.author_id === k.userId || friends.has(r.author_id)) &&
      k.prefs.dietary_prefs.every((t) => r.dietary_tags.includes(t)) &&
      !avoid.some((a) => r.title.toLowerCase().includes(a)),
  );
  const lines = ingredientsFor(recipes.map((r) => r.id));
  const out: Candidate[] = [];
  for (const recipe of recipes) {
    const ls = lines.get(recipe.id) ?? [];
    const names = ls.map((l) => l.name.toLowerCase());
    if (avoid.some((a) => names.some((n) => n.includes(a)))) continue;
    const cost = costLines(ls, servingsFactor(k.prefs, recipe.servings), k.have);
    if (cost.counted < 2 || cost.fullCents <= 0) continue;
    out.push({
      recipe,
      lines: ls,
      names,
      cost,
      meat: isMeat(recipe, names),
      protein: proteinOf(names),
      history: k.history.get(recipe.id) ?? 0,
    });
  }
  return out;
}

/* ---------------- dates ---------------- */

// The next `nights` dinners from `from` that don't already have a dinner
// planned, looking at most three weeks ahead.
export function openDinners(userId: number, from: string, nights: number): string[] {
  const busy = new Set(
    all<{ date: string }>(
      `SELECT DISTINCT date FROM calendar_entries
       WHERE owner_type = 'user' AND owner_id = ? AND meal = 'dinner' AND status != 'cancelled' AND date BETWEEN ? AND ?`,
      userId,
      from,
      addDays(from, 21),
    ).map((r) => r.date),
  );
  const out: string[] = [];
  for (let i = 0; i <= 21 && out.length < nights; i++) {
    const d = addDays(from, i);
    if (!busy.has(d)) out.push(d);
  }
  return out;
}

/* ---------------- scoring ---------------- */

export interface PlanRequest {
  from: string;
  nights: number;
  budgetCents: number | null;
  interests: Set<InterestKey>;
  seed: number;
  // a recipe id per slot to keep (0 = choose), for swapping one pick
  keep: number[];
  // recipe ids never to choose (picks already swapped away)
  exclude: number[];
}

interface Reason {
  text: string;
  weight: number;
}

// A dinner beside the slot being filled: a pick, or a meal already planned.
interface Neighbour {
  date: string;
  cuisine: string;
  protein: string;
}

interface Slot {
  date: string;
  // the dinners the night before and the night after, where there are any
  neighbours: Neighbour[];
  claimed: Set<number>;
  meatElsewhere: number;
}

// A small stable hash in [0, 1): the seed's say in close calls.
function jitter(seed: number, id: number): number {
  let h = Math.imul(seed + 1, 2654435761) ^ Math.imul(id, 40503);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function expiresLabel(slotDate: string, expiry: string): string {
  return daysBetween(slotDate, expiry) === 0 ? "the day it expires" : `before it expires ${weekday(expiry)}`;
}

interface Scoring {
  req: PlanRequest;
  k: Kitchen;
  // the budget spread evenly over the nights, when budget was chosen
  pace: number | null;
  month: number;
  // seasonal produce each candidate uses, worked out once
  seasonal: Map<number, string[]>;
}

function scoreAt(c: Candidate, slot: Slot, ctx: Scoring): { score: number; reasons: Reason[] } {
  const { req, k, pace, month } = ctx;
  const on = req.interests;
  if (on.has("lessmeat") && c.meat && slot.meatElsewhere >= 2) return { score: -Infinity, reasons: [] };
  if (on.has("new") && c.history > 0) return { score: -Infinity, reasons: [] };

  const reasons: Reason[] = [];
  let score = jitter(req.seed, c.recipe.id) * 1.4;
  if (c.recipe.image_url) score += 0.4;

  // past data: cuisines you plan often always nudge a little
  const affinity = c.recipe.cuisine ? (k.cuisines.get(c.recipe.cuisine) ?? 0) : 0;
  score += 0.25 * Math.min(affinity, 4);

  // money: with a budget, cheaper-than-pace is rewarded; without one, a light touch
  if (on.has("budget") && pace) {
    const ratio = c.cost.toBuyCents / pace;
    score += Math.max(-3, Math.min(1.5, 1.6 * (1 - ratio)));
    if (c.cost.toBuyCents <= pace) {
      reasons.push({ text: `${money(c.cost.toBuyCents)} to buy, under your ${money(pace)} a night`, weight: 1.2 + (1 - ratio) });
    }
  } else {
    score -= (0.3 * c.cost.toBuyCents) / 1500;
  }

  // the fridge: coverage, and soon-to-expire items used before they turn
  if (on.has("fridge")) {
    const required = c.lines.filter((l) => !l.optional);
    const coverage = required.length ? c.cost.held.length / required.length : 0;
    score += 3 * coverage;
    let urgent: { name: string; expiry: string; days: number } | undefined;
    for (const l of required) {
      const e = k.expiring.get(l.ingredient_id);
      if (!e || slot.claimed.has(l.ingredient_id) || e.expiry < slot.date) continue;
      const days = daysBetween(slot.date, e.expiry);
      if (days > 4) continue;
      score += Math.max(0.6, 3 - 0.6 * days);
      if (!urgent || days < urgent.days) urgent = { name: e.name, expiry: e.expiry, days };
    }
    if (urgent) reasons.push({ text: `Uses your ${urgent.name} ${expiresLabel(slot.date, urgent.expiry)}`, weight: 5 - urgent.days * 0.5 });
    else if (c.cost.held.length) reasons.push({ text: `You already have ${listNames(c.cost.held.slice(0, 2))}`, weight: 1 + coverage * 2 });
  }

  if (on.has("mix") && slot.neighbours.length) {
    let clashes = 0;
    for (const n of slot.neighbours) {
      if (c.recipe.cuisine && c.recipe.cuisine === n.cuisine) {
        score -= 4;
        clashes++;
      }
      if (c.protein !== "veg" && c.protein === n.protein) {
        score -= 3;
        clashes++;
      }
    }
    const before = slot.neighbours.find((n) => n.date < slot.date);
    if (!clashes && before) {
      const what = before.cuisine || (before.protein !== "veg" ? before.protein : "");
      reasons.push({ text: what ? `A change from ${weekday(before.date)}'s ${what}` : "Different from the night before", weight: 0.9 });
    }
  } else if (c.recipe.cuisine && slot.neighbours.some((n) => n.cuisine === c.recipe.cuisine)) {
    score -= 0.5;
  }

  if (on.has("lessmeat") && !c.meat) {
    score += 1.2;
    reasons.push({ text: "Meat-free night", weight: 0.8 });
  }

  if (on.has("usuals")) {
    if (c.history > 0) {
      score += 2.5 + 0.6 * Math.min(c.history, 4);
      reasons.push({ text: `One of your usuals, planned ${c.history}×`, weight: 3 + c.history * 0.2 });
    } else if (affinity > 0) {
      score += 0.5;
      reasons.push({ text: affinity >= 3 ? `You often cook ${c.recipe.cuisine}` : `More of the ${c.recipe.cuisine} food you've planned before`, weight: 1 });
    }
  }

  if (on.has("new")) {
    score += 0.3;
    if (c.recipe.cuisine && affinity === 0 && k.cuisines.size) {
      score += 0.5;
      reasons.push({ text: `New to you, and a cuisine you haven't planned`, weight: 1.6 });
    } else reasons.push({ text: "New to you", weight: 1.1 });
  }

  if (on.has("season")) {
    const inSeason = ctx.seasonal.get(c.recipe.id) ?? [];
    if (inSeason.length) {
      score += 0.9 * Math.min(inSeason.length, 3);
      const shown = inSeason.slice(0, 2);
      const label = listNames(shown);
      reasons.push({
        text: `${label[0].toUpperCase()}${label.slice(1)} ${shown.length > 1 || /s$/.test(shown[0]) ? "are" : "is"} in season in ${MONTH_NAMES[month]}`,
        weight: 1.3 + inSeason.length * 0.3,
      });
    }
  }

  return { score, reasons: reasons.sort((a, b) => b.weight - a.weight) };
}

/* ---------------- the plan ---------------- */

export interface PlanPick {
  date: string;
  recipe: Recipe;
  toBuyCents: number;
  fullCents: number;
  reasons: string[];
  meat: boolean;
}

export interface Plan {
  dates: string[];
  picks: PlanPick[];
  // dates the planner left open (budget too tight, or nothing fits the diet)
  open: string[];
  totalCents: number;
  // the ceiling that was enforced, or null when budget wasn't chosen
  budgetCents: number | null;
  notes: string[];
  candidateCount: number;
}

export function generatePlan(userId: number, req: PlanRequest): Plan {
  const k = kitchenFor(userId);
  const dates = openDinners(userId, req.from, req.nights);
  const month = parseIsoDate(dates[0] ?? req.from)!.getMonth();
  const enforce = req.interests.has("budget") && req.budgetCents !== null ? req.budgetCents : null;
  const pace = enforce !== null && dates.length ? Math.round(enforce / dates.length) : null;

  // nothing already planned near these days gets suggested again, by id or
  // by name (two people's "Shakshuka" are still the same dinner)
  const nearbyRows = dates.length
    ? all<{ recipe_id: number; title: string }>(
        `SELECT DISTINCT c.recipe_id, r.title FROM calendar_entries c JOIN recipes r ON r.id = c.recipe_id
         WHERE c.owner_type = 'user' AND c.owner_id = ? AND c.status != 'cancelled' AND c.date BETWEEN ? AND ?`,
        userId,
        addDays(dates[0], -3),
        addDays(dates.at(-1)!, 3),
      )
    : [];
  const nearby = new Set(nearbyRows.map((r) => r.recipe_id));
  // dinners already on the calendar next to the open nights, for "mix it up"
  const planned = new Map<string, Neighbour>();
  if (dates.length) {
    const rows = all<{ date: string; recipe_id: number; cuisine: string; author_id: number; visibility: string }>(
      `SELECT c.date, c.recipe_id, r.cuisine, r.author_id, r.visibility FROM calendar_entries c JOIN recipes r ON r.id = c.recipe_id
       WHERE c.owner_type = 'user' AND c.owner_id = ? AND c.meal = 'dinner' AND c.status != 'cancelled' AND c.date BETWEEN ? AND ?
       ORDER BY c.date, c.id`,
      userId,
      addDays(dates[0], -1),
      addDays(dates.at(-1)!, 1),
    ).filter((r) => canSeeRecipe(userId, r));
    const lines = ingredientsFor([...new Set(rows.map((r) => r.recipe_id))]);
    for (const r of rows) {
      if (planned.has(r.date)) continue;
      const names = (lines.get(r.recipe_id) ?? []).map((l) => l.name.toLowerCase());
      planned.set(r.date, { date: r.date, cuisine: r.cuisine, protein: proteinOf(names) });
    }
  }
  const nearbyTitles = new Set(nearbyRows.map((r) => titleKey(r.title)));
  const excluded = new Set(req.exclude);
  const all_ = candidatesFor(k);
  const byId = new Map(all_.map((c) => [c.recipe.id, c]));
  const pool = all_.filter(
    (c) =>
      !excluded.has(c.recipe.id) &&
      !nearby.has(c.recipe.id) &&
      !nearbyTitles.has(titleKey(c.recipe.title)) &&
      (enforce === null || c.cost.toBuyCents <= enforce),
  );

  const scoring: Scoring = {
    req,
    k,
    pace,
    month,
    seasonal: new Map(all_.map((c) => [c.recipe.id, seasonalIn(c.names, month)])),
  };
  const notes: string[] = [];
  const chosen: (Candidate | undefined)[] = dates.map((_, i) => {
    const id = req.keep[i];
    return id ? byId.get(id) : undefined;
  });
  const fixed = chosen.map((c) => !!c);

  const slotFor = (i: number, picks: (Candidate | undefined)[]): Slot => {
    const claimed = new Set<number>();
    for (let j = 0; j < i; j++) {
      for (const l of picks[j]?.lines ?? []) if (k.expiring.has(l.ingredient_id)) claimed.add(l.ingredient_id);
    }
    const neighbours: Neighbour[] = [];
    for (const date of [addDays(dates[i], -1), addDays(dates[i], 1)]) {
      const j = dates.indexOf(date);
      const pick = j >= 0 ? picks[j] : undefined;
      if (pick) neighbours.push({ date, cuisine: pick.recipe.cuisine, protein: pick.protein });
      else if (planned.has(date)) neighbours.push(planned.get(date)!);
    }
    return { date: dates[i], neighbours, claimed, meatElsewhere: picks.filter((p, j) => j !== i && p?.meat).length };
  };
  // ids and names already in the week, so no dinner appears twice
  const used = (picks: (Candidate | undefined)[], except: number) => {
    const out = new Set<number | string>();
    picks.forEach((p, j) => {
      if (!p || j === except) return;
      out.add(p.recipe.id);
      out.add(titleKey(p.recipe.title));
    });
    return out;
  };
  const isUsed = (taken: Set<number | string>, c: Candidate) => taken.has(c.recipe.id) || taken.has(titleKey(c.recipe.title));

  // greedy, day by day
  for (let i = 0; i < dates.length; i++) {
    if (fixed[i]) continue;
    const slot = slotFor(i, chosen);
    const taken = used(chosen, i);
    let best: { c: Candidate; s: number } | undefined;
    for (const c of pool) {
      if (isUsed(taken, c)) continue;
      const { score } = scoreAt(c, slot, scoring);
      if (score === -Infinity) continue;
      if (!best || score > best.s) best = { c, s: score };
    }
    chosen[i] = best?.c;
  }

  // the budget is a ceiling: swap the costliest picks for the cheaper option
  // that hurts the week least, and leave a night open if nothing fits
  if (enforce !== null) {
    const total = () => chosen.reduce((s, c) => s + (c?.cost.toBuyCents ?? 0), 0);
    for (let guard = 0; guard < 60 && total() > enforce; guard++) {
      const now = total();
      let bestFit: { i: number; c: Candidate; loss: number } | undefined;
      let bestStep: { i: number; c: Candidate; value: number } | undefined;
      for (let i = 0; i < dates.length; i++) {
        const current = chosen[i];
        if (!current || fixed[i]) continue;
        const slot = slotFor(i, chosen);
        const taken = used(chosen, i);
        const currentScore = scoreAt(current, slot, scoring).score;
        for (const c of pool) {
          if (isUsed(taken, c) || c.cost.toBuyCents >= current.cost.toBuyCents) continue;
          const s = scoreAt(c, slot, scoring).score;
          if (s === -Infinity) continue;
          const loss = Math.max(0, currentScore - s);
          const saving = current.cost.toBuyCents - c.cost.toBuyCents;
          if (now - saving <= enforce) {
            if (!bestFit || loss < bestFit.loss) bestFit = { i, c, loss };
          } else {
            const value = saving / (loss + 0.5);
            if (!bestStep || value > bestStep.value) bestStep = { i, c, value };
          }
        }
      }
      const move = bestFit ?? bestStep;
      if (move) {
        chosen[move.i] = move.c;
        continue;
      }
      // nothing cheaper anywhere: leave the costliest choosable night open
      let drop = -1;
      for (let i = 0; i < dates.length; i++) {
        if (!chosen[i]) continue;
        if (drop < 0 || (fixed[drop] && !fixed[i]) || (fixed[drop] === fixed[i] && chosen[i]!.cost.toBuyCents > chosen[drop]!.cost.toBuyCents)) drop = i;
      }
      if (drop < 0) break;
      chosen[drop] = undefined;
      fixed[drop] = false;
    }
    // belt and braces: whatever the search did, the week never ends over budget
    while (total() > enforce) {
      let drop = -1;
      chosen.forEach((c, i) => {
        if (c && (drop < 0 || c.cost.toBuyCents > chosen[drop]!.cost.toBuyCents)) drop = i;
      });
      if (drop < 0) break;
      chosen[drop] = undefined;
    }
  }

  // reasons are worked out once more against the final neighbours
  const picks: PlanPick[] = [];
  const open: string[] = [];
  dates.forEach((date, i) => {
    const c = chosen[i];
    if (!c) {
      open.push(date);
      return;
    }
    const { reasons } = scoreAt(c, slotFor(i, chosen), scoring);
    const texts = reasons.map((r) => r.text);
    if (!texts.length) texts.push(c.cost.held.length ? `You already have ${listNames(c.cost.held.slice(0, 2))}` : c.recipe.cuisine ? `A ${c.recipe.cuisine} dinner for a change` : "A good all-rounder");
    picks.push({ date, recipe: c.recipe, toBuyCents: c.cost.toBuyCents, fullCents: c.cost.fullCents, reasons: texts.slice(0, 2), meat: c.meat });
  });

  const totalCents = picks.reduce((s, p) => s + p.toBuyCents, 0);
  if (!pool.length) notes.push("Nothing in the catalogue fits your diet and dislikes together. Loosen one in settings to get suggestions.");
  else if (open.length && enforce !== null) {
    notes.push(`Only ${picks.length} dinner${picks.length === 1 ? "" : "s"} fit in ${money(enforce)}, so ${open.length === 1 ? "one night is" : `${open.length} nights are`} left open.`);
  } else if (open.length) notes.push(`${open.length === 1 ? "One night" : `${open.length} nights`} had no recipe left that fits.`);
  if (dates.length < req.nights) notes.push(`Only ${dates.length} free night${dates.length === 1 ? "" : "s"} in the next three weeks.`);

  return { dates, picks, open, totalCents, budgetCents: enforce, notes, candidateCount: pool.length };
}
