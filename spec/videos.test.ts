import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { parseYouTubeId, videoMatches } from "../src/videos.ts";
import { Client, createRecipe, registered } from "./helpers.ts";

type Entry = { videoId: string | null; status: string };
const videos: Record<string, Entry> = JSON.parse(readFileSync(new URL("../src/data/videos.json", import.meta.url), "utf8"));
const catalogue: { source: string; title: string }[] = JSON.parse(readFileSync(new URL("../src/data/catalogue.json", import.meta.url), "utf8"));

describe("video matching", () => {
  it("accepts a video titled for the dish and rejects an unrelated one", () => {
    expect(videoMatches("Pad Thai", "Easy Pad Thai Recipe | Gordon")).toBe(true);
    expect(videoMatches("Chicken Alfredo Primavera", "How to make Chicken Alfredo Primavera")).toBe(true);
    expect(videoMatches("Pad Thai", "10 Hour Lo-Fi Beats")).toBe(false);
    expect(videoMatches("Beef Wellington", "Beef Stew Recipe")).toBe(false);
    expect(videoMatches("", "anything")).toBe(false);
  });

  it("reads only real YouTube video addresses", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=F86GfZIph8o")).toBe("F86GfZIph8o");
    expect(parseYouTubeId("https://youtu.be/F86GfZIph8o?t=4")).toBe("F86GfZIph8o");
    expect(parseYouTubeId("https://www.youtube.com/shorts/F86GfZIph8o")).toBe("F86GfZIph8o");
    expect(parseYouTubeId("https://evil.example/watch?v=F86GfZIph8o")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYouTubeId("javascript:alert(1)")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/playlist?list=PLabc")).toBeNull();
  });
});

const catalogueId = async (title: string) => {
  const html = await (await new Client().get(`/recipes?q=${encodeURIComponent(title)}`)).text();
  return Number(html.match(/href="\/recipes\/(\d+)"/)?.[1]);
};

describe("recipe videos", () => {
  const recipePage = async (client: Client, id: number) => (await client.get(`/recipes/${id}`)).text();

  it("a catalogue recipe with a verified video embeds exactly that video, labelled with its provenance", async () => {
    const hit = catalogue.find((r) => videos[r.source]?.status === "verified");
    expect(hit, "videos.json has at least one verified video").toBeDefined();
    const id = await catalogueId(hit!.title);
    const page = await recipePage(new Client(), id);
    expect(page).toContain(`https://www.youtube-nocookie.com/embed/${videos[hit!.source].videoId}`);
    expect(page).toContain("transcribed from it");
    expect(page).toContain("Open on YouTube");
  });

  it("a catalogue recipe without a verified video says so and embeds nothing", async () => {
    const miss = catalogue.find((r) => videos[r.source] && videos[r.source].status !== "verified");
    if (!miss) return;
    const page = await recipePage(new Client(), await catalogueId(miss.title));
    expect(page).toContain("No matching video available");
    expect(page).not.toContain("youtube-nocookie.com/embed");
  });

  it("an author's own video is labelled as theirs, survives edits that leave it alone, and goes when cleared", async () => {
    const { client } = await registered("vid");
    const id = await createRecipe(client, "Video test", "public");
    const base = {
      title: "Video test", description: "d", servings: "2", visibility: "public",
      ing_name: ["eggs"], ing_qty: ["3"], ing_unit: [""], step_text: ["Whisk."], step_minutes: [""],
    };
    expect((await client.post(`/recipes/${id}/edit`, { ...base, video_url: "https://youtu.be/F86GfZIph8o" })).status).toBe(200);
    let page = await recipePage(client, id);
    expect(page).toContain("youtube-nocookie.com/embed/F86GfZIph8o");
    expect(page).toContain("not checked against the recipe");

    // an edit from a client that doesn't send the field leaves the video attached
    await client.post(`/recipes/${id}/edit`, { ...base, title: "Video test 2" });
    page = await recipePage(client, id);
    expect(page).toContain("youtube-nocookie.com/embed/F86GfZIph8o");

    await client.post(`/recipes/${id}/edit`, { ...base, video_url: "" });
    page = await recipePage(client, id);
    expect(page).not.toContain("youtube-nocookie.com/embed");
    expect(page).toContain("No matching video available");
  });

  it("refuses a video link that isn't a YouTube video, on create and on edit", async () => {
    const { client } = await registered("vid");
    const fields = {
      title: "Bad link", description: "d", servings: "2", visibility: "public",
      ing_name: ["eggs"], ing_qty: ["3"], ing_unit: [""], step_text: ["Whisk."], step_minutes: [""],
    };
    const create = await client.post("/recipes/new", { ...fields, video_url: "https://evil.example/x" });
    expect(create.status).toBe(422);
    expect(await create.text()).toContain("YouTube video address");
    const id = await createRecipe(client, "Good", "public");
    expect((await client.post(`/recipes/${id}/edit`, { ...fields, video_url: "not a url" })).status).toBe(422);
    expect(await recipePage(client, id)).not.toContain("youtube-nocookie.com/embed");
  });

  it("a private recipe's video page is still a 404 to strangers", async () => {
    const { client } = await registered("vid");
    const id = await createRecipe(client, "Secret", "private");
    expect((await new Client().get(`/recipes/${id}`)).status).toBe(404);
  });
});

describe("the Has video filter", () => {
  const ids = (markup: string) => [...new JSDOM(markup).window.document.querySelectorAll<HTMLAnchorElement>("a.rx-tile")].map((a) => a.getAttribute("href")!);

  it("lists only recipes whose page shows a video, for a guest, and every one opens to it", async () => {
    const guest = new Client();
    const res = await guest.get("/recipes?video=1");
    expect(res.status).toBe(200);
    const page = await res.text();
    const hrefs = ids(page);
    const shown = Object.values(videos).filter((v) => v.status === "verified").length;
    expect(hrefs.length).toBe(Math.min(shown, 200));
    expect(page).toContain("Recipes with a video");
    expect(page).toMatch(/aria-pressed="true"[^>]*>(?:<span[^>]*><\/span>)?Has video/);
    for (const href of hrefs.slice(0, 5)) expect(await (await guest.get(href)).text()).toContain("youtube-nocookie.com/embed/");
  });

  it("a recipe without a shown video is left out, and the filter keeps the other filters and the search", async () => {
    const guest = new Client();
    const miss = catalogue.find((r) => videos[r.source] && videos[r.source].status !== "verified")!;
    const missHref = `/recipes/${await catalogueId(miss.title)}`;
    const missQ = encodeURIComponent(miss.title);
    // found by its own title without the filter, gone with it
    expect(ids(await (await guest.get(`/recipes?q=${missQ}`)).text())).toContain(missHref);
    expect(ids(await (await guest.get(`/recipes?video=1&q=${missQ}`)).text())).not.toContain(missHref);
    expect(ids(await (await guest.get(`/recipes?video=1&q=${missQ}&partial=1`)).text())).not.toContain(missHref);

    const hit = catalogue.find((r) => videos[r.source]?.status === "verified")!;
    const word = hit.title.split(" ")[0];
    const searched = await (await guest.get(`/recipes?video=1&q=${encodeURIComponent(word)}`)).text();
    expect(ids(searched)).toContain(`/recipes/${await catalogueId(hit.title)}`);
    expect(searched).toContain('<input type="hidden" name="video" value="1" />');
    expect(searched).toContain("video=1");
  });

  it("an author's own public video counts, and a private one never shows to strangers", async () => {
    const { client } = await registered("vidf");
    const base = { description: "d", servings: "2", ing_name: ["eggs"], ing_qty: ["3"], ing_unit: [""], step_text: ["Whisk."], step_minutes: [""] };
    const pub = await createRecipe(client, "Filterable omelette", "public");
    await client.post(`/recipes/${pub}/edit`, { ...base, title: "Filterable omelette", visibility: "public", video_url: "https://youtu.be/F86GfZIph8o" });
    const priv = await createRecipe(client, "Hidden omelette", "private");
    await client.post(`/recipes/${priv}/edit`, { ...base, title: "Hidden omelette", visibility: "private", video_url: "https://youtu.be/F86GfZIph8o" });

    const noVideo = await createRecipe(client, "Plain omelette", "public");

    const guest = await (await new Client().get("/recipes?video=1&q=omelette")).text();
    expect(ids(guest)).toContain(`/recipes/${pub}`);
    expect(ids(guest)).not.toContain(`/recipes/${priv}`);
    expect(ids(guest)).not.toContain(`/recipes/${noVideo}`);
    expect(ids(await (await client.get("/recipes?video=1&q=omelette")).text())).toContain(`/recipes/${priv}`);
  });
});

describe("videoMatches: same dish, different words", () => {
  it.each([
    ["Ma Po Tofu", "How to Make Mapo Tofu (Mabo Dofu Recipe)"],
    ["Lasagne", "The Best Meat Lasagna Recipe"],
    ["Bang bang prawn salad", "Bang Bang Shrimp Salad"],
    ["Beef pho", "Legit Vietnamese Pho At Home"],
    ["Borsch", "Classic Ukrainian Borscht Recipe"],
    ["Baba Ghanoush", "Baba Ganoush (creamy eggplant dip)"],
    ["Spanish Tortilla", "Ultimate Spanish Omelette"],
  ])("%s ≈ %s", (recipe, video) => expect(videoMatches(recipe, video)).toBe(true));

  it.each([
    ["Double cheeseburger with special sauce", "How to make a McDonald's Big Mac"],
    ["Beef and Mustard Pie", "James Martin Home Comforts 17/02/14"],
    ["Chicken Couscous", "Tasty Turkish Couscous"],
    ["Fennel Dauphinoise", "Potato and Courgette Dauphinoise"],
    ["Stuffed Lamb Tomatoes", "Rice-Stuffed Baked Tomatoes"],
    ["Dundee cake", "Traditional English Christmas Cake"],
  ])("%s is not %s", (recipe, video) => expect(videoMatches(recipe, video)).toBe(false));
});
