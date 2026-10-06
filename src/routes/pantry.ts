import { all, catalogFor, ingredientId, one, run } from "../db.ts";
import { freshness, money, parseIsoDate, qty } from "../format.ts";
import { type Html, html } from "../html.ts";
import { type Ctx, HttpError, htmlReply, redirect, setFlash } from "../http.ts";
import type { Route } from "../server.ts";
import { empty, errors, icon, page, pageHeader } from "../views/layout.ts";

export interface InventoryItem {
  id: number;
  ingredient_id: number;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  expiry_date: string | null;
  price_cents: number | null;
  updated_at: string;
}

export function personalInventory(userId: number): InventoryItem[] {
  // soonest expiry first; undated items last
  return all<InventoryItem>(
    `SELECT it.id, it.ingredient_id, i.name, i.category, it.quantity, it.unit, it.expiry_date,
            it.price_cents, it.updated_at
     FROM inventory_items it JOIN ingredients i ON i.id = it.ingredient_id
     WHERE it.owner_type = 'user' AND it.owner_id = ?
     ORDER BY it.expiry_date IS NULL, it.expiry_date, i.name`,
    userId,
  );
}

interface ItemInput {
  name: string;
  quantity: number;
  unit: string;
  expiry_date: string | null;
  price_cents: number | null;
}

// Quantity is never negative and price is a non-negative dollar amount;
// the table's CHECK constraints back this up (CLAUDE.md invariant 7).
function parseItem(form: URLSearchParams): { input: ItemInput; values: Record<string, string>; problems: string[] } {
  const values = {
    name: (form.get("name") ?? "").trim(),
    quantity: (form.get("quantity") ?? "").trim(),
    unit: (form.get("unit") ?? "").trim(),
    expiry_date: (form.get("expiry_date") ?? "").trim(),
    price: (form.get("price") ?? "").trim().replace(/^\$/, ""),
  };
  const problems: string[] = [];
  if (!values.name || values.name.length > 80) problems.push("Name the item (up to 80 characters).");
  const quantity = Number(values.quantity);
  if (values.quantity === "" || !Number.isFinite(quantity) || quantity < 0 || quantity > 100000) {
    problems.push("Quantity must be a number of zero or more.");
  }
  if (values.expiry_date && !parseIsoDate(values.expiry_date)) problems.push("Expiry must be a valid date.");
  let price_cents: number | null = null;
  if (values.price !== "") {
    const dollars = Number(values.price);
    if (!/^\d+(\.\d{1,2})?$/.test(values.price) || !Number.isFinite(dollars) || dollars > 10000) {
      problems.push("Price must be a dollar amount like 4.50.");
    } else {
      price_cents = Math.round(dollars * 100);
    }
  }
  return {
    input: {
      name: values.name,
      quantity,
      unit: values.unit.slice(0, 20),
      expiry_date: values.expiry_date || null,
      price_cents,
    },
    values,
    problems,
  };
}

function itemFields(values: Record<string, string>, idPrefix: string): Html {
  return html`
    <label class="field grow-2"><span>Item</span>
      <input id="${idPrefix}-name" name="name" required maxlength="80" list="ingredient-catalog" placeholder="e.g. eggs" value="${values.name ?? ""}" /></label>
    <label class="field"><span>Qty</span>
      <input name="quantity" required inputmode="decimal" placeholder="12" value="${values.quantity ?? ""}" /></label>
    <label class="field"><span>Unit</span>
      <input name="unit" maxlength="20" placeholder="g, ml, pack" value="${values.unit ?? ""}" /></label>
    <label class="field"><span>Expires</span>
      <input name="expiry_date" type="date" value="${values.expiry_date ?? ""}" /></label>
    <label class="field"><span>Price paid</span>
      <span class="input-prefix"><span>$</span><input name="price" inputmode="decimal" placeholder="0.00" value="${values.price ?? ""}" /></span></label>`;
}

function pantryPage(ctx: Ctx, values: Record<string, string> = {}, problems: string[] = [], status = 200) {
  const user = ctx.user!;
  const items = personalInventory(user.id);
  const catalog = catalogFor(ctx.user!.id);
  const counts = { expired: 0, soon: 0 };
  let value = 0;
  for (const it of items) {
    const f = freshness(it.expiry_date).state;
    if (f === "expired") counts.expired++;
    if (f === "soon") counts.soon++;
    value += it.price_cents ?? 0;
  }
  const editing = Number(ctx.url.searchParams.get("edit"));

  const body = html`
    ${pageHeader("Pantry", "What's in your kitchen, what it cost, and what needs using first.")}
    <dl class="stats">
      <div><dt>Items</dt><dd>${items.length}</dd></div>
      <div class="${counts.soon ? "stat-warn" : ""}"><dt>Use soon</dt><dd>${counts.soon}</dd></div>
      <div class="${counts.expired ? "stat-bad" : ""}"><dt>Expired</dt><dd>${counts.expired}</dd></div>
      <div><dt>Stock value</dt><dd>${money(value)}</dd></div>
    </dl>

    <section class="panel">
      <h2 class="panel-title">Add an item</h2>
      ${errors(problems)}
      <form method="post" action="/pantry" class="inline-form">
        ${itemFields(values, "add")}
        <button class="button" type="submit">${icon("plus", 16)} Add</button>
      </form>
      <datalist id="ingredient-catalog">${catalog.map((c) => html`<option value="${c}"></option>`)}</datalist>
    </section>

    ${items.length
      ? html`<section class="panel panel-flush">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th scope="col">Item</th><th scope="col" class="num">Qty</th><th scope="col">Expiry</th><th scope="col" class="num">Price</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>
                ${items.map((it) => {
                  const f = freshness(it.expiry_date);
                  if (it.id === editing) {
                    return html`<tr class="editing"><td colspan="5">
                      <form method="post" action="/pantry/${it.id}" class="inline-form">
                        ${itemFields(
                          {
                            name: it.name,
                            quantity: String(it.quantity),
                            unit: it.unit,
                            expiry_date: it.expiry_date ?? "",
                            price: it.price_cents === null ? "" : (it.price_cents / 100).toFixed(2),
                          },
                          `edit-${it.id}`,
                        )}
                        <a class="button button-ghost" href="/pantry">Cancel</a>
                        <button class="button" type="submit">Save</button>
                      </form></td></tr>`;
                  }
                  return html`<tr class="row-${f.state}">
                    <td><span class="item-name">${it.name}</span><small class="muted">${it.category}</small></td>
                    <td class="num mono">${qty(it.quantity, it.unit)}</td>
                    <td><span class="pill pill-${f.state}">${f.label}</span></td>
                    <td class="num mono">${money(it.price_cents)}</td>
                    <td class="row-actions">
                      <a class="link-button" href="/pantry?edit=${it.id}">Edit</a>
                      <form method="post" action="/pantry/${it.id}/delete" data-confirm="Remove ${it.name} from your pantry?">
                        <button class="link-button danger" type="submit">Remove</button>
                      </form>
                    </td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>
        </section>`
      : empty("Your pantry is empty", "Add what you have — expiry dates drive the “use soon” list, and prices feed recipe cost estimates.")}
    <p class="hint">${icon("household", 16)} Shared household pantries with live ingredient reservations arrive in crit 9.</p>`;

  return htmlReply(page(ctx, { title: "Pantry", active: "pantry", body }), status);
}

function ownItem(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? one("SELECT 1 FROM inventory_items WHERE id = ? AND owner_type = 'user' AND owner_id = ?", id, ctx.user!.id)
    : undefined;
  if (!row) throw new HttpError(404, "That pantry item doesn't exist.");
  return id;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/pantry",
    auth: true,
    handler: (ctx) => pantryPage(ctx),
  },
  {
    method: "POST",
    path: "/pantry",
    auth: true,
    handler: async (ctx) => {
      const { input, values, problems } = parseItem(await ctx.form());
      if (problems.length) return pantryPage(ctx, values, problems, 422);
      run(
        `INSERT INTO inventory_items (owner_type, owner_id, ingredient_id, quantity, unit, expiry_date, price_cents, added_by)
         VALUES ('user', ?, ?, ?, ?, ?, ?, ?)`,
        ctx.user!.id,
        ingredientId(input.name, input.unit),
        input.quantity,
        input.unit,
        input.expiry_date,
        input.price_cents,
        ctx.user!.id,
      );
      setFlash(ctx, `Added ${input.name}.`);
      return redirect("/pantry");
    },
  },
  {
    method: "POST",
    path: "/pantry/:id",
    auth: true,
    handler: async (ctx) => {
      const id = ownItem(ctx);
      const { input, values, problems } = parseItem(await ctx.form());
      if (problems.length) return pantryPage(ctx, values, problems, 422);
      run(
        `UPDATE inventory_items SET ingredient_id = ?, quantity = ?, unit = ?, expiry_date = ?, price_cents = ?,
         updated_at = datetime('now') WHERE id = ?`,
        ingredientId(input.name, input.unit),
        input.quantity,
        input.unit,
        input.expiry_date,
        input.price_cents,
        id,
      );
      setFlash(ctx, `Updated ${input.name}.`);
      return redirect("/pantry");
    },
  },
  {
    method: "POST",
    path: "/pantry/:id/delete",
    auth: true,
    handler: (ctx) => {
      run("DELETE FROM inventory_items WHERE id = ?", ownItem(ctx));
      setFlash(ctx, "Item removed.");
      return redirect("/pantry");
    },
  },
];
