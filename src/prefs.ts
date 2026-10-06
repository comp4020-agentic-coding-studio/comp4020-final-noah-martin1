import { one } from "./db.ts";

export interface Prefs {
  weekly_budget_cents: number | null;
  dietary_prefs: string[];
  dislikes: string;
  default_visibility: "public" | "friends" | "private";
  default_servings: number;
}

export function prefsFor(userId: number): Prefs {
  const row = one<Omit<Prefs, "dietary_prefs"> & { dietary_prefs: string }>(
    `SELECT weekly_budget_cents, dietary_prefs, dislikes, default_visibility, default_servings
     FROM users WHERE id = ?`,
    userId,
  )!;
  return { ...row, dietary_prefs: JSON.parse(row.dietary_prefs) };
}
