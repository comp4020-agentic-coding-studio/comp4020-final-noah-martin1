import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { befriend, type Client, createRecipe, localToday, registered } from "./helpers.ts";

// The calendar with the week planner built in. The planner is deterministic
// (CLAUDE.md: AI is advisory only), the budget it's given is a ceiling, and
// friends' meals reach the overlay only through visibility.ts.

function doc(markup: string): Document {
  return new JSDOM(markup).window.document;
}

async function planFor(client: Client, params: Record<string, string | string[]>) {
  const q = new URLSearchParams({ plan: "1" });
  for (const [k, v] of Object.entries(params)) for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  const res = await client.get(`/calendar?${q}`);
  expect(res.status).toBe(200);
  const d = doc(await res.text());
  const picks = [...d.querySelectorAll<HTMLElement>(".cal-pick[data-pick-recipe]")].map((li) => ({
    recipe: Number(li.dataset.pickRecipe),
    date: li.dataset.pickDate!,
    cents: Number(li.dataset.costCents),
  }));
  const plan = d.querySelector<HTMLElement>(".cal-plan");
  const form = [...d.querySelectorAll<HTMLInputElement>('form[action="/calendar/plan"] input[name="pick"]')].map((i) => i.value);
  return { picks, total: Number(plan?.dataset.totalCents ?? NaN), form, doc: d };
}

// Recipe ids on a person's own calendar for the week holding `date`.
async function ownRecipes(client: Client, date: string): Promise<number[]> {
  const d = doc(await (await client.get(`/calendar?week=${date}`)).text());
  return [...d.querySelectorAll<HTMLElement>(".cal-tile[data-entry]")].map((t) => Number(t.dataset.recipe));
}

describe("week planner", () => {
  it.each([
    ["$12", "12", "0"],
    ["$25", "25", "3"],
    ["$60", "60", "7"],
    ["$4.50", "4.50", "1"],
  ])("never plans past a %s budget", async (_label, budget, seed) => {
    const { client } = await registered();
    const { picks, total } = await planFor(client, { i: ["budget", "mix", "season"], budget, nights: "7", seed });
    const cap = Math.round(Number(budget) * 100);
    expect(total).toBeLessThanOrEqual(cap);
    expect(picks.reduce((s, p) => s + p.cents, 0)).toBe(total);
    for (const p of picks) expect(p.cents).toBeLessThanOrEqual(cap);
  });

  it("finds a full week when the budget allows it", async () => {
    const { client } = await registered();
    const { picks, total } = await planFor(client, { i: ["budget"], budget: "150", nights: "5" });
    expect(picks).toHaveLength(5);
    expect(total).toBeLessThanOrEqual(15000);
    // five different dinners on five different nights
    expect(new Set(picks.map((p) => p.recipe)).size).toBe(5);
    expect(new Set(picks.map((p) => p.date)).size).toBe(5);
  });

  it("gives the same week for the same choices", async () => {
    const { client } = await registered();
    const params = { i: ["mix", "season"], nights: "5", seed: "4" };
    const a = await planFor(client, params);
    const b = await planFor(client, params);
    expect(a.picks.map((p) => p.recipe)).toEqual(b.picks.map((p) => p.recipe));
  });

  it("'something I haven't tried before' leaves out everything in your history", async () => {
    const { client } = await registered();
    // whatever the planner likes best becomes this person's history...
    const first = await planFor(client, { i: ["mix"], nights: "7" });
    expect(first.picks.length).toBeGreaterThan(0);
    const history = first.picks.map((p) => p.recipe);
    for (const [i, id] of history.entries()) {
      await client.post("/calendar", { recipe_id: String(id), date: `2025-01-${String(i + 1).padStart(2, "0")}`, meal: "dinner" });
    }
    // ...and is never suggested again once "new" is chosen
    const next = await planFor(client, { i: ["mix", "new"], nights: "7" });
    expect(next.picks.length).toBeGreaterThan(0);
    for (const p of next.picks) expect(history).not.toContain(p.recipe);
    // while "my usuals" brings them back
    const usual = await planFor(client, { i: ["usuals"], nights: "3" });
    expect(usual.picks.some((p) => history.includes(p.recipe))).toBe(true);
  });

  it("'add all to calendar' plans the week for the person who asked, and nobody else", async () => {
    const owner = await registered("owner");
    const friend = await registered("friend");
    await befriend(owner, friend);
    const { form, picks } = await planFor(owner.client, { i: ["mix"], nights: "3" });
    expect(form).toHaveLength(3);

    const res = await owner.client.post("/calendar/plan", { pick: form, shared: "1", return_to: "/calendar" });
    expect(res.status).toBe(200);
    expect(res.finalUrl).toMatch(/^\/calendar/);
    const mine = [...new Set([...(await ownRecipes(owner.client, picks[0].date)), ...(await ownRecipes(owner.client, picks.at(-1)!.date))])];
    for (const p of picks) expect(mine).toContain(p.recipe);

    // the friend's own calendar is untouched (they only see it as an overlay)
    expect(await ownRecipes(friend.client, picks[0].date)).toEqual([]);
    const overlay = doc(await (await friend.client.get(`/calendar?week=${picks[0].date}&with=${owner.username}`)).text());
    expect(overlay.querySelectorAll(`.cal-ghost[data-friend="${owner.username.toLowerCase()}"]`).length).toBeGreaterThan(0);
  });

  it("'add all' re-checks every recipe and refuses one you can't see", async () => {
    const author = await registered("author");
    const other = await registered("other");
    const hidden = await createRecipe(author.client, `Hidden ${author.username}`, "private");
    const date = localToday(2);
    const res = await other.client.post("/calendar/plan", { pick: [`${date}|${hidden}`] });
    expect(res.status).toBe(404);
    expect(await ownRecipes(other.client, date)).toEqual([]);
    expect(await ownRecipes(author.client, date)).toEqual([]);
  });

  it("the budget set on the calendar is the one settings and the planner use", async () => {
    const { client } = await registered();
    expect((await client.post("/calendar/budget", { weekly_budget: "73.50", return_to: "/calendar" })).status).toBe(200);
    expect(await (await client.get("/settings")).text()).toContain('value="73.50"');
    expect(await (await client.get("/calendar")).text()).toContain("$73.50");
    expect((await client.post("/calendar/budget", { weekly_budget: "lots" })).status).toBe(422);
  });
});

describe("friends overlay", () => {
  it("shows a friend's shared meals and never their private ones", async () => {
    const me = await registered("me");
    const friend = await registered("friend");
    await befriend(me, friend);
    const date = localToday(1);
    const shared = `Shared ${friend.username}`;
    const secret = `Unshared ${friend.username}`;
    const sharedId = await createRecipe(friend.client, shared, "public");
    const secretId = await createRecipe(friend.client, secret, "public");
    await friend.client.post("/calendar", { recipe_id: String(sharedId), date, meal: "dinner", shared: "1" });
    await friend.client.post("/calendar", { recipe_id: String(secretId), date, meal: "lunch", shared: "0" });

    const off = await (await me.client.get(`/calendar?week=${date}`)).text();
    expect(off).not.toContain(shared);

    const on = await (await me.client.get(`/calendar?week=${date}&with=${friend.username}`)).text();
    expect(on).toContain(shared);
    expect(on).not.toContain(secret);
    const ghost = doc(on).querySelector<HTMLElement>(`.cal-ghost[data-recipe="${sharedId}"]`);
    expect(ghost?.dataset.date).toBe(date);
  });

  it("a shared meal of a recipe you can't see stays hidden", async () => {
    const me = await registered("me");
    const friend = await registered("friend");
    await befriend(me, friend);
    const date = localToday(1);
    const title = `Private dish ${friend.username}`;
    const id = await createRecipe(friend.client, title, "private");
    await friend.client.post("/calendar", { recipe_id: String(id), date, meal: "dinner", shared: "1" });
    expect(await (await me.client.get(`/calendar?week=${date}&with=${friend.username}`)).text()).not.toContain(title);
  });

  it("a stranger can't be overlaid", async () => {
    const me = await registered("me");
    const stranger = await registered("stranger");
    const date = localToday(1);
    const title = `Stranger meal ${stranger.username}`;
    const id = await createRecipe(stranger.client, title, "public");
    await stranger.client.post("/calendar", { recipe_id: String(id), date, meal: "dinner", shared: "1" });

    const page = await (await me.client.get(`/calendar?week=${date}&with=${stranger.username}`)).text();
    expect(page).not.toContain(title);
    expect(page).not.toContain(`data-friend="${stranger.username.toLowerCase()}"`);
    expect(doc(page).querySelectorAll(".cal-ghost")).toHaveLength(0);
  });
});

describe("old planner and schedule pages", () => {
  it.each(["/planner", "/planner/week", "/schedule"])("%s redirects to the calendar", async (path) => {
    const { client } = await registered();
    const res = await fetch(new URL(path, client.base), { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/calendar/);
    const followed = await client.get(path);
    expect(followed.status).toBe(200);
    expect(followed.finalUrl).toMatch(/^\/calendar/);
    expect(await followed.text()).not.toContain("Preview with sample data");
  });

  it("quick add searches the recipe catalogue", async () => {
    const { client } = await registered();
    const res = await client.get("/calendar?partial=quickadd&q=curry");
    expect(res.status).toBe(200);
    const d = doc(await res.text());
    const titles = [...d.querySelectorAll(".cal-result-title")].map((a) => a.textContent ?? "");
    expect(titles.length).toBeGreaterThan(0);
    expect(d.querySelectorAll('form[action="/calendar"] input[name="recipe_id"]').length).toBe(titles.length);
  });
});
