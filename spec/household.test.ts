import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { type Client, createRecipe, localToday, registered } from "./helpers.ts";

// Households (CLAUDE.md product brief): create, join with a code, leave; a
// shared pantry, house calendar and shopping list with claims; the expiry
// race. Membership is the privacy boundary: anything household-scoped answers
// 404 to someone who isn't in that household, never 403.

type Person = Awaited<ReturnType<typeof registered>>;

function doc(markup: string): Document {
  return new JSDOM(markup).window.document;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// The one-shot message a form's redirect lands with.
async function flash(res: Response): Promise<string> {
  return text(doc(await res.text()).querySelector(".flash"));
}

async function create(p: Person, name = `House ${p.username}`): Promise<string> {
  const res = await p.client.post("/household", { name });
  expect(res.status).toBe(200);
  return name;
}

async function inviteCode(client: Client): Promise<string> {
  const page = doc(await (await client.get("/household/members")).text());
  const code = text(page.querySelector(".hh-code-big"));
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  return code;
}

async function join(p: Person, code: string) {
  return p.client.post("/household/join", { code });
}

// A household of two, ready to share.
async function house(): Promise<{ a: Person; b: Person; code: string }> {
  const a = await registered("hha");
  const b = await registered("hhb");
  await create(a);
  const code = await inviteCode(a.client);
  const res = await join(b, code);
  expect(res.finalUrl).toBe("/household");
  return { a, b, code };
}

async function addShared(client: Client, fields: Record<string, string>) {
  return client.post("/household/pantry", { quantity: "1", unit: "", expiry_date: "", price: "", ...fields });
}

// Ids of the house pantry's items, from their edit links.
async function itemIds(client: Client): Promise<Map<string, number>> {
  const page = doc(await (await client.get("/household/pantry")).text());
  const out = new Map<string, number>();
  for (const li of page.querySelectorAll(".hh-item[id^='item-']")) {
    out.set(text(li.querySelector(".item-name")).toLowerCase(), Number(li.id.slice(5)));
  }
  return out;
}

async function shoppingLines(client: Client) {
  const page = doc(await (await client.get("/household/shopping")).text());
  return {
    toBuy: [...page.querySelectorAll(".hh-line")].map((li) => text(li).toLowerCase()),
    covered: [...page.querySelectorAll(".shop-list.covered .shop-line")].map((li) => text(li).toLowerCase()),
    page,
  };
}

describe("households: create, join, leave", () => {
  it("someone with no household gets an explainer with both ways in, on the same page", async () => {
    const p = await registered("hh");
    const res = await p.client.get("/household");
    expect(res.status).toBe(200);
    const page = doc(await res.text());
    expect(page.querySelector('form[action="/household"] input[name="name"]')).not.toBeNull();
    expect(page.querySelector('form[action="/household/join"] input[name="code"]')).not.toBeNull();
    expect(text(page.querySelector("main"))).toMatch(/shared pantry/i);
  });

  it("household pages 404 for someone without a household, and /household/new leads to /household", async () => {
    const p = await registered("hh");
    for (const path of ["/household/pantry", "/household/calendar", "/household/shopping", "/household/members", "/household/state"]) {
      expect((await p.client.get(path)).status, path).toBe(404);
    }
    const res = await p.client.get("/household/new");
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe("/household");
  });

  it("creating needs a name, and makes you the owner with an invite code", async () => {
    const p = await registered("hh");
    expect((await p.client.post("/household", { name: "   " })).status).toBe(422);
    const name = await create(p);
    const members = await (await p.client.get("/household/members")).text();
    expect(members).toContain(name);
    expect(text(doc(members).querySelector(".people .badge"))).toBe("Owner");
    await inviteCode(p.client);
  });

  it("joining takes a code typed any old way; a bad code is a friendly error", async () => {
    const a = await registered("hh");
    const b = await registered("hh");
    const name = await create(a);
    const code = await inviteCode(a.client);

    const bad = await join(b, "NOPE-NOPE");
    expect(bad.status).toBe(422);
    expect(await bad.text()).toMatch(/No household has that code/);

    // lower case, no dash, stray spaces
    const ok = await join(b, ` ${code.replace("-", "").toLowerCase()} `);
    expect(ok.finalUrl).toBe("/household");
    expect(await ok.text()).toContain(name);
    expect(await (await a.client.get("/household/members")).text()).toContain(b.username);
  });

  it("one household at a time: someone already in one can't create or join another", async () => {
    const { a } = await house();
    const c = await registered("hh");
    await create(c);
    const otherCode = await inviteCode(c.client);
    const res = await join(a, otherCode);
    expect(res.finalUrl).toBe("/household/members");
    expect(await (await c.client.get("/household/members")).text()).not.toContain(a.username);
    await a.client.post("/household", { name: "Second house" });
    expect(await (await a.client.get("/household")).text()).not.toContain("Second house");
  });

  it("a new invite code stops the old one working; only the owner can make one", async () => {
    const { a, b, code } = await house();
    expect((await b.client.post("/household/code")).status).toBe(403);
    await a.client.post("/household/code");
    const fresh = await inviteCode(a.client);
    expect(fresh).not.toBe(code);
    const late = await registered("hh");
    expect((await join(late, code)).status).toBe(422);
    expect((await join(late, fresh)).finalUrl).toBe("/household");
  });

  it("leaving hands ownership on; the last one out closes the household and its shared stock", async () => {
    const { a, b, code } = await house();
    await addShared(a.client, { name: "rice", quantity: "1000", unit: "g" });
    const id = [...(await itemIds(a.client)).values()][0];

    await a.client.post("/household/leave");
    expect((await a.client.get("/household/pantry")).status).toBe(404);
    const members = doc(await (await b.client.get("/household/members")).text());
    expect(text(members.querySelector(".people .badge"))).toBe("Owner");
    // what a added stays with the house
    expect((await itemIds(b.client)).has("rice")).toBe(true);

    await b.client.post("/household/leave");
    expect((await b.client.get("/household")).status).toBe(200);
    expect(await (await b.client.get("/household")).text()).toContain("Join with an invite code");
    // the house is gone: its code no longer works and its item no longer exists for anyone
    const late = await registered("hh");
    expect((await join(late, code)).status).toBe(422);
    await create(late);
    expect((await late.client.post(`/household/pantry/${id}/delete`)).status).toBe(404);
  });
});

describe("households: membership is the boundary", () => {
  it("a member of another household can't read, edit, remove or claim this house's items", async () => {
    const { a } = await house();
    await addShared(a.client, { name: "saffron", quantity: "1", unit: "g", expiry_date: localToday(1) });
    const id = (await itemIds(a.client)).get("saffron")!;
    expect(id).toBeGreaterThan(0);

    const outsider = await registered("hhx");
    await create(outsider);
    expect(await (await outsider.client.get("/household/pantry")).text()).not.toContain("saffron");
    const edit = await outsider.client.post(`/household/pantry/${id}`, { name: "stolen", quantity: "0", unit: "", expiry_date: "", price: "" });
    expect(edit.status).toBe(404);
    expect((await outsider.client.post(`/household/pantry/${id}/delete`)).status).toBe(404);
    expect((await outsider.client.post(`/household/items/${id}/tonight`)).status).toBe(404);
    expect((await outsider.client.get(`/household/pantry?edit=${id}`)).status).toBe(200);
    expect(await (await outsider.client.get(`/household/pantry?edit=${id}`)).text()).not.toContain("saffron");
    // and nothing changed for the house
    expect((await itemIds(a.client)).get("saffron")).toBe(id);
  });

  it("someone with no household gets 404 on every household write", async () => {
    const { a } = await house();
    await addShared(a.client, { name: "paprika" });
    const id = (await itemIds(a.client)).get("paprika")!;
    const stranger = await registered("hhx");
    for (const path of [`/household/pantry/${id}/delete`, `/household/items/${id}/tonight`, "/household/pantry", "/household/budget", "/household/code"]) {
      expect((await stranger.client.post(path, { name: "x", quantity: "1", budget: "10" })).status, path).toBe(404);
    }
  });

  it("a personal pantry item can't be edited through the household routes", async () => {
    const { a, b } = await house();
    await b.client.post("/pantry", { name: "secret truffle", quantity: "1", unit: "", expiry_date: "", price: "" });
    const personal = doc(await (await b.client.get("/pantry")).text());
    const href = personal.querySelector('a[href^="/pantry?edit="]')?.getAttribute("href") ?? "";
    const id = Number(href.split("=")[1]);
    expect(id).toBeGreaterThan(0);
    expect((await a.client.post(`/household/pantry/${id}/delete`)).status).toBe(404);
    // nor moved into the house by someone else
    expect((await a.client.post("/household/pantry/move", { item_id: String(id) })).status).toBe(404);
    expect(await (await b.client.get("/pantry")).text()).toContain("secret truffle");
  });

  it("the shared pantry is visible to every member, with who added each item", async () => {
    const { a, b } = await house();
    await addShared(a.client, { name: "oat milk", quantity: "2", unit: "l", price: "4.20" });
    const page = await (await b.client.get("/household/pantry")).text();
    expect(page).toContain("oat milk");
    expect(page).toMatch(/added by Test/);
  });

  it("shared pantry validation matches the personal pantry", async () => {
    const { a } = await house();
    const cases: Record<string, string>[] = [{ quantity: "-1" }, { price: "abc" }, { expiry_date: "2026-02-30" }, { name: "" }];
    for (const bad of cases) {
      const res = await addShared(a.client, { name: "flour", ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
  });
});

describe("households: the expiry race", () => {
  it("a claim by one member is visible to the other, who can't take it", async () => {
    const { a, b } = await house();
    await addShared(a.client, { name: "cream", quantity: "300", unit: "ml", expiry_date: localToday(1) });
    const id = (await itemIds(a.client)).get("cream")!;

    await a.client.post(`/household/items/${id}/tonight`, { return_to: "/household" });
    const overview = doc(await (await b.client.get("/household")).text());
    const row = [...overview.querySelectorAll(".hh-race-item")].find((li) => text(li).includes("cream"));
    expect(text(row)).toMatch(/is using it tonight/);
    expect(row?.querySelector(`form[action="/household/items/${id}/tonight"]`)).toBeNull();

    // b tries anyway: a keeps it
    const taken = await b.client.post(`/household/items/${id}/tonight`, { return_to: "/household" });
    expect(await flash(taken)).toMatch(/Too late/);
    const state = await (await b.client.get("/household/state")).json();
    expect(state.claims.tonight.find((c: { item: string }) => c.item === "cream")?.by).toMatch(/^Test hha_/);

    // only the claimer can let go
    await b.client.post(`/household/items/${id}/release`);
    expect((await (await a.client.get("/household/state")).json()).claims.tonight.length).toBe(1);
    await a.client.post(`/household/items/${id}/release`);
    expect((await (await a.client.get("/household/state")).json()).claims.tonight.length).toBe(0);
  });

  it("only items about to go off can be raced for", async () => {
    const { a } = await house();
    await addShared(a.client, { name: "honey", expiry_date: localToday(60) });
    const id = (await itemIds(a.client)).get("honey")!;
    const res = await a.client.post(`/household/items/${id}/tonight`);
    expect(await flash(res)).toMatch(/isn't about to go off/);
    expect((await (await a.client.get("/household/state")).json()).claims.tonight.length).toBe(0);
  });
});

describe("households: calendar and shared shopping", () => {
  it("the shopping list is house meals minus fresh household stock", async () => {
    const { a, b } = await house();
    // createRecipe: 3 eggs, 100 g spinach; public so the whole house can open it
    const recipe = await createRecipe(a.client, `House list ${a.username}`, "public");
    const plan = await a.client.post("/household/calendar", { recipe_id: String(recipe), date: localToday(1), meal: "dinner" });
    expect(plan.status).toBe(200);
    expect(await (await b.client.get(`/household/calendar?week=${localToday(1)}`)).text()).toContain(`House list ${a.username}`);

    await addShared(b.client, { name: "eggs", quantity: "2", unit: "" });
    await addShared(b.client, { name: "spinach", quantity: "500", unit: "g", expiry_date: "2020-01-01" }); // expired: doesn't count
    let { toBuy, covered } = await shoppingLines(a.client);
    expect(toBuy.find((l) => l.includes("eggs"))).toMatch(/^1 eggs/);
    expect(toBuy.find((l) => l.includes("spinach"))).toMatch(/^100 g spinach/);

    await addShared(b.client, { name: "spinach", quantity: "150", unit: "g" });
    ({ toBuy, covered } = await shoppingLines(a.client));
    expect(toBuy.some((l) => l.includes("spinach"))).toBe(false);
    expect(covered.some((l) => l.includes("spinach"))).toBe(true);
    // the personal shopping list is untouched by house meals
    expect(await (await a.client.get("/shopping")).text()).not.toContain(`House list ${a.username}`);
  });

  it("claim and unclaim: one claimer per item, seen by everyone", async () => {
    const { a, b } = await house();
    const recipe = await createRecipe(a.client, `Claim test ${a.username}`, "public");
    await a.client.post("/household/calendar", { recipe_id: String(recipe), date: localToday(), meal: "dinner" });
    const { page } = await shoppingLines(a.client);
    const action = page.querySelector('form[action$="/claim"]')?.getAttribute("action") ?? "";
    expect(action).toMatch(/^\/household\/shopping\/\d+\/claim$/);

    await a.client.post(action);
    let other = await shoppingLines(b.client);
    expect(other.toBuy.some((l) => /'s got this/.test(l))).toBe(true);
    expect(other.page.querySelector(`form[action="${action}"]`)).toBeNull();

    // b can't take or drop a's claim
    expect(await flash(await b.client.post(action))).toMatch(/already has/);
    await b.client.post(action.replace("/claim", "/unclaim"));
    expect((await (await b.client.get("/household/state")).json()).claims.shopping.length).toBe(1);

    await a.client.post(action.replace("/claim", "/unclaim"));
    other = await shoppingLines(b.client);
    expect(other.page.querySelector(`form[action="${action}"]`)).not.toBeNull();
  });

  it("removing the meal drops its claims, so they never resurface on a later list", async () => {
    const { a, b } = await house();
    const recipe = await createRecipe(a.client, `Prune test ${a.username}`, "public");
    await a.client.post("/household/calendar", { recipe_id: String(recipe), date: localToday(), meal: "dinner" });
    const claim = (await shoppingLines(b.client)).page.querySelector('form[action$="/claim"]')!.getAttribute("action")!;
    await b.client.post(claim);
    expect((await (await a.client.get("/household/state")).json()).claims.shopping.length).toBe(1);

    const cal = doc(await (await a.client.get("/household/calendar")).text());
    await a.client.post(cal.querySelector('form[action$="/delete"]')!.getAttribute("action")!);
    expect((await (await a.client.get("/household/state")).json()).claims.shopping.length).toBe(0);
  });

  it("'Bought it' puts the item in the shared pantry and takes it off the list", async () => {
    const { a, b } = await house();
    const recipe = await createRecipe(a.client, `Bought test ${a.username}`, "public");
    await a.client.post("/household/calendar", { recipe_id: String(recipe), date: localToday(), meal: "dinner" });
    const { page } = await shoppingLines(a.client);
    const line = [...page.querySelectorAll(".hh-line")].find((li) => text(li).toLowerCase().includes("spinach"))!;
    const claim = line.querySelector('form[action$="/claim"]')!.getAttribute("action")!;
    await a.client.post(claim);
    await a.client.post(claim.replace("/claim", "/bought"));
    expect((await shoppingLines(b.client)).toBuy.some((l) => l.includes("spinach"))).toBe(false);
    expect((await itemIds(b.client)).has("spinach")).toBe(true);
  });

  it("a recipe someone in the house can't open can't go on the house calendar", async () => {
    const { a, b } = await house();
    const secret = await createRecipe(a.client, `Secret ${a.username}`, "private");
    const res = await a.client.post("/household/calendar", { recipe_id: String(secret), date: localToday(1), meal: "dinner" });
    expect(await flash(res)).toMatch(/can't open/);
    expect(await (await b.client.get(`/household/calendar?week=${localToday(1)}`)).text()).not.toContain(`Secret ${a.username}`);
  });

  it("house meals can be marked cooked and removed by any member, but not by outsiders", async () => {
    const { a, b } = await house();
    const recipe = await createRecipe(a.client, `Status test ${a.username}`, "public");
    await a.client.post("/household/calendar", { recipe_id: String(recipe), date: localToday(), meal: "dinner" });
    const page = doc(await (await b.client.get("/household/calendar")).text());
    const action = page.querySelector('form[action$="/status"]')?.getAttribute("action") ?? "";
    expect(action).toMatch(/^\/household\/calendar\/\d+\/status$/);

    const outsider = await registered("hhx");
    await create(outsider);
    expect((await outsider.client.post(action, { status: "completed" })).status).toBe(404);
    expect((await outsider.client.post(action.replace("/status", "/delete"))).status).toBe(404);

    await b.client.post(action, { status: "completed" });
    expect(await (await a.client.get("/household")).text()).toMatch(/cooked Status test/);
    await a.client.post(action.replace("/status", "/delete"));
    expect(await (await b.client.get("/household/calendar")).text()).not.toContain(`Status test ${a.username}`);
  });

  it("the budget ticker reads the household's weekly budget, which any member can set", async () => {
    const { a, b } = await house();
    expect((await b.client.post("/household/budget", { budget: "abc" })).status).toBe(200);
    await b.client.post("/household/budget", { budget: "150" });
    const ticker = doc(await (await a.client.get("/household")).text()).querySelector("[data-hh-region='ticker']");
    expect(text(ticker)).toMatch(/\$150\.00 weekly budget/);
  });

  it("adding stock that completes a planned house meal nudges the house", async () => {
    const { a, b } = await house();
    const recipe = await createRecipe(a.client, `Nudge test ${a.username}`, "public");
    await a.client.post("/household/calendar", { recipe_id: String(recipe), date: localToday(1), meal: "dinner" });
    await addShared(b.client, { name: "spinach", quantity: "200", unit: "g" });
    // eggs complete it
    await addShared(b.client, { name: "eggs", quantity: "6", unit: "" });
    const activity = text(doc(await (await a.client.get("/household")).text()).querySelector("[data-hh-region='activity']"));
    expect(activity).toMatch(new RegExp(`added eggs, so tomorrow's Nudge test ${a.username} is now fully covered`));
  });
});

describe("households: the live endpoint", () => {
  it("the version moves when a housemate changes something, and the change is reported", async () => {
    const { a, b } = await house();
    const before = (await (await a.client.get("/household/state")).json()).version;
    await addShared(b.client, { name: "lemons", quantity: "3", unit: "" });
    const after = await (await a.client.get(`/household/state?since=${before}`)).json();
    expect(after.version).toBeGreaterThan(before);
    expect(after.events.some((e: { text: string }) => e.text.includes("lemons"))).toBe(true);
  });
});
