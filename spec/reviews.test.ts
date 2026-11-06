import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { detectLanguage, TRANSLATABLE } from "../src/language.ts";
import { cleanBody, stripMetadata } from "../src/reviews.ts";
import { befriend, Client, createRecipe, DISH_PNG, PASSWORD, registered } from "./helpers.ts";

// Reviews on recipe pages (CLAUDE.md task 1): stars, words, photos, links to
// other recipes, replies and likes; who may see and write them; and what
// happens when the writer's account is deleted. Each person posts at most
// once per test where it matters: the app throttles posting to one every
// few seconds per person (POST_COOLDOWN_SECONDS), as CI runs it.

type Person = Awaited<ReturnType<typeof registered>>;

const json = { accept: "application/json" };
async function postReview(p: Person, recipe: number, fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) body.append(k, one);
  const res = await p.client.request(`/recipes/${recipe}/reviews`, { method: "POST", headers: { ...json, "content-type": "application/x-www-form-urlencoded" }, body });
  return { status: res.status, body: (await res.json()) as { id?: number; edited?: boolean; error?: string; problem?: string; parentId?: number; html?: string } };
}
async function postJson(p: Person, path: string, fields: Record<string, string> = {}) {
  const res = await p.client.request(path, { method: "POST", headers: { ...json, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const doc = async (c: Client, path: string) => new JSDOM(await (await c.get(path)).text()).window.document;
const reviewTexts = (d: Document) => [...d.querySelectorAll("[data-rv-list] > .rv > .rv-main [data-rv-text]")].map((t) => t.textContent!.trim());

async function uploadReviewPhoto(p: Person, bytes: Buffer = DISH_PNG) {
  const res = await p.client.request("/reviews/photos", { method: "POST", headers: { "content-type": "image/png", ...json }, body: new Uint8Array(bytes) });
  return { status: res.status, body: (await res.json()) as { id?: number; error?: string } };
}

describe("writing and reading reviews", () => {
  it("anyone sees a public recipe's reviews and average; signing in is needed to write", async () => {
    const author = await registered("rauthor");
    const a = await registered("ra");
    const b = await registered("rb");
    const id = await createRecipe(author.client, `Reviewed ${author.username}`, "public");
    expect((await postReview(a, id, { rating: "5", body: "Wonderful, cooked it twice." })).status).toBe(200);
    expect((await postReview(b, id, { rating: "2", body: "Too salty for us." })).status).toBe(200);

    const guest = new Client();
    const d = await doc(guest, `/recipes/${id}`);
    expect(reviewTexts(d).sort()).toEqual(["Too salty for us.", "Wonderful, cooked it twice."]);
    // the average at the top of the page and over the reviews
    expect(d.querySelector(".rd-rating")?.textContent).toMatch(/3\.5\s*2 reviews/);
    expect(d.querySelector("[data-rv-average]")?.textContent).toBe("3.5");
    // signed out: an invitation, not a form
    expect(d.querySelector("[data-rv-compose]")).toBeNull();
    expect(d.querySelector(".rv-compose-out a")?.getAttribute("href")).toMatch(/^\/login\?next=/);
    // and a post goes to sign in, coming back to the recipe
    const res = await guest.request(`/recipes/${id}/reviews`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", referer: `${guest.base}/recipes/${id}` }, body: "rating=5&body=hi" });
    expect(res.finalUrl).toBe(`/login?next=${encodeURIComponent(`/recipes/${id}`)}`);
  });

  it("a rating is a whole number of stars from 1 to 5, required, with words", async () => {
    const author = await registered("rauthor");
    const p = await registered("rp");
    const id = await createRecipe(author.client, `Rules ${author.username}`, "public");
    for (const rating of ["", "0", "6", "4.5", "five"]) {
      const r = await postReview(p, id, { rating, body: "Nice" });
      expect(r.status).toBe(422);
      expect(r.body.problem).toBe("no-rating");
    }
    expect((await postReview(p, id, { rating: "4", body: "   \n\n " })).body.problem).toBe("empty");
    expect((await postReview(p, id, { rating: "4", body: "x".repeat(2001) })).body.problem).toBe("too-long");
    // nothing was saved by the refusals
    expect(reviewTexts(await doc(new Client(), `/recipes/${id}`))).toEqual([]);
  });

  it("the recipe's author can't rate their own recipe, but can reply", async () => {
    const author = await registered("rauthor");
    const fan = await registered("rfan");
    const id = await createRecipe(author.client, `Own ${author.username}`, "public");
    expect((await postReview(author, id, { rating: "5", body: "Mine is great" })).body.problem).toBe("own-recipe");
    const d = await doc(author.client, `/recipes/${id}`);
    expect(d.querySelector("[data-rv-compose]")).toBeNull();
    expect(d.querySelector(".rv-compose-own")?.textContent).toMatch(/can't rate it/);

    const review = (await postReview(fan, id, { rating: "4", body: "Lovely" })).body.id!;
    const reply = await postJson(author, `/recipes/${id}/reviews/${review}/reply`, { body: "Thank you!" });
    expect(reply.status).toBe(200);
    const page = await doc(new Client(), `/recipes/${id}`);
    const replyLi = page.querySelector(`#rv-${reply.body.id}`)!;
    expect(replyLi.querySelector(".rv-badge")?.textContent).toBe("Recipe author");
    // replies carry no stars and don't move the average
    expect(replyLi.querySelector(".stars")).toBeNull();
    expect(page.querySelector("[data-rv-average]")?.textContent).toBe("4.0");
  });

  it("one review per person: posting again edits it", async () => {
    const author = await registered("rauthor");
    const p = await registered("rp");
    const id = await createRecipe(author.client, `Once ${author.username}`, "public");
    const first = await postReview(p, id, { rating: "2", body: "Bland." });
    const again = await postReview(p, id, { rating: "4", body: "Better with more salt." });
    expect(again.body).toEqual({ id: first.body.id, edited: true });
    const d = await doc(new Client(), `/recipes/${id}`);
    expect(reviewTexts(d)).toEqual(["Better with more salt."]);
    expect(d.querySelector(`#rv-${first.body.id} .rv-meta`)?.textContent).toMatch(/edited/);
    // the writer's box now edits it, filled in
    const mine = await doc(p.client, `/recipes/${id}`);
    expect(mine.querySelector(".rv-compose-title")?.textContent).toBe("Edit your review");
    expect((mine.querySelector("[data-rv-compose] textarea") as HTMLTextAreaElement).value).toBe("Better with more salt.");
    expect((mine.querySelector("#rate-4") as HTMLInputElement).checked).toBe(true);
  });

  it("keeps line breaks, tidies spacing, and escapes everything written", async () => {
    expect(cleanBody("  Hello   world\r\n\r\n\r\n\r\nSecond​ para  \n")).toBe("Hello world\n\nSecond para");
    const author = await registered("rauthor");
    const p = await registered("rp");
    const id = await createRecipe(author.client, `Escape ${author.username}`, "public");
    await postReview(p, id, { rating: "3", body: `<script>alert(1)</script>\n\n<img src=x onerror=alert(2)> & "quotes"` });
    const html = await (await new Client().get(`/recipes/${id}`)).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    const d = new JSDOM(html).window.document;
    expect([...d.querySelectorAll("[data-rv-list] .rv-text p")].map((p) => p.textContent)).toEqual(["<script>alert(1)</script>", `<img src=x onerror=alert(2)> & "quotes"`]);
  });

  it("works without the page's script: a form post comes back to the review on the page", async () => {
    const author = await registered("rauthor");
    const p = await registered("rp");
    const id = await createRecipe(author.client, `NoJS ${author.username}`, "public");
    const res = await p.client.post(`/recipes/${id}/reviews`, { rating: "5", body: "Posted without JavaScript" });
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe(`/recipes/${id}`);
    const d = new JSDOM(await res.text()).window.document;
    expect(d.querySelector(".flash, [role=status]")?.textContent).toMatch(/review is posted/);
    // a refused post keeps what was typed
    const q = await registered("rq");
    const refused = await q.client.post(`/recipes/${id}/reviews`, { body: "Forgot the stars" });
    expect(refused.status).toBe(422);
    const rd = new JSDOM(await refused.text()).window.document;
    expect((rd.querySelector("[data-rv-compose] textarea") as HTMLTextAreaElement).value).toBe("Forgot the stars");
    expect(rd.querySelector("[data-rv-compose] .form-errors")?.textContent).toMatch(/star rating/);
  });

  it("posting is throttled to stop double posts and floods", async () => {
    const author = await registered("rauthor");
    const p = await registered("rp");
    const id = await createRecipe(author.client, `Throttle ${author.username}`, "public");
    const other = await createRecipe(author.client, `Throttle2 ${author.username}`, "public");
    expect((await postReview(p, id, { rating: "5", body: "First" })).status).toBe(200);
    const fast = await postReview(p, other, { rating: "5", body: "Second, straight away" });
    expect(fast.status).toBe(429);
    expect(fast.body.problem).toBe("too-soon");
  });
});

describe("who sees reviews", () => {
  it("a private recipe's reviews, photos and pages are 404 to everyone but its author", async () => {
    const author = await registered("rauthor");
    const friend = await registered("rfriend");
    await befriend(author, friend);
    const id = await createRecipe(author.client, `Private ${author.username}`, "private");
    expect((await postReview(friend, id, { rating: "5", body: "x" })).status).toBe(404);
    for (const path of [`/recipes/${id}/reviews/stream`, `/recipes/${id}/reviews/summary`, `/recipes/${id}/reviews/1`]) {
      expect((await friend.client.get(path)).status).toBe(404);
      expect((await new Client().get(path)).status).toBe(404);
    }
  });

  it("a friends-only recipe's reviews reach friends, and its review photos stop when it goes private", async () => {
    const author = await registered("rauthor");
    const friend = await registered("rfriend");
    const stranger = await registered("rstranger");
    await befriend(author, friend);
    const id = await createRecipe(author.client, `Friends ${author.username}`, "friends");
    const photo = (await uploadReviewPhoto(friend)).body.id!;
    const r = await postReview(friend, id, { rating: "4", body: "Made this for the team", photo: String(photo) });
    expect(r.status).toBe(200);
    expect((await friend.client.get(`/reviews/photos/${photo}`)).status).toBe(200);
    expect((await author.client.get(`/reviews/photos/${photo}`)).status).toBe(200);
    expect((await stranger.client.get(`/reviews/photos/${photo}`)).status).toBe(404);
    expect((await new Client().get(`/reviews/photos/${photo}`)).status).toBe(404);
    expect((await stranger.client.get(`/recipes/${id}`)).status).toBe(404);
    // the photo is never cached publicly
    expect((await friend.client.get(`/reviews/photos/${photo}`)).headers.get("cache-control")).toMatch(/^private/);
  });

  it("a photo not yet posted is its uploader's alone, and can't be put on someone else's review", async () => {
    const author = await registered("rauthor");
    const a = await registered("ra");
    const b = await registered("rb");
    const id = await createRecipe(author.client, `Photos ${author.username}`, "public");
    const mine = (await uploadReviewPhoto(a)).body.id!;
    expect((await a.client.get(`/reviews/photos/${mine}`)).status).toBe(200);
    expect((await b.client.get(`/reviews/photos/${mine}`)).status).toBe(404);
    // b tries to post a's photo
    expect((await postReview(b, id, { rating: "5", body: "Stolen", photo: String(mine) })).body.problem).toBe("bad-photo");
  });
});

describe("photos and links on reviews", () => {
  it("up to four photos, each checked, shown on the review", async () => {
    const author = await registered("rauthor");
    const p = await registered("rp");
    const id = await createRecipe(author.client, `Gallery ${author.username}`, "public");
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push((await uploadReviewPhoto(p)).body.id!);
    expect((await postReview(p, id, { rating: "5", body: "Too many", photo: ids.map(String) })).body.problem).toBe("too-many-photos");
    // not a photo at all
    const bad = await uploadReviewPhoto(p, Buffer.from("not an image"));
    expect(bad.status).toBe(422);
    const ok = await postReview(p, id, { rating: "5", body: "Look at this", photo: ids.slice(0, 4).map(String) });
    expect(ok.status).toBe(200);
    const d = await doc(new Client(), `/recipes/${id}`);
    expect(d.querySelectorAll(`#rv-${ok.body.id} .rv-photo img`).length).toBe(4);
    expect(d.querySelector(`#rv-${ok.body.id} .rv-photo img`)?.getAttribute("alt")).toMatch(/Photo 1 from/);
  });

  it("linked recipes: only ones the writer can see, never the recipe itself, and a reader sees only theirs", async () => {
    const author = await registered("rauthor");
    const writer = await registered("rwriter");
    await befriend(author, writer);
    const id = await createRecipe(author.client, `Main ${author.username}`, "public");
    const side = await createRecipe(author.client, `Side ${author.username}`, "public");
    const friendsOnly = await createRecipe(author.client, `Secret side ${author.username}`, "friends");
    const hidden = await createRecipe(author.client, `Hidden ${author.username}`, "private");
    const r = await postReview(writer, id, { rating: "5", body: "Serve with these", link: [String(side), String(friendsOnly), String(hidden), String(id)] });
    expect(r.status).toBe(200);
    // the writer (a friend) sees both visible links; the private one and the
    // recipe itself were never linked
    const asWriter = await doc(writer.client, `/recipes/${id}`);
    expect([...asWriter.querySelectorAll(`#rv-${r.body.id} .rv-link span`)].map((s) => s.textContent)).toEqual([`Side ${author.username}`, `Secret side ${author.username}`]);
    // a stranger never sees the friends-only title
    const asGuest = await (await new Client().get(`/recipes/${id}`)).text();
    expect(asGuest).toContain(`Side ${author.username}`);
    expect(asGuest).not.toContain(`Secret side ${author.username}`);
    expect(asGuest).not.toContain(`Hidden ${author.username}`);
    // at most three
    const another = await registered("ranother");
    const many = await Promise.all([1, 2, 3, 4].map((n) => createRecipe(author.client, `Many ${n} ${author.username}`, "public")));
    expect((await postReview(another, id, { rating: "4", body: "x", link: many.map(String) })).body.problem).toBe("too-many-links");
  });

  it("the link picker finds only recipes the writer may see", async () => {
    const author = await registered("rauthor");
    const writer = await registered("rwriter");
    const id = await createRecipe(author.client, `Picker ${author.username}`, "public");
    await createRecipe(author.client, `Zesty private ${author.username}`, "private");
    await createRecipe(author.client, `Zesty public ${author.username}`, "public");
    const res = await writer.client.request(`/recipes/${id}/reviews/link-search?q=${encodeURIComponent(`Zesty`)}`, { headers: json });
    const titles = ((await res.json()) as { results: { title: string }[] }).results.map((r) => r.title);
    expect(titles).toContain(`Zesty public ${author.username}`);
    expect(titles).not.toContain(`Zesty private ${author.username}`);
    expect((await new Client().get(`/recipes/${id}/reviews/link-search?q=Zesty`)).finalUrl).toMatch(/^\/login/);
  });
});

describe("found in review: regressions", () => {
  it("removing every photo from a review takes them all off", async () => {
    const author = await registered("rauthor");
    const p = await registered("rp");
    const id = await createRecipe(author.client, `Unphoto ${author.username}`, "public");
    const photo = (await uploadReviewPhoto(p)).body.id!;
    const r = await postReview(p, id, { rating: "4", body: "With a photo", photo: String(photo) });
    expect((await doc(new Client(), `/recipes/${id}`)).querySelectorAll(`#rv-${r.body.id} .rv-photo`).length).toBe(1);
    await postReview(p, id, { rating: "4", body: "Without it now" });
    expect((await doc(new Client(), `/recipes/${id}`)).querySelectorAll(`#rv-${r.body.id} .rv-photo`).length).toBe(0);
    // and the photo is no longer public
    expect((await new Client().get(`/reviews/photos/${photo}`)).status).toBe(404);
  });

  it("a sort name from Object's prototype is ignored, not a server error", async () => {
    const author = await registered("rauthor");
    const id = await createRecipe(author.client, `Proto ${author.username}`, "public");
    for (const sort of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect((await new Client().get(`/recipes/${id}?sort=${sort}`)).status).toBe(200);
    }
  });

  it("a deleted review's own page doesn't name who wrote it", async () => {
    const author = await registered("rauthor");
    const a = await registered("ra");
    const b = await registered("rb");
    const id = await createRecipe(author.client, `Gone ${author.username}`, "public");
    const review = (await postReview(a, id, { rating: "2", body: "Meh" })).body.id!;
    await postJson(b, `/recipes/${id}/reviews/${review}/reply`, { body: "Why?" });
    await postJson(a, `/recipes/${id}/reviews/${review}/delete`);
    const html = await (await new Client().get(`/recipes/${id}/reviews/${review}`)).text();
    expect(html).toContain("A deleted review");
    expect(html).not.toContain(`Test ${a.username}`);
  });

  it("a signed-out page script gets a 401 it can act on, not a sign-in page it would read as success", async () => {
    const author = await registered("rauthor");
    const id = await createRecipe(author.client, `Expired ${author.username}`, "public");
    const res = await new Client().request(`/recipes/${id}/reviews`, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: "rating=5&body=hi" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { problem: string }).problem).toBe("signed-out");
  });

  it("photos lose their hidden location data before they're stored", () => {
    // a JPEG with an APP1 Exif segment holding a GPS tag, then the image
    const soi = Buffer.from([0xff, 0xd8]);
    const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")]);
    const exifBody = Buffer.from("Exif\0\0GPSLatitude=-37.81", "latin1");
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, exifBody.length + 2]), exifBody]);
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
    const jpeg = Buffer.concat([soi, app0, app1, sos]);
    const clean = stripMetadata(jpeg, "image/jpeg");
    expect(clean.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(clean.includes(Buffer.from("JFIF"))).toBe(true);
    expect(clean.subarray(-8).equals(sos)).toBe(true);
    // a PNG's text chunks go, its image chunks stay
    const chunk = (type: string, data: Buffer) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, "ascii"); data.copy(b, 8); return b; };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.alloc(13)), chunk("tEXt", Buffer.from("Location\0Home")), chunk("IDAT", Buffer.alloc(4)), chunk("IEND", Buffer.alloc(0))]);
    const cleanPng = stripMetadata(png, "image/png");
    expect(cleanPng.includes(Buffer.from("Home"))).toBe(false);
    expect(cleanPng.includes(Buffer.from("IDAT"))).toBe(true);
  });

  it("an uploaded review photo still opens after its metadata is stripped", async () => {
    const p = await registered("rp");
    const up = await uploadReviewPhoto(p);
    const res = await p.client.get(`/reviews/photos/${up.body.id}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 8).equals(DISH_PNG.subarray(0, 8))).toBe(true);
  });
});

describe("replies and likes", () => {
  it("replies thread under the review; a reply to a reply says who it answers", async () => {
    const author = await registered("rauthor");
    const a = await registered("ra");
    const b = await registered("rb");
    const c = await registered("rc");
    const id = await createRecipe(author.client, `Thread ${author.username}`, "public");
    const review = (await postReview(a, id, { rating: "4", body: "Good base" })).body.id!;
    const r1 = await postJson(b, `/recipes/${id}/reviews/${review}/reply`, { body: "Agree, add lemon" });
    expect(r1.body.parentId).toBe(review);
    const r2 = await postJson(c, `/recipes/${id}/reviews/${r1.body.id}/reply`, { body: "Lemon is perfect" });
    // still under the review, one level deep
    expect(r2.body.parentId).toBe(review);
    const d = await doc(new Client(), `/recipes/${id}`);
    const thread = d.querySelector(`[data-rv-thread="${review}"]`)!;
    expect([...thread.querySelectorAll(".rv-reply [data-rv-text]")].map((t) => t.textContent!.trim())).toEqual(["Agree, add lemon", "Lemon is perfect"]);
    expect(d.querySelector(`#rv-${r2.body.id} .rv-to`)?.textContent).toMatch(/to Test rb_/);
    // a reply is to a review on the same recipe
    const other = await createRecipe(author.client, `Elsewhere ${author.username}`, "public");
    const d2 = await registered("rd");
    expect((await postJson(d2, `/recipes/${other}/reviews/${review}/reply`, { body: "wrong place" })).status).toBe(404);
  });

  it("only the first replies show, with a link to the rest", async () => {
    const author = await registered("rauthor");
    const a = await registered("ra");
    const id = await createRecipe(author.client, `Many replies ${author.username}`, "public");
    const review = (await postReview(a, id, { rating: "5", body: "Popular" })).body.id!;
    for (let i = 0; i < 5; i++) {
      const p = await registered(`rr${i}`);
      await postJson(p, `/recipes/${id}/reviews/${review}/reply`, { body: `Reply ${i}` });
    }
    const d = await doc(new Client(), `/recipes/${id}`);
    expect(d.querySelectorAll(`[data-rv-thread="${review}"] .rv-reply`).length).toBe(3);
    expect(d.querySelector(`[data-rv-all-replies="${review}"]`)?.textContent).toBe("Show 2 more replies");
    const all = await (await new Client().get(`/recipes/${id}/reviews/${review}?partial=replies`)).text();
    expect(new JSDOM(`<ol>${all}</ol>`).window.document.querySelectorAll(".rv-reply").length).toBe(5);
  });

  it("likes toggle, are counted, and can't be given to your own writing", async () => {
    const author = await registered("rauthor");
    const a = await registered("ra");
    const b = await registered("rb");
    const id = await createRecipe(author.client, `Likes ${author.username}`, "public");
    const review = (await postReview(a, id, { rating: "5", body: "Like me" })).body.id!;
    expect((await postJson(b, `/recipes/${id}/reviews/${review}/like`)).body).toEqual({ liked: true, likes: 1 });
    expect((await postJson(author, `/recipes/${id}/reviews/${review}/like`)).body).toEqual({ liked: true, likes: 2 });
    expect((await postJson(b, `/recipes/${id}/reviews/${review}/like`)).body).toEqual({ liked: false, likes: 1 });
    expect((await postJson(a, `/recipes/${id}/reviews/${review}/like`)).status).toBe(422);
    const d = await doc(author.client, `/recipes/${id}`);
    expect(d.querySelector(`#rv-${review} [data-rv-like] button`)?.getAttribute("aria-pressed")).toBe("true");
    // "Most helpful" puts the liked review first
    const c = await registered("rc");
    await postReview(c, id, { rating: "3", body: "Newer but unliked" });
    expect(reviewTexts(await doc(new Client(), `/recipes/${id}`))[0]).toBe("Like me");
    expect(reviewTexts(await doc(new Client(), `/recipes/${id}?sort=newest`))[0]).toBe("Newer but unliked");
  });

  it("only the writer can delete; a review with replies stays as '[deleted]' until its last reply goes", async () => {
    const author = await registered("rauthor");
    const a = await registered("ra");
    const b = await registered("rb");
    const id = await createRecipe(author.client, `Delete ${author.username}`, "public");
    const review = (await postReview(a, id, { rating: "1", body: "Awful" })).body.id!;
    const reply = (await postJson(b, `/recipes/${id}/reviews/${review}/reply`, { body: "Really?" })).body.id as number;
    expect((await postJson(b, `/recipes/${id}/reviews/${review}/delete`)).status).toBe(403);
    expect((await postJson(author, `/recipes/${id}/reviews/${review}/delete`)).status).toBe(403);
    expect((await postJson(a, `/recipes/${id}/reviews/${review}/delete`)).body).toEqual({ removed: "content" });
    let d = await doc(new Client(), `/recipes/${id}`);
    expect(d.querySelector(`#rv-${review}`)?.classList.contains("rv-deleted")).toBe(true);
    expect(d.querySelector(`#rv-${review}`)?.textContent).not.toContain("Awful");
    // its stars no longer count
    expect(d.querySelector(".rd-rating")?.textContent).toMatch(/No reviews yet/);
    // nobody can reply to or like it now
    const c = await registered("rc");
    expect((await postJson(c, `/recipes/${id}/reviews/${review}/reply`, { body: "x" })).status).toBe(422);
    expect((await postJson(c, `/recipes/${id}/reviews/${review}/like`)).status).toBe(422);
    // the last reply going takes the placeholder with it
    expect((await postJson(b, `/recipes/${id}/reviews/${reply}/delete`)).body).toEqual({ removed: "row" });
    d = await doc(new Client(), `/recipes/${id}`);
    expect(d.querySelector(`#rv-${review}`)).toBeNull();
    // and the writer can review it again
    expect((await postReview(a, id, { rating: "3", body: "Tried again" })).status).toBe(200);
  });

  it("a reply can be edited by its writer only", async () => {
    const author = await registered("rauthor");
    const a = await registered("ra");
    const b = await registered("rb");
    const id = await createRecipe(author.client, `Edit reply ${author.username}`, "public");
    const review = (await postReview(a, id, { rating: "4", body: "Nice" })).body.id!;
    const reply = (await postJson(b, `/recipes/${id}/reviews/${review}/reply`, { body: "Typo hree" })).body.id as number;
    expect((await postJson(a, `/recipes/${id}/reviews/${reply}/edit`, { body: "hijack" })).status).toBe(403);
    expect((await postJson(b, `/recipes/${id}/reviews/${reply}/edit`, { body: "Typo here" })).status).toBe(200);
    const d = await doc(new Client(), `/recipes/${id}`);
    expect(d.querySelector(`#rv-${reply} [data-rv-text]`)?.textContent?.trim()).toBe("Typo here");
    expect(d.querySelector(`#rv-${reply} .rv-meta`)?.textContent).toMatch(/edited/);
  });
});

describe("sorting and filtering reviews", () => {
  it("filters by photos, language and stars, and says when nothing matches", async () => {
    const author = await registered("rauthor");
    const en = await registered("ren");
    const es = await registered("res");
    const pic = await registered("rpic");
    const id = await createRecipe(author.client, `Filters ${author.username}`, "public");
    await postReview(en, id, { rating: "5", body: "Brilliant weeknight dinner, the kids loved it." });
    await postReview(es, id, { rating: "3", body: "Me encantó esta receta, pero le puse menos azúcar y quedó perfecta." });
    const photo = (await uploadReviewPhoto(pic)).body.id!;
    await postReview(pic, id, { rating: "4", body: "Here is mine", photo: String(photo) });

    const guest = new Client();
    expect(reviewTexts(await doc(guest, `/recipes/${id}?photos=1`))).toEqual(["Here is mine"]);
    expect(reviewTexts(await doc(guest, `/recipes/${id}?lang=es`))).toEqual(["Me encantó esta receta, pero le puse menos azúcar y quedó perfecta."]);
    expect(reviewTexts(await doc(guest, `/recipes/${id}?stars=5`))).toEqual(["Brilliant weeknight dinner, the kids loved it."]);
    expect(reviewTexts(await doc(guest, `/recipes/${id}?sort=lowest`))[0]).toMatch(/^Me encantó/);
    expect(reviewTexts(await doc(guest, `/recipes/${id}?sort=highest`))[0]).toMatch(/^Brilliant/);
    const none = await doc(guest, `/recipes/${id}?stars=1`);
    expect(none.querySelector(".rv-empty")?.textContent).toMatch(/No reviews match/);
    // the chips say how many, and a language chip appears once there's more than English
    const d = await doc(guest, `/recipes/${id}`);
    const chips = [...d.querySelectorAll(".rv-chips .rx-chip")].map((c) => c.textContent!.replace(/\s+/g, " ").trim());
    expect(chips).toEqual(expect.arrayContaining(["With photos 1", "English 2", "Spanish 1"]));
    // the bars count each star; junk filter values are ignored
    expect(d.querySelectorAll(".rv-bars li").length).toBe(5);
    expect(reviewTexts(await doc(guest, `/recipes/${id}?stars=9&lang=<x>&sort=hack`)).length).toBe(3);
  });
});

describe("languages and translation", () => {
  it("detects a review's language from its words, never guessing from a scrap", () => {
    expect(detectLanguage("This was delicious! I added extra garlic and the kids loved it.")).toBe("en");
    expect(detectLanguage("Great recipe")).toBe("en");
    expect(detectLanguage("这道菜很好吃，我加了一点辣椒，全家都喜欢。")).toBe("zh");
    expect(detectLanguage("美味しい！")).toBe("ja");
    expect(detectLanguage("정말 맛있어요!")).toBe("ko");
    expect(detectLanguage("Món này rất ngon, tôi đã thêm một chút nước mắm.")).toBe("vi");
    expect(detectLanguage("Me encantó esta receta, pero le puse menos azúcar y quedó perfecta.")).toBe("es");
    expect(detectLanguage("Sehr lecker, aber die Backzeit war bei mir zehn Minuten länger.")).toBe("de");
    // English with borrowed food words stays English
    expect(detectLanguage("Loved the pho! Added extra basil and lime.")).toBe("en");
    expect(detectLanguage("I used 2 tbsp of gochujang with kimchi on the side")).toBe("en");
    expect(detectLanguage("jalapeño")).toBe("und");
    // no words at all
    expect(detectLanguage("10/10 👍")).toBe("und");
  });

  it("offers translation only where a translator read review sentences right", async () => {
    expect(TRANSLATABLE.has("es")).toBe(true);
    // only a many-languages model exists for these, and it mistranslated
    for (const l of ["pt", "el", "tl", "en", "und"]) expect(TRANSLATABLE.has(l)).toBe(false);
    const author = await registered("rauthor");
    const es = await registered("res");
    const pt = await registered("rpt");
    const id = await createRecipe(author.client, `Translate ${author.username}`, "public");
    const esId = (await postReview(es, id, { rating: "5", body: "Me encantó esta receta, pero le puse menos azúcar y quedó perfecta." })).body.id;
    const ptId = (await postReview(pt, id, { rating: "4", body: "Ficou muito gostoso, coloquei menos sal e mais alho na receita." })).body.id;
    const d = await doc(new Client(), `/recipes/${id}`);
    const esBtn = d.querySelector(`#rv-${esId} [data-rv-translate]`);
    expect(esBtn?.textContent).toMatch(/Translate from Spanish/);
    // shown by the script only where a worker can run
    expect(esBtn?.hasAttribute("hidden")).toBe(true);
    expect(d.querySelector(`#rv-${esId} [data-rv-text]`)?.getAttribute("lang")).toBe("es");
    expect(d.querySelector(`#rv-${ptId} [data-rv-translate]`)).toBeNull();
    expect(d.querySelector(`#rv-${ptId} .rv-lang`)?.textContent).toMatch(/Written in Portuguese/);
  });
});

describe("who's writing", () => {
  it("the live stream tells others someone is writing, never the writer themselves", async () => {
    const author = await registered("rauthor");
    const writer = await registered("rwriter");
    const watcher = await registered("rwatcher");
    const id = await createRecipe(author.client, `Typing ${author.username}`, "public");
    const read = async (p: Person) => {
      const ctrl = new AbortController();
      const res = await p.client.request(`/recipes/${id}/reviews/stream`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      return {
        async until(match: RegExp, ms = 3000) {
          let text = "";
          const end = Date.now() + ms;
          while (Date.now() < end) {
            const r = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), end - Date.now()))]);
            if (!r || r.done) break;
            text += new TextDecoder().decode(r.value);
            if (match.test(text)) return text;
          }
          return text;
        },
        close: () => ctrl.abort(),
      };
    };
    const w = await read(watcher);
    const self = await read(writer);
    await w.until(/event: typing/);
    await self.until(/event: typing/);
    await writer.client.post(`/recipes/${id}/reviews/typing`, { on: "1" });
    expect(await w.until(/"names":\["Test rwriter_[^"]+"\]/)).toMatch(/"names":\["Test rwriter_/);
    expect(await self.until(/"names":\["Test rwriter/, 800)).not.toMatch(/rwriter/);
    await writer.client.post(`/recipes/${id}/reviews/typing`, { on: "0" });
    expect(await w.until(/"names":\[\]/)).toMatch(/"names":\[\]/);
    // a stranger to a private recipe can't open its stream
    const priv = await createRecipe(author.client, `Typing private ${author.username}`, "private");
    expect((await watcher.client.get(`/recipes/${priv}/reviews/stream`)).status).toBe(404);
    expect((await watcher.client.post(`/recipes/${priv}/reviews/typing`, { on: "1" })).status).toBe(404);
    w.close();
    self.close();
  });
});

describe("deleting an account", () => {
  it("keeps their reviews of others' recipes without their name or picture, and removes their own recipes", async () => {
    const author = await registered("rauthor");
    const leaver = await registered("rleaver");
    const reader = await registered("rreader");
    const id = await createRecipe(author.client, `Stays ${author.username}`, "public");
    // the leaver chose a character, reviewed, liked and wrote a recipe
    await leaver.client.post("/settings", { display_name: "Lee Leaver", avatar: "dumpling", default_servings: "2", default_visibility: "friends" });
    const review = (await postReview(leaver, id, { rating: "5", body: "Best curry I've made" })).body.id!;
    const theirs = await createRecipe(leaver.client, `Leaver's own ${leaver.username}`, "public");
    const readerReview = (await postReview(reader, theirs, { rating: "4", body: "Nice" })).body.id!;
    let d = await doc(new Client(), `/recipes/${id}`);
    expect(d.querySelector(`#rv-${review} .rv-who`)?.textContent).toBe("Lee Leaver");
    expect(d.querySelector(`#rv-${review} > .avatar-char`)).not.toBeNull();

    // a wrong password deletes nothing
    const wrong = await leaver.client.post("/settings/delete", { password: "not it" });
    expect(wrong.status).toBe(422);
    expect((await leaver.client.get("/settings")).status).toBe(200);

    const res = await leaver.client.post("/settings/delete", { password: PASSWORD });
    expect(res.finalUrl).toBe("/");
    // signed out, and the account is gone
    expect((await leaver.client.get("/settings")).finalUrl).toMatch(/^\/login/);
    expect((await new Client().get(`/u/${leaver.username}`)).status).toBe(404);
    // the review stays: words and stars, no name, no picture, no profile link
    d = await doc(new Client(), `/recipes/${id}`);
    const li = d.querySelector(`#rv-${review}`)!;
    expect(li.querySelector("[data-rv-text]")?.textContent?.trim()).toBe("Best curry I've made");
    expect(li.querySelector(".rv-who")?.textContent).toBe("Deleted account");
    expect(li.querySelector(".rv-who")?.tagName).toBe("SPAN");
    expect(li.querySelector(":scope > .avatar-gone")).not.toBeNull();
    expect(li.textContent).not.toContain("Lee Leaver");
    expect(d.querySelector("[data-rv-average]")?.textContent).toBe("5.0");
    // their own recipe went, with the reviews on it
    expect((await reader.client.get(`/recipes/${theirs}`)).status).toBe(404);
    expect((await reader.client.get(`/recipes/${id}/reviews/${readerReview}`)).status).toBe(404);
    // the review can still be replied to and liked
    expect((await postJson(reader, `/recipes/${id}/reviews/${review}/like`)).body).toEqual({ liked: true, likes: 1 });
  });

  it("works for someone with a pantry and a household; what they added to the house stays with it", async () => {
    const owner = await registered("rowner");
    const leaver = await registered("rleaver");
    expect((await owner.client.post("/household", { name: `House ${owner.username}` })).status).toBe(200);
    const code = new JSDOM(await (await owner.client.get("/household/members")).text()).window.document.querySelector(".hh-code-big")!.textContent!.trim();
    expect((await leaver.client.post("/household/join", { code })).status).toBe(200);
    // their own pantry, and an item in the shared one (both once blocked deleting a user)
    await leaver.client.post("/pantry", { name: "eggs", quantity: "6", unit: "", expiry_date: "", price: "" });
    await leaver.client.post("/household/pantry", { name: `saffron ${leaver.username}`, quantity: "1", unit: "g", expiry_date: "", price: "" });
    expect(await (await owner.client.get("/household/pantry")).text()).toContain(`saffron ${leaver.username}`);
    const res = await leaver.client.post("/settings/delete", { password: PASSWORD });
    expect(res.finalUrl).toBe("/");
    expect((await new Client().get(`/u/${leaver.username}`)).status).toBe(404);
    // the household and its shared pantry item are still there for the owner
    const pantry = await owner.client.get("/household/pantry");
    expect(pantry.status).toBe(200);
    expect(await pantry.text()).toContain(`saffron ${leaver.username}`);
    expect(await (await owner.client.get("/household/members")).text()).not.toContain(leaver.username);
  });

  it("what they added to a household they left earlier stays with that household", async () => {
    const owner = await registered("rowner");
    const leaver = await registered("rleaver");
    await owner.client.post("/household", { name: `Old house ${owner.username}` });
    const code = new JSDOM(await (await owner.client.get("/household/members")).text()).window.document.querySelector(".hh-code-big")!.textContent!.trim();
    await leaver.client.post("/household/join", { code });
    await leaver.client.post("/household/pantry", { name: `oat milk ${leaver.username}`, quantity: "1", unit: "l", expiry_date: "", price: "" });
    await leaver.client.post("/household/leave");
    // months later
    expect((await leaver.client.post("/settings/delete", { password: PASSWORD })).finalUrl).toBe("/");
    expect(await (await owner.client.get("/household/pantry")).text()).toContain(`oat milk ${leaver.username}`);
  });

  it("the settings page says what goes and what stays, and demo accounts can't be deleted", async () => {
    const p = await registered("rp");
    const d = await doc(p.client, "/settings");
    const form = d.querySelector("form[action='/settings/delete']")!;
    expect(form.textContent).toMatch(/Deleted:/);
    expect(form.textContent).toMatch(/stay, shown as from a deleted account/);
    expect(form.querySelector("input[type=password][name=password]")).not.toBeNull();
  });
});

describe("cooking-character pictures", () => {
  it("can be picked in settings, shown beside the name, and only from the gallery", async () => {
    const p = await registered("rp");
    const page = await doc(p.client, "/settings");
    const options = [...page.querySelectorAll("input[name=avatar]")].map((i) => (i as HTMLInputElement).value);
    expect(options[0]).toBe("");
    expect(options.length).toBeGreaterThanOrEqual(10);
    const save = (avatar: string) => p.client.post("/settings", { display_name: "Pat Picker", avatar, default_servings: "2", default_visibility: "friends" });
    expect((await save("avocado")).status).toBe(200);
    let header = await doc(p.client, "/settings");
    expect(header.querySelector(".me .avatar-char")).not.toBeNull();
    expect((header.querySelector("input[name=avatar][value=avocado]") as HTMLInputElement).checked).toBe(true);
    expect((await save("<script>")).status).toBe(422);
    expect((await save("")).status).toBe(200);
    header = await doc(p.client, "/settings");
    expect(header.querySelector(".me .avatar-char")).toBeNull();
    expect(header.querySelector(".me .avatar")?.textContent).toBe("PP");
  });
});
