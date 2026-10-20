import { readFileSync } from "node:fs";
import { all, run, transaction } from "./db.ts";
import type { CatalogueVideo } from "./videos.ts";

// Attaches src/data/videos.json to catalogue recipes by source key. Idempotent,
// and never touches a recipe whose video its author chose themselves.
export function seedVideos(): number {
  let data: Record<string, CatalogueVideo>;
  try {
    data = JSON.parse(readFileSync(new URL("./data/videos.json", import.meta.url), "utf8"));
  } catch {
    return 0;
  }
  const current = new Map(
    all<{ source: string; video_id: string | null; video_status: string | null }>(
      "SELECT source, video_id, video_status FROM recipes WHERE source LIKE 'themealdb:%'",
    ).map((r) => [r.source, r]),
  );
  let changed = 0;
  transaction(() => {
    for (const [source, v] of Object.entries(data)) {
      const row = current.get(source);
      if (!row || row.video_status === "user") continue;
      const id = v.status === "verified" ? v.videoId : null;
      if (row.video_status === v.status && row.video_id === id) continue;
      run(
        "UPDATE recipes SET video_id = ?, video_title = ?, video_channel = ?, video_checked = ?, video_status = ? WHERE source = ?",
        id, id ? (v.title ?? null) : null, id ? (v.channel ?? null) : null, v.checked, v.status, source,
      );
      changed++;
    }
  });
  return changed;
}
