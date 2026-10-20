// Pure helpers only (no database), so scripts and specs can import them.
// Recipe videos. A catalogue recipe's video is the one TheMealDB itself links
// to that exact meal, kept only if YouTube says it exists and can be embedded
// and its title shares the dish's key words (scripts/fetch-videos.ts). We
// can't watch videos, so "verified" means that, not that every quantity agrees.

export type VideoStatus = "verified" | "unavailable" | "rejected" | "user";

const STOP = new Set([
  "a", "an", "and", "the", "with", "of", "in", "on", "to", "for", "my", "our", "easy", "best", "recipe", "how", "make",
  "homemade", "classic", "quick", "simple", "authentic", "perfect", "ultimate", "style", "traditional", "from", "by",
  "video", "cooking", "cook", "food", "dish", "meal",
]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(es|s)$/, ""));
}

// Every key word of a short title, or at least two-thirds of a longer one,
// must appear in the video's title.
export function videoMatches(recipeTitle: string, videoTitle: string): boolean {
  const need = [...new Set(words(recipeTitle))];
  if (!need.length) return false;
  const have = new Set(words(videoTitle));
  const hit = need.filter((w) => have.has(w)).length;
  return need.length <= 3 ? hit === need.length : hit / need.length >= 2 / 3;
}

const ID = /^[A-Za-z0-9_-]{11}$/;

// The 11-character id from a YouTube watch, shorts, embed or youtu.be URL;
// null for anything else (other hosts, playlists, malformed ids).
export function parseYouTubeId(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = /^\/(?:shorts|embed|live)\/([^/]+)/.exec(u.pathname);
      id = m ? m[1] : null;
    }
  }
  return id && ID.test(id) ? id : null;
}

export interface CatalogueVideo {
  videoId: string | null;
  title?: string;
  channel?: string;
  checked: string;
  status: "verified" | "rejected" | "unavailable";
  reason?: string;
}

