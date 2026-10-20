#!/usr/bin/env node
// Who did what, from the activity log, newest last. For narrating at the
// crit or tracing a problem:
//
//   node scripts/activity.ts            last 50 entries
//   node scripts/activity.ts --follow   then keep printing new ones
//   node scripts/activity.ts --user alice --limit 200
//
// Reads $DATA_DIR/app.db (./data locally; on Fly, run it inside the machine:
// `fly ssh console -C "node scripts/activity.ts --follow"`). Read-only.
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};
const follow = args.includes("--follow");
const limit = Number(flag("limit") ?? 50) || 50;
const user = flag("user");
const db = new DatabaseSync(join(process.env.DATA_DIR ?? "./data", "app.db"), { readOnly: true });

interface Row {
  id: number;
  at: string;
  username: string | null;
  action: string;
  outcome: string;
  subject: string;
  detail: string;
}

const sql = `SELECT a.id, a.at, u.username, a.action, a.outcome, a.subject, a.detail
  FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
  WHERE a.id > ? ${user ? "AND u.username = ?" : ""} ORDER BY a.id DESC LIMIT ?`;

function fetch(since: number, n: number): Row[] {
  const params: (number | string)[] = [since];
  if (user) params.push(user);
  params.push(n);
  return (db.prepare(sql).all(...params) as unknown as Row[]).reverse();
}

function print(r: Row): void {
  const detail = Object.entries(JSON.parse(r.detail) as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== false && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const flagText = r.outcome === "ok" ? "" : ` [${r.outcome.toUpperCase()}]`;
  console.log(`${r.at.slice(0, 19).replace("T", " ")}  ${(r.username ?? "system").padEnd(14)} ${r.action}${flagText}${r.subject ? `  "${r.subject}"` : ""}${detail ? `  ${detail}` : ""}`);
}

let last = 0;
for (const r of fetch(0, limit)) {
  print(r);
  last = r.id;
}
if (follow) {
  setInterval(() => {
    for (const r of fetch(last, 500)) {
      print(r);
      last = r.id;
    }
  }, 1000);
}
