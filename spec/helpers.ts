import { randomBytes } from "node:crypto";
import { inject } from "vitest";

// A tiny browser stand-in: keeps cookies, follows redirects by hand so each
// hop's Set-Cookie lands in the jar, and posts forms the way a page would.
export class Client {
  readonly base = inject("baseUrl");
  private jar = new Map<string, string>();

  private store(res: Response): void {
    for (const header of res.headers.getSetCookie()) {
      const [pair, ...attrs] = header.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (expired || value === "") this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  // a cookie the page's own script would set (the time zone, say)
  setCookie(name: string, value: string): void {
    this.jar.set(name, encodeURIComponent(value));
  }

  private cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async request(path: string, init: RequestInit = {}): Promise<Response & { finalUrl: string }> {
    let url = new URL(path, this.base);
    let res: Response;
    let opts: RequestInit = init;
    for (let hops = 0; ; hops++) {
      res = await fetch(url, {
        ...opts,
        redirect: "manual",
        headers: { ...(opts.headers as Record<string, string>), cookie: this.cookieHeader() },
      });
      this.store(res);
      const location = res.headers.get("location");
      if (!location || res.status < 300 || res.status >= 400 || hops > 5) break;
      url = new URL(location, url);
      opts = {};
    }
    return Object.assign(res, { finalUrl: url.pathname + url.search });
  }

  get(path: string) {
    return this.request(path);
  }

  post(path: string, fields: Record<string, string | string[]> = {}) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
    }
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  }
}

export function uniqueName(prefix = "t"): string {
  return `${prefix}_${randomBytes(5).toString("hex")}`;
}

export const PASSWORD = "correct horse battery";

export async function registered(prefix = "t"): Promise<{ client: Client; username: string }> {
  const client = new Client();
  const username = uniqueName(prefix);
  const res = await client.post("/register", { username, display_name: `Test ${username}`, password: PASSWORD });
  if (res.status !== 200 || res.finalUrl !== "/") throw new Error(`registering ${username} failed: ${res.status}`);
  return { client, username };
}

export async function befriend(a: { client: Client; username: string }, b: { client: Client; username: string }) {
  await a.client.post(`/friends/${b.username}/request`);
  const res = await b.client.post(`/friends/${a.username}/accept`);
  if (res.status !== 200) throw new Error(`friendship ${a.username}–${b.username} failed: ${res.status}`);
}

// A small, valid 320 × 240 PNG: every recipe needs a photo.
export const DISH_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAUAAAADwCAIAAAD+Tyo8AAACEUlEQVR42u3TQQkAAAgEwesfxSTGMYId/AkDk2BhM13AU5EADAwYGDAwGBgwMGBgwMBgYMDAgIHBwICBAQMDBgYDAwYGDAwYGAwMGBgwMBgYMDBgYMDAYGDAwICBAQODgQEDAwYGAwMGBgwMGBgMDBgYMDAYWAUwMGBgwMBgYMDAgIEBA4OBAQMDBgYDAwYGDAwYGAwMGBgwMGBgMDBgYMDAYGDAwICBAQODgQEDAwYGDAwGBgwMGBgMDBgYMDBgYDAwYGDAwGBgwMCAgQEDg4EBAwMGBgwMBgYMDBgYDAwYGDAwYGAwMGBgwMCAgcHAgIEBA4OBAQMDBgYMDAYGDAwYGDAwGBgwMGBgMDBgYMDAgIHBwICBAQODgQEDAwYGDAwGBgwMGBgwMBgYMDBgYDAwYGDAwICBwcCAgQEDAwYGAwMGBgwMBgYMDBgYMDAYGDAwYGAwsApgYMDAgIHBwICBAQMDBgYDAwYGDAwGBgwMGBgwMBgYMDBgYMDAYGDAwICBwcCAgQEDAwYGAwMGBgwMGBgMDBgYMDAYGDAwYGDAwGBgwMCAgcHAgIEBAwMGBgMDBgYMDBgYDAwYGDAwGBgwMGBgwMBgYMDAgIEBA4OBAQMDBgYDAwYGDAwYGAwMGBgwMGBgMDBgYMDAYGDAwICBAQODgQEDAwYGAwMGBgwMGBgMDBgYMDBgYDAwYGDgbgExTQHmrarPiQAAAABJRU5ErkJggg==",
  "base64",
);

// Uploads a photo the way the recipe form's script does; returns its /images/<id>.
export async function uploadPhoto(client: Client, bytes: Buffer = DISH_PNG, type = "image/png"): Promise<string> {
  const res = await client.request("/images", { method: "POST", headers: { "content-type": type, accept: "application/json" }, body: new Uint8Array(bytes) });
  const body = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(`photo upload failed: ${res.status} ${body.error}`);
  return body.url;
}

// Creates a recipe and returns its id, read from the redirect to /recipes/:id.
export async function createRecipe(client: Client, title: string, visibility: "public" | "friends" | "private") {
  const image_ref = await uploadPhoto(client);
  const res = await client.post("/recipes/new", {
    image_ref,
    title,
    description: "A test recipe",
    servings: "2",
    visibility,
    ing_name: ["eggs", "spinach"],
    ing_qty: ["3", "100"],
    ing_unit: ["", "g"],
    step_text: ["Whisk the eggs.", "Cook with the spinach."],
    step_minutes: ["2", "5"],
  });
  const id = res.finalUrl.match(/^\/recipes\/(\d+)$/)?.[1];
  if (res.status !== 200 || !id) throw new Error(`creating recipe failed: ${res.status} ${res.finalUrl}`);
  return Number(id);
}

// Today as the server sees it (both run in the same timezone: the container
// in CI, this machine locally).
export function localToday(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
