// Barcode lookup through Open Food Facts, an open product database. It
// gives a product name and an exact pack size; which catalogue ingredient
// that product is stays the app's decision (resolveName), since the name is
// usually a brand ("Nutella"). No match, a timeout or an unreadable code is
// said plainly and the person types the item instead.

import { catalogueHas, learnedNames, resolveName } from "./fridge-scan.ts";
import type { ResultRow } from "./scan-jobs.ts";

export interface Product {
  code: string;
  name: string;
  brand: string;
  quantity: number | null;
  unit: string;
}

// EAN-13, EAN-8, UPC-A (12) and UPC-E (8) with a valid check digit; GS1
// check digits catch most misreads before any lookup is made.
export function validBarcode(raw: string): string | null {
  const code = raw.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(code.length)) return null;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? code : null;
}

const UNITS: Record<string, [number, string]> = { g: [1, "g"], kg: [1000, "g"], mg: [0.001, "g"], ml: [1, "ml"], cl: [10, "ml"], dl: [100, "ml"], l: [1000, "ml"] };

const cache = new Map<string, { at: number; product: Product | null }>();
const DAY = 24 * 60 * 60 * 1000;

export class LookupUnavailable extends Error {}

export async function lookupBarcode(code: string, fetcher: typeof fetch = fetch): Promise<Product | null> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < DAY) return hit.product;
  let res: Response;
  try {
    res = await fetcher(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_en,brands,product_quantity,product_quantity_unit`, {
      headers: { "user-agent": "Larder/1.0 (COMP4020 student project)" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new LookupUnavailable("The product database didn't answer. Type the item instead.");
  }
  if (res.status === 404) return remember(code, null);
  if (!res.ok) throw new LookupUnavailable("The product database didn't answer. Type the item instead.");
  const body = (await res.json()) as { status?: number; product?: Record<string, unknown> };
  if (body.status !== 1 || !body.product) return remember(code, null);
  const p = body.product;
  const name = String(p.product_name_en || p.product_name || "").trim();
  if (!name) return remember(code, null);
  const q = Number(p.product_quantity);
  const unit = UNITS[String(p.product_quantity_unit ?? "").toLowerCase()];
  return remember(code, {
    code,
    name: name.slice(0, 80),
    brand: String(p.brands ?? "").split(",")[0].trim().slice(0, 60),
    quantity: unit && Number.isFinite(q) && q > 0 ? +(q * unit[0]).toFixed(2) : null,
    unit: unit ? unit[1] : "",
  });
}

function remember(code: string, product: Product | null): Product | null {
  cache.set(code, { at: Date.now(), product });
  return product;
}

// A found product becomes one review row: its pack size prefilled, its name
// matched to the catalogue where it can be. Brand words are stripped from
// the name first so "Ferrero Nutella" can still meet "chocolate hazelnut spread".
export function barcodeRow(userId: number, product: Product): ResultRow {
  const plain = product.brand
    ? product.name.replace(new RegExp(`\\b${product.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "").trim() || product.name
    : product.name;
  const r = resolveName({ name: plain.toLowerCase(), count: null, container: "", confidence: "high" }, catalogueHas, learnedNames(userId));
  return {
    detected: plain.toLowerCase(),
    name: r.name,
    match: r.match,
    confidence: "high",
    quantity: product.quantity !== null ? String(product.quantity) : "1",
    unit: product.unit,
    price_cents: null,
    // the brand only when it adds something ("Nutella" by "Nutella" doesn't)
    source: `${product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase()) ? `${product.brand} · ` : ""}${product.name} · barcode ${product.code}`,
  };
}
