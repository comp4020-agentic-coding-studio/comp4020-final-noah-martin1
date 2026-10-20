import { all, catalogFor, ingredientId, one, run } from "../db.ts";
import { addDays, daysBetween, freshness, money, parseIsoDate, qty, shortDate, today, weekday } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { type Ctx, HttpError, htmlReply, redirect, setFlash } from "../http.ts";
import { logActivity } from "../activity.ts";
import { expiryState, listedParams, listedSql, removalDate } from "../expiry.ts";
import { shelfware } from "../kitchen.ts";
import { recordPaidPrice } from "../pricing.ts";
import type { Route } from "../server.ts";
import { empty, errors, icon, page } from "../views/layout.ts";

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
  kept_at: string | null;
}

export function personalInventory(userId: number): InventoryItem[] {
  // soonest expiry first; undated items last
  return all<InventoryItem>(
    `SELECT it.id, it.ingredient_id, i.name, i.category, it.quantity, it.unit, it.expiry_date,
            it.price_cents, it.updated_at, it.kept_at
     FROM inventory_items it JOIN ingredients i ON i.id = it.ingredient_id
     WHERE it.owner_type = 'user' AND it.owner_id = ? AND ${listedSql("it")}
     ORDER BY it.expiry_date IS NULL, it.expiry_date, i.name`,
    userId,
    ...listedParams(),
  );
}

// Expired yesterday and not answered yet: the owner is asked once, on the
// pantry page and the home page, whether they still have it.
export function graceItems(items: InventoryItem[]): InventoryItem[] {
  return items.filter((it) => expiryState(it) === "grace");
}

// The label an item wears: an expired item someone kept says so.
export function itemFreshness(it: Pick<InventoryItem, "expiry_date" | "kept_at">): { state: "expired" | "soon" | "fresh" | "none" | "kept"; label: string } {
  const f = freshness(it.expiry_date);
  if (f.state === "expired" && it.kept_at) return { state: "kept", label: "Past date · kept" };
  if (f.state === "expired") return { state: "expired", label: `${f.label} · still have it?` };
  return f;
}

// Which of the person's own upcoming planned meals use each ingredient, for
// the fridge's "what's this for?" panel. Their own calendar only, so no
// visibility question arises.
function upcomingUses(userId: number, ingredientIds: number[]): Map<number, { date: string; meal: string; recipe_id: number; title: string }[]> {
  const out = new Map<number, { date: string; meal: string; recipe_id: number; title: string }[]>();
  if (!ingredientIds.length) return out;
  const rows = all<{ ingredient_id: number; date: string; meal: string; recipe_id: number; title: string }>(
    `SELECT DISTINCT ri.ingredient_id, c.date, c.meal, r.id AS recipe_id, r.title
     FROM calendar_entries c
     JOIN recipes r ON r.id = c.recipe_id
     JOIN recipe_ingredients ri ON ri.recipe_id = r.id
     WHERE c.owner_type = 'user' AND c.owner_id = ? AND c.status = 'planned'
       AND c.date BETWEEN ? AND ?
       AND ri.ingredient_id IN (${ingredientIds.map(() => "?").join(", ")})
     ORDER BY c.date, CASE c.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END`,
    userId,
    today(),
    addDays(today(), 21),
    ...ingredientIds,
  );
  for (const r of rows) {
    const list = out.get(r.ingredient_id) ?? [];
    list.push({ date: r.date, meal: r.meal, recipe_id: r.recipe_id, title: r.title });
    out.set(r.ingredient_id, list);
  }
  return out;
}

function inDays(days: number): string {
  if (days < 14) return `${days} days left`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks left`;
  return `about ${Math.round(days / 30)} months left`;
}

// What the 3D scene draws: one entry per item, with its container and the
// meals it's earmarked for. Escaped so no item name can close the tag.
function scenePayload(userId: number, items: InventoryItem[]): string {
  const uses = upcomingUses(userId, [...new Set(items.map((i) => i.ingredient_id))]);
  const data = items.map((it) => {
    const f = itemFreshness(it);
    const ware = shelfware(it.name, it.category);
    return {
      id: it.id,
      name: it.name,
      qty: qty(it.quantity, it.unit),
      price: it.price_cents === null ? null : money(it.price_cents),
      expiry: it.expiry_date ? `${weekday(it.expiry_date)} ${shortDate(it.expiry_date)}` : null,
      fresh: f.state,
      // the panel already shows the date, so say how long that is from now
      freshLabel: f.state === "fresh" && it.expiry_date ? inDays(daysBetween(today(), it.expiry_date)) : f.label,
      // the grace day: the panel asks "Do you still have this?" and says when it goes
      grace: expiryState(it) === "grace" ? { removes: `${weekday(removalDate(it.expiry_date!))} ${shortDate(removalDate(it.expiry_date!))}` } : null,
      place: ware.place,
      model: ware.model,
      tint: ware.tint,
      uses: (uses.get(it.ingredient_id) ?? []).map((u) => ({ ...u, day: `${weekday(u.date)} ${shortDate(u.date)}` })),
    };
  });
  return JSON.stringify(data).replace(/</g, "\\u003c");
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

// "Do you still have this?" for items in their grace day. One card, one
// answer per item; once answered (or once the day passes) it's gone.
export function gracePrompt(items: InventoryItem[], returnTo = "/pantry"): Html {
  const due = graceItems(items);
  if (!due.length) return html``;
  return html`<section class="panel grace" id="still-have" aria-labelledby="grace-h">
    <h2 class="panel-title" id="grace-h">Do you still have ${due.length === 1 ? "this" : "these"}?</h2>
    <p class="muted small">${due.length === 1 ? "It" : "They"} passed ${due.length === 1 ? "its" : "their"} expiry date yesterday. Unless you say you still have ${due.length === 1 ? "it" : "them"}, ${due.length === 1 ? "it leaves" : "they leave"} your kitchen tomorrow, and ${due.length === 1 ? "isn't" : "aren't"} counted for recipes or shopping in the meantime.</p>
    <ul class="grace-list">
      ${due.map(
        (it) => html`<li>
          <span class="grow"><span class="item-name">${it.name}</span> <small class="muted">${qty(it.quantity, it.unit)} · expired ${shortDate(it.expiry_date!)} · removed ${weekday(removalDate(it.expiry_date!))} ${shortDate(removalDate(it.expiry_date!))} if not kept</small></span>
          <form method="post" action="/pantry/${it.id}/keep" class="grace-form">
            <input type="hidden" name="return_to" value="${returnTo}" />
            <label class="sr-only" for="grace-date-${it.id}">New expiry date for ${it.name} (optional)</label>
            <input id="grace-date-${it.id}" type="date" name="expiry_date" min="${today()}" />
            <button class="button button-small" type="submit">I still have it</button>
          </form>
          <form method="post" action="/pantry/${it.id}/gone">
            <input type="hidden" name="return_to" value="${returnTo}" />
            <button class="button button-small button-ghost" type="submit">It's gone</button>
          </form>
        </li>`,
      )}
    </ul>
  </section>`;
}

function pantryPage(ctx: Ctx, values: Record<string, string> = {}, problems: string[] = [], status = 200) {
  const user = ctx.user!;
  const items = personalInventory(user.id);
  const catalog = catalogFor(ctx.user!.id);
  const counts = { expired: 0, soon: 0 };
  let value = 0;
  for (const it of items) {
    const f = itemFreshness(it).state;
    if (f === "expired") counts.expired++;
    if (f === "soon") counts.soon++;
    value += it.price_cents ?? 0;
  }
  const editing = Number(ctx.url.searchParams.get("edit"));

  const inFridge = items.filter((it) => shelfware(it.name, it.category).place === "fridge").length;
  const body = html`
    <section class="kx" data-kitchen data-view="fridge">
      <header class="kx-hero">
        <p class="eyebrow">Your kitchen</p>
        <h1><span class="kx-title" data-kx-title>Fridge</span></h1>
        <p class="lede">Hover anything to lift it off the shelf; tap it to see when it goes off and which meals it's for.</p>
        <dl class="kx-stats">
          <div><dt>Items</dt><dd>${items.length}</dd></div>
          <div class="${counts.soon ? "kx-warn" : ""}"><dt>Use soon</dt><dd>${counts.soon}</dd></div>
          <div class="${counts.expired ? "kx-bad" : ""}"><dt>Expired</dt><dd>${counts.expired}</dd></div>
          <div><dt>Stock value</dt><dd>${money(value)}</dd></div>
        </dl>
        <p class="kx-actions"><a class="button kx-add-btn" href="#add" data-kx-add>${icon("plus", 16)} Add an item</a></p>
      </header>

      <div class="kx-stage" data-kx-stage>
        <canvas aria-label="3D view of your fridge and pantry. Every item is also listed in the table below."></canvas>
        <div class="kx-loading" aria-hidden="true"><span></span></div>
        <div class="kx-switch" role="group" aria-label="Show">
          <button type="button" class="kx-arrow kx-arrow-prev" data-kx-go="fridge" aria-label="Show the fridge">${icon("back", 18)}</button>
          <span class="kx-dots" aria-hidden="true"><i data-dot="fridge"></i><i data-dot="pantry"></i></span>
          <button type="button" class="kx-arrow kx-arrow-next" data-kx-go="pantry" aria-label="Show the pantry">${icon("arrow", 18)}</button>
        </div>
        <p class="kx-toast" data-kx-toast role="status"></p>
        <p class="kx-place-label" aria-hidden="true"><span data-kx-count-fridge>${inFridge} in the fridge</span><span data-kx-count-pantry>${items.length - inFridge} on the shelves</span></p>
      </div>

      <aside class="kx-panel" data-kx-panel hidden aria-live="polite">
        <button class="kx-close" type="button" data-kx-close aria-label="Close">${icon("close", 18)}</button>
        <div data-kx-panel-body></div>
        <form method="post" action="/pantry" class="kx-add-form" data-kx-add-form hidden>
          <p class="kx-panel-kind">Just been shopping?</p>
          <h2>Add an item</h2>
          <p class="kx-panel-qty">It finds its own spot: a fridge shelf, the door, the crisper or the pantry.</p>
          <div data-kx-add-errors></div>
          <div class="kx-fields">${itemFields({}, "kx")}</div>
          <div class="kx-quick" role="group" aria-label="Expires in">
            <span>Expires in</span>
            ${[[3, "3 days"], [7, "1 week"], [14, "2 weeks"], [30, "1 month"]].map(
              ([days, label]) => html`<button type="button" data-days="${days}" aria-pressed="false">${label}</button>`,
            )}
          </div>
          <button class="button button-block" type="submit">${icon("plus", 16)} Add to my kitchen</button>
        </form>
      </aside>
    </section>
    <script type="application/json" id="kitchen-data">${raw(scenePayload(user.id, items))}</script>

    ${gracePrompt(items)}

    <section class="panel kx-add" id="add">
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
                  const f = itemFreshness(it);
                  if (it.id === editing) {
                    return html`<tr class="editing" id="item-${it.id}"><td colspan="5">
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
                  return html`<tr class="row-${f.state}" id="item-${it.id}">
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
    `;

  return htmlReply(
    page(ctx, {
      title: "Fridge & pantry",
      active: "pantry",
      body,
      mainClass: "main-kitchen",
      headExtra: html`<script type="importmap">${raw(JSON.stringify({ imports: { three: "/assets/vendor/three.module.min.js", "three/addons/": "/assets/vendor/addons/" } }))}</script>
        <script type="module" src="/assets/kitchen.mjs"></script>`,
    }),
    status,
  );
}

function ownItem(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  const row = Number.isInteger(id)
    ? one("SELECT 1 FROM inventory_items WHERE id = ? AND owner_type = 'user' AND owner_id = ? AND removed_at IS NULL", id, ctx.user!.id)
    : undefined;
  if (!row) throw new HttpError(404, "That pantry item doesn't exist.");
  return id;
}

function itemName(id: number): string {
  return one<{ name: string }>("SELECT i.name FROM inventory_items it JOIN ingredients i ON i.id = it.ingredient_id WHERE it.id = ?", id)?.name ?? "";
}

function back(form: URLSearchParams): string {
  const to = form.get("return_to") ?? "";
  return to.startsWith("/") && !to.startsWith("//") ? to : "/pantry";
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
      const ing = ingredientId(input.name, input.unit);
      const { id } = run(
        `INSERT INTO inventory_items (owner_type, owner_id, ingredient_id, quantity, unit, expiry_date, price_cents, added_by)
         VALUES ('user', ?, ?, ?, ?, ?, ?, ?)`,
        ctx.user!.id,
        ing,
        input.quantity,
        input.unit,
        input.expiry_date,
        input.price_cents,
        ctx.user!.id,
      );
      const recorded = recordPaidPrice(ctx.user!.id, ing, id, input);
      logActivity({ actor: ctx.user, action: "pantry.add", subject: input.name, detail: { item: id, expiry: input.expiry_date, priced: input.price_cents !== null, price_recorded: recorded } });
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
      const ing = ingredientId(input.name, input.unit);
      // a new expiry date governs again: "kept" applied to the old one
      run(
        `UPDATE inventory_items SET ingredient_id = ?, quantity = ?, unit = ?, expiry_date = ?, price_cents = ?,
         kept_at = CASE WHEN expiry_date IS ? THEN kept_at ELSE NULL END,
         updated_at = datetime('now') WHERE id = ?`,
        ing,
        input.quantity,
        input.unit,
        input.expiry_date,
        input.price_cents,
        input.expiry_date,
        id,
      );
      recordPaidPrice(ctx.user!.id, ing, id, input);
      logActivity({ actor: ctx.user, action: "pantry.update", subject: input.name, detail: { item: id, expiry: input.expiry_date } });
      setFlash(ctx, `Updated ${input.name}.`);
      return redirect("/pantry");
    },
  },
  {
    method: "POST",
    path: "/pantry/:id/delete",
    auth: true,
    handler: (ctx) => {
      const id = ownItem(ctx);
      const name = itemName(id);
      run("UPDATE inventory_items SET removed_at = datetime('now'), removed_reason = 'gone' WHERE id = ?", id);
      logActivity({ actor: ctx.user, action: "pantry.remove", subject: name, detail: { item: id } });
      setFlash(ctx, "Item removed.");
      return redirect("/pantry");
    },
  },
  {
    // "I still have it": with a new date, that date governs; without one the
    // item is kept past its date and never removed for it
    method: "POST",
    path: "/pantry/:id/keep",
    auth: true,
    handler: async (ctx) => {
      const id = ownItem(ctx);
      const form = await ctx.form();
      const date = (form.get("expiry_date") ?? "").trim();
      const name = itemName(id);
      if (date) {
        if (!parseIsoDate(date) || date < today()) {
          setFlash(ctx, "A new expiry date has to be today or later.");
          return redirect(back(form));
        }
        run("UPDATE inventory_items SET expiry_date = ?, kept_at = NULL, updated_at = datetime('now') WHERE id = ?", date, id);
      } else {
        run("UPDATE inventory_items SET kept_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", id);
      }
      logActivity({ actor: ctx.user, action: "pantry.keep", subject: name, detail: { item: id, new_expiry: date || null } });
      setFlash(ctx, date ? `Kept ${name} — it now expires ${shortDate(date)}.` : `Kept ${name}. It won't be removed automatically.`);
      return redirect(back(form));
    },
  },
  {
    method: "POST",
    path: "/pantry/:id/gone",
    auth: true,
    handler: async (ctx) => {
      const id = ownItem(ctx);
      const form = await ctx.form();
      const name = itemName(id);
      run("UPDATE inventory_items SET removed_at = datetime('now'), removed_reason = 'gone' WHERE id = ?", id);
      logActivity({ actor: ctx.user, action: "pantry.gone", subject: name, detail: { item: id } });
      setFlash(ctx, `Removed ${name}.`);
      return redirect(back(form));
    },
  },
];
