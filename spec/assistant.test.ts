import { describe, expect, it } from "vitest";
import { Client, createRecipe, registered } from "./helpers.ts";

// "Ask about this recipe" answers from checked facts (a substitution table,
// the pantry, plain scaling maths), so it works with no AI model at all, and
// it obeys the same visibility rules as the recipe page (CLAUDE.md: AI is
// advisory; every visibility decision goes through visibility.ts).
describe("ask about this recipe", () => {
  it("answers a substitution question from the checked table, signed out", async () => {
    const author = await registered("asker");
    const id = await createRecipe(author.client, `Spinach eggs ${author.username}`, "public");
    const res = await new Client().get(`/recipes/${id}/ask?q=${encodeURIComponent("what can I use instead of spinach?")}`);
    expect(res.status).toBe(200);
    const a = await res.json();
    expect(a.kind).toBe("swap");
    expect(a.headline).toContain("spinach");
    expect(a.lines.join(" ")).toMatch(/kale|silverbeet/);
  });

  it("says plainly when it has no checked answer instead of guessing", async () => {
    const author = await registered("asker");
    const id = await createRecipe(author.client, `Spinach eggs ${author.username}`, "public");
    const a = await (await new Client().get(`/recipes/${id}/ask?q=${encodeURIComponent("what wine goes with this")}`)).json();
    expect(a.kind).toBe("unknown");
  });

  it("works without JavaScript: the form reloads the page with the answer", async () => {
    const author = await registered("asker");
    const id = await createRecipe(author.client, `Spinach eggs ${author.username}`, "public");
    const page = await (await new Client().get(`/recipes/${id}?ask=${encodeURIComponent("double it")}`)).text();
    expect(page).toContain("For 4, multiply everything by 2.");
  });

  it("a private recipe can't be asked about by anyone else", async () => {
    const author = await registered("asker");
    const id = await createRecipe(author.client, `Secret eggs ${author.username}`, "private");
    const stranger = await registered("stranger");
    expect((await stranger.client.get(`/recipes/${id}/ask?q=double`)).status).toBe(404);
    expect((await new Client().get(`/recipes/${id}/ask?q=double`)).status).toBe(404);
    expect((await author.client.get(`/recipes/${id}/ask?q=double`)).status).toBe(200);
  });

  it("checks what you're missing against your own pantry only", async () => {
    const cook = await registered("asker");
    const id = await createRecipe(cook.client, `Spinach eggs ${cook.username}`, "public");
    await cook.client.post("/pantry", { name: "eggs", quantity: "6", unit: "", expiry_date: "", price: "" });
    const mine = await (await cook.client.get(`/recipes/${id}/ask?q=${encodeURIComponent("what am I missing?")}`)).json();
    expect(mine.headline).toBe("You're missing 1 of 2.");
    expect(mine.lines.join(" ")).toContain("spinach");
    // someone else asking sees their own (empty) pantry, never the cook's
    const other = await registered("asker");
    const theirs = await (await other.client.get(`/recipes/${id}/ask?q=${encodeURIComponent("what am I missing?")}`)).json();
    expect(theirs.headline).toBe("You're missing 2 of 2.");
  });
});
