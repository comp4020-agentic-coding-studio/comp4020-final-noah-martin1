import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { seedCatalogue } from "../src/catalogue.ts";
import { all, one, run } from "../src/db.ts";
import { listVisibleRecipes } from "../src/recipes.ts";
import { seedSampleReviews } from "../src/sample-reviews.ts";
import { Client, createRecipe, registered } from "./helpers.ts";

// The "Top rated" recipe filter, the sample reviews that give it something
// to rank before real people have reviewed much, and who those sample
// reviewers are (nobody: no sign-in, no profile, not in people search).

type Person = Awaited<ReturnType<typeof registered>>;
const doc = async (c: Client, path: string) => new JSDOM(await (await c.get(path)).text()).window.document;
const tileTitles = (d: Document) => [...d.querySelectorAll("a.rx-tile h3")].map((h) => h.textContent!.trim());
async function review(p: Person, recipe: number, rating: number, body = "Cooked it, here's how it went.") {
  const res = await p.client.request(`/recipes/${recipe}/reviews`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ rating: String(rating), body }),
  });
  if (res.status !== 200) throw new Error(`review failed: ${res.status}`);
}

describe("Top rated", () => {
  it("lists only reviewed recipes, best first, and one 5-star review doesn't beat many good ones", async () => {
    const author = await registered("tr");
    const tag = author.username;
    // a search for this person's titles keeps the list to this test's recipes
    const lone = await createRecipe(author.client, `${tag} lone five`, "public");
    const loved = await createRecipe(author.client, `${tag} loved`, "public");
    const meh = await createRecipe(author.client, `${tag} meh`, "public");
    await createRecipe(author.client, `${tag} unreviewed`, "public");
    // one post each (posting is throttled per person)
    const people = await Promise.all([...Array(8)].map(() => registered("trv")));
    // loved: five people, average 4.8; lone: one 5; meh: two 2s
    await Promise.all([
      ...people.slice(0, 5).map((p, i) => review(p, loved, i === 0 ? 4 : 5)),
      review(people[5], lone, 5),
      ...people.slice(6).map((p) => review(p, meh, 2)),
    ]);

    const guest = new Client();
    const d = await doc(guest, `/recipes?rated=1&q=${encodeURIComponent(tag)}`);
    expect(tileTitles(d)).toEqual([`${tag} loved`, `${tag} lone five`, `${tag} meh`]);
    // (a search is headed by what was searched; unsearched, by the filter)
    expect((await doc(guest, "/recipes?rated=1")).querySelector("[data-results-heading]")?.textContent).toBe("Top rated");
    // the chip shows it's on, and turning it off brings back the unreviewed one
    const chip = [...d.querySelectorAll<HTMLAnchorElement>("a.rx-chip")].find((a) => a.textContent!.includes("Top rated"))!;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.getAttribute("href")).not.toContain("rated=1");
    // searching again from the page keeps the filter
    expect(d.querySelector('form input[name="rated"]')?.getAttribute("value")).toBe("1");
    const off = await doc(guest, chip.getAttribute("href")!);
    expect(tileTitles(off)).toContain(`${tag} unreviewed`);
    // "All" clears it too
    const allChip = [...d.querySelectorAll<HTMLAnchorElement>("a.rx-chip")].find((a) => a.textContent!.trim() === "All")!;
    expect(allChip.getAttribute("href")).not.toContain("rated");
  });

  it("each tile shows its stars and how many reviews; unreviewed tiles show none", async () => {
    const author = await registered("ts");
    const tag = author.username;
    const id = await createRecipe(author.client, `${tag} starred`, "public");
    await createRecipe(author.client, `${tag} plain`, "public");
    const [a, b] = await Promise.all([registered("tsa"), registered("tsb")]);
    await Promise.all([review(a, id, 5), review(b, id, 4)]);

    const d = await doc(new Client(), `/recipes?q=${encodeURIComponent(tag)}`);
    const tile = (title: string) => [...d.querySelectorAll("a.rx-tile")].find((t) => t.querySelector("h3")!.textContent!.trim() === title)!;
    const stars = tile(`${tag} starred`).querySelector(".rx-stars")!;
    expect(stars.textContent!.replace(/\s+/g, "")).toBe("4.5(2)");
    expect(stars.getAttribute("aria-label")).toBe("4.5 out of 5 stars from 2 reviews");
    expect(tile(`${tag} plain`).querySelector(".rx-stars")).toBeNull();
  });

  it("follows recipe visibility: a friends-only recipe is ranked only for its author's friends", async () => {
    const author = await registered("tv");
    const tag = author.username;
    const id = await createRecipe(author.client, `${tag} secret`, "friends");
    // the author can't rate their own, so a friend does
    const friend = await registered("tvf");
    await friend.client.post(`/friends/${author.username}/request`);
    await author.client.post(`/friends/${friend.username}/accept`);
    await review(friend, id, 5);
    expect(tileTitles(await doc(friend.client, `/recipes?rated=1&q=${encodeURIComponent(tag)}`))).toEqual([`${tag} secret`]);
    expect(tileTitles(await doc(new Client(), `/recipes?rated=1&q=${encodeURIComponent(tag)}`))).toEqual([]);
    const stranger = await registered("tvs");
    expect(tileTitles(await doc(stranger.client, `/recipes?rated=1&q=${encodeURIComponent(tag)}`))).toEqual([]);
  });

  it("with nothing reviewed it says so, not 'nothing matches'", async () => {
    const d = await doc(new Client(), `/recipes?rated=1&q=${encodeURIComponent("no such dish zzq")}`);
    expect(d.querySelector(".rx-empty")?.textContent).toContain("None of these have reviews yet");
  });
});

describe("sample reviews", () => {
  // the app seeds them at boot: find a catalogue recipe they're on
  async function sampled(): Promise<{ href: string; d: Document }> {
    const guest = new Client();
    const list = await doc(guest, "/recipes?rated=1");
    for (const a of list.querySelectorAll<HTMLAnchorElement>("a.rx-tile")) {
      const d = await doc(guest, a.getAttribute("href")!);
      if (d.querySelector(".rv-badge-sample")) return { href: a.getAttribute("href")!, d };
    }
    throw new Error("no recipe carries sample reviews");
  }

  it("are labelled Sample, with a banner saying so, and link to no profile", async () => {
    const { d } = await sampled();
    const banner = d.querySelector(".rv-section .preview-banner");
    expect(banner?.textContent).toContain("Sample reviews");
    const samples = [...d.querySelectorAll("[data-rv-list] .rv")].filter((r) => r.querySelector(":scope > .rv-main .rv-badge-sample"));
    expect(samples.length).toBeGreaterThan(0);
    for (const r of samples) {
      // the name is plain text, not a link to /u/…
      expect(r.querySelector(":scope > .rv-main a.rv-who")).toBeNull();
      expect(r.querySelector(":scope > .rv-main span.rv-who")?.textContent).toBeTruthy();
      // and each has a cooking character
      expect(r.querySelector(":scope > .avatar-char")).not.toBeNull();
    }
  });

  it("a real review beside them carries no Sample badge", async () => {
    const { href, d } = await sampled();
    const before = d.querySelectorAll("[data-rv-list] > .rv").length;
    const p = await registered("srv");
    await review(p, Number(href.split("/").pop()), 4, "A real person's review.");
    const after = await doc(new Client(), href);
    expect(after.querySelectorAll("[data-rv-list] > .rv").length).toBe(before + 1);
    const mine = [...after.querySelectorAll("[data-rv-list] > .rv")].find((r) => r.textContent!.includes("A real person's review."))!;
    expect(mine.querySelector(".rv-badge-sample")).toBeNull();
    expect(mine.querySelector("a.rv-who")?.getAttribute("href")).toBe(`/u/${p.username}`);
  });

  it("their reviewers can't sign in, have no profile and can't be found or befriended", async () => {
    const { d } = await sampled();
    const name = d.querySelector(".rv-badge-sample")!.previousElementSibling!.textContent!.trim();
    const guest = new Client();
    // the sample usernames use a hyphen, which nobody can register
    for (const username of ["sample-mia", "sample-raj"]) {
      const res = await guest.post("/login", { username, password: "password123" });
      expect(res.finalUrl).toBe("/login");
      expect((await guest.get(`/u/${username}`)).status).toBe(404);
    }
    const reg = await guest.post("/register", { username: "sample-mia", display_name: "Imposter", password: "correct horse battery" });
    expect(reg.status).toBe(422);
    const p = await registered("srs");
    const search = await doc(p.client, `/friends?q=${encodeURIComponent(name.split(" ")[0])}`);
    expect(search.body.textContent).not.toContain(name);
    expect((await p.client.post("/friends/sample-mia/request")).status).toBe(404);
  });
});

describe("demo accounts", () => {
  it("show their cooking characters, not initials", async () => {
    const alice = new Client();
    await alice.post("/login", { username: "alice", password: "password123" });
    const home = await doc(alice, "/");
    expect(home.querySelector(".me .avatar-char")).not.toBeNull();
    // her friends, in the friends list and in what they share
    const friends = await doc(alice, "/friends");
    const people = [...friends.querySelectorAll("li.person")];
    expect(people.length).toBeGreaterThan(0);
    for (const li of people) expect(li.querySelector(".avatar-char")).not.toBeNull();
    for (const item of friends.querySelectorAll(".feed-item")) expect(item.querySelector(":scope > .avatar-char")).not.toBeNull();
  });
});

// On this file's own throwaway database (spec/unit-db.ts), never the app's.
describe("seeding sample reviews", () => {
  it("writes them once per version, replaces rather than doubles, and keeps real reviews", () => {
    seedCatalogue();
    const n = seedSampleReviews("test-a");
    expect(n).toBeGreaterThan(10);
    const count = () => one<{ n: number }>("SELECT COUNT(*) AS n FROM reviews v JOIN users u ON u.id = v.author_id WHERE u.is_sample = 1 AND v.parent_id IS NULL")!.n;
    expect(count()).toBe(n);
    // same version: nothing to do
    expect(seedSampleReviews("test-a")).toBe(0);
    // a real person's review on the same recipe survives a rebuild
    const recipe = one<{ recipe_id: number }>("SELECT recipe_id FROM reviews LIMIT 1")!.recipe_id;
    const real = run("INSERT INTO users (username, display_name, password_hash) VALUES ('real_reviewer', 'Real', 'x')").id;
    run("INSERT INTO reviews (recipe_id, author_id, rating, body, lang) VALUES (?, ?, 4, 'real words', 'en')", recipe, real);
    expect(seedSampleReviews("test-b")).toBe(n);
    expect(count()).toBe(n);
    expect(one("SELECT 1 FROM reviews WHERE author_id = ? AND body = 'real words'", real)).toBeTruthy();
    // every sample reviewer is marked, has a character and an unusable password
    for (const u of all<{ password_hash: string; avatar: string | null; is_sample: number }>("SELECT password_hash, avatar, is_sample FROM users WHERE username LIKE 'sample-%'")) {
      expect(u.is_sample).toBe(1);
      expect(u.avatar).toBeTruthy();
      expect(u.password_hash.startsWith("scrypt$")).toBe(false);
    }
    // a wiped sample set (someone deleted them) comes back even on the same version
    run("DELETE FROM reviews WHERE author_id IN (SELECT id FROM users WHERE is_sample = 1)");
    run("DELETE FROM users WHERE is_sample = 1");
    expect(seedSampleReviews("test-b")).toBe(n);
  });

  it("ranks by a shrunk average: 20 reviews at 4.7 beat one 5, which beats two 2s", () => {
    const author = run("INSERT INTO users (username, display_name, password_hash) VALUES ('rank_author', 'A', 'x')").id;
    const recipe = (title: string) => run("INSERT INTO recipes (author_id, title, visibility, image_url) VALUES (?, ?, 'public', '/assets/x.svg')", author, title).id;
    const many = recipe("rank many");
    const one5 = recipe("rank one");
    const low = recipe("rank low");
    const rate = (r: number, stars: number[]) =>
      stars.forEach((s, i) => {
        const u = run("INSERT INTO users (username, display_name, password_hash) VALUES (?, 'R', 'x')", `rank_${r}_${i}`).id;
        run("INSERT INTO reviews (recipe_id, author_id, rating, body, lang) VALUES (?, ?, ?, 'ok', 'en')", r, u, s);
      });
    rate(many, [...Array(14).fill(5), ...Array(6).fill(4)]);
    rate(one5, [5]);
    rate(low, [2, 2]);
    const order = listVisibleRecipes(null, { rated: true, order: "rating", query: "rank " }).map((r) => r.title);
    expect(order).toEqual(["rank many", "rank one", "rank low"]);
  });
});
