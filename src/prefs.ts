import { one } from "./db.ts";

export interface Prefs {
  weekly_budget_cents: number | null;
  dietary_prefs: string[];
  dislikes: string;
  default_visibility: "public" | "friends" | "private";
  default_servings: number;
  // start cooking live automatically (default on) and where an automatic
  // session appears: a city key, or "" for "listed, not on the map"
  auto_live: boolean;
  live_city: string;
}

export function prefsFor(userId: number): Prefs {
  const row = one<Omit<Prefs, "dietary_prefs" | "auto_live"> & { dietary_prefs: string; auto_live: number }>(
    `SELECT weekly_budget_cents, dietary_prefs, dislikes, default_visibility, default_servings, auto_live, live_city
     FROM users WHERE id = ?`,
    userId,
  )!;
  return { ...row, dietary_prefs: JSON.parse(row.dietary_prefs), auto_live: !!row.auto_live };
}
