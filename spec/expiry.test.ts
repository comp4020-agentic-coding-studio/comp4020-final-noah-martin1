import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { expiryState, removalDate } from "../src/expiry.ts";
import { type Client, createRecipe, localToday, registered } from "./helpers.ts";

// Expired food doesn't sit in the kitchen forever. Through its expiry date
// it's stock; the next day it's a grace day ("Do you still have this?") and
// no longer counted; after that it leaves the kitchen by itself, unless the
// owner said they still have it.

function doc(markup: string): Document {
  return new JSDOM(markup).window.document;
}

async function pantryNames(client: Client): Promise<string[]> {
  const d = doc(await (await client.get("/pantry")).text());
  return JSON.parse(d.getElementById("kitchen-data")?.textContent ?? "[]").map((i: { name: string }) => i.name);
}

async function shopping(client: Client): Promise<string[]> {
  const d = doc(await (await client.get("/shopping")).text());
  return [...d.querySelectorAll(".shop-list:not(.covered) .shop-line .item-name")].map((e) => e.textContent ?? "");
}

describe("expiry rules", () => {
  it("decides each state from the expiry date, the grace day and the owner's answer", () => {
    const on = "2026-10-21";
    expect(expiryState({ expiry_date: null, kept_at: null }, on)).toBe("none");
    expect(expiryState({ expiry_date: "2026-10-21", kept_at: null }, on)).toBe("fresh");
    expect(expiryState({ expiry_date: "2026-10-20", kept_at: null }, on)).toBe("grace");
    expect(expiryState({ expiry_date: "2026-10-19", kept_at: null }, on)).toBe("removed");
    expect(expiryState({ expiry_date: "2026-10-01", kept_at: "2026-10-02 10:00:00" }, on)).toBe("kept");
    expect(expiryState({ expiry_date: "2030-01-01", kept_at: null, removed_at: "2026-10-20" }, on)).toBe("removed");
    // removal is the second day after the expiry date: one grace day between
    expect(removalDate("2026-10-20")).toBe("2026-10-22");
  });
});

describe("expired food in the kitchen", () => {
  it("asks once during the grace day, and the item isn't counted as stock meanwhile", async () => {
    const { client } = await registered();
    await client.post("/pantry", { name: "spinach", quantity: "500", unit: "g", expiry_date: localToday(-1), price: "" });
    const page = doc(await (await client.get("/pantry")).text());
    const prompt = page.querySelector("#still-have");
    expect(prompt?.textContent).toMatch(/Do you still have this\?/);
    expect(prompt?.textContent).toMatch(/spinach/);
    expect(page.querySelectorAll("#still-have form[action$='/keep']")).toHaveLength(1);
    // still listed in the kitchen, so the person can see what's being asked about
    expect(await pantryNames(client)).toContain("spinach");
    // but not used: a recipe needing spinach still puts it on the list
    const id = await createRecipe(client, "Grace test", "private");
    await client.post("/calendar", { recipe_id: String(id), date: localToday(1), meal: "dinner" });
    expect(await shopping(client)).toContain("spinach");
    // the home page asks too
    expect(await (await client.get("/")).text()).toMatch(/Do you still have this\?/);
  });

  it("removes an unanswered item after its grace day, keeping the row out of every view", async () => {
    const { client } = await registered();
    await client.post("/pantry", { name: "old milk", quantity: "1", unit: "l", expiry_date: localToday(-2), price: "" });
    await client.post("/pantry", { name: "fresh milk", quantity: "1", unit: "l", expiry_date: localToday(5), price: "" });
    const names = await pantryNames(client);
    expect(names).toContain("fresh milk");
    expect(names).not.toContain("old milk");
    const page = doc(await (await client.get("/pantry")).text());
    // the table and the prompt (the autocomplete may still offer the name)
    expect(page.querySelector(".table")?.textContent).not.toContain("old milk");
    expect(page.querySelector("#still-have")).toBeNull();
  });

  it("'I still have it' keeps the item as stock and stops it being removed", async () => {
    const { client } = await registered();
    await client.post("/pantry", { name: "spinach", quantity: "500", unit: "g", expiry_date: localToday(-1), price: "" });
    const action = doc(await (await client.get("/pantry")).text()).querySelector("#still-have form[action$='/keep']")!.getAttribute("action")!;
    const res = await client.post(action, { return_to: "/pantry", expiry_date: "" });
    expect(res.status).toBe(200);
    const page = doc(await res.text());
    // asked once: no prompt after answering
    expect(page.querySelector("#still-have")).toBeNull();
    expect(await pantryNames(client)).toContain("spinach");
    // counted again: the recipe's spinach is covered by the kept item
    const id = await createRecipe(client, "Kept test", "private");
    await client.post("/calendar", { recipe_id: String(id), date: localToday(1), meal: "dinner" });
    expect(await shopping(client)).not.toContain("spinach");
  });

  it("'I still have it' with a new date makes that date govern", async () => {
    const { client } = await registered();
    await client.post("/pantry", { name: "yoghurt", quantity: "500", unit: "g", expiry_date: localToday(-1), price: "" });
    const action = doc(await (await client.get("/pantry")).text()).querySelector("#still-have form[action$='/keep']")!.getAttribute("action")!;
    await client.post(action, { return_to: "/pantry", expiry_date: localToday(3) });
    const scene = JSON.parse(doc(await (await client.get("/pantry")).text()).getElementById("kitchen-data")!.textContent!);
    expect(scene[0]).toMatchObject({ name: "yoghurt", fresh: "soon" });
    // a date in the past is refused
    const again = await client.post(action, { return_to: "/pantry", expiry_date: localToday(-5) });
    expect(await again.text()).toContain("has to be today or later");
  });

  it("'It's gone' removes it straight away", async () => {
    const { client } = await registered();
    await client.post("/pantry", { name: "cream", quantity: "300", unit: "ml", expiry_date: localToday(-1), price: "" });
    const action = doc(await (await client.get("/pantry")).text()).querySelector("#still-have form[action$='/gone']")!.getAttribute("action")!;
    await client.post(action, { return_to: "/pantry" });
    expect(await pantryNames(client)).not.toContain("cream");
  });

  it("only the owner can answer for an item", async () => {
    const owner = await registered("owner");
    const other = await registered("other");
    await owner.client.post("/pantry", { name: "spinach", quantity: "500", unit: "g", expiry_date: localToday(-1), price: "" });
    const action = doc(await (await owner.client.get("/pantry")).text()).querySelector("#still-have form[action$='/keep']")!.getAttribute("action")!;
    expect((await other.client.post(action, { return_to: "/pantry" })).status).toBe(404);
    expect((await other.client.post(action.replace("/keep", "/gone"), { return_to: "/pantry" })).status).toBe(404);
  });
});
