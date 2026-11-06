// Every catalogue ingredient through the app's own pricing engine: which have
// a pack to buy, which can't buy a typical recipe amount, which have no
// price at all. Run on a throwaway database, never the app's:
//   DATA_DIR=$(mktemp -d) node scripts/price-audit.ts audit.json
import { writeFileSync } from "node:fs";
import { all } from "../src/db.ts";
import { seedCatalogue } from "../src/catalogue.ts";
import { estimate, referencePrice } from "../src/nutrition.ts";
import { equivalentProducts, productsFor } from "../src/products.ts";
import { packOptions, choosePack, toBase } from "../src/pricing.ts";

seedCatalogue();
const rows = all<{ name: string; recipes: number; units: string; example: string }>(
  `SELECT i.name, COUNT(DISTINCT ri.recipe_id) AS recipes, GROUP_CONCAT(DISTINCT ri.unit) AS units,
          (SELECT ri2.quantity || ' ' || ri2.unit FROM recipe_ingredients ri2 WHERE ri2.ingredient_id = i.id AND ri2.quantity IS NOT NULL LIMIT 1) AS example
   FROM ingredients i JOIN recipe_ingredients ri ON ri.ingredient_id = i.id GROUP BY i.id ORDER BY recipes DESC`,
);
const out = rows.map((r) => {
  const ref = referencePrice(r.name);
  const listings = equivalentProducts(r.name).filter((p) => p.available);
  const raw = productsFor(r.name).length;
  const opts = packOptions(null, -1, r.name);
  // can a typical recipe amount be bought?
  const [q, ...u] = (r.example ?? "").split(" ");
  const base = q ? toBase(Number(q), u.join(" "), r.name) : null;
  const buy = base ? choosePack(base, opts, r.name).best : null;
  const est = q ? estimate([{ name: r.name, quantity: Number(q), unit: u.join(" ") }]) : null;
  return {
    name: r.name,
    recipes: r.recipes,
    units: r.units,
    example: r.example,
    ref: ref ? ref.source.slice(0, 80) : null,
    listings: listings.length,
    rawListings: raw,
    options: opts.length,
    buyable: !!buy,
    buyVia: buy ? `${buy.option.kind}:${buy.option.retailer}:${buy.option.product.slice(0, 50)}` : null,
    consumption: est ? (est.counted ? "priced" : "unknown") : "no-amount",
  };
});
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
const n = out.length;
const c = (f: (x: (typeof out)[number]) => boolean) => out.filter(f).length;
console.log(JSON.stringify({
  ingredients: n,
  noPackOption: c((x) => x.options === 0),
  noRef: c((x) => !x.ref),
  noRefNoListing: c((x) => !x.ref && x.listings === 0),
  exampleNotBuyable: c((x) => x.example !== null && !x.buyable),
  consumptionUnknown: c((x) => x.consumption === "unknown"),
  recipeLinesAffected: out.filter((x) => x.options === 0).reduce((s, x) => s + x.recipes, 0),
}));
