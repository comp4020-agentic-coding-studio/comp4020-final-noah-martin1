import { addDays, today } from "./format.ts";
import { expiryState } from "./expiry.ts";
import { ingredientsFor, listVisibleRecipes, type Recipe, type RecipeIngredient, totalMinutes } from "./recipes.ts";

// What to cook now, when nothing's planned: a deterministic pick from
// recipes the person may see, for the meal the local time calls for, using
// what's in their kitchen (soonest-expiring first) when there's anything in
// it. Empty kitchen is read as "not entered yet", never "has no food".

export type Period = "breakfast" | "lunch" | "dinner" | "late";

export const PERIOD_LABEL: Record<Period, string> = {
  breakfast: "breakfast",
  lunch: "lunch",
  dinner: "dinner",
  late: "a late-night snack",
};

export function periodAt(hour: number): Period {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 15 && hour < 21) return "dinner";
  return "late";
}

// The hour where the person is: their browser's zone (a cookie the page
// sets), else the server's own clock (Sydney on Fly).
export function localHour(zone: string | null, now = new Date()): number {
  if (zone) {
    try {
      const h = new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(now);
      const n = Number(h);
      if (Number.isInteger(n) && n >= 0 && n < 24) return n;
    } catch {
      // unknown zone: fall through to the server's clock
    }
  }
  return now.getHours();
}

export function validZone(zone: string | undefined): string | null {
  if (!zone || zone.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(zone)) return null;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

// Which recipes suit each meal of the day.
function fits(r: Recipe, period: Period): boolean {
  const minutes = totalMinutes(r);
  if (period === "breakfast") return r.course === "breakfast";
  if (period === "lunch") return (r.course === "main" || r.course === "starter") && minutes > 0 && minutes <= 40;
  if (period === "dinner") return r.course === "main" || r.course === "";
  return (r.course === "dessert" || r.course === "starter" || r.course === "breakfast") && minutes > 0 && minutes <= 30;
}

const STAPLES = /^(salt|black pepper|pepper|water|sea salt|ice|boiling water|cold water|warm water)$/;

export interface KitchenItem {
  ingredient_id: number;
  name: string;
  quantity: number;
  expiry_date: string | null;
  kept_at: string | null;
}

export interface Suggestion {
  recipe: Recipe;
  period: Period;
  // what it uses from the kitchen, soonest-expiring first
  uses: { name: string; expiry: string | null }[];
  // required ingredients not in the kitchen (staples left out)
  missing: string[];
  // the person's kitchen had something in it
  fromKitchen: boolean;
  reason: string;
}

// Same day, same kitchen, same pick: a stable choice among equals, so the
// home page doesn't reshuffle on every visit.
function dayHash(id: number, day: string): number {
  let h = 2166136261 ^ id;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export function suggestNow(viewerId: number, items: KitchenItem[], hour: number, opts: { day?: string; exclude?: number[] } = {}): Suggestion | null {
  const day = opts.day ?? today();
  const period = periodAt(hour);
  // only usable stock counts (src/expiry.ts): nothing expired and unkept
  const stock = items.filter((it) => it.quantity > 0 && ["fresh", "none", "kept"].includes(expiryState(it, day)));
  const held = new Map<number, KitchenItem>();
  for (const it of stock) {
    const prev = held.get(it.ingredient_id);
    if (!prev || (it.expiry_date ?? "9999") < (prev.expiry_date ?? "9999")) held.set(it.ingredient_id, it);
  }
  const exclude = new Set(opts.exclude ?? []);
  const pool = listVisibleRecipes(viewerId, { limit: 5000 }).filter((r) => fits(r, period) && r.image_url && !exclude.has(r.id));
  if (!pool.length) return null;
  const lines = ingredientsFor(pool.map((r) => r.id));
  const soon = addDays(day, 3);

  let best: { s: Suggestion; score: number } | null = null;
  for (const r of pool) {
    const seen = new Set<number>();
    const required = (lines.get(r.id) ?? []).filter((l: RecipeIngredient) => {
      if (l.optional || STAPLES.test(l.name) || seen.has(l.ingredient_id)) return false;
      seen.add(l.ingredient_id);
      return true;
    });
    if (required.length < 2) continue;
    const used = required.filter((l) => held.has(l.ingredient_id));
    const missing = required.filter((l) => !held.has(l.ingredient_id)).map((l) => l.name);
    let score = dayHash(r.id, day) * 0.5;
    if (held.size) {
      if (!used.length) continue;
      const urgent = used.filter((l) => {
        const e = held.get(l.ingredient_id)!.expiry_date;
        return e !== null && e <= soon;
      }).length;
      // what you have, weighted to what's going off, and how close you are
      score += used.length * 2 + urgent * 4 + (used.length / required.length) * 4 - missing.length * 0.8;
    } else {
      // empty kitchen: something simple for the time of day
      score += -required.length * 0.15 - totalMinutes(r) / 60;
    }
    if (!best || score > best.score) {
      const uses = used
        .map((l) => ({ name: l.name, expiry: held.get(l.ingredient_id)!.expiry_date }))
        .sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999"));
      best = { score, s: { recipe: r, period, uses, missing, fromKitchen: held.size > 0, reason: "" } };
    }
  }
  if (!best && held.size) {
    const plain = suggestNow(viewerId, [], hour, opts);
    if (plain) plain.reason = `Nothing for ${PERIOD_LABEL[period]} uses what's in your kitchen yet, so here's a simple one`;
    return plain;
  }
  if (!best) return null;
  const s = best.s;
  const urgent = s.uses.filter((u) => u.expiry !== null && u.expiry <= soon);
  s.reason = s.fromKitchen
    ? urgent.length
      ? `Uses your ${urgent.slice(0, 2).map((u) => u.name).join(" and ")} before ${urgent.length === 1 ? "it goes" : "they go"} off`
      : `Uses ${s.uses.length} thing${s.uses.length === 1 ? "" : "s"} you already have`
    : `Something simple for ${PERIOD_LABEL[period]}`;
  return s;
}
