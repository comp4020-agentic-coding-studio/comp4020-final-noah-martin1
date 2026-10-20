// Builds src/data/videos.json: for each catalogue recipe, TheMealDB's own
// YouTube link for that meal, kept only if YouTube's oEmbed says it exists and
// is embeddable and its title agrees with the recipe's (videoMatches).
// Usage: node scripts/fetch-videos.ts   (about 4 requests a second)
import { readFileSync, writeFileSync } from "node:fs";
import { type CatalogueVideo, parseYouTubeId, videoMatches } from "../src/videos.ts";

const recipes: { source: string; title: string }[] = JSON.parse(readFileSync(new URL("../src/data/catalogue.json", import.meta.url), "utf8"));
const out: Record<string, CatalogueVideo> = {};
const checked = new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, tries = 3): Promise<{ status: number; body: any }> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
    } catch (err) {
      if (i >= tries - 1) throw err;
      await sleep(1000 * (i + 1));
    }
  }
}

for (const r of recipes) {
  const mealId = r.source.replace("themealdb:", "");
  const rec = (v: Omit<CatalogueVideo, "checked">) => (out[r.source] = { ...v, checked });
  try {
    const meal = (await getJson(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${mealId}`)).body?.meals?.[0];
    const link = String(meal?.strYoutube ?? "").trim();
    const id = link ? parseYouTubeId(link) : null;
    if (!id) rec({ videoId: null, status: "unavailable", reason: link ? "TheMealDB's link isn't a valid YouTube video URL" : "TheMealDB lists no video for this meal" });
    else {
      const o = await getJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
      if (o.status === 404) rec({ videoId: id, status: "unavailable", reason: "video no longer exists on YouTube" });
      else if (o.status === 401 || o.status === 403) rec({ videoId: id, status: "unavailable", reason: "video can't be embedded" });
      else if (o.status !== 200 || !o.body) rec({ videoId: id, status: "unavailable", reason: `YouTube oEmbed answered ${o.status}` });
      else if (!videoMatches(r.title, String(o.body.title))) rec({ videoId: id, title: o.body.title, channel: o.body.author_name, status: "rejected", reason: "video title doesn't match the dish" });
      else rec({ videoId: id, title: o.body.title, channel: o.body.author_name, status: "verified" });
    }
  } catch (err) {
    rec({ videoId: null, status: "unavailable", reason: `lookup failed: ${(err as Error).message}` });
  }
  await sleep(250);
  if (Object.keys(out).length % 50 === 0) console.log(Object.keys(out).length);
}
writeFileSync(new URL("../src/data/videos.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
const n = (s: string) => Object.values(out).filter((v) => v.status === s).length;
console.log(`verified ${n("verified")}, rejected ${n("rejected")}, unavailable ${n("unavailable")}`);
