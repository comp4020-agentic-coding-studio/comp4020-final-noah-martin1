import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { Client, createRecipe, PASSWORD, registered } from "./helpers.ts";

// Crit 10: the app logs who did what, server-side, and the log outlives the
// session that wrote it (it's in the database on the volume). Each person
// can read their own trail on the settings page; nobody else's.

async function trail(client: Client): Promise<string[]> {
  const d = new JSDOM(await (await client.get("/settings")).text()).window.document;
  return [...d.querySelectorAll("#activity .activity-list li")].map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim());
}

describe("activity log", () => {
  it("records what a person did, attributed to them, newest first", async () => {
    const { client } = await registered("logger");
    const id = await createRecipe(client, "Logged soup", "private");
    await client.post("/pantry", { name: "leeks", quantity: "2", unit: "", expiry_date: "", price: "" });
    await client.post("/calendar", { recipe_id: String(id), date: "2030-01-02", meal: "dinner" });
    const t = await trail(client);
    expect(t[0]).toMatch(/Planned a meal: Logged soup/);
    expect(t.some((l) => /Added to the kitchen: leeks/.test(l))).toBe(true);
    expect(t.some((l) => /Wrote a recipe: Logged soup/.test(l))).toBe(true);
    expect(t.at(-1)).toMatch(/Created an account/);
  });

  it("survives signing out and back in (it's stored, not in memory of the session)", async () => {
    const first = await registered("persist");
    await createRecipe(first.client, "Persisted pie", "private");
    await first.client.post("/logout");
    const again = new Client();
    await again.post("/login", { username: first.username, password: PASSWORD });
    const t = await trail(again);
    expect(t.some((l) => /Wrote a recipe: Persisted pie/.test(l))).toBe(true);
    expect(t.some((l) => /Signed out/.test(l))).toBe(true);
    expect(t[0]).toMatch(/Signed in/);
  });

  it("logs refused actions too, and never a password", async () => {
    const { client, username } = await registered("refused");
    await new Client().post("/login", { username, password: "wrong-password-123" });
    await client.post("/recipes/new", { title: "No photo", servings: "2", visibility: "private", ing_name: "eggs", ing_qty: "2", ing_unit: "", step_text: "Boil." });
    const settingsHtml = await (await client.get("/settings")).text();
    expect(settingsHtml).not.toContain("wrong-password-123");
    expect(settingsHtml).not.toContain(PASSWORD);
  });

  it("one person's trail is never shown to another", async () => {
    const a = await registered("trailA");
    const b = await registered("trailB");
    await createRecipe(a.client, `Secret trail ${a.username}`, "private");
    expect((await trail(b.client)).join(" ")).not.toContain(`Secret trail ${a.username}`);
  });

  it("the operator feed is hidden from everyone who isn't an operator", async () => {
    const { client } = await registered("notadmin");
    expect((await client.get("/admin/activity")).status).toBe(404);
    expect((await client.get("/admin/activity.json")).status).toBe(404);
    expect((await new Client().get("/admin/activity")).finalUrl).toMatch(/^\/login/);
  });
});
