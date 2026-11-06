import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { Client } from "./helpers.ts";

// Pages lay themselves out by the width of the page column, not the window.
// With the sidebar showing, a 1000px window leaves a page about 650px: less
// than a phone held sideways. Layouts keyed to the window kept their desktop
// columns there and squeezed (a recipe's method went to a sliver and the page
// scrolled sideways), so page layouts use `@container main`. A window-width
// @media query is only for what really follows the window: the app shell,
// full-screen pages (cook mode, the globe, the fridge, the landing page) and
// things pinned to the screen.

const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");

// selectors that may sit in a window-width @media block
const WINDOW_LEVEL = [
  /^\.sidebar\b/, /^\.topbar\b/, /^\.tabbar\b/, /^\.main\b/, /^\.public-bar\b/, /^\.public-main\b/, /^h1$/, /^\.form-actions$/,
  /^\.cm-/, /^\.gl\b/, /^\.gl-/, /^\.public \.gl-/, /^\.kx\b/, /^\.kx-/, /^\.kx\./, /^\.ld-/, /^\.public-main\.main-landing/,
  /^\.hh-toasts$/, /^\.cal-menu\b/,
];

// top-level @media (min|max-width) blocks, each with its rules' selectors
function windowBlocks(text: string): { query: string; selectors: string[] }[] {
  const out: { query: string; selectors: string[] }[] = [];
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of plain.matchAll(/^@media \(((?:max|min)-width: \d+px)\) \{/gm)) {
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    const start = i + 1;
    for (; i < plain.length; i++) {
      if (plain[i] === "{") depth++;
      else if (plain[i] === "}" && --depth === 0) break;
    }
    const body = plain.slice(start, i);
    const selectors: string[] = [];
    // the selector text before each top-level "{" in the block
    let d = 0;
    let from = 0;
    for (let j = 0; j < body.length; j++) {
      if (body[j] === "{") {
        if (d === 0) selectors.push(...body.slice(from, j).split(",").map((s) => s.trim()).filter(Boolean));
        d++;
      } else if (body[j] === "}") {
        d--;
        if (d === 0) from = j + 1;
      }
    }
    out.push({ query: m[1], selectors });
  }
  return out;
}

describe("page widths", () => {
  it("page layouts follow the page column (@container main), not the window", () => {
    const strays = windowBlocks(css).flatMap((b) =>
      b.selectors
        .filter((s) => !/^(from|to|\d+%)$/.test(s) && !s.startsWith("@keyframes"))
        .filter((s) => !WINDOW_LEVEL.some((re) => re.test(s)))
        .map((s) => `${s}  (in @media ${b.query})`),
    );
    expect(strays).toEqual([]);
  });

  it("the page column is the container those layouts query, signed in or out", () => {
    expect(css).toMatch(/\.main \{[^}]*container: main \/ inline-size/);
    expect(css).toMatch(/\.public-main \{[^}]*container: main \/ inline-size/);
  });

  it("a recipe page puts the ingredients, method and the other cards in their own areas", async () => {
    const guest = new Client();
    const list = new JSDOM(await (await guest.get("/recipes?q=pad+thai")).text()).window.document;
    const href = list.querySelector("a.rx-tile")!.getAttribute("href")!;
    const d = new JSDOM(await (await guest.get(href)).text()).window.document;
    const body = d.querySelector(".rd-body")!;
    expect(body.querySelector(":scope > .rd-side-a #ingredients-h")).not.toBeNull();
    expect(body.querySelector(":scope > .rd-main #method-h")).not.toBeNull();
    expect(body.querySelector(":scope > .rd-side-b #nutrition-h")).not.toBeNull();
  });
});
