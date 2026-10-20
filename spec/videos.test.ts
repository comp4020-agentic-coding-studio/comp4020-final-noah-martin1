import { readFileSync } from "node:fs";
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

describe("recipe videos", () => {
  const recipePage = async (client: Client, id: number) => (await client.get(`/recipes/${id}`)).text();
  const catalogueId = async (title: string) => {
    const html = await (await new Client().get(`/recipes?q=${encodeURIComponent(title)}`)).text();
    return Number(html.match(/href="\/recipes\/(\d+)"/)?.[1]);
  };

  it("a catalogue recipe with a verified video embeds exactly that video, labelled with its provenance", async () => {
    const hit = catalogue.find((r) => videos[r.source]?.status === "verified");
    expect(hit, "videos.json has at least one verified video").toBeDefined();
    const id = await catalogueId(hit!.title);
    const page = await recipePage(new Client(), id);
    expect(page).toContain(`https://www.youtube-nocookie.com/embed/${videos[hit!.source].videoId}`);
    expect(page).toContain("linked to this recipe by TheMealDB");
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
