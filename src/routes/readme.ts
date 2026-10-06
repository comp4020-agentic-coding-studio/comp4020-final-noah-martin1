import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { marked } from "marked";
import { html, raw } from "../html.ts";
import { HttpError, htmlReply } from "../http.ts";
import type { Route } from "../server.ts";
import { page } from "../views/layout.ts";

const root = new URL("../../", import.meta.url);

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export const routes: Route[] = [
  {
    method: "GET",
    path: "/readme",
    handler: async (ctx) => {
      // README.md is ours, not user input, so its rendered HTML goes in raw.
      // Read per request: it's small, and a stale cached copy would fail the
      // heading check after an edit.
      const md = await readFile(new URL("README.md", root), "utf8");
      const rendered = await marked.parse(md);
      return htmlReply(
        page(ctx, { title: "About", body: html`<article class="prose">${raw(rendered)}</article>` }),
      );
    },
  },
  {
    // README images are linked relatively (docs/x.png) so they render on
    // GitHub; from /readme/ that resolves here.
    method: "GET",
    path: "/readme/docs/:file",
    handler: async (ctx) => {
      const file = ctx.params.file ?? "";
      const type = IMAGE_TYPES[extname(file).toLowerCase()];
      if (!/^[\w.-]+$/.test(file) || !type) throw new HttpError(404, "No such image.");
      try {
        const body = await readFile(new URL(`docs/${file}`, root));
        return { status: 200, headers: { "content-type": type, "cache-control": "no-cache" }, body };
      } catch {
        throw new HttpError(404, "No such image.");
      }
    },
  },
];
