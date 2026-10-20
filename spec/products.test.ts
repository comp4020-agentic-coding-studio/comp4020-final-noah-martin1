import { describe, expect, it } from "vitest";
import { dataAge, loadProducts, matchesIngredient, parseSize, productsFor } from "../src/products.ts";

describe("parseSize", () => {
  it("normalises mass and volume", () => {
    expect(parseSize("2kg")).toEqual({ amount: 2000, unit: "g" });
    expect(parseSize("500 g")).toEqual({ amount: 500, unit: "g" });
    expect(parseSize("600mL")).toEqual({ amount: 600, unit: "ml" });
    expect(parseSize("1.5L")).toEqual({ amount: 1500, unit: "ml" });
    expect(parseSize("Woolworths Full Cream Milk 3L")).toEqual({ amount: 3000, unit: "ml" });
  });
  it("totals multipacks and counts", () => {
    expect(parseSize("4 x 125g")).toEqual({ amount: 500, unit: "g" });
    expect(parseSize("12 pack")).toEqual({ amount: 12, unit: "each" });
    expect(parseSize("dozen")).toEqual({ amount: 12, unit: "each" });
  });
  it("gives no size for loose per-kg produce or nonsense", () => {
    expect(parseSize("$3.90 per kg")).toBeNull();
    expect(parseSize("")).toBeNull();
    expect(parseSize("each")).toEqual({ amount: 1, unit: "each" });
    expect(parseSize("some bananas")).toBeNull();
  });
});

describe("matchesIngredient", () => {
  it("accepts the plain product", () => {
    expect(matchesIngredient("plain flour", "White Mill Plain Flour 2kg")).toBe(true);
    expect(matchesIngredient("eggs", "Free Range Egg 12 pack")).toBe(true);
  });
  it("rejects different foods", () => {
    expect(matchesIngredient("chicken breast", "Chicken Stock Liquid 1L")).toBe(false);
    expect(matchesIngredient("milk", "Coconut Milk 400ml")).toBe(false);
    expect(matchesIngredient("milk", "Milk Chocolate Block 200g")).toBe(false);
    expect(matchesIngredient("butter", "Peanut Butter 375g")).toBe(false);
    expect(matchesIngredient("potato", "Potato Chips 150g")).toBe(false);
  });
  it("keeps what the ingredient itself asks for", () => {
    expect(matchesIngredient("coconut milk", "Coconut Milk 400ml")).toBe(true);
    expect(matchesIngredient("chicken stock", "Chicken Stock 1L")).toBe(true);
  });
});

describe("productsFor", () => {
  const data = loadProducts();
  const key = Object.keys(data.products).find((k) => !k.endsWith("s") && data.products[k].length);
  it("finds by exact key, plural and a longer name containing the key", () => {
    expect(productsFor("no such ingredient xyz")).toEqual([]);
    expect(productsFor("")).toEqual([]);
    if (!key) return;
    expect(productsFor(key)).toBe(data.products[key]);
    expect(productsFor(key.toUpperCase())).toBe(data.products[key]);
    expect(productsFor(`${key}s`).length).toBeGreaterThan(0);
    expect(productsFor(`finely chopped ${key}`).length).toBeGreaterThan(0);
  });
});

describe("the committed product data", () => {
  const data = loadProducts();
  it("says when it was read", () => {
    expect(dataAge().generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it("has well-formed products from real retailer pages", () => {
    let n = 0;
    for (const list of Object.values(data.products)) {
      for (const p of list) {
        n++;
        const host = p.retailer === "woolworths" ? "https://www.woolworths.com.au/" : "https://www.aldi.com.au/";
        expect(p.url.startsWith(host), p.url).toBe(true);
        expect(Number.isInteger(p.priceCents) && p.priceCents > 0, p.name).toBe(true);
        expect(p.size.amount > 0 && ["g", "ml", "each"].includes(p.size.unit), p.name).toBe(true);
        expect(Number.isNaN(Date.parse(p.checkedAt)), p.name).toBe(false);
        expect(typeof p.available).toBe("boolean");
        expect(p.name.length).toBeGreaterThan(2);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});
