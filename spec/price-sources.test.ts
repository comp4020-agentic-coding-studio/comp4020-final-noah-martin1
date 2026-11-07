import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { seedCatalogue } from "../src/catalogue.ts";
import { all, ingredientId, one } from "../src/db.ts";
import { type PriceSource, priceSources } from "../src/products.ts";
import { choosePack, costToMake, packOptions, recipePurchase, toBase } from "../src/pricing.ts";
import { ingredientsFor } from "../src/recipes.ts";
import { Client, registered, uploadPhoto } from "./helpers.ts";

// Every ingredient priced from a supermarket product checked by hand, a
// stand-in that says so, another ingredient it's bought as, a dated
// estimate, or nothing on purpose (src/data/price-sources.json), and the
// pages that show it: the recipe's three costs, the editor's price prompt,
// the "from my kitchen" filter. CLAUDE.md task: meals read cheap because
// ingredients were missing from the price (a lamb bake at $5.50 with no lamb).

const sources = priceSources();
type Entry = [string, PriceSource];
const entries = Object.entries(sources) as Entry[];

describe("the checked price data", () => {
  it("every entry is exactly one kind, and every product is real and dated", () => {
    for (const [name, s] of entries) {
      const kinds = ["products", "similar", "from", "estimate", "reference", "free"].filter((k) => (s as Record<string, unknown>)[k]);
      expect(kinds, name).toHaveLength(1);
      for (const p of [...(s.products ?? []), ...(s.similar?.products ?? [])]) {
        expect(p.url, `${name}: ${p.name}`).toMatch(/^https:\/\/www\.(woolworths|aldi)\.com\.au\//);
        expect(p.priceCents, `${name}: ${p.name}`).toBeGreaterThan(0);
        expect(p.size.amount, `${name}: ${p.name}`).toBeGreaterThan(0);
        expect(p.checkedAt, `${name}: ${p.name}`).toMatch(/^\d{4}-\d{2}-\d{2}/);
      }
    }
  });

  it("a stand-in always says what it's priced as", () => {
    for (const [name, s] of entries) if (s.similar) expect(s.similar.note.length, name).toBeGreaterThan(10);
  });

  it("an estimate names its shop and when it was read", () => {
    for (const [name, s] of entries) {
      if (!s.estimate) continue;
      expect(s.estimate.source.length, name).toBeGreaterThan(2);
      expect(s.estimate.checked, name).toMatch(/^\d{4}-\d{2}/);
      expect(s.estimate.centsPer100, name).toBeGreaterThan(0);
    }
  });

  it("no product prices two names: the same food under another name links to it", () => {
    const owner = new Map<string, string>();
    for (const [name, s] of entries) {
      for (const p of [...(s.products ?? []), ...(s.similar?.products ?? [])]) {
        const prev = owner.get(p.url);
        expect(prev === undefined || prev === name, `${p.name} prices "${prev}" and "${name}"`).toBe(true);
        owner.set(p.url, name);
      }
    }
  });

  it("every 'bought as' link ends at a priced ingredient, without loops", () => {
    for (const [name, s] of entries) {
      if (!s.from) continue;
      let k = s.from.ingredient;
      const seen = new Set([name]);
      while (sources[k]?.from) {
        expect(seen.has(k), `${name} loops at ${k}`).toBe(false);
        seen.add(k);
        k = sources[k].from!.ingredient;
      }
      expect(s.from.parent, name).toBeGreaterThan(0);
      expect(["g", "ml", "each"]).toContain(s.from.unit);
    }
  });

  it("water is free", () => {
    expect(sources.water).toEqual({ free: true });
  });
});

// On this file's own throwaway database (spec/unit-db.ts), never the app's.
describe("coverage of the catalogue", () => {
  seedCatalogue();
  const names = all<{ name: string; example: string | null }>(
    `SELECT i.name, (SELECT ri.quantity || ' ' || ri.unit FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id AND ri.quantity IS NOT NULL LIMIT 1) AS example
     FROM ingredients i WHERE EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id)`,
  );

  it("every catalogue ingredient has a checked price source (charcoal isn't food)", () => {
    const missing = names.map((n) => n.name).filter((n) => !sources[n] && n !== "charcoal");
    expect(missing).toEqual([]);
  });

  it("a typical recipe amount of nearly every ingredient can be bought", () => {
    const unbuyable: string[] = [];
    for (const { name, example } of names) {
      if (!example || sources[name]?.free) continue;
      const [q, ...u] = example.split(" ");
      const base = toBase(Number(q), u.join(" "), name);
      if (!base || !choosePack(base, packOptions(null, -1, name), name).best) unbuyable.push(name);
    }
    // a few counted things with no weight per piece (a "half" breadfruit) are
    // named as unpriced on the page rather than guessed
    expect(unbuyable.length, unbuyable.join(", ")).toBeLessThan(25);
  });

  it("no catalogue recipe costs nothing to make, and few leave anything out", () => {
    const recipes = all<{ id: number; title: string }>("SELECT id, title FROM recipes WHERE source IS NOT NULL");
    const lines = ingredientsFor(recipes.map((r) => r.id));
    let short = 0;
    for (const r of recipes) {
      const made = costToMake((lines.get(r.id) ?? []).filter((l) => !l.optional));
      expect(made.cents, r.title).toBeGreaterThan(0);
      if (made.unpriced.length) short++;
    }
    expect(short / recipes.length).toBeLessThan(0.08);
  });

  it("a reused recipe id (same second, new ingredients) never gets the old recipe's cached cost", () => {
    const egg = { ingredient_id: ingredientId("eggs"), name: "eggs", quantity: 2, unit: "", optional: 0 };
    const odd = { ingredient_id: ingredientId("zzcache unknownium"), name: "zzcache unknownium", quantity: 10, unit: "g", optional: 0 };
    const key = "999999@2026-01-01 00:00:00";
    expect(costToMake([egg], key).unpriced).toEqual([]);
    expect(costToMake([egg, odd], key).unpriced).toEqual(["zzcache unknownium"]);
  });

  it("Tavë Kosi buys a whole lamb shoulder roast, not a lamb bake with no lamb", () => {
    const r = one<{ id: number }>("SELECT id FROM recipes WHERE title LIKE 'Tav% Kosi%' AND source IS NOT NULL")!;
    const lines = ingredientsFor([r.id]).get(r.id)!;
    const plan = recipePurchase(null, lines, 1, [], "Tavë Kosi");
    const lamb = plan.toBuy.find((l) => l.name === "lamb shoulder")!;
    expect(lamb.pack?.option.product).toMatch(/Lamb Shoulder Roast/);
    // a whole roast of 1.1-1.7 kg at $18/kg: about $25, not 350 g's worth
    expect(lamb.pack!.costCents).toBeGreaterThan(2000);
    expect(plan.purchaseCents).toBeGreaterThan(4000);
    // and the dish's own share of it still counts what's used
    expect(lamb.consumptionCents).toBeGreaterThan(500);
    expect(lamb.consumptionCents).toBeLessThan(900);
  });

  it("two egg yolks buy a carton of eggs; tap water is never bought", () => {
    const plan = recipePurchase(
      null,
      [
        { ingredient_id: one<{ id: number }>("SELECT id FROM ingredients WHERE name = 'egg yolks'")!.id, name: "egg yolks", quantity: 2, unit: "", optional: 0 },
        { ingredient_id: one<{ id: number }>("SELECT id FROM ingredients WHERE name = 'water'")!.id, name: "water", quantity: 500, unit: "ml", optional: 0 },
      ],
      1,
      [],
      "custard",
    );
    const yolks = plan.toBuy.find((l) => l.name === "egg yolks")!;
    expect(yolks.pack?.option.product).toMatch(/egg/i);
    expect(yolks.pack!.count).toBe(1);
    expect(plan.toBuy.some((l) => l.name === "water")).toBe(false);
    expect(plan.covered.some((l) => l.name === "water")).toBe(true);
    expect(plan.unpriced).toBe(0);
  });

  it("a spoon of a solid buys its pack by weight, but grams are never bought by the litre", () => {
    // three tablespoons of butter come out of a 250 g block
    const butter = choosePack(toBase(3, "tbsp", "butter")!, packOptions(null, -1, "butter"), "butter").best;
    expect(butter?.option.size?.unit).toBe("g");
    expect(butter?.count).toBe(1);
  });
});

describe("a recipe page's costs", () => {
  async function recipePage(client: Client, title: string) {
    const list = new JSDOM(await (await client.get(`/recipes?q=${encodeURIComponent(title)}`)).text()).window.document;
    const href = list.querySelector("a.rx-tile")!.getAttribute("href")!;
    return new JSDOM(await (await client.get(href)).text()).window.document;
  }

  it("shows cost to make and the checkout from an empty kitchen, named for what they are", async () => {
    const d = await recipePage(new Client(), "Tavë Kosi");
    const card = d.querySelector(".rd-buy")!;
    const labels = [...card.querySelectorAll(".cost-split dt")].map((t) => t.textContent!.trim());
    expect(labels).toEqual(["Cost to make", "At the checkout"]);
    // the old, confusing pair is gone
    expect(d.body.textContent).not.toContain("Recipe uses");
    expect(d.body.textContent).not.toContain("Ingredients used");
    // the lamb is in what you'd buy
    expect(card.textContent).toMatch(/Lamb Shoulder Roast/);
    const make = Number(card.querySelector("[data-scale-cost]")!.getAttribute("data-base"));
    const checkout = Number(card.querySelector("[data-recipe-purchase]")!.getAttribute("data-recipe-purchase"));
    expect(checkout).toBeGreaterThan(make);
  });

  it("signed in, it adds the checkout after your pantry", async () => {
    const { client } = await registered("cost");
    await client.post("/pantry", { name: "lamb shoulder", quantity: "1", unit: "kg", expiry_date: "2030-01-01", price: "" });
    const card = (await recipePage(client, "Tavë Kosi")).querySelector(".rd-buy")!;
    expect([...card.querySelectorAll(".cost-split dt")].map((t) => t.textContent!.trim())).toEqual(["Cost to make", "At the checkout", "After your pantry"]);
    const empty = Number(card.querySelector("[data-recipe-purchase]")!.getAttribute("data-recipe-purchase"));
    const mine = Number(card.querySelector("[data-recipe-purchase-mine]")!.getAttribute("data-recipe-purchase-mine"));
    // holding the lamb saves the whole roast
    expect(empty - mine).toBeGreaterThan(2000);
  });

  it("names any ingredient with no price instead of leaving it out quietly", async () => {
    const { client } = await registered("unpriced");
    const odd = `zzunknownium dust ${Date.now()}`;
    const res = await client.post("/recipes/new", {
      image_ref: await uploadPhoto(client),
      title: `Dusted eggs ${Date.now()}`,
      description: "",
      servings: "2",
      visibility: "private",
      ing_name: ["eggs", odd],
      ing_qty: ["2", "10"],
      ing_unit: ["", "g"],
      step_text: ["Cook."],
      step_minutes: [""],
    });
    const d = new JSDOM(await res.text()).window.document;
    const note = d.querySelector(".rd-unpriced")?.textContent ?? "";
    expect(note).toContain(odd);
    expect(note).toMatch(/isn't in these totals/);
    // the per-serve figure says it's a floor, not the whole cost
    expect(d.querySelector(".cost-row")?.textContent).toMatch(/\+/);
  });
});

describe("pricing an ingredient while writing a recipe", () => {
  const json = { accept: "application/json" };

  it("says what Larder prices an ingredient at, and asks when it doesn't know", async () => {
    const { client } = await registered("hint");
    const hint = async (name: string) => (await client.request(`/prices/hint?name=${encodeURIComponent(name)}`, { headers: json })).json() as Promise<{ kind: string; label: string; perText: string | null; note: string | null }>;
    const bay = await hint("bay leaf");
    expect(bay.kind).toBe("product");
    expect(bay.label).toMatch(/^Woolworths: .*Bay Leaves/);
    expect(bay.perText).toMatch(/^\$\d+\.\d\d per 100 g$/);
    expect((await hint("water")).kind).toBe("free");
    const monk = await hint("monkfish");
    expect(monk.kind).toBe("from");
    expect(monk.note).toMatch(/monkfish/);
    expect((await hint(`zz unheard of ${Date.now()}`)).kind).toBe("unknown");
  });

  it("records a price someone gives, for them only, and refuses nonsense", async () => {
    const a = await registered("pricer");
    const b = await registered("other");
    const name = `zz rare root ${Date.now()}`;
    const post = (who: typeof a, fields: Record<string, string>) =>
      who.client.request("/prices", { method: "POST", headers: { ...json, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
    expect((await post(a, { name, price: "-2", quantity: "100", unit: "g" })).status).toBe(422);
    expect((await post(a, { name, price: "3", quantity: "0", unit: "g" })).status).toBe(422);
    expect((await post(a, { name, price: "3", quantity: "100", unit: "bucket" })).status).toBe(422);
    const ok = await post(a, { name, price: "4.50", quantity: "250", unit: "g", store: "ALDI" });
    expect(ok.status).toBe(200);
    const mine = (await (await a.client.request(`/prices/hint?name=${encodeURIComponent(name)}`, { headers: json })).json()) as { yours: { text: string } | null };
    expect(mine.yours?.text).toBe("$4.50 for 250 g at ALDI");
    // someone else's prices don't change
    const theirs = (await (await b.client.request(`/prices/hint?name=${encodeURIComponent(name)}`, { headers: json })).json()) as { yours: unknown; kind: string };
    expect(theirs.yours).toBeNull();
    expect(theirs.kind).toBe("unknown");
  });

  it("the editor has a place under each ingredient for its price", async () => {
    const { client } = await registered("editor");
    const d = new JSDOM(await (await client.get("/recipes/new")).text()).window.document;
    expect(d.querySelectorAll('[data-rows="ingredients"] [data-row] [data-price-hint]').length).toBeGreaterThan(0);
    expect(d.querySelector("[data-price-help]")?.textContent).toMatch(/what you paid/);
  });

  it("price posts need a signed-in person", async () => {
    const res = await new Client().request("/prices", { method: "POST", headers: { ...json, "content-type": "application/x-www-form-urlencoded" }, body: "name=salt&price=1&quantity=1&unit=kg" });
    expect(res.status).toBe(401);
  });
});

describe("cooking with what you have", () => {
  it("lists recipes you can make first, then those missing one or two, and names what's missing", async () => {
    const { client } = await registered("cookwith");
    // the makings of a Spanish tortilla (eggs, potato, onion), plus olive oil
    for (const [name, quantity, unit] of [["eggs", "12", ""], ["potato", "2", "kg"], ["onion", "1", "kg"], ["olive oil", "1", "l"]]) {
      await client.post("/pantry", { name, quantity, unit, expiry_date: "2030-01-01", price: "" });
    }
    const d = new JSDOM(await (await client.get("/recipes?have=1")).text()).window.document;
    expect(d.querySelector("[data-results-heading]")?.textContent).toBe("From your kitchen");
    const chip = [...d.querySelectorAll<HTMLAnchorElement>("a.rx-chip")].find((a) => a.textContent!.includes("From my kitchen"))!;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    // groups in order, each tile saying what it still needs
    const groups = [...d.querySelectorAll(".rx-group")].map((g) => g.textContent!.trim());
    expect(groups.length).toBeGreaterThan(0);
    const order = ["You have everything", "Missing one ingredient", "Missing two"];
    expect(groups.map((g) => order.indexOf(g))).toEqual([...groups.map((g) => order.indexOf(g))].sort((a, b) => a - b));
    const notes = [...d.querySelectorAll(".rx-kitchen")].map((n) => n.textContent!.trim());
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n).toMatch(/^(You have all \d+|Need .+)$/);
    // no tile needs more than two things, and salt or water never count
    for (const n of notes.filter((x) => x.startsWith("Need "))) {
      expect(n.replace(/^Need /, "").split(" and ").length).toBeLessThanOrEqual(2);
      expect(n).not.toMatch(/\b(salt|water)\b/);
    }
  });

  it("isn't offered to visitors, and an empty kitchen says how to fill it", async () => {
    const guest = new JSDOM(await (await new Client().get("/recipes")).text()).window.document;
    expect([...guest.querySelectorAll("a.rx-chip")].some((a) => a.textContent!.includes("From my kitchen"))).toBe(false);
    const { client } = await registered("emptyk");
    const d = new JSDOM(await (await client.get("/recipes?have=1")).text()).window.document;
    expect(d.querySelector(".rx-empty")?.textContent).toMatch(/Add what's in your fridge/);
  });
});
