import { describe, expect, it } from "vitest";
import { dataAge, loadProducts, matchesIngredient, parseSize, productsFor, equivalentProducts, isEquivalent } from "../src/products.ts";

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

describe("like-for-like products", () => {
  it.each([
    ["lemon", "Woolworths Lemon & Pepper Tuna 95g"],
    ["garlic", "BAKERS LIFE Garlic Naan 2 Pack 250g"],
    ["garlic", "COLWAY Garlic Aioli 260g"],
    ["onion", "PORTVIEW Tomato & Onion Tuna 95g"],
    ["prawns", "URBAN EATS Prawn Gyoza 750g"],
    ["prawns", "Just Caught Garlic Prawns 500g"],
    ["coriander", "Hoyt's Coriander Ground 25g"],
    ["cream", "Woolworths Sour Cream 300mL"],
    ["cream", "FARMDALE Full Cream Milk 3L"],
    ["chicken breast", "FARMWOOD Chicken Breast Kyiv 2 Pack 350g"],
    ["lime", "Bosisto's Desert Lime & Eucalyptus Hand Wash 500mL"],
    ["bay leaf", "2PK Christy Sovereign Bath Mat Combed Cotton 1000GSM Plush Luxurious Bay Leaf"],
    ["spinach", "Borg's Triangles Spinach & Ricotta 360g"],
    ["tomato", "Woolworths Essentials Diced Tomatoes 400g"],
    ["mixed berries", "DOMINION NATURALS Ropes Mixed Berry 8 Pack 160g"],
  ])("%s is not %s", (ingredient, product) => {
    expect(isEquivalent(ingredient, product)).toBe(false);
  });

  it.each([
    ["plain flour", "White Wings Plain Flour 2kg"],
    ["plain flour", "WHITE MILL Plain Flour 2kg"],
    ["onion", "Woolworths Brown Onions Bag 2kg"],
    ["lemon", "Lemons 5 Pack"],
    ["eggs", "Woolworths 12 Pack Extra Large Cage Free Eggs 700g"],
    ["canned tomatoes", "Woolworths Essentials Diced Tomatoes 400g"],
    ["garlic", "Woolworths Minced Garlic 500g"],
    ["parmesan", "Perfect Italiano Parmesan Cheese Grated 250g"],
    ["coriander", "Coriander Bunch"],
    ["milk", "Woolworths Full Cream Milk 2L"],
  ])("%s can be bought as %s", (ingredient, product) => {
    expect(isEquivalent(ingredient, product)).toBe(true);
  });

  it("every product offered for an ingredient passes the like-for-like rule", () => {
    for (const name of ["plain flour", "onion", "lemon", "prawns", "cream", "garlic", "milk", "rice"]) {
      for (const p of equivalentProducts(name)) expect(isEquivalent(name, p.name), `${name} → ${p.name}`).toBe(true);
    }
  });
});
