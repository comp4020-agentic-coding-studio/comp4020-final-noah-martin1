// Pure helpers only (no database), so scripts and specs can import them.
// Recipe videos. A catalogue video is "verified" only when the recipe's
// ingredients and steps were transcribed from that video (its transcript or
// the creator's written recipe for it) and a second pass checked them against
// that source; src/data/videos.json records each one. A title match alone
// (videoMatches, scripts/fetch-videos.ts) only finds candidates: those are
// stored as "rejected" until checked, so the page never shows them.

export type VideoStatus = "verified" | "unavailable" | "rejected" | "user";

const STOP = new Set([
  "a", "an", "and", "the", "with", "of", "in", "on", "to", "for", "my", "our", "easy", "best", "recipe", "how", "make",
  "homemade", "classic", "quick", "simple", "authentic", "perfect", "ultimate", "style", "traditional", "from", "by",
  "video", "cooking", "cook", "food", "dish", "meal",
]);

// Different spellings and names for the same food, folded to one, so
// "Mapo Tofu" matches "Ma Po Tofu" and "Bang Bang Shrimp" matches prawns.
const SAME: [RegExp, string][] = [
  [/\bma po\b/g, "mapo"], [/\bmabo\b/g, "mapo"], [/\blasagna\b/g, "lasagne"], [/\bborscht?\b|\bborsch\b/g, "borsch"],
  [/\bganoush|ghanoush|ganouj\b/g, "ghanoush"], [/\bshrimps?\b/g, "prawn"], [/\beggplants?\b/g, "aubergine"],
  [/\bbeets?\b/g, "beetroot"], [/\bchil[il]\b|\bchilli\b/g, "chilli"], [/\bomelett?e\b/g, "tortilla"],
  [/\bhommus|houmous|humus\b/g, "hummus"], [/\bcourgettes?\b|\bzucchinis?\b/g, "courgette"], [/\bcoriander|cilantro\b/g, "coriander"],
  [/\bschi|shchi\b/g, "shchi"], [/\bghriyba|ghoriba|ghriba\b/g, "ghoriba"], [/\bajo ?blanco\b/g, "ajoblanco"],
  [/\bpho\b/g, "pho"], [/\bscallions?\b/g, "spring onion"], [/\bcapsicums?|bell peppers?\b/g, "capsicum"],
  [/\bminced meat\b/g, "mince"], [/\bground beef\b/g, "beef mince"], [/\bstew\b|\bcasserole\b|\bhot ?pot\b/g, "stew"],
  [/\bcake\b|\bgateau\b/g, "cake"], [/\bbiscuits?\b|\bcookies?\b/g, "biscuit"], [/\bmeatballs?\b|\bkefta|kofta\b/g, "meatball"],
  [/\bsalmone\b/g, "salmon"], [/\bpollo\b/g, "chicken"], [/\bparmentier\b/g, "parmentier"],
];

function words(s: string): string[] {
  let t = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ");
  for (const [re, to] of SAME) t = t.replace(re, to);
  return t
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(es|s)$/, ""));
}

// Every key word of a short title, or at least two-thirds of a longer one,
// must appear in the video's title, after spellings and names are folded
// together. A one- or two-word dish ("Lasagne", "Beef pho") needs its last
// word, the dish itself, plus any other word when there is one.
export function videoMatches(recipeTitle: string, videoTitle: string): boolean {
  const need = [...new Set(words(recipeTitle))];
  if (!need.length) return false;
  const have = new Set(words(videoTitle));
  const hit = need.filter((w) => have.has(w)).length;
  // a word that says what the dish is made of or where it's from, which a
  // video of a different dish wouldn't share ("Venezuelan", "lamb",
  // "fennel"); generic cooking words don't count
  const telling = need.filter((w) => !GENERIC.has(w));
  const missingTelling = telling.filter((w) => !have.has(w));
  if (need.length === 1) return hit === 1;
  // two words: the dish and what kind; the dish word must be there, and the
  // kind too unless the video names the dish on its own ("Lasagne" for
  // "Lasagne Bolognese", "Pho" for "Beef pho")
  if (need.length === 2) return have.has(need[1]) && (have.has(need[0]) || GENERIC.has(need[0]) || DISH_ALONE.has(need[1]));
  // longer: two-thirds of the words, and every telling word but one
  return hit / need.length >= 2 / 3 && missingTelling.length <= Math.max(0, telling.length - 2) && missingTelling.length <= 1;
}

// Words about how it's cooked or served rather than what it is.
const GENERIC = new Set(["crispy", "spicy", "sweet", "savoury", "savory", "baked", "fried", "grilled", "griddled", "roast", "roasted", "stuffed", "braised", "slow", "hot", "cold", "fresh", "creamy", "smoky", "honey", "garlicky", "chinese", "spanish", "italian", "french", "greek", "turkish", "vietnamese", "thai", "indian", "dutch", "irish", "english", "british", "traditional", "summer", "winter", "christmas", "vegetarian", "vegan", "algerian", "afghan", "bajan", "kenyan", "russian"].map((w) => w.replace(/(es|s)$/, "")));

// Dishes whose name alone identifies them, so a video titled just that is the
// same dish whatever adjective the recipe adds.
const DISH_ALONE = new Set(["pho", "lasagne", "bolognese", "borsch", "souvlaki", "tortilla", "ajoblanco", "ghanoush", "empanada", "latke", "stroopwafel", "lahmacun", "alfajore", "skoleboller", "goulash", "shchi", "mapo", "mein", "flapjack", "fool"].map((w) => w.replace(/(es|s)$/, "")));

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
  // the recipe was transcribed from this video and checked against it; only
  // these may be "verified", and the fetch scripts leave them alone
  transcribed?: true;
}

