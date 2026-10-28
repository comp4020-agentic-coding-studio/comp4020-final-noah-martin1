import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { userForSession } from "./auth.ts";
import { seedCatalogue } from "./catalogue.ts";
import { db } from "./db.ts";
import { seedVideos } from "./video-seed.ts";
import { DEMO_MODE, seedDemo } from "./demo.ts";
import { startExpirySweep } from "./expiry.ts";
import {
  type Ctx,
  cookie,
  HttpError,
  htmlReply,
  isHttps,
  parseCookies,
  readForm,
  type Reply,
  redirect,
  sameOrigin,
  send,
  text,
} from "./http.ts";
import { html } from "./html.ts";
import { routes as adminRoutes } from "./routes/admin.ts";
import { routes as authRoutes } from "./routes/auth.ts";
import { routes as calendarRoutes } from "./routes/calendar.ts";
import { routes as cookRoutes } from "./routes/cook.ts";
import { routes as friendRoutes } from "./routes/friends.ts";
import { routes as globalRoutes } from "./routes/global.ts";
import { routes as homeRoutes } from "./routes/home.ts";
import { routes as householdRoutes } from "./routes/household.ts";
import { routes as liveRoutes } from "./routes/live.ts";
import { routes as pantryRoutes } from "./routes/pantry.ts";
import { routes as plannerRoutes } from "./routes/planner.ts";
import { routes as profileRoutes } from "./routes/profile.ts";
import { routes as readmeRoutes } from "./routes/readme.ts";
import { routes as recipeRoutes } from "./routes/recipes.ts";
import { routes as scheduleRoutes } from "./routes/schedule.ts";
import { routes as settingsRoutes } from "./routes/settings.ts";
import { routes as shoppingRoutes } from "./routes/shopping.ts";
import { page } from "./views/layout.ts";

export type Handler = (ctx: Ctx) => Reply | Promise<Reply>;

export interface Route {
  method: "GET" | "POST";
  path: string;
  handler: Handler;
  // signed-out visitors are sent to /login rather than reaching the handler
  auth?: boolean;
}

// "/recipes/:id/edit" → a regex with named groups
function compile(path: string): RegExp {
  const pattern = path.replace(/\/:(\w+)/g, "/(?<$1>[^/]+)");
  return new RegExp(`^${pattern}/?$`);
}

const table = [
  ...homeRoutes,
  ...authRoutes,
  ...recipeRoutes,
  ...cookRoutes,
  ...pantryRoutes,
  ...calendarRoutes,
  ...shoppingRoutes,
  ...friendRoutes,
  ...profileRoutes,
  ...householdRoutes,
  ...liveRoutes,
  ...globalRoutes,
  ...scheduleRoutes,
  ...plannerRoutes,
  ...settingsRoutes,
  ...readmeRoutes,
  ...adminRoutes,
].map((r) => ({ ...r, regex: compile(r.path) }));

const STATIC_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(pathname: string): Promise<Reply | null> {
  const name = pathname.slice("/assets/".length);
  // plain path segments only: no "..", no leading dots, nothing outside public/
  if (!/^(?:[\w-]+\/)*[\w-][\w.-]*$/.test(name) || name.includes("..") || !(extname(name) in STATIC_TYPES)) return null;
  try {
    const body = await readFile(new URL(`../public/${name}`, import.meta.url));
    // vendored libraries and textures never change under the same name
    const immutable = name.startsWith("vendor/") || name.startsWith("textures/");
    return {
      status: 200,
      headers: {
        "content-type": STATIC_TYPES[extname(name)],
        "cache-control": immutable ? "public, max-age=86400" : "no-cache",
      },
      body,
    };
  } catch {
    return null;
  }
}

function errorPage(ctx: Ctx, status: number, message: string): Reply {
  const title = status === 404 ? "Not found" : status === 403 ? "Not allowed" : "Something went wrong";
  return htmlReply(
    page(ctx, {
      title,
      body: html`<section class="error-page">
        <p class="eyebrow">Error ${status}</p>
        <h1>${title}</h1>
        <p class="lede">${message}</p>
        <a class="button" href="/">Back home</a>
      </section>`,
    }),
    status,
  );
}

async function handle(ctx: Ctx): Promise<Reply> {
  if (ctx.method === "GET" && ctx.url.pathname.startsWith("/assets/")) {
    return (await serveStatic(ctx.url.pathname)) ?? text("Not found", 404);
  }
  if (ctx.method === "GET" && ctx.url.pathname === "/healthz") return text("ok");

  if (ctx.method === "POST" && !sameOrigin(ctx.req)) {
    return errorPage(ctx, 403, "That form was submitted from another site.");
  }

  let pathMatched = false;
  for (const route of table) {
    const m = route.regex.exec(ctx.url.pathname);
    if (!m) continue;
    pathMatched = true;
    if (route.method !== ctx.method) continue;
    if (route.auth && !ctx.user) {
      return redirect(`/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
    }
    ctx.params = { ...m.groups };
    return await route.handler(ctx);
  }
  return pathMatched
    ? text("Method not allowed", 405)
    : errorPage(ctx, 404, "There's nothing at this address.");
}

const port = Number(process.env.PORT ?? 8080);

const server = createServer(async (req, res) => {
  const started = Date.now();
  const cookies = parseCookies(req.headers.cookie);
  const ctx: Ctx = {
    req,
    url: new URL(req.url ?? "/", "http://localhost"),
    method: req.method ?? "GET",
    params: {},
    user: userForSession(cookies.sid),
    flash: cookies.flash ?? null,
    setCookies: [],
    form: (() => {
      let parsed: Promise<URLSearchParams> | null = null;
      return () => (parsed ??= readForm(req));
    })(),
  };
  // a flash message is shown once
  if (ctx.flash) ctx.setCookies.push(cookie("flash", "", { maxAge: 0, secure: isHttps(req) }));

  let reply: Reply;
  try {
    reply = await handle(ctx);
  } catch (err) {
    if (err instanceof HttpError) {
      reply = errorPage(ctx, err.status, err.message);
    } else {
      console.error(JSON.stringify({ level: "error", event: "request.failed", method: ctx.method, path: ctx.url.pathname, who: ctx.user ? `${ctx.user.username}#${ctx.user.id}` : "guest", error: err instanceof Error ? err.message : String(err) }));
      console.error(err);
      reply = errorPage(ctx, 500, "The server hit an error. It has been logged.");
    }
  }
  // a redirect carries a flash set during this request; don't clear it
  if (reply.status === 303) ctx.setCookies = ctx.setCookies.filter((c) => !c.startsWith("flash=;"));
  send(res, reply, ctx.setCookies);
  // one line per request, with who made it; a stream is logged when it
  // opens. Static assets and health checks would drown the story, so only
  // their failures are logged.
  const quiet = ctx.url.pathname.startsWith("/assets/") || ctx.url.pathname === "/healthz";
  if (!quiet || reply.status >= 400) {
    console.log(`${ctx.method} ${ctx.url.pathname} ${reply.status} ${Date.now() - started}ms ${ctx.user ? `${ctx.user.username}#${ctx.user.id}` : "guest"}${reply.stream ? " (stream)" : ""}`);
  }
});

const catalogued = seedCatalogue();
if (catalogued) console.log(`catalogue: added or revised ${catalogued} recipes`);
const videos = seedVideos();
if (videos) console.log(`videos: updated ${videos} catalogue recipes`);
if (DEMO_MODE) await seedDemo();
startExpirySweep();

server.listen(port, "0.0.0.0", () => {
  console.log(`listening on http://0.0.0.0:${port}`);
});

// Fly stops the machine with SIGINT/SIGTERM; close cleanly so SQLite's WAL is
// checkpointed rather than left for the next boot.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
