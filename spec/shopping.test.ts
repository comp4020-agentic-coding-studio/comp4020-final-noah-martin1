import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { type Client, createRecipe, localToday, registered } from "./helpers.ts";

// The shopping list is arithmetic over the calendar and pantry: what planned
// meals need, minus what you hold (fresh, same unit).

async function lists(client: Client) {
  const doc = new JSDOM(await (await client.get("/shopping")).text()).window.document;
  const read = (sel: string) =>
    [...doc.querySelectorAll(sel)].map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase());
  return { toBuy: read(".shop-list:not(.covered) .shop-line"), covered: read(".shop-list.covered .shop-line") };
}

async function plan(client: Client, recipeId: number, status?: string) {
  await client.post("/calendar", { recipe_id: String(recipeId), date: localToday(1), meal: "dinner" });
  if (status) {
    const page = await (await client.get("/calendar?week=" + localToday(1))).text();
    const id = [...page.matchAll(/action="\/calendar\/(\d+)\/status"/g)].at(-1)?.[1];
    await client.post(`/calendar/${id}/status`, { status });
  }
}

describe("shopping list", () => {
  it("lists what planned meals need, minus what's in the pantry", async () => {
    const { client } = await registered();
    const id = await createRecipe(client, "List test", "private"); // 3 eggs, 100 g spinach
    await client.post("/pantry", { name: "eggs", quantity: "2", unit: "", expiry_date: "", price: "6.50" });
    await plan(client, id);

    const { toBuy } = await lists(client);
    expect(toBuy.find((l) => l.includes("eggs"))).toMatch(/^1 eggs/);
    expect(toBuy.find((l) => l.includes("spinach"))).toMatch(/^100 g spinach/);
  });

  it("moves an item to 'already in your pantry' once you hold enough", async () => {
    const { client } = await registered();
    const id = await createRecipe(client, "Covered test", "private");
    await client.post("/pantry", { name: "spinach", quantity: "250", unit: "g", expiry_date: "", price: "" });
    await plan(client, id);

    const { toBuy, covered } = await lists(client);
    expect(toBuy.some((l) => l.includes("spinach"))).toBe(false);
    expect(covered.some((l) => l.includes("spinach"))).toBe(true);
  });

  it("ignores expired pantry items and cancelled meals", async () => {
    const { client } = await registered();
    const id = await createRecipe(client, "Expiry test", "private");
    await client.post("/pantry", { name: "spinach", quantity: "500", unit: "g", expiry_date: "2020-01-01", price: "" });
    await plan(client, id);
    expect((await lists(client)).toBuy.some((l) => l.includes("spinach"))).toBe(true);

    const other = await registered();
    const id2 = await createRecipe(other.client, "Cancelled test", "private");
    await plan(other.client, id2, "cancelled");
    expect((await lists(other.client)).toBuy).toEqual([]);
  });
});
