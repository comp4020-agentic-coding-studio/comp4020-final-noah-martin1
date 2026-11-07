import { describe, expect, it } from "vitest";
import { allParts, t, withLang } from "../src/i18n.ts";
import { Client, registered } from "./helpers.ts";

// The interface comes in English, Chinese, Spanish and Hindi. English is the
// default and the fallback, so a page with no choice made reads exactly as
// it always has; a chosen language changes the interface, never the facts.

const LANGS = ["zh", "es", "hi"] as const;
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translation tables", () => {
  it("keep every placeholder the English has, and add none", () => {
    for (const part of allParts()) {
      for (const l of LANGS) {
        for (const [en, tr] of Object.entries(part[l])) {
          expect({ en, l, holes: holes(tr) }).toEqual({ en, l, holes: holes(en) });
        }
      }
    }
  });

  it("have no empty lines and no English left untranslated by mistake", () => {
    for (const part of allParts()) {
      for (const l of LANGS) {
        for (const [en, tr] of Object.entries(part[l])) {
          expect(tr.trim(), `${l}: ${en}`).not.toBe("");
          // Chinese and Hindi are in their own scripts; a line that's long
          // English prose there was pasted, not translated
          if (l !== "es" && /[a-z]{4,} [a-z]{4,} [a-z]{4,}/i.test(tr.replace(/\{\w+\}/g, ""))) {
            expect.fail(`${l} line looks untranslated: ${en} → ${tr}`);
          }
        }
      }
    }
  });

  it("say the same line the same way wherever it appears", () => {
    for (const l of LANGS) {
      const seen = new Map<string, string>();
      for (const part of allParts()) {
        for (const [en, tr] of Object.entries(part[l])) {
          if (seen.has(en)) expect(tr, `${l}: ${en}`).toBe(seen.get(en));
          seen.set(en, tr);
        }
      }
    }
  });

  it("fall back to the English for a line with no translation", () => {
    expect(withLang("zh", () => t("A sentence nobody translated"))).toBe("A sentence nobody translated");
    expect(withLang("es", () => t("Hello {name}", { name: "Kai" }))).toBe("Hello Kai");
    expect(t("Recipes")).toBe("Recipes");
  });
});

describe("choosing a language", () => {
  it("is English with no choice and no browser preference", async () => {
    const res = await new Client().get("/login");
    const page = await res.text();
    expect(page).toMatch(/<html lang="en-AU"/);
    expect(page).toContain("Sign in");
    expect(page).toContain('id="i18n">{}</script>');
  });

  it("follows the browser's languages until one is picked", async () => {
    const res = await new Client().request("/recipes", { headers: { "accept-language": "fr-FR, es;q=0.8, en;q=0.5" } });
    const page = await res.text();
    expect(page).toMatch(/<html lang="es"/);
    expect(page).toContain(">Recetas<");
  });

  it("is remembered once picked, on every page, signed in or out", async () => {
    const client = new Client();
    const picked = await client.post("/lang", { lang: "zh" });
    expect(picked.status).toBe(200);
    let page = await (await client.get("/recipes")).text();
    expect(page).toMatch(/<html lang="zh-Hans"/);
    expect(page).toContain(">食谱<");
    // the picker shows the choice, each language named in its own words
    expect(page).toMatch(/<option value="zh" lang="zh-Hans" selected>中文（简体）<\/option>/);
    expect(page).toContain(">हिन्दी</option>");

    const { client: signedIn } = await registered("lang");
    await signedIn.post("/lang", { lang: "hi" });
    page = await (await signedIn.get("/pantry")).text();
    expect(page).toMatch(/<html lang="hi"/);
    expect(page).toContain("फ्रिज और भंडार");
  });

  it("ignores a language the site doesn't have", async () => {
    const client = new Client();
    await client.post("/lang", { lang: "xx" });
    const page = await (await client.request("/login", { headers: { "accept-language": "de" } })).text();
    expect(page).toMatch(/<html lang="en-AU"/);
  });

  it("works without JavaScript: the picker is a form with its own button", async () => {
    const page = await (await new Client().get("/login")).text();
    expect(page).toMatch(/<form class="lang-picker" method="post" action="\/lang"/);
    expect(page).toMatch(/<button[^>]*type="submit"[^>]*data-lang-go>Change<\/button>/);
  });

  it("translates error pages too", async () => {
    const client = new Client();
    await client.post("/lang", { lang: "es" });
    const res = await client.get("/no-such-page-here");
    expect(res.status).toBe(404);
    const page = await res.text();
    expect(page).toContain("No encontrado");
    expect(page).toContain("No hay nada en esta dirección.");
  });
});
