// What Larder prices an ingredient at, for the recipe editor: as an author
// types an ingredient it shows the supermarket product (or stand-in, or
// estimate) and its price, asks for a price when there isn't one, and takes
// a correction. A price someone gives is theirs (src/pricing.ts
// recordPrice): it prices their own recipes and shopping, and is logged so
// corrections can be reviewed into the shared price data. It never changes
// anyone else's prices on its own.

import { logActivity } from "../activity.ts";
import { ingredientId, normaliseIngredient, one } from "../db.ts";
import { money } from "../format.ts";
import { type Ctx, json, type Reply, redirect, setFlash } from "../http.ts";
import { priceNote } from "../price-notes.ts";
import { recordPrice } from "../pricing.ts";
import type { Route } from "../server.ts";

const MAX_NAME = 80;

// back to the page the form was on, when it's ours (never another site)
function backTo(ctx: Ctx): string {
  try {
    const from = new URL(ctx.req.headers.referer ?? "");
    if (from.host === ctx.req.headers.host) return from.pathname + from.search;
  } catch {
    // no referrer, or not a URL
  }
  return "/recipes/new";
}
const STORES = ["Woolworths", "ALDI", "Coles", "IGA", "Other"];

interface Hint {
  name: string;
  kind: string;
  label: string;
  note: string | null;
  // cents per 100 g or ml of use, and the same as words ("$1.50 per 100 g")
  per100: number | null;
  perText: string | null;
  url: string | null;
  // the viewer's own recorded price, newest first
  yours: { text: string } | null;
}

export function hintFor(userId: number, raw: string): Hint | null {
  const name = normaliseIngredient(raw).slice(0, MAX_NAME);
  if (name.length < 2) return null;
  const n = priceNote(name);
  const id = one<{ id: number }>("SELECT id FROM ingredients WHERE name = ?", name)?.id;
  const mine = id
    ? one<{ price_cents: number; size_amount: number; size_unit: string; retailer: string }>(
        "SELECT price_cents, size_amount, size_unit, retailer FROM user_prices WHERE user_id = ? AND ingredient_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1",
        userId,
        id,
      )
    : undefined;
  const unit = n.kind === "unknown" ? null : "g";
  return {
    name,
    kind: n.kind,
    label: n.label,
    note: n.note,
    per100: n.centsPer100,
    perText: n.kind === "free" ? "free" : n.centsPer100 !== null && unit ? `${money(Math.max(1, Math.round(n.centsPer100)))} per 100 ${unit}` : null,
    url: n.url,
    yours: mine ? { text: `${money(mine.price_cents)} for ${mine.size_amount} ${mine.size_unit === "each" ? "" : mine.size_unit}${mine.retailer ? ` at ${mine.retailer}` : ""}`.replace(/\s+/g, " ") } : null,
  };
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/prices/hint",
    auth: true,
    handler: (ctx: Ctx): Reply => {
      const hint = hintFor(ctx.user!.id, ctx.url.searchParams.get("name") ?? "");
      return json(hint ?? { name: "", kind: "none" });
    },
  },
  {
    // a price an author gives for an ingredient: "$4.50 for 500 g at ALDI"
    method: "POST",
    path: "/prices",
    auth: true,
    handler: async (ctx: Ctx): Promise<Reply> => {
      const form = await ctx.form();
      const name = normaliseIngredient(form.get("name") ?? "").slice(0, MAX_NAME);
      const price = Number((form.get("price") ?? "").replace(/[$,\s]/g, ""));
      const quantity = Number(form.get("quantity") ?? "");
      const unit = (form.get("unit") ?? "").trim().toLowerCase();
      const storeRaw = (form.get("store") ?? "").trim();
      const store = STORES.includes(storeRaw) ? storeRaw : "";
      const wantsJson = (ctx.req.headers.accept ?? "").includes("application/json");
      const fail = (error: string): Reply => {
        if (wantsJson) return json({ error }, 422);
        setFlash(ctx, error);
        return redirect(backTo(ctx));
      };
      if (name.length < 2) return fail("Which ingredient is this price for?");
      if (!(price > 0) || price > 1000) return fail("Enter the price you paid, like 4.50.");
      if (!(quantity > 0) || quantity > 100000) return fail("Enter how much was in the pack, like 500.");
      if (!["g", "kg", "ml", "l", "each", ""].includes(unit)) return fail("Choose g, kg, ml, L or each for the pack.");
      const id = ingredientId(name);
      const ok = recordPrice(ctx.user!.id, id, { name, quantity, unit: unit === "each" ? "" : unit, price_cents: Math.round(price * 100), store });
      if (!ok) return fail("That pack size couldn't be read. Use g, kg, ml, L or each.");
      logActivity({ actor: ctx.user, action: "price.record", subject: name, detail: { price_cents: Math.round(price * 100), quantity, unit, store } });
      if (wantsJson) return json({ ok: true, hint: hintFor(ctx.user!.id, name) });
      setFlash(ctx, `Saved: ${money(Math.round(price * 100))} for ${quantity} ${unit} of ${name}.`);
      return redirect(backTo(ctx));
    },
  },
];
