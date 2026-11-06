// What Larder knows about an ingredient's price, in words a cook can read:
// a supermarket product, a stand-in product ("no store sells monkfish:
// priced as basa"), another ingredient it comes from (egg yolks from eggs), a
// dated estimate, free (tap water), or nothing. Shown on recipe pages next to
// the cost, and in the recipe editor so an author sees what each ingredient
// costs and can correct it. Deterministic: read from src/data/price-sources.json,
// the searched listings and the dated reference prices, never from a model.

import { useRate } from "./nutrition.ts";
import { equivalentProducts, isFree, priceSources, priceSourceFor, type Product, unitPrice } from "./products.ts";

export type PriceKind = "product" | "similar" | "from" | "estimate" | "reference" | "free" | "unknown";

export interface PriceNote {
  kind: PriceKind;
  // a short phrase: "Woolworths: Hoyt's Bay Leaves 15g", "estimate", "free"
  label: string;
  // the sentence a recipe shows for a stand-in, a derived food or an estimate
  note: string | null;
  // cents per 100 g (or 100 ml) of use, when known
  centsPer100: number | null;
  // where a product lives, to check or correct it
  url: string | null;
}

const STORE: Record<string, string> = { woolworths: "Woolworths", aldi: "ALDI" };

export function priceNote(name: string): PriceNote {
  if (isFree(name)) return { kind: "free", label: "free (tap water)", note: null, centsPer100: 0, url: null };
  const curated = priceSourceFor(name);
  const rate = useRate(name);
  const per100 = rate ? Math.round(rate.centsPerGram * 100 * 100) / 100 : null;
  const s = curated?.source;
  // an ingredient bought as another (egg yolks as eggs, monkfish as white
  // fish): its own note says why, when it has one
  if (curated?.via.length) {
    const own = priceSources()[curated.via[0]]?.from;
    return { kind: "from", label: `bought as ${own?.ingredient ?? curated.key}`, note: own?.note && !/^bought as /i.test(own.note) ? own.note : null, centsPer100: per100, url: null };
  }
  if (s?.similar?.products.length) {
    const p = cheapest(s.similar.products);
    return { kind: "similar", label: `${STORE[p.retailer] ?? p.retailer}: ${p.name}`, note: s.similar.note, centsPer100: per100, url: p.url };
  }
  if (s?.estimate) {
    return { kind: "estimate", label: "estimate", note: `Estimate: ${s.estimate.source} (${s.estimate.checked}).`, centsPer100: per100, url: null };
  }
  const products = equivalentProducts(name).filter((p) => p.available);
  if (products.length) {
    const p = cheapest(products);
    return { kind: "product", label: `${STORE[p.retailer] ?? p.retailer}: ${p.name}`, note: null, centsPer100: per100, url: p.url };
  }
  if (rate) return { kind: "reference", label: "dated reference price", note: null, centsPer100: per100, url: null };
  return { kind: "unknown", label: "no price known", note: null, centsPer100: null, url: null };
}

function cheapest(list: Product[]): Product {
  return [...list].sort((a, b) => unitPrice(a) - unitPrice(b))[0];
}
