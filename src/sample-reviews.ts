// Example reviews on catalogue recipes, so the reviews section, its
// filters and the "Top rated" recipe list show what they do before real
// people have written much, like the globe's sample cooks (src/samples.ts).
// Written by sample reviewers (users.is_sample, migration 013): accounts
// nobody can sign into, find or befriend, each review labelled "Sample".
// Seeded at boot whether or not demo mode is on, and rebuilt only when
// SAMPLE_VERSION changes. To remove them all, delete their reviews, then
// them (deleting only the users would leave the reviews as "Deleted
// account", as for a real person):
//   DELETE FROM reviews WHERE author_id IN (SELECT id FROM users WHERE is_sample = 1);
//   DELETE FROM users WHERE is_sample = 1;

import { randomBytes } from "node:crypto";
import { all, one, run, transaction } from "./db.ts";
import { detectLanguage } from "./language.ts";

// [username, display name, character]
const REVIEWERS: [string, string, string][] = [
  ["sample-mia", "Mia Thompson", "avocado"],
  ["sample-raj", "Raj Mehta", "chilli"],
  ["sample-lucia", "Lucía Romero", "strawberry"],
  ["sample-hana", "Hana Sato", "onigiri"],
  ["sample-tom", "Tom Gallagher", "pan"],
  ["sample-wen", "Wen Li", "dumpling"],
  ["sample-noor", "Noor Haddad", "teapot"],
  ["sample-kate", "Kate O'Brien", "bread"],
  ["sample-linh", "Linh Pham", "carrot"],
  ["sample-marco", "Marco Bellini", "mushroom"],
];

interface SampleReview {
  recipe: string;
  by: string;
  stars: number;
  body: string;
  // [by, body] replies, oldest first
  replies?: [string, string][];
  likes?: string[];
  daysAgo: number;
}

// Plausible things home cooks say: what they changed, how it went. Spread
// across ratings and a few languages (for the language filter and the
// translator), on catalogue dishes people cook often.
const REVIEWS: SampleReview[] = [
  { recipe: "Pad Thai", by: "sample-mia", stars: 5, daysAgo: 3, likes: ["sample-tom", "sample-wen", "sample-kate"],
    body: "Better than our local takeaway. I soaked the noodles a bit less than it says so they didn't go mushy in the pan.",
    replies: [["sample-linh", "Same, slightly undercooked noodles are the trick. A squeeze of extra lime at the end too."], ["sample-mia", "Will try the extra lime next time!"]] },
  { recipe: "Pad Thai", by: "sample-tom", stars: 4, daysAgo: 9, likes: ["sample-mia"],
    body: "Good, but I found it a touch sweet. Next time I'll use half the sugar and a bit more fish sauce." },
  { recipe: "Pad Thai", by: "sample-linh", stars: 5, daysAgo: 14,
    body: "Món này rất ngon, tôi đã thêm một chút nước mắm và đậu phộng rang." },
  { recipe: "Lasagne", by: "sample-marco", stars: 5, daysAgo: 6, likes: ["sample-kate", "sample-lucia", "sample-raj", "sample-noor"],
    body: "Proper Sunday lasagne. Let it rest for 15 minutes before cutting or the layers slide apart.",
    replies: [["sample-kate", "The resting tip made all the difference, thank you."]] },
  { recipe: "Lasagne", by: "sample-kate", stars: 4, daysAgo: 20,
    body: "Lovely, though it took about 20 minutes longer than the recipe says in my oven." },
  { recipe: "Lasagne", by: "sample-lucia", stars: 5, daysAgo: 27, likes: ["sample-marco"],
    body: "Me encantó esta receta, pero le puse menos sal y un poco más de ajo. Quedó perfecta." },
  { recipe: "Beef Rendang", by: "sample-raj", stars: 5, daysAgo: 4, likes: ["sample-noor", "sample-tom"],
    body: "Worth the long cook. Keep stirring near the end when it starts to dry out, that's where the flavour comes from." },
  { recipe: "Beef Rendang", by: "sample-noor", stars: 4, daysAgo: 12,
    body: "Delicious but very rich. I served it with plenty of rice and cucumber to balance it." },
  { recipe: "Shakshuka", by: "sample-noor", stars: 5, daysAgo: 2, likes: ["sample-mia", "sample-hana", "sample-raj"],
    body: "Weekend breakfast sorted. A spoon of harissa in the sauce and some feta on top before serving.",
    replies: [["sample-raj", "Harissa is a great idea, doing that this Sunday."]] },
  { recipe: "Shakshuka", by: "sample-hana", stars: 3, daysAgo: 16,
    body: "Tasty sauce but my eggs overcooked. Cover the pan and check after 5 minutes rather than 8." },
  { recipe: "Spaghetti Bolognese", by: "sample-kate", stars: 4, daysAgo: 5, likes: ["sample-tom"],
    body: "Family favourite now. I grated a carrot into the sauce to sneak in some veg, nobody noticed." },
  { recipe: "Spaghetti Bolognese", by: "sample-marco", stars: 4, daysAgo: 18,
    body: "Ricetta ottima, ma lascia cuocere il sugo almeno un'ora in più. Ne vale la pena." },
  { recipe: "Lamingtons", by: "sample-mia", stars: 5, daysAgo: 7, likes: ["sample-kate", "sample-linh"],
    body: "Made these for a work morning tea and they were gone in minutes. Freeze the sponge for 20 minutes first, much easier to dip.",
    replies: [["sample-kate", "Freezing first is genius, no more crumbs everywhere."]] },
  { recipe: "Lamingtons", by: "sample-tom", stars: 4, daysAgo: 22,
    body: "Messy but worth it. The icing needs to be quite runny or the coconut won't stick." },
  { recipe: "Fish pie", by: "sample-kate", stars: 5, daysAgo: 8, likes: ["sample-tom", "sample-noor"],
    body: "Comfort food done right. I added a handful of frozen peas and some chopped boiled egg like my nan did." },
  { recipe: "Fish pie", by: "sample-tom", stars: 3, daysAgo: 25,
    body: "Good flavour but the mash topping sank into the sauce. Let the filling cool a bit before topping." },
  { recipe: "Teriyaki Chicken Casserole", by: "sample-hana", stars: 4, daysAgo: 10, likes: ["sample-wen"],
    body: "とても美味しかったです。次は玉ねぎを多めに入れます。" },
  { recipe: "Teriyaki Chicken Casserole", by: "sample-wen", stars: 5, daysAgo: 13,
    body: "这道菜很好吃，我加了一点辣椒，全家都喜欢。" },
  { recipe: "Irish beef stew", by: "sample-kate", stars: 5, daysAgo: 11, likes: ["sample-marco", "sample-tom", "sample-mia"],
    body: "Perfect for a cold night. I used half stout and half stock, really deep flavour." },
  { recipe: "Irish beef stew", by: "sample-raj", stars: 4, daysAgo: 30,
    body: "Hearty and simple. Brown the beef in batches, it makes a big difference." },
  { recipe: "Bread and Butter Pudding", by: "sample-noor", stars: 4, daysAgo: 15,
    body: "Used leftover brioche instead of white bread. A bit of orange zest in the custard was lovely." },
  { recipe: "Bread and Butter Pudding", by: "sample-lucia", stars: 5, daysAgo: 19, likes: ["sample-noor"],
    body: "My kids asked for seconds. Soak it for an hour before baking for a really soft middle." },
  { recipe: "Tamal De Maicena", by: "sample-lucia", stars: 4, daysAgo: 17,
    body: "Muy rico y fácil de hacer. Le puse un poco de canela por encima." },
];

// Bump to rebuild the sample reviews on the next deploy (once): their dates
// count back from then.
export const SAMPLE_VERSION = "2026-11-06";

// The sample reviewers and their reviews, rebuilt when `version` is new (or
// they're missing): anything they wrote before is replaced, so a rebuild
// never doubles up. Real people's reviews and replies are untouched, except
// replies to a sample review, which go with it. Returns how many reviews
// were written, 0 when nothing needed doing.
export function seedSampleReviews(version = SAMPLE_VERSION): number {
  const built = one<{ value: string }>("SELECT value FROM app_state WHERE key = 'sample_reviews_version'")?.value;
  if (built === version && one("SELECT 1 FROM users WHERE is_sample = 1")) return 0;
  const ids = new Map<string, number>();
  transaction(() => {
    for (const [username, name, avatar] of REVIEWERS) {
      const row = one<{ id: number }>("SELECT id FROM users WHERE username = ?", username);
      if (row) {
        run("UPDATE users SET display_name = ?, avatar = ?, is_sample = 1 WHERE id = ?", name, avatar, row.id);
        ids.set(username, row.id);
      } else {
        // a password nobody knows, in a form verifyPassword never accepts
        ids.set(username, run("INSERT INTO users (username, display_name, password_hash, avatar, is_sample) VALUES (?, ?, ?, ?, 1)", username, name, `sample:${randomBytes(16).toString("hex")}`, avatar).id);
      }
    }
    const all_ = [...ids.values()];
    run(`DELETE FROM reviews WHERE author_id IN (${all_.map(() => "?").join(", ")})`, ...all_);
  });
  const recipeId = new Map<string, number>(
    all<{ id: number; title: string }>(
      `SELECT id, title FROM recipes WHERE source IS NOT NULL AND visibility = 'public' AND title IN (${[...new Set(REVIEWS.map((r) => r.recipe))].map(() => "?").join(", ")})`,
      ...new Set(REVIEWS.map((r) => r.recipe)),
    ).map((r) => [r.title, r.id]),
  );
  let n = 0;
  transaction(() => {
    for (const r of REVIEWS) {
      const recipe = recipeId.get(r.recipe);
      const by = ids.get(r.by);
      if (!recipe || !by) continue;
      const at = (days: number, minutes = 0) => `strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${days} days', '+${minutes} minutes')`;
      const id = run(
        `INSERT INTO reviews (recipe_id, author_id, rating, body, lang, created_at) VALUES (?, ?, ?, ?, ?, ${at(r.daysAgo)})`,
        recipe, by, r.stars, r.body, detectLanguage(r.body),
      ).id;
      n++;
      (r.replies ?? []).forEach(([who, text], i) => {
        const replier = ids.get(who);
        if (replier) run(`INSERT INTO reviews (recipe_id, author_id, parent_id, body, lang, created_at) VALUES (?, ?, ?, ?, ?, ${at(r.daysAgo, 90 * (i + 1))})`, recipe, replier, id, text, detectLanguage(text));
      });
      for (const who of r.likes ?? []) {
        const liker = ids.get(who);
        if (liker && liker !== by) run("INSERT OR IGNORE INTO review_likes (review_id, user_id) VALUES (?, ?)", id, liker);
      }
    }
    run(
      "INSERT INTO app_state (key, value) VALUES ('sample_reviews_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
      version,
    );
  });
  return n;
}
