import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { Client, createRecipe, registered } from "./helpers.ts";

const catalogue: { title: string; servings: number; ingredients: { name: string; quantity: number | null; unit: string }[] }[] = JSON.parse(
  readFileSync(new URL("../src/data/catalogue.json", import.meta.url), "utf8"),
);

// The recipe catalogue is the part of the site anyone can use: browse,
// search and read without an account. Private recipes stay private.
describe("recipes", () => {
  it("anyone can browse and open catalogue recipes without signing in", async () => {
    const guest = new Client();
    const res = await guest.get("/recipes");
    expect(res.status).toBe(200);
    const doc = new JSDOM(await res.text()).window.document;
    const tiles = [...doc.querySelectorAll<HTMLAnchorElement>("a.rx-tile")];
    expect(tiles.length).toBeGreaterThanOrEqual(40);

    const detail = await guest.get(tiles[0].getAttribute("href")!);
    expect(detail.status).toBe(200);
    const page = await detail.text();
    expect(page).toContain("Ingredients");
    expect(page).toContain("Method");
    expect(page).toContain("kcal");
  });

  it("search matches ingredients as well as titles", async () => {
    const res = await new Client().get("/recipes?q=chickpeas&partial=1");
    expect(res.status).toBe(200);
    expect(Number(res.headers.get("x-result-count"))).toBeGreaterThan(0);
    expect(await res.text()).toMatch(/Falafel|Fajitas|Koshari/);
  });

  it("a private recipe never shows up in someone else's browse or search", async () => {
    const author = await registered("author");
    const title = `Secret sauce ${author.username}`;
    await createRecipe(author.client, title, "private");
    const stranger = await registered("stranger");
    // search for a word from the title, so the page echoing the query back
    // can't be mistaken for the recipe appearing
    const tiles = async (client: Client, path: string) =>
      [...new JSDOM(await (await client.get(path)).text()).window.document.querySelectorAll("a.rx-tile h3")].map((h) => h.textContent);
    expect(await tiles(stranger.client, `/recipes?q=${author.username}`)).not.toContain(title);
    expect(await tiles(new Client(), `/recipes?q=${author.username}`)).not.toContain(title);
    expect(await tiles(new Client(), "/recipes")).not.toContain(title);
    expect(await tiles(author.client, "/recipes?tab=mine")).toContain(title);
  });

  it("cook mode works for a guest on a public recipe and scales the amounts", async () => {
    const guest = new Client();
    const doc = new JSDOM(await (await guest.get("/recipes?q=pad+thai")).text()).window.document;
    const href = doc.querySelector<HTMLAnchorElement>("a.rx-tile")!.getAttribute("href")!;
    // the noodles in grams, from the catalogue, so this tests scaling, not one version of the recipe
    const padThai = catalogue.find((r) => r.title === "Pad Thai")!;
    const noodles = padThai.ingredients.find((i) => i.name === "rice noodles" && i.unit === "g")!.quantity!;
    const base = await (await guest.get(`${href}/cook`)).text();
    const doubled = await (await guest.get(`${href}/cook?serves=${padThai.servings * 2}`)).text();
    expect(base).toContain("Step 1 of");
    expect(base).toContain(`${noodles} g`);
    expect(doubled).toContain(`${noodles * 2} g`);
  });
});
