import { describe, expect, it } from "vitest";
import { registered } from "./helpers.ts";

const valid = {
  display_name: "Renamed Person",
  dislikes: "coriander",
  default_servings: "4",
  weekly_budget: "80",
  default_visibility: "private",
  diet: ["vegetarian"],
};

describe("settings", () => {
  it("saves preferences that the rest of the app reads", async () => {
    const { client } = await registered();
    const res = await client.post("/settings", valid);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Settings saved");

    expect(await (await client.get("/")).text()).toContain("Renamed Person");
    expect(await (await client.get("/planner")).text()).toContain("$80.00");
    // new recipes default to the chosen visibility and servings
    const form = await (await client.get("/recipes/new")).text();
    expect(form).toMatch(/value="private" checked/);
    expect(form).toMatch(/name="servings"[^>]*value="4"/);
  });

  it.each([
    ["a negative budget", { weekly_budget: "-5" }],
    ["a non-numeric budget", { weekly_budget: "lots" }],
    ["an empty display name", { display_name: "" }],
    ["zero servings", { default_servings: "0" }],
  ])("refuses %s", async (_label, change) => {
    const { client } = await registered();
    const res = await client.post("/settings", { ...valid, ...change });
    expect(res.status).toBe(422);
  });

  it("changes the password only with the current one", async () => {
    const { client } = await registered();
    expect((await client.post("/settings/password", { current: "wrong password", next: "brand new password" })).status).toBe(422);
    expect((await client.post("/settings/password", { current: "correct horse battery", next: "brand new password" })).status).toBe(200);
  });
});
