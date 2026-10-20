// Re-judges the stored video titles in src/data/videos.json with the current
// videoMatches, without asking TheMealDB or YouTube again: only verified and
// rejected entries change between those two states. Usage:
//   node scripts/rejudge-videos.ts
import { readFileSync, writeFileSync } from "node:fs";
import { type CatalogueVideo, videoMatches } from "../src/videos.ts";

const file = new URL("../src/data/videos.json", import.meta.url);
const data: Record<string, CatalogueVideo> = JSON.parse(readFileSync(file, "utf8"));
const titles = new Map((JSON.parse(readFileSync(new URL("../src/data/catalogue.json", import.meta.url), "utf8")) as { source: string; title: string }[]).map((r) => [r.source, r.title]));
// decisions a person made after reading the recipe beside the video title
const overrides: Record<string, { status: "verified" | "rejected"; reason: string }> = JSON.parse(
  readFileSync(new URL("../src/data/video-overrides.json", import.meta.url), "utf8"),
);
let up = 0;
let down = 0;
for (const [source, v] of Object.entries(data)) {
  if ((v.status !== "verified" && v.status !== "rejected") || !v.title) continue;
  const o = overrides[source];
  const ok = o ? o.status === "verified" : videoMatches(titles.get(source) ?? "", v.title);
  if (o && !ok) {
    if (v.status === "verified") down++;
    data[source] = { ...v, status: "rejected", reason: o.reason };
    continue;
  }
  if (ok && v.status === "rejected") {
    data[source] = { ...v, status: "verified", reason: undefined };
    up++;
  } else if (!ok && v.status === "verified") {
    data[source] = { ...v, status: "rejected", reason: "video title doesn't match the dish" };
    down++;
  }
}
writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
const n = (s: string) => Object.values(data).filter((v) => v.status === s).length;
console.log(`now verified ${up}, now rejected ${down}; totals: verified ${n("verified")}, rejected ${n("rejected")}, unavailable ${n("unavailable")}`);
