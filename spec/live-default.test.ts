import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { befriend, Client, createRecipe, registered } from "./helpers.ts";

// Cooking is live by default: opening cook mode starts a session (the page
// posts /live/auto), never wider than the person's default visibility or
// the recipe's, on the map only at a city they chose themselves. A setting
// turns it off for good; a button turns it off for this session.

type Person = { client: Client; username: string };

async function postJson(client: Client, path: string, fields: Record<string, string> = {}) {
  const res = await client.request(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    // an HTML page
  }
  return { status: res.status, body };
}

async function globeIds(client: Client): Promise<string[]> {
  const { sessions } = (await (await client.get("/global/sessions.json")).json()) as { sessions: { id: string }[] };
  return sessions.map((s) => s.id);
}

async function settings(p: Person, fields: Record<string, string>) {
  const page = new JSDOM(await (await p.client.get("/settings")).text()).window.document;
  const name = (page.querySelector("input[name=display_name]") as HTMLInputElement).value;
  return p.client.post("/settings", { display_name: name, default_servings: "2", weekly_budget: "", default_visibility: "friends", live_fields: "1", ...fields });
}

describe("live cooking by default", () => {
  it("cook mode marks itself to go live automatically, and the banner says so", async () => {
    const cook = await registered("cook");
    const id = await createRecipe(cook.client, `Auto ${cook.username}`, "public");
    const page = new JSDOM(await (await cook.client.get(`/recipes/${id}/cook`)).text()).window.document;
    expect(page.querySelector("[data-live-root]")?.hasAttribute("data-auto-live")).toBe(true);
    expect(page.querySelector("[data-live-banner]")?.textContent).toMatch(/Not live/);
    // without JavaScript the Go live form is still there
    expect(page.querySelector("form[action='/live/start']")).not.toBeNull();
  });

  it("starts a session at the person's default visibility, listed but not on the map", async () => {
    const cook = await registered("cook");
    const friend = await registered("friend");
    const stranger = await registered("stranger");
    await befriend(cook, friend);
    const id = await createRecipe(cook.client, `Auto vis ${cook.username}`, "public");
    const r = await postJson(cook.client, "/live/auto", { recipe_id: String(id), serves: "2" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, visibility: "friends", city: "" });
    const sid = String(r.body.id);
    // default visibility is friends: a friend sees it, a stranger and a guest don't
    expect(await globeIds(friend.client)).toContain(sid);
    expect(await globeIds(stranger.client)).not.toContain(sid);
    expect(await globeIds(new Client())).not.toContain(sid);
    // the page now shows it live, with a working off switch
    const page = new JSDOM(await (await cook.client.get(`/recipes/${id}/cook`)).text()).window.document;
    expect(page.querySelector("[data-live-banner]")?.textContent).toMatch(/You're live/);
    expect(page.querySelector("[data-live-banner]")?.textContent).toMatch(/not on the map/);
    const off = page.querySelector<HTMLFormElement>("[data-live-off]")!;
    expect(off.hasAttribute("hidden")).toBe(false);
    expect(off.getAttribute("action")).toBe(`/live/${sid}/end`);
    // turning it off ends the session and takes it off the globe
    expect((await postJson(cook.client, `/live/${sid}/end`, { reason: "ended" })).status).toBe(200);
    expect(await globeIds(friend.client)).not.toContain(sid);
  });

  it("is idempotent: opening cook mode again while live doesn't start a second session", async () => {
    const cook = await registered("cook");
    const id = await createRecipe(cook.client, `Auto again ${cook.username}`, "public");
    const first = await postJson(cook.client, "/live/auto", { recipe_id: String(id) });
    const again = await postJson(cook.client, "/live/auto", { recipe_id: String(id) });
    expect(again.body).toMatchObject({ ok: true, id: first.body.id, already: true });
    // live with another recipe: it doesn't end that one behind the cook's back
    const other = await createRecipe(cook.client, `Auto other ${cook.username}`, "public");
    expect((await postJson(cook.client, "/live/auto", { recipe_id: String(other) })).body).toMatchObject({ ok: false, reason: "elsewhere" });
    await postJson(cook.client, `/live/${first.body.id}/end`);
  });

  it("never shows a private recipe more widely, even with a public default", async () => {
    const cook = await registered("cook");
    const friend = await registered("friend");
    await befriend(cook, friend);
    await settings(cook, { default_visibility: "public", auto_live: "1" });
    const id = await createRecipe(cook.client, `Auto private ${cook.username}`, "private");
    const r = await postJson(cook.client, "/live/auto", { recipe_id: String(id) });
    expect(r.body).toMatchObject({ ok: true, visibility: "private" });
    expect(await globeIds(friend.client)).not.toContain(String(r.body.id));
    expect(await globeIds(new Client())).not.toContain(String(r.body.id));
    await postJson(cook.client, `/live/${r.body.id}/end`);
  });

  it("appears at the city the person last chose by hand, never their device location", async () => {
    const cook = await registered("cook");
    const id = await createRecipe(cook.client, `Auto city ${cook.username}`, "public");
    const manual = await postJson(cook.client, "/live/start", { recipe_id: String(id), visibility: "public", city: "melbourne", serves: "2" });
    await postJson(cook.client, `/live/${manual.body.id}/end`);
    const r = await postJson(cook.client, "/live/auto", { recipe_id: String(id) });
    expect(r.body).toMatchObject({ ok: true, city: "Melbourne" });
    await postJson(cook.client, `/live/${r.body.id}/end`);
    // a device location is used once and never remembered for automatic sessions
    await postJson(cook.client, "/live/start", { recipe_id: String(id), visibility: "public", where: "near", lat: "-33.86", lng: "151.2", serves: "2" });
    const open = (await (await cook.client.get(`/recipes/${id}/cook`)).text()).match(/data-session="(\d+)"/)?.[1];
    await postJson(cook.client, `/live/${open}/end`);
    const again = await postJson(cook.client, "/live/auto", { recipe_id: String(id) });
    expect(again.body).toMatchObject({ ok: true, city: "Melbourne" });
    await postJson(cook.client, `/live/${again.body.id}/end`);
  });

  it("the setting turns it off for later sessions, and it persists", async () => {
    const cook = await registered("cook");
    const id = await createRecipe(cook.client, `Auto off ${cook.username}`, "public");
    expect((await settings(cook, { default_visibility: "friends" })).status).toBe(200);
    const page = new JSDOM(await (await cook.client.get("/settings")).text()).window.document;
    expect((page.querySelector("input[name=auto_live]") as HTMLInputElement).checked).toBe(false);
    const r = await postJson(cook.client, "/live/auto", { recipe_id: String(id) });
    expect(r.body).toMatchObject({ ok: false, reason: "off" });
    const cookPage = new JSDOM(await (await cook.client.get(`/recipes/${id}/cook`)).text()).window.document;
    expect(cookPage.querySelector("[data-live-root]")?.hasAttribute("data-auto-live")).toBe(false);
    expect(cookPage.querySelector("[data-live-banner]")?.textContent).toMatch(/Automatic live is off/);
    // going live by hand still works
    const manual = await postJson(cook.client, "/live/start", { recipe_id: String(id), visibility: "friends", city: "none", serves: "2" });
    expect(manual.status).toBe(200);
    await postJson(cook.client, `/live/${manual.body.id}/end`);
    // and turning it back on works too
    await settings(cook, { default_visibility: "friends", auto_live: "1" });
    expect((await postJson(cook.client, "/live/auto", { recipe_id: String(id) })).body).toMatchObject({ ok: true });
  });

  it("guests and hidden recipes can't auto-start", async () => {
    const owner = await registered("owner");
    const other = await registered("other");
    const id = await createRecipe(owner.client, `Auto hidden ${owner.username}`, "private");
    expect((await postJson(other.client, "/live/auto", { recipe_id: String(id) })).status).toBe(404);
    expect((await new Client().post("/live/auto", { recipe_id: String(id) })).finalUrl).toMatch(/^\/login/);
  });
});
