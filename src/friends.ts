import { all, one, run } from "./db.ts";

export interface Person {
  id: number;
  username: string;
  display_name: string;
}

export interface Friendship {
  id: number;
  status: "pending" | "accepted";
  requested_by: number;
}

function pair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

export function findUser(username: string): Person | undefined {
  return one<Person>("SELECT id, username, display_name FROM users WHERE username = ?", username.toLowerCase());
}

export function friendship(a: number, b: number): Friendship | undefined {
  const [lo, hi] = pair(a, b);
  return one<Friendship>("SELECT id, status, requested_by FROM friendships WHERE user_a = ? AND user_b = ?", lo, hi);
}

export type RequestOutcome = "sent" | "accepted" | "already-friends" | "already-sent" | "self";

// Asking someone who has already asked you is the second side acting, so it
// accepts. A friendship is only ever accepted once both people have acted
// (CLAUDE.md invariant 5).
export function requestFriend(me: number, other: number): RequestOutcome {
  if (me === other) return "self";
  const existing = friendship(me, other);
  if (existing?.status === "accepted") return "already-friends";
  if (existing && existing.requested_by === me) return "already-sent";
  if (existing) {
    run("UPDATE friendships SET status = 'accepted', responded_at = datetime('now') WHERE id = ?", existing.id);
    return "accepted";
  }
  const [lo, hi] = pair(me, other);
  run("INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES (?, ?, 'pending', ?)", lo, hi, me);
  return "sent";
}

// Only the person who did NOT send the request can accept it.
export function acceptFriend(me: number, other: number): boolean {
  const f = friendship(me, other);
  if (!f || f.status !== "pending" || f.requested_by === me) return false;
  return (
    run(
      "UPDATE friendships SET status = 'accepted', responded_at = datetime('now') WHERE id = ? AND status = 'pending' AND requested_by != ?",
      f.id,
      me,
    ).changes > 0
  );
}

// Declining, cancelling and unfriending all remove the row; either side may.
export function removeFriendship(me: number, other: number): boolean {
  const [lo, hi] = pair(me, other);
  return run("DELETE FROM friendships WHERE user_a = ? AND user_b = ?", lo, hi).changes > 0;
}

export interface Connection extends Person {
  status: "pending" | "accepted";
  requested_by: number;
  since: string;
}

export function connections(me: number): Connection[] {
  return all<Connection>(
    `SELECT u.id, u.username, u.display_name, f.status, f.requested_by,
            COALESCE(f.responded_at, f.created_at) AS since
     FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
     WHERE f.user_a = ? OR f.user_b = ?
     ORDER BY u.display_name`,
    me,
    me,
    me,
  );
}

export function searchPeople(me: number, query: string): Person[] {
  const q = `%${query.toLowerCase()}%`;
  return all<Person>(
    `SELECT id, username, display_name FROM users
     WHERE id != ? AND (username LIKE ? OR lower(display_name) LIKE ?)
     ORDER BY username LIMIT 20`,
    me,
    q,
    q,
  );
}
