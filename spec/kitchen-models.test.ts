import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatalogueRecipe } from "../src/catalogue.ts";
import { normaliseIngredient } from "../src/db.ts";
import { NAMED_INGREDIENTS, shelfware } from "../src/kitchen.ts";

// What each ingredient looks like in the 3D fridge and pantry (src/kitchen.ts
// decides, public/kitchen-models.mjs draws). The point is that you can tell
// what's in your kitchen from a glance at it, so: every common ingredient has
// a look of its own, no two of them look the same unless they're the same
// food, and the word rules don't mistake one thing for another ("butter
// beans" aren't butter). Pure functions; no server needed.

const catalogue: CatalogueRecipe[] = JSON.parse(readFileSync(new URL("../src/data/catalogue.json", import.meta.url), "utf8"));
const uses = new Map<string, number>();
for (const r of catalogue) for (const name of new Set(r.ingredients.map((i) => normaliseIngredient(i.name)))) uses.set(name, (uses.get(name) ?? 0) + 1);
const common = [...uses].filter(([, n]) => n >= 5).map(([name]) => name);

// names that are the same food, so share a look on purpose
const SAME_FOOD = [
  ["aubergine", "eggplant"],
  ["courgette", "zucchini"],
  ["corn cob", "sweetcorn"],
  ["capsicum", "red capsicum"],
  ["cream", "thickened cream"],
  ["spinach", "baby spinach"],
  ["lemon", "lemon zest"],
  ["orange", "orange zest"],
  ["eggs", "egg yolks", "egg whites"],
  ["tomato ketchup", "tomato sauce"],
  ["white wine", "dry white wine"],
  ["black olives", "pitted black olives"],
  ["tomato paste", "tomato puree"],
  ["ginger garlic paste", "ginger and garlic"],
  ["cinnamon", "ground cinnamon"],
  ["cloves", "ground cloves"],
  ["chilli flakes", "red chilli flakes"],
  ["oregano", "dried oregano"],
  ["five spice", "chinese five spice powder"],
];
const sameFood = (a: string, b: string) => SAME_FOOD.some((g) => g.includes(a) && g.includes(b));

describe("every common ingredient has a look of its own", () => {
  it("the catalogue's common ingredients (five recipes or more) are each in the table by name", () => {
    expect(common.length).toBeGreaterThan(200);
    const missing = common.filter((name) => !NAMED_INGREDIENTS.includes(name));
    expect(missing).toEqual([]);
  });

  it("no two of them look the same unless they're the same food", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const name of NAMED_INGREDIENTS) {
      const w = shelfware(name, "");
      const key = JSON.stringify([w.place, w.model, w.look]);
      const other = seen.get(key);
      if (other && !sameFood(other, name)) clashes.push(`${other} = ${name}`);
      else seen.set(key, name);
    }
    expect(clashes).toEqual([]);
  });

  it("packaged food carries its own name on the label", () => {
    const packaged = new Set(["jar", "bottle", "can", "carton", "box", "sack", "pouch", "spice", "bar", "milk", "tub"]);
    for (const name of common) {
      const w = shelfware(name, "");
      if (packaged.has(w.model)) expect(w.look.label, name).toBeTruthy();
    }
  });
});

describe("things that are easy to get wrong", () => {
  const look = (name: string) => shelfware(name, "");

  it("peanut butter is a jar with a peanut on it, not a block of butter", () => {
    expect(look("peanut butter")).toMatchObject({ place: "pantry", model: "jar", look: { variant: "peanut" } });
    expect(look("crunchy peanut butter").model).toBe("jar");
    expect(look("butter").model).toBe("butter");
  });

  it("a word naming one thing inside another doesn't make it that thing", () => {
    expect(look("butter beans").model).toBe("can");
    expect(look("chicken stock").model).toBe("carton");
    expect(look("beef stock cube").model).toBe("box");
    expect(look("ground ginger").model).toBe("spice");
    expect(look("ginger").model).toBe("ginger");
    expect(look("fish sauce").model).toBe("bottle");
    expect(look("coconut milk").model).toBe("can");
    expect(look("water spinach").model).toBe("leaves");
    expect(look("red bell pepper").model).toBe("capsicum");
    expect(look("black pepper").model).toBe("spice");
    expect(look("potato starch").model).toBe("box");
    expect(look("glacé cherries").model).toBe("jar");
    expect(look("dried wild mushrooms").model).toBe("pouch");
    expect(look("refried beans").model).toBe("can");
  });

  it("produce looks like itself: a lemon isn't an orange isn't an onion", () => {
    const shapes = ["lemon", "orange", "lime", "onion", "garlic", "potato", "tomato", "apple", "carrot", "broccoli", "banana"].map((n) => {
      const w = look(n);
      return `${w.model}/${w.look.variant ?? ""}/${w.look.colour ?? ""}`;
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("meat sits on a tray in its own cut", () => {
    const cuts = ["beef mince", "chicken breast", "chicken thigh", "bacon", "salmon fillet", "prawns", "sausages", "ham", "lamb chops", "steak"].map((n) => look(n));
    for (const c of cuts) expect(c.model).toBe("tray");
    expect(new Set(cuts.map((c) => c.look.variant)).size).toBeGreaterThanOrEqual(9);
  });

  it("the same name always looks the same (deterministic), whatever its case or spacing", () => {
    expect(look("  Peanut   Butter ")).toEqual(look("peanut butter"));
    expect(look("Some Unknown Relish")).toEqual(look("some unknown relish"));
  });
});

describe("every look can be drawn", () => {
  const source = readFileSync(new URL("../public/kitchen-models.mjs", import.meta.url), "utf8");
  const built = new Set(
    source
      .match(/export const BUILD = \{([^}]*)\}/)![1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  it("the scene has a builder for every model the table uses", () => {
    const names = [...NAMED_INGREDIENTS, ...uses.keys()];
    const models = new Set(names.map((n) => shelfware(n, "").model));
    for (const m of models) expect(built.has(m), m).toBe(true);
  });

  it("every produce model goes in the crisper, and nothing else does", () => {
    const produce = new Set(
      source
        .match(/export const PRODUCE = new Set\(\[([^\]]*)\]\)/)![1]
        .split(",")
        .map((s) => s.trim().replace(/"/g, ""))
        .filter(Boolean),
    );
    expect(produce.has("citrus") && produce.has("herbs")).toBe(true);
    for (const packaged of ["jar", "bottle", "tray", "milk", "can"]) expect(produce.has(packaged), packaged).toBe(false);
  });
});
