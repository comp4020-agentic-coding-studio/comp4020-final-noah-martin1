import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { one, run } from "./db.ts";
import type { User } from "./http.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString("base64url");
  run(
    `INSERT INTO auth_sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
    token,
    userId,
  );
  return token;
}

export function userForSession(token: string | undefined): User | null {
  if (!token) return null;
  return (
    one<User>(
      `SELECT u.id, u.username, u.display_name FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
      token,
    ) ?? null
  );
}

export function destroySession(token: string | undefined): void {
  if (token) run("DELETE FROM auth_sessions WHERE token = ?", token);
}

export const USERNAME = /^[a-z0-9_]{3,24}$/;
