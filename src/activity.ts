import { all, run } from "./db.ts";

// Who did what, server-side. Every entry goes two places: a row in
// activity_log (on the volume, so it outlives restarts, redeploys and the
// crit) and one JSON line on stdout, which is what `fly logs` streams. Only
// ids, usernames, short subjects (a recipe title, an ingredient) and counts
// are recorded: never passwords, tokens, session ids, locations finer than a
// city, or free text someone typed.

export type Outcome = "ok" | "denied" | "failed";

export interface ActivityInput {
  actor?: { id: number; username: string } | null;
  action: string;
  outcome?: Outcome;
  subject?: string;
  detail?: Record<string, string | number | boolean | null>;
}

const SENSITIVE = /pass|token|secret|cookie|sid|lat|lng|email/i;

function clean(detail: ActivityInput["detail"] = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SENSITIVE.test(k)) continue;
    out[k] = typeof v === "string" ? v.slice(0, 120) : v;
  }
  return out;
}

export function logActivity(input: ActivityInput): void {
  const detail = clean(input.detail);
  const subject = (input.subject ?? "").slice(0, 120);
  const outcome = input.outcome ?? "ok";
  try {
    run(
      "INSERT INTO activity_log (actor_id, action, outcome, subject, detail) VALUES (?, ?, ?, ?, ?)",
      input.actor?.id ?? null,
      input.action,
      outcome,
      subject,
      JSON.stringify(detail),
    );
  } catch (err) {
    // the log must never break the action it describes
    console.error(JSON.stringify({ level: "error", event: "activity.write_failed", action: input.action, error: String(err) }));
  }
  const line = {
    level: outcome === "failed" ? "error" : outcome === "denied" ? "warn" : "info",
    event: input.action,
    who: input.actor ? `${input.actor.username}#${input.actor.id}` : "system",
    outcome,
    ...(subject ? { subject } : {}),
    ...detail,
  };
  (outcome === "failed" ? console.error : console.log)(JSON.stringify(line));
}

export interface ActivityRow {
  id: number;
  at: string;
  actor_id: number | null;
  username: string | null;
  action: string;
  outcome: Outcome;
  subject: string;
  detail: string;
}

// One person's own trail, newest first (the settings page shows it).
export function activityFor(userId: number, limit = 30): ActivityRow[] {
  return all<ActivityRow>(
    `SELECT a.*, u.username FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.actor_id = ? ORDER BY a.id DESC LIMIT ?`,
    userId,
    limit,
  );
}

// Everyone's, for the operator's command-line view (scripts/activity.ts).
export function recentActivity(limit = 100, sinceId = 0): ActivityRow[] {
  return all<ActivityRow>(
    `SELECT a.*, u.username FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.id > ? ORDER BY a.id DESC LIMIT ?`,
    sinceId,
    limit,
  ).reverse();
}

// Plain-English labels for the actions, so the trail reads as a story.
export const ACTION_LABEL: Record<string, string> = {
  "auth.register": "Created an account",
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.logout": "Signed out",
  "recipe.create": "Wrote a recipe",
  "recipe.update": "Edited a recipe",
  "recipe.delete": "Deleted a recipe",
  "recipe.image_rejected": "Recipe photo rejected",
  "pantry.add": "Added to the kitchen",
  "pantry.update": "Updated a kitchen item",
  "pantry.remove": "Removed a kitchen item",
  "pantry.keep": "Still has an expired item",
  "pantry.gone": "Confirmed an item is gone",
  "pantry.auto_remove": "Expired item removed automatically",
  "calendar.plan": "Planned a meal",
  "calendar.status": "Changed a planned meal",
  "calendar.remove": "Removed a planned meal",
  "live.start": "Went live",
  "live.auto_start": "Went live automatically",
  "live.end": "Ended a live session",
  "live.question": "Asked a cook a question",
  "live.answer": "Answered a question",
  "settings.update": "Changed settings",
  "prices.record": "Recorded a price paid",
  "prices.refresh": "Refreshed supermarket prices",
  "prices.refresh_failed": "Supermarket price refresh failed",
  "friends.request": "Sent a friend request",
  "friends.accept": "Accepted a friend",
  "household.join": "Joined a household",
};
