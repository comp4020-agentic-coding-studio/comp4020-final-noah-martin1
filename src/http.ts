import type { IncomingMessage, ServerResponse } from "node:http";
import type { Html } from "./html.ts";

export interface User {
  id: number;
  username: string;
  display_name: string;
}

export interface Ctx {
  req: IncomingMessage;
  url: URL;
  method: string;
  params: Record<string, string>;
  user: User | null;
  // one-shot message carried across a redirect in a cookie
  flash: string | null;
  // cookies set while handling the request, sent with whatever reply wins
  setCookies: string[];
  form: () => Promise<URLSearchParams>;
}

export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
  // a long-lived response (Server-Sent Events): called once the headers are
  // written, and owns the response from then on (writes, ends, cleans up)
  stream?: (res: ServerResponse) => void;
}

export function json(body: unknown, status = 200): Reply {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

export function htmlReply(body: Html, status = 200): Reply {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: "<!doctype html>" + body.value,
  };
}

export function redirect(location: string): Reply {
  return { status: 303, headers: { location }, body: "" };
}

export function text(body: string, status = 200): Reply {
  return { status, headers: { "content-type": "text/plain; charset=utf-8" }, body };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (header ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    const key = pair.slice(0, at).trim();
    try {
      out[key] = decodeURIComponent(pair.slice(at + 1).trim());
    } catch {
      // a malformed cookie is ignored rather than failing the request
    }
  }
  return out;
}

interface CookieOptions {
  maxAge?: number;
  secure: boolean;
}

export function cookie(name: string, value: string, { maxAge, secure }: CookieOptions): string {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (secure) c += "; Secure";
  return c;
}

// Fly's proxy terminates TLS and forwards plain http, so the original scheme
// is only visible in this header.
export function isHttps(req: IncomingMessage): boolean {
  return req.headers["x-forwarded-proto"] === "https";
}

export function setFlash(ctx: Ctx, message: string): void {
  ctx.setCookies.push(cookie("flash", message, { maxAge: 60, secure: isHttps(ctx.req) }));
}

const MAX_BODY = 64 * 1024;

export async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Form too large");
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// A cross-site form post would carry an Origin that isn't us. SameSite=Lax
// already keeps the session cookie off such requests; this is the second lock.
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function send(res: ServerResponse, reply: Reply, cookies: string[]): void {
  const headers: Record<string, string | string[]> = { ...reply.headers };
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(reply.status, headers);
  if (reply.stream) {
    res.flushHeaders();
    reply.stream(res);
    return;
  }
  res.end(reply.body);
}
