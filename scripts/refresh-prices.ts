// Reads current shelf prices from Woolworths and ALDI Australia into
// src/data/products.json. Run by hand (`node scripts/refresh-prices.ts`); the app never
// fetches at request time. Polite by design: a real user agent, at most about
// 3 requests a second, one retry, and only pages robots.txt allows
// (Woolworths' public search API and ALDI's category listings; not
// /shop/search or /results?). If a retailer blocks us part-way, what was read
// is kept and the block is recorded under stats.blocked.
import { readFileSync, writeFileSync } from "node:fs";
import { isEquivalent, matchesIngredient, type Product, type ProductData, parseSize, type Retailer, unitPrice } from "../src/products.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const OUT = new URL("../src/data/products.json", import.meta.url);
const PER_RETAILER = 4;
const FOOD_TOP = ["fruits-vegetables", "meat-seafood", "deli-chilled-meats", "dairy-eggs-fridge", "pantry", "bakery", "freezer"];

let last = 0;
async function get(url: string, tries = 2): Promise<Response> {
  const wait = last + 350 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
    if (res.status === 403 || res.status === 429) throw Object.assign(new Error(`blocked ${res.status}`), { blocked: true });
    return res;
  } catch (err) {
    if ((err as { blocked?: boolean }).blocked || tries <= 1) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return get(url, tries - 1);
  }
}

function ingredientNames(): string[] {
  const cat = JSON.parse(readFileSync(new URL("../src/data/catalogue.json", import.meta.url), "utf8")) as {
    ingredients: { name: string }[];
  }[];
  const names = new Set<string>();
  for (const r of cat) for (const i of r.ingredients) names.add(i.name.toLowerCase().trim());
  const db = readFileSync(new URL("../src/db.ts", import.meta.url), "utf8");
  for (const m of db.matchAll(/\["([a-z' -]+)", "[a-z]*", "[a-z]+"\]/g)) names.add(m[1]);
  names.delete("water");
  return [...names].sort();
}

/* ---------------- Woolworths ---------------- */

interface WProduct {
  Stockcode: number;
  DisplayName: string;
  Price: number | null;
  PackageSize: string | null;
  IsAvailable: boolean;
  UrlFriendlyName: string;
}

async function woolworths(name: string, now: string): Promise<Product[]> {
  const res = await get(`https://www.woolworths.com.au/apis/ui/Search/products?searchTerm=${encodeURIComponent(name)}&pageSize=24`);
  if (!res.ok) return [];
  const body = (await res.json()) as { Products?: { Products?: WProduct[] }[] };
  const out: Product[] = [];
  for (const group of body.Products ?? []) {
    for (const p of group.Products ?? []) {
      if (!p.Price || p.Price <= 0 || !p.IsAvailable) continue;
      if (!matchesIngredient(name, p.DisplayName)) continue;
      const size = parseSize(p.PackageSize ?? "") ?? parseSize(p.DisplayName);
      if (!size) continue;
      out.push({
        retailer: "woolworths",
        name: p.DisplayName.replace(/\s+/g, " ").trim(),
        url: `https://www.woolworths.com.au/shop/productdetails/${p.Stockcode}/${p.UrlFriendlyName}`,
        priceCents: Math.round(p.Price * 100),
        size,
        checkedAt: now,
        available: true,
      });
    }
  }
  return out;
}

/* ---------------- ALDI ---------------- */

interface AldiTile {
  name: string;
  url: string;
  priceCents: number;
  size: string;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, "").trim();

function tiles(html: string): AldiTile[] {
  const out: AldiTile[] = [];
  for (const chunk of html.split('class="product-teaser-item').slice(1)) {
    const href = /href="(\/product\/[^"]+)"/.exec(chunk)?.[1];
    const brand = /product-tile__brandname"[^>]*><p[^>]*>([^<]*)</.exec(chunk)?.[1] ?? "";
    const title = /product-tile__name"[^>]*><p[^>]*>([^<]*)</.exec(chunk)?.[1];
    const size = /product-tile__unit-of-measurement"[^>]*><p>([^<]*)</.exec(chunk)?.[1] ?? "";
    const price = /base-price__regular"><span>\$([0-9.]+)</.exec(chunk)?.[1];
    if (!href || !title || !price) continue;
    const display = `${decode(brand)} ${decode(title)}`.trim();
    out.push({ name: display, url: `https://www.aldi.com.au${href}`, priceCents: Math.round(Number(price) * 100), size: decode(size) || decode(title) });
  }
  return out;
}

async function aldiCatalogue(): Promise<AldiTile[]> {
  const xml = await (await get("https://www.aldi.com.au/sitemap_categories.xml")).text();
  const cats = [...xml.matchAll(/<loc>(https:\/\/www\.aldi\.com\.au\/products\/([^/]+)\/[^<]*\/k\/\d+)<\/loc>/g)]
    .filter((m) => FOOD_TOP.includes(m[2]))
    .map((m) => m[1]);
  const seen = new Map<string, AldiTile>();
  for (const cat of cats) {
    for (let page = 1; page <= 15; page++) {
      const res = await get(page === 1 ? cat : `${cat}?page=${page}`);
      if (!res.ok) break;
      const found = tiles(await res.text());
      const before = seen.size;
      for (const t of found) seen.set(t.url, t);
      if (!found.length || seen.size === before) break;
    }
  }
  return [...seen.values()];
}

/* ---------------- main ---------------- */

// The cheapest few per retailer, like-for-like matches first so a cheap
// "Lemon & Pepper Tuna" never pushes real lemons out of the list.
function best(name: string, list: Product[]): Product[] {
  const byUrl = new Map(list.map((p) => [p.url, p]));
  const sorted = [...byUrl.values()].sort((a, b) => Number(isEquivalent(name, b.name)) - Number(isEquivalent(name, a.name)) || unitPrice(a) - unitPrice(b));
  return sorted.slice(0, PER_RETAILER);
}

const started = Date.now();
const now = new Date().toISOString();
const names = ingredientNames();
const products: Record<string, Product[]> = {};
const blocked: Retailer[] = [];
let wRead = 0;
let aRead = 0;

let aldiTiles: AldiTile[] = [];
try {
  aldiTiles = await aldiCatalogue();
  aRead = aldiTiles.length;
  console.log(`aldi: ${aRead} products read`);
} catch (err) {
  console.error(`aldi stopped: ${(err as Error).message}`);
  blocked.push("aldi");
}

let wBlocked = false;
for (const [i, name] of names.entries()) {
  let w: Product[] = [];
  if (!wBlocked) {
    try {
      w = await woolworths(name, now);
      wRead += w.length;
    } catch (err) {
      console.error(`woolworths stopped at "${name}": ${(err as Error).message}`);
      wBlocked = true;
      blocked.push("woolworths");
    }
  }
  const a: Product[] = [];
  for (const t of aldiTiles) {
    const size = parseSize(t.size) ?? parseSize(t.name);
    if (size && matchesIngredient(name, t.name)) {
      a.push({ retailer: "aldi", name: t.name, url: t.url, priceCents: t.priceCents, size, checkedAt: now, available: true });
    }
  }
  const picked = [...best(name, w), ...best(name, a)];
  if (picked.length) products[name] = picked;
  if (i % 50 === 0) console.log(`${i}/${names.length}`);
}

const data: ProductData = {
  generatedAt: now,
  products,
  stats: {
    ingredients: names.length,
    withWoolworths: Object.values(products).filter((l) => l.some((p) => p.retailer === "woolworths")).length,
    withAldi: Object.values(products).filter((l) => l.some((p) => p.retailer === "aldi")).length,
    woolworthsProductsRead: wRead,
    aldiProductsRead: aRead,
    blocked,
  },
};
writeFileSync(OUT, `${JSON.stringify(data, null, 1)}\n`);
// the same structured line the app logs, so a refresh shows up the same way
const line = { level: blocked.length ? "error" : "info", event: blocked.length ? "prices.refresh_failed" : "prices.refresh", who: "operator", outcome: blocked.length ? "failed" : "ok", seconds: Math.round((Date.now() - started) / 1000), ...data.stats, blocked: blocked.join(",") || null };
(blocked.length ? console.error : console.log)(JSON.stringify(line));
