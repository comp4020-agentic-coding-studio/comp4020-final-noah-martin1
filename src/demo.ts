// The demo kitchen markers are pointed at: alice, sam, bo and jo, one
// password, friends and a shared household. While DEMO_MODE is on the
// sign-in form is prefilled with alice. The accounts are shared, so when
// DEMO_VERSION changes their content is rebuilt once: their own recipes,
// pantries, calendars and household go back to a tidy, current week, and
// anything a visitor added while signed in as them is cleared. Nobody else's
// data is touched. Between versions nothing is rebuilt, so what a marker
// adds as alice persists across the machine's idle stops and restarts.
import { hashPassword } from "./auth.ts";
import { all, ingredientId, one, run, transaction } from "./db.ts";
import { addDays, today } from "./format.ts";
import { acceptFriend, requestFriend } from "./friends.ts";
import { resetHouseholdDemo, seedHouseholdDemo } from "./household.ts";
import { saveRecipe, type RecipeInput } from "./recipes.ts";

export const DEMO_MODE = true;

// Bump to rebuild the demo kitchen on the next deploy (once).
export const DEMO_VERSION = "2026-11-05";

export const DEMO_LOGIN = { username: "alice", password: "password123" };

// The seeded accounts all share DEMO_LOGIN's password and markers are told
// to use them, so none may have its password changed: one change would lock
// everyone else out. This holds whether or not DEMO_MODE prefills the form.
export const DEMO_USERNAMES = ["alice", "sam", "bo", "jo"];

const PEOPLE: [string, string][] = [
  ["alice", "Alice Ng"],
  ["sam", "Sam Patel"],
  ["bo", "Bo Kim"],
  ["jo", "Jo Rivera"],
];

// Demo recipes borrow the photo of the same dish from the catalogue
// (TheMealDB), so each looks like what it is; none is presented as someone's
// own photo. A dish with no catalogue photo isn't used.
function catalogueImage(title: string): string | null {
  return one<{ image_url: string }>("SELECT image_url FROM recipes WHERE source IS NOT NULL AND title = ? AND image_url LIKE 'http%'", title)?.image_url ?? null;
}

type DemoRecipe = { author: string; photo: string } & Omit<RecipeInput, "image_url">;

const RECIPES: DemoRecipe[] = [
  {
    author: "alice",
    photo: "Pad Thai",
    title: "Weeknight pad thai",
    description: "Sweet, sour and salty in twenty-five minutes. Tofu keeps it cheap; swap in prawns when they're on special.",
    servings: 2,
    visibility: "friends",
    dietary_tags: ["vegetarian", "quick"],
    ingredients: [
      { name: "rice noodles", quantity: 200, unit: "g", optional: false },
      { name: "firm tofu", quantity: 150, unit: "g", optional: false },
      { name: "eggs", quantity: 2, unit: "", optional: false },
      { name: "fish sauce", quantity: 30, unit: "ml", optional: false },
      { name: "lime", quantity: 1, unit: "", optional: false },
      { name: "spring onion", quantity: 2, unit: "", optional: true },
    ],
    steps: [
      { text: "Soak the noodles in warm water until pliable.", est_minutes: 20 },
      { text: "Whisk fish sauce, lime juice and a spoon of sugar into a sauce.", est_minutes: 2 },
      { text: "Fry the tofu until golden, push it aside and scramble the eggs.", est_minutes: 6 },
      { text: "Add the noodles and sauce, toss for two minutes, finish with spring onion.", est_minutes: 3 },
    ],
  },
  {
    author: "alice",
    photo: "Banana pancakes",
    title: "Banana oat pancakes",
    description: "Weekend breakfast from the fruit bowl: ripe bananas, oats and eggs, no flour.",
    servings: 2,
    visibility: "friends",
    dietary_tags: ["vegetarian", "quick", "budget"],
    ingredients: [
      { name: "banana", quantity: 2, unit: "", optional: false },
      { name: "rolled oats", quantity: 80, unit: "g", optional: false },
      { name: "eggs", quantity: 2, unit: "", optional: false },
      { name: "milk", quantity: 60, unit: "ml", optional: false },
      { name: "butter", quantity: 20, unit: "g", optional: false },
      { name: "honey", quantity: 20, unit: "g", optional: true },
    ],
    steps: [
      { text: "Blend the bananas, oats, eggs and milk into a thick batter; rest it for five minutes.", est_minutes: 7 },
      { text: "Melt a little butter in a pan over medium heat and pour in small rounds of batter.", est_minutes: 2 },
      { text: "Cook until bubbles appear, flip, and cook another minute.", est_minutes: 10 },
      { text: "Serve with a drizzle of honey.", est_minutes: 1 },
    ],
  },
  {
    author: "alice",
    photo: "Thai pumpkin soup",
    title: "Thai pumpkin soup",
    description: "Roast pumpkin blitzed with coconut milk and red curry paste. Makes enough for lunches.",
    servings: 4,
    visibility: "public",
    dietary_tags: ["vegan", "gluten-free"],
    ingredients: [
      { name: "pumpkin", quantity: 1000, unit: "g", optional: false },
      { name: "onion", quantity: 1, unit: "", optional: false },
      { name: "red curry paste", quantity: 40, unit: "g", optional: false },
      { name: "coconut milk", quantity: 400, unit: "ml", optional: false },
      { name: "vegetable stock", quantity: 500, unit: "ml", optional: false },
      { name: "coriander", quantity: 1, unit: "handful", optional: true },
    ],
    steps: [
      { text: "Roast the pumpkin in chunks at 200°C until soft and caramelised.", est_minutes: 35 },
      { text: "Soften the onion in a pot, then fry the curry paste for a minute.", est_minutes: 7 },
      { text: "Add the pumpkin, stock and most of the coconut milk; simmer for ten minutes.", est_minutes: 10 },
      { text: "Blend until smooth and serve with the rest of the coconut milk and coriander.", est_minutes: 3 },
    ],
  },
  {
    author: "sam",
    photo: "Shakshuka",
    title: "Shakshuka",
    description: "Eggs poached in spiced tomato. Breakfast, lunch or dinner.",
    servings: 2,
    visibility: "public",
    dietary_tags: ["vegetarian", "gluten-free", "budget"],
    ingredients: [
      { name: "canned tomatoes", quantity: 400, unit: "g", optional: false },
      { name: "eggs", quantity: 4, unit: "", optional: false },
      { name: "onion", quantity: 1, unit: "", optional: false },
      { name: "capsicum", quantity: 1, unit: "", optional: false },
      { name: "garlic", quantity: 2, unit: "clove", optional: false },
      { name: "ground cumin", quantity: 1, unit: "tsp", optional: false },
    ],
    steps: [
      { text: "Soften the onion and capsicum in olive oil.", est_minutes: 8 },
      { text: "Add the garlic and cumin, then the tomatoes; simmer until thick.", est_minutes: 10 },
      { text: "Make four wells, crack in the eggs and cover until the whites set.", est_minutes: 6 },
    ],
  },
  {
    author: "sam",
    photo: "Dal fry",
    title: "Weeknight dal",
    description: "Red lentils simmered soft and finished with a sizzling spiced oil. Cheap, filling and better the next day.",
    servings: 4,
    visibility: "friends",
    dietary_tags: ["vegan", "gluten-free", "budget"],
    ingredients: [
      { name: "red lentils", quantity: 300, unit: "g", optional: false },
      { name: "onion", quantity: 1, unit: "", optional: false },
      { name: "garlic", quantity: 3, unit: "clove", optional: false },
      { name: "ginger", quantity: 15, unit: "g", optional: false },
      { name: "ground turmeric", quantity: 1, unit: "tsp", optional: false },
      { name: "ground cumin", quantity: 1, unit: "tsp", optional: false },
      { name: "rice", quantity: 300, unit: "g", optional: true },
    ],
    steps: [
      { text: "Rinse the lentils, then simmer them with turmeric in a litre of water until soft.", est_minutes: 20 },
      { text: "Fry the onion until golden, then the garlic, ginger and cumin.", est_minutes: 10 },
      { text: "Stir the spiced onion through the lentils and season. Serve with rice.", est_minutes: 2 },
    ],
  },
  {
    author: "bo",
    photo: "Panang chicken curry",
    title: "Chicken & coconut curry",
    description: "A one-pot curry that uses up whatever greens are wilting.",
    servings: 4,
    visibility: "friends",
    dietary_tags: ["gluten-free", "dairy-free", "high-protein"],
    ingredients: [
      { name: "chicken thigh", quantity: 500, unit: "g", optional: false },
      { name: "coconut milk", quantity: 400, unit: "ml", optional: false },
      { name: "spinach", quantity: 100, unit: "g", optional: false },
      { name: "ginger", quantity: 20, unit: "g", optional: false },
      { name: "rice", quantity: 300, unit: "g", optional: false },
    ],
    steps: [
      { text: "Brown the chicken in batches.", est_minutes: 8 },
      { text: "Fry the ginger and curry paste, add the coconut milk and simmer the chicken.", est_minutes: 20 },
      { text: "Stir through the spinach; serve over rice.", est_minutes: 2 },
    ],
  },
  {
    author: "jo",
    photo: "Salmon avocado salad",
    title: "Salmon & avocado salad",
    description: "Pan-seared salmon over leaves, avocado and a lemon dressing. Ten minutes, no oven.",
    servings: 2,
    visibility: "public",
    dietary_tags: ["gluten-free", "dairy-free", "high-protein", "quick"],
    ingredients: [
      { name: "salmon fillet", quantity: 300, unit: "g", optional: false },
      { name: "avocado", quantity: 1, unit: "", optional: false },
      { name: "spinach", quantity: 80, unit: "g", optional: false },
      { name: "lemon", quantity: 1, unit: "", optional: false },
      { name: "olive oil", quantity: 30, unit: "ml", optional: false },
    ],
    steps: [
      { text: "Season the salmon and sear it skin-side down until crisp, then turn for a minute.", est_minutes: 8 },
      { text: "Whisk lemon juice and olive oil into a dressing.", est_minutes: 1 },
      { text: "Toss the leaves and avocado in the dressing and top with flaked salmon.", est_minutes: 2 },
    ],
  },
];

// Each person's own fridge and pantry: [name, qty, unit, days until expiry
// (null = none), cents]. Dates are from today, so "use soon" is always
// current; one item each is near its date so the reminders show something.
const PANTRY: Record<string, [string, number, string, number | null, number | null][]> = {
  alice: [
    ["eggs", 10, "", 9, 650],
    ["firm tofu", 300, "g", 5, 350],
    ["rice noodles", 400, "g", 200, 280],
    ["fish sauce", 250, "ml", null, 420],
    ["lime", 3, "", 10, 240],
    ["banana", 4, "", 2, 280],
    ["rolled oats", 750, "g", 120, 199],
    ["milk", 2000, "ml", 6, 310],
    ["butter", 250, "g", 30, 450],
    ["honey", 500, "g", null, 650],
    ["greek yoghurt", 1000, "g", 6, 550],
    ["cheddar cheese", 500, "g", 21, 900],
    ["pumpkin", 1200, "g", 12, 400],
    ["coconut milk", 400, "ml", 500, 200],
    ["salmon fillet", 300, "g", 1, 1100],
    ["capsicum", 2, "", 8, 300],
    ["carrot", 5, "", 18, 200],
    ["lemon", 3, "", 14, 240],
    ["onion", 4, "", 30, 260],
    ["garlic", 1, "bulb", 40, 150],
    ["potato", 2000, "g", 30, 450],
    ["spaghetti", 500, "g", 400, 200],
    ["rice", 1000, "g", 400, 300],
    ["plain flour", 1000, "g", 300, 180],
    ["olive oil", 750, "ml", null, 1200],
    ["soy sauce", 500, "ml", null, 380],
    ["ground cumin", 50, "g", null, 250],
    ["paprika", 50, "g", null, 250],
  ],
  sam: [
    ["eggs", 6, "", 8, 450],
    ["red lentils", 500, "g", 300, 320],
    ["ginger", 100, "g", 14, 200],
    ["ground turmeric", 50, "g", null, 250],
    ["onion", 3, "", 25, 200],
    ["capsicum", 1, "", 3, 150],
  ],
  bo: [["chicken thigh", 500, "g", 2, 650]],
  jo: [["avocado", 2, "", 3, 300]],
};

// Their own week: [who, days from today, meal, recipe title, shared]
const PLAN: [string, number, "breakfast" | "lunch" | "dinner", string, number][] = [
  ["alice", 0, "dinner", "Weeknight pad thai", 1],
  ["alice", 1, "breakfast", "Banana oat pancakes", 0],
  ["alice", 2, "lunch", "Thai pumpkin soup", 1],
  ["alice", 4, "dinner", "Chicken & coconut curry", 1],
  ["sam", 1, "dinner", "Weeknight dal", 1],
  ["sam", 3, "breakfast", "Shakshuka", 1],
  ["bo", 3, "dinner", "Chicken & coconut curry", 1],
  ["jo", 2, "dinner", "Salmon & avocado salad", 1],
];

async function demoUsers(): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  let hash: string | null = null;
  for (const [username, name] of PEOPLE) {
    const row = one<{ id: number }>("SELECT id FROM users WHERE username = ?", username);
    if (row) {
      // whatever a visitor renamed it to, it reads as the demo person again
      run("UPDATE users SET display_name = ? WHERE id = ?", name, row.id);
      ids.set(username, row.id);
    } else {
      hash ??= await hashPassword(DEMO_LOGIN.password);
      ids.set(username, run("INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)", username, name, hash).id);
    }
  }
  return ids;
}

function friends(a: number, b: number, accepted: boolean): void {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  if (one("SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?", lo, hi)) return;
  requestFriend(a, b);
  if (accepted) acceptFriend(b, a);
}

// Everything the demo accounts own, cleared before it's rebuilt. A demo
// recipe someone outside the demo has planned or is cooking is kept (its
// author's other content still goes), so nobody else's calendar loses a meal.
function clearDemo(ids: number[]): void {
  const list = ids.map(() => "?").join(", ");
  run(`DELETE FROM calendar_entries WHERE owner_type = 'user' AND owner_id IN (${list})`, ...ids);
  run(`DELETE FROM inventory_items WHERE owner_type = 'user' AND owner_id IN (${list})`, ...ids);
  run(`DELETE FROM cook_sessions WHERE user_id IN (${list})`, ...ids);
  run(`DELETE FROM scan_jobs WHERE user_id IN (${list})`, ...ids);
  run(`DELETE FROM scan_corrections WHERE user_id IN (${list})`, ...ids);
  run(
    `DELETE FROM recipes WHERE author_id IN (${list})
       AND id NOT IN (SELECT recipe_id FROM calendar_entries)
       AND id NOT IN (SELECT recipe_id FROM cook_sessions)`,
    ...ids,
  );
}

// Rebuilds the demo kitchen when `version` hasn't been built yet; otherwise
// leaves it exactly as visitors left it. Returns whether it rebuilt.
export async function seedDemo(version = DEMO_VERSION): Promise<boolean> {
  const built = one<{ value: string }>("SELECT value FROM app_state WHERE key = 'demo_version'")?.value;
  const present = one("SELECT 1 FROM users WHERE username = ?", DEMO_LOGIN.username);
  if (built === version && present) return false;
  const ids = await demoUsers();
  const id = (u: string) => ids.get(u)!;
  const [alice, sam, bo, jo] = DEMO_USERNAMES.map(id);

  friends(alice, sam, true);
  friends(bo, alice, true);
  friends(jo, alice, false); // left pending, so Alice has a request to answer

  resetHouseholdDemo();
  transaction(() => clearDemo([alice, sam, bo, jo]));
  // saveRecipe runs its own transaction, so recipes go in one at a time
  const recipeIds = new Map<string, number>();
  for (const { author, photo, ...r } of RECIPES) {
    const image = catalogueImage(photo);
    if (!image) continue;
    // a recipe kept because someone else plans it is reused, not duplicated
    const kept = one<{ id: number }>("SELECT id FROM recipes WHERE author_id = ? AND title = ?", id(author), r.title);
    recipeIds.set(r.title, saveRecipe(id(author), { ...r, image_url: image }, kept?.id));
  }
  transaction(() => {
    const now = today();
    for (const [who, items] of Object.entries(PANTRY)) {
      for (const [name, q, unit, days, cents] of items) {
        run(
          `INSERT INTO inventory_items (owner_type, owner_id, ingredient_id, quantity, unit, expiry_date, price_cents, added_by)
           VALUES ('user', ?, ?, ?, ?, ?, ?, ?)`,
          id(who), ingredientId(name, unit), q, unit, days === null ? null : addDays(now, days), cents, id(who),
        );
      }
    }
    for (const [who, offset, meal, title, shared] of PLAN) {
      const recipe = recipeIds.get(title);
      if (!recipe) continue;
      run(
        `INSERT INTO calendar_entries (owner_type, owner_id, date, meal, recipe_id, planned_by, shared, status)
         VALUES ('user', ?, ?, ?, ?, ?, ?, 'planned')`,
        id(who), addDays(now, offset), meal, recipe, id(who), shared,
      );
    }
  });
  seedHouseholdDemo();
  run(
    "INSERT INTO app_state (key, value) VALUES ('demo_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    version,
  );
  const left = all<{ n: number }>(`SELECT COUNT(*) AS n FROM recipes WHERE author_id IN (?, ?, ?, ?)`, alice, sam, bo, jo)[0].n;
  console.log(`demo kitchen rebuilt (version ${version}): ${left} recipes for alice, sam, bo, jo`);
  return true;
}
