// Display helpers shared by the views. Dates are ISO yyyy-mm-dd strings
// throughout; "today" is the server's local date (Fly region: Sydney).

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export function qty(n: number | null | undefined, unit = ""): string {
  if (n === null || n === undefined) return unit;
  const num = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return unit ? `${num} ${unit}` : num;
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return isoDate(new Date());
}

export function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

export function addDays(iso: string, n: number): string {
  const d = parseIsoDate(iso)!;
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = parseIsoDate(fromIso)!;
  const b = parseIsoDate(toIso)!;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// Monday of the week containing the date.
export function weekStart(iso: string): string {
  const d = parseIsoDate(iso)!;
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return isoDate(d);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function shortDate(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : iso;
}

export function weekday(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? DAYS[d.getDay()] : "";
}

export type Freshness = "expired" | "soon" | "fresh" | "none";

export const SOON_DAYS = 3;

export function freshness(expiry: string | null): { state: Freshness; label: string } {
  if (!expiry) return { state: "none", label: "No date" };
  const days = daysBetween(today(), expiry);
  if (days < 0) return { state: "expired", label: days === -1 ? "Expired yesterday" : `Expired ${-days}d ago` };
  if (days === 0) return { state: "soon", label: "Expires today" };
  if (days <= SOON_DAYS) return { state: "soon", label: `${days}d left` };
  return { state: "fresh", label: shortDate(expiry) };
}

// "2026-10-06 03:12:00" (SQLite UTC) → "3h ago"
export function ago(sqliteUtc: string): string {
  const then = new Date(sqliteUtc.replace(" ", "T") + "Z").getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : shortDate(sqliteUtc.slice(0, 10));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export const DIETARY_TAGS = [
  "vegetarian",
  "vegan",
  "gluten-free",
  "dairy-free",
  "nut-free",
  "high-protein",
  "quick",
  "budget",
] as const;
