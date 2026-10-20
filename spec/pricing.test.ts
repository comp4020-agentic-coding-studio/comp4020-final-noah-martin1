import { describe, expect, it } from "vitest";
import { choosePack, convert, type PackOption, purchasePlan, referenceOption, toBase } from "../src/pricing.ts";

// The package-purchase engine in isolation (src/pricing.ts). These run in
// the test process: no server, no database writes.

const NOW = "2026-10-20T00:00:00Z";
const pack = (retailer: string, priceCents: number, amount: number, unit: "g" | "ml" | "each", over: Partial<PackOption> = {}): PackOption => ({
  kind: "retailer",
  retailer,
  product: `${retailer} ${amount}${unit}`,
  url: `https://example.test/${retailer}`,
  priceCents,
  size: { amount, unit },
  checked: NOW,
  available: true,
  ...over,
});

const FLOUR_1KG = pack("Woolworths", 300, 1000, "g");
const need = (name: string, quantity: number | null, unit: string, meal = "Bread", id = 1) => ({ ingredient_id: id, name, category: "pantry", quantity, unit, meal });

describe("package purchases", () => {
  it("200 g of flour with none at home buys the whole $3 bag, and uses $0.60 of it", () => {
    const plan = purchasePlan([need("plain flour", 200, "g")], [], () => [FLOUR_1KG]);
    expect(plan.toBuy).toHaveLength(1);
    expect(plan.toBuy[0].pack?.count).toBe(1);
    expect(plan.purchaseCents).toBe(300);
    expect(plan.consumptionCents).toBe(60);
  });

  it("buys nothing when the pantry already holds enough", () => {
    const plan = purchasePlan([need("plain flour", 200, "g")], [{ ingredient_id: 1, quantity: 500, unit: "g" }], () => [FLOUR_1KG]);
    expect(plan.toBuy).toHaveLength(0);
    expect(plan.covered).toHaveLength(1);
    expect(plan.purchaseCents).toBe(0);
  });

  it("buys only for the shortfall when stock is insufficient, rounding up to whole packs", () => {
    const plan = purchasePlan([need("plain flour", 2300, "g")], [{ ingredient_id: 1, quantity: 500, unit: "g" }], () => [FLOUR_1KG]);
    expect(plan.toBuy[0].toBuy).toBe(1800);
    expect(plan.toBuy[0].pack?.count).toBe(2);
    expect(plan.purchaseCents).toBe(600);
  });

  it("two recipes needing the same ingredient share one bag rather than buying two", () => {
    const plan = purchasePlan([need("plain flour", 300, "g", "Bread"), need("plain flour", 400, "g", "Pancakes")], [], () => [FLOUR_1KG]);
    expect(plan.toBuy).toHaveLength(1);
    expect(plan.toBuy[0].meals).toEqual(["Bread", "Pancakes"]);
    expect(plan.toBuy[0].pack?.count).toBe(1);
    expect(plan.purchaseCents).toBe(300);
  });

  it("adds compatible units together (kg + g, l + ml + tbsp) before choosing packs", () => {
    const flour = purchasePlan([need("plain flour", 0.5, "kg"), need("plain flour", 600, "g")], [], () => [FLOUR_1KG]);
    expect(flour.toBuy[0].toBuy).toBe(1100);
    expect(flour.toBuy[0].pack?.count).toBe(2);
    const milk = purchasePlan([need("milk", 1, "l", "A", 2), need("milk", 250, "ml", "B", 2), need("milk", 2, "tbsp", "C", 2)], [{ ingredient_id: 2, quantity: 0.5, unit: "l" }], () => [pack("ALDI", 339, 2000, "ml")]);
    expect(milk.toBuy[0].toBuy).toBe(780);
    expect(milk.purchaseCents).toBe(339);
  });

  it("never converts mass to volume or count without the ingredient's own conversion", () => {
    // no density is listed for flour: a 1 L pack can't serve a gram amount
    expect(convert({ amount: 200, unit: "g", approx: false }, "ml", "plain flour")).toBeNull();
    const plan = purchasePlan([need("plain flour", 200, "g")], [], () => [pack("ALDI", 250, 1000, "ml")]);
    expect(plan.toBuy[0].pack).toBeNull();
    expect(plan.unpriced).toBe(1);
    expect(plan.purchaseCents).toBe(0);
    // milk has a listed density, so millilitres can be compared with grams
    expect(convert({ amount: 1030, unit: "g", approx: false }, "ml", "milk")?.amount).toBeCloseTo(1000, 0);
  });

  it("a pantry quantity in an incomparable unit is flagged, not subtracted", () => {
    const plan = purchasePlan([need("plain flour", 200, "g")], [{ ingredient_id: 1, quantity: 1, unit: "jar" }], () => [FLOUR_1KG]);
    expect(plan.toBuy[0].otherUnit).toBe(true);
    expect(plan.toBuy[0].toBuy).toBe(200);
  });

  it("an ingredient with no known pack price is unpriced, never free, and kept out of the checkout total", () => {
    const plan = purchasePlan([need("dragonfruit powder", 50, "g")], [], () => []);
    expect(plan.toBuy[0].pack).toBeNull();
    expect(plan.unpriced).toBe(1);
    expect(plan.purchaseCents).toBe(0);
  });

  it("recommends the cheaper retailer for the same amount, comparing packs like for like", () => {
    // 1.5 kg needed: two 1 kg bags at $3 = $6, versus one 2 kg bag at $4.50
    const { best, all } = choosePack({ amount: 1500, unit: "g", approx: false }, [FLOUR_1KG, pack("ALDI", 450, 2000, "g")], "plain flour");
    expect(best?.option.retailer).toBe("ALDI");
    expect(best?.costCents).toBe(450);
    expect(all.map((c) => c.costCents)).toEqual([450, 600]);
    expect(best?.why).toMatch(/ALDI saves \$1\.50/);
  });

  it("prefers less waste when two options cost the same", () => {
    const { best } = choosePack({ amount: 500, unit: "g", approx: false }, [pack("A", 300, 2000, "g"), pack("B", 300, 500, "g")], "plain flour");
    expect(best?.option.retailer).toBe("B");
  });

  it("uses a cheaper price the user paid for the same pack size", () => {
    const yours = pack("", 250, 1000, "g", { kind: "user", url: null, checked: "2026-10-01" });
    const { best } = choosePack({ amount: 200, unit: "g", approx: false }, [FLOUR_1KG, yours], "plain flour");
    expect(best?.option.kind).toBe("user");
    expect(best?.costCents).toBe(250);
  });

  it("doesn't stretch a user's price to a different pack size", () => {
    // they paid $2 for 500 g; 1.5 kg needs three of those ($6), not $2 × 1.5/0.5 at some other size
    const yours = pack("", 200, 500, "g", { kind: "user", url: null });
    const { best } = choosePack({ amount: 1500, unit: "g", approx: false }, [yours], "plain flour");
    expect(best?.count).toBe(3);
    expect(best?.costCents).toBe(600);
  });

  it("a higher shelf price never replaces a cheaper user price", () => {
    const yours = pack("", 280, 1000, "g", { kind: "user", url: null });
    const { best } = choosePack({ amount: 900, unit: "g", approx: false }, [pack("Woolworths", 450, 1000, "g"), yours], "plain flour");
    expect(best?.option.kind).toBe("user");
  });

  it("loose produce is priced by weight without inventing a pack", () => {
    const loose: PackOption = { ...pack("Woolworths", 390, 1000, "g"), size: null };
    const { best } = choosePack({ amount: 600, unit: "g", approx: false }, [loose], "banana");
    expect(best?.count).toBeNull();
    expect(best?.costCents).toBe(234);
  });

  it("scaling servings changes requirements and purchases consistently", () => {
    const one = purchasePlan([need("plain flour", 600, "g")], [], () => [FLOUR_1KG]);
    const two = purchasePlan([need("plain flour", 1200, "g")], [], () => [FLOUR_1KG]);
    expect(one.purchaseCents).toBe(300);
    expect(two.purchaseCents).toBe(600);
    expect(two.consumptionCents).toBe(one.consumptionCents * 2);
  });
});

describe("units and reference packs", () => {
  it("reads base amounts only through exact or listed conversions", () => {
    expect(toBase(2, "kg", "rice")).toEqual({ amount: 2000, unit: "g", approx: false });
    expect(toBase(3, "tbsp", "olive oil")).toEqual({ amount: 45, unit: "ml", approx: false });
    expect(toBase(1, "cup", "plain flour")).toEqual({ amount: 125, unit: "g", approx: false });
    expect(toBase(3, "", "eggs")).toEqual({ amount: 3, unit: "each", approx: false });
    expect(toBase(2, "clove", "garlic")?.approx).toBe(true);
    expect(toBase(1, "glug", "olive oil")).toBeNull();
  });

  it("turns a dated shelf reading into a pack, and refuses 'typical' prices", () => {
    const flour = referenceOption("plain flour");
    expect(flour?.size).toEqual({ amount: 2000, unit: "g" });
    expect(flour?.priceCents).toBe(239);
    expect(flour?.retailer).toBe("ALDI");
    expect(flour?.checked).toMatch(/^\d{4}-\d{2}$/);
    // "Typical Woolworths price" rows carry no pack to buy
    expect(referenceOption("beef brisket")).toBeNull();
  });
});

describe("one ingredient across incompatible lines", () => {
  it("a 'to taste' line shares the pack another line buys instead of buying a second", () => {
    const vanilla = pack("Woolworths", 400, 50, "ml");
    const plan = purchasePlan([need("vanilla extract", 2, "tsp", "Cake", 9), need("vanilla extract", null, "", "Custard", 9)], [], () => [vanilla]);
    expect(plan.purchaseCents).toBe(400);
    expect(plan.toBuy.filter((l) => l.pack)).toHaveLength(1);
    expect(plan.toBuy.find((l) => l.need === null)?.sharesPack).toBe(true);
  });

  it("a second unit fits into the first pack's leftover when a conversion exists", () => {
    // milk has a listed density: 250 ml and 100 g both come out of one 2 L bottle
    const plan = purchasePlan([need("milk", 250, "ml", "A", 2), need("milk", 100, "g", "B", 2)], [], () => [pack("ALDI", 339, 2000, "ml")]);
    expect(plan.purchaseCents).toBe(339);
  });
});
