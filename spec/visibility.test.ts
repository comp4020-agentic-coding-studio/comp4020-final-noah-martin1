import { describe, expect, it } from "vitest";
import { befriend, Client, createRecipe, localToday, registered } from "./helpers.ts";

// CLAUDE.md invariant 4 (the Phase 0 part): someone who isn't an accepted
// friend never sees another person's friends-only or private recipes, nor
// their shared meals.
describe("who sees what", () => {
  it("friends-only recipes reach friends and nobody else", async () => {
    const author = await registered("author");
    const friend = await registered("friend");
    const stranger = await registered("stranger");
    await befriend(author, friend);
    const title = `Friends-only ${author.username}`;
    const id = await createRecipe(author.client, title, "friends");

    expect((await friend.client.get(`/recipes/${id}`)).status).toBe(200);
    expect(await (await friend.client.get("/feed")).text()).toContain(title);

    expect((await stranger.client.get(`/recipes/${id}`)).status).toBe(404);
    expect(await (await stranger.client.get(`/u/${author.username}`)).text()).not.toContain(title);
    expect(await (await stranger.client.get("/recipes?tab=discover")).text()).not.toContain(title);
    expect((await new Client().get(`/recipes/${id}`)).status).toBe(404);
  });

  it("private recipes are visible only to their author", async () => {
    const author = await registered("author");
    const friend = await registered("friend");
    await befriend(author, friend);
    const id = await createRecipe(author.client, `Private ${author.username}`, "private");

    expect((await author.client.get(`/recipes/${id}`)).status).toBe(200);
    expect((await friend.client.get(`/recipes/${id}`)).status).toBe(404);
  });

  it("public recipes are visible to anyone, signed in or not", async () => {
    const author = await registered("author");
    const id = await createRecipe(author.client, `Public ${author.username}`, "public");
    expect((await new Client().get(`/recipes/${id}`)).status).toBe(200);
  });

  it("only the author can edit or delete a recipe", async () => {
    const author = await registered("author");
    const other = await registered("other");
    const id = await createRecipe(author.client, `Mine ${author.username}`, "public");
    expect((await other.client.get(`/recipes/${id}/edit`)).status).toBe(403);
    expect((await other.client.post(`/recipes/${id}/delete`)).status).toBe(403);
    expect((await author.client.get(`/recipes/${id}`)).status).toBe(200);
  });

  it("a shared meal never leaks the title of a recipe the friend can't see", async () => {
    const author = await registered("author");
    const friend = await registered("friend");
    await befriend(author, friend);
    const title = `Secret ${author.username}`;
    const id = await createRecipe(author.client, title, "private");
    await author.client.post("/calendar", {
      recipe_id: String(id),
      date: localToday(),
      meal: "dinner",
      shared: "1",
    });
    expect(await (await friend.client.get(`/u/${author.username}`)).text()).not.toContain(title);
    expect(await (await friend.client.get("/feed")).text()).not.toContain(title);
  });

  it("you cannot plan a meal from a recipe you can't see", async () => {
    const author = await registered("author");
    const stranger = await registered("stranger");
    const id = await createRecipe(author.client, `Hidden ${author.username}`, "friends");
    const res = await stranger.client.post("/calendar", {
      recipe_id: String(id),
      date: "2026-10-10",
      meal: "dinner",
    });
    expect(res.status).toBe(404);
  });

  it("cook mode follows the recipe's visibility", async () => {
    const author = await registered("author");
    const stranger = await registered("stranger");
    const id = await createRecipe(author.client, `Cook ${author.username}`, "friends");
    expect((await author.client.get(`/recipes/${id}/cook`)).status).toBe(200);
    expect((await stranger.client.get(`/recipes/${id}/cook`)).status).toBe(404);
  });

  it("cook mode never offers to complete someone else's planned meal", async () => {
    const author = await registered("author");
    const other = await registered("other");
    const id = await createRecipe(author.client, `Meal ${author.username}`, "public");
    await author.client.post("/calendar", { recipe_id: String(id), date: localToday(), meal: "dinner" });
    const cal = await (await author.client.get("/calendar")).text();
    const entry = cal.match(/\/cook\?entry=(\d+)/)?.[1];
    expect(entry).toBeDefined();
    expect(await (await author.client.get(`/recipes/${id}/cook?entry=${entry}`)).text()).toContain("Mark as cooked");
    expect(await (await other.client.get(`/recipes/${id}/cook?entry=${entry}`)).text()).not.toContain("Mark as cooked");
    expect((await other.client.post(`/calendar/${entry}/status`, { status: "completed" })).status).toBe(404);
  });
});
