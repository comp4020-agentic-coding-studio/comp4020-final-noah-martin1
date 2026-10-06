import { describe, expect, it } from "vitest";
import { registered } from "./helpers.ts";

// CLAUDE.md invariant 7 (validation half): quantities never go negative and
// prices are real amounts. Also: what you save is still there next request.
describe("pantry", () => {
  it("saves an item and shows it with its price", async () => {
    const { client } = await registered();
    const res = await client.post("/pantry", {
      name: "Free-range eggs",
      quantity: "12",
      unit: "",
      expiry_date: "2030-01-01",
      price: "6.50",
    });
    expect(res.status).toBe(200);
    const page = await (await client.get("/pantry")).text();
    expect(page).toContain("free-range eggs");
    expect(page).toContain("$6.50");
  });

  it.each([
    ["a negative quantity", { quantity: "-1", price: "" }],
    ["a missing quantity", { quantity: "", price: "" }],
    ["a non-numeric price", { quantity: "1", price: "cheap" }],
    ["a negative price", { quantity: "1", price: "-3" }],
  ])("refuses %s", async (_label, fields) => {
    const { client } = await registered();
    const res = await client.post("/pantry", { name: "milk", unit: "ml", expiry_date: "", ...fields });
    expect(res.status).toBe(422);
    expect(await (await client.get("/pantry")).text()).toContain("Your pantry is empty");
  });

  it("one person's pantry is invisible to and unchangeable by another", async () => {
    const owner = await registered("owner");
    const other = await registered("other");
    await owner.client.post("/pantry", { name: "saffron", quantity: "1", unit: "g", expiry_date: "", price: "" });
    const ownerPage = await (await owner.client.get("/pantry")).text();
    const id = ownerPage.match(/action="\/pantry\/(\d+)\/delete"/)?.[1];
    expect(id).toBeDefined();

    expect(await (await other.client.get("/pantry")).text()).not.toContain("saffron");
    expect((await other.client.post(`/pantry/${id}/delete`)).status).toBe(404);
    expect(await (await owner.client.get("/pantry")).text()).toContain("saffron");
  });
});
