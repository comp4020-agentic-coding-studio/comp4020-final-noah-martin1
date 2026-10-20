// TEMPORARY demo mode for the early crits: a seeded demo kitchen (alice,
// sam, bo, jo) and the sign-in form prefilled with alice's details, so a
// visitor can look around without registering. Anyone can sign in as alice
// while this is on. Turn it off (DEMO_MODE = false) before the final
// submission; the seeded rows stay until deleted.
import { hashPassword } from "./auth.ts";
import { all, ingredientId, one, run } from "./db.ts";
import { addDays, today, weekStart } from "./format.ts";
import { acceptFriend, requestFriend } from "./friends.ts";
import { seedHouseholdDemo } from "./household.ts";
import { saveRecipe } from "./recipes.ts";

// Demo recipes borrow the catalogue photo of the same dish (TheMealDB), so
// they look like what they are; none is presented as someone's own photo.
function catalogueImage(title: string): string {
  return one<{ image_url: string }>("SELECT image_url FROM recipes WHERE source IS NOT NULL AND title = ?", title)?.image_url ?? "/assets/recipe-placeholder.svg";
}

export const DEMO_MODE = true;

export const DEMO_LOGIN = { username: "alice", password: "password123" };

// A believable week's shop for alice, so the fridge and pantry have
// something to show: [name, qty, unit, days until expiry (null = none), cents].
const ALICE_SHOP: [string, number, string, number | null, number | null][] = [
  ["butter", 250, "g", 30, 450],
  ["cheddar cheese", 500, "g", 21, 900],
  ["greek yoghurt", 1000, "g", 6, 550],
  ["orange juice", 2000, "ml", 7, 450],
  ["chicken thigh", 600, "g", 3, 780],
  ["salmon fillet", 300, "g", 2, 1100],
  ["coriander", 1, "bunch", 4, 300],
  ["capsicum", 2, "", 8, 300],
  ["lemon", 3, "", 14, 240],
  ["carrot", 5, "", 18, 200],
  ["parmesan", 200, "g", 40, 800],
  ["onion", 4, "", 30, 260],
  ["garlic", 1, "bulb", 40, 150],
  ["potato", 2000, "g", 30, 450],
  ["olive oil", 750, "ml", null, 1200],
  ["soy sauce", 500, "ml", null, 380],
  ["peanut butter", 375, "g", 200, 450],
  ["honey", 500, "g", null, 650],
  ["coconut milk", 400, "ml", 500, 200],
  ["chickpeas", 400, "g", 600, 120],
  ["spaghetti", 500, "g", 400, 200],
  ["plain flour", 1000, "g", 300, 180],
  ["rice", 1000, "g", 400, 300],
  ["bread", 1, "loaf", 4, 450],
  ["ground cumin", 50, "g", null, 250],
  ["paprika", 50, "g", null, 250],
];

function stock(owner: number, name: string, q: number, unit: string, expiresIn: number | null, cents: number | null): void {
  run(
    `INSERT INTO inventory_items (owner_type, owner_id, ingredient_id, quantity, unit, expiry_date, price_cents, added_by)
     VALUES ('user', ?, ?, ?, ?, ?, ?, ?)`,
    owner, ingredientId(name, unit), q, unit, expiresIn === null ? null : addDays(today(), expiresIn), cents, owner,
  );
}

// Tops up alice's kitchen with ALICE_SHOP on databases seeded before it
// existed. Adds only items she doesn't already hold, so it runs once.
function topUpAlice(alice: number): void {
  const held = new Set(
    all<{ name: string }>(
      `SELECT i.name FROM inventory_items it JOIN ingredients i ON i.id = it.ingredient_id
       WHERE it.owner_type = 'user' AND it.owner_id = ?`,
      alice,
    ).map((r) => r.name),
  );
  for (const [name, q, unit, days, cents] of ALICE_SHOP) if (!held.has(name)) stock(alice, name, q, unit, days, cents);
}

// Creates the demo kitchen once; on later boots only tops up alice's shop.
export async function seedDemo(): Promise<boolean> {
  const existing = one<{ id: number }>("SELECT id FROM users WHERE username = ?", DEMO_LOGIN.username);
  if (existing) {
    topUpAlice(existing.id);
    seedHouseholdDemo();
    return false;
  }
  const PASSWORD = DEMO_LOGIN.password;
  const hash = await hashPassword(PASSWORD);
  const user = (username: string, name: string) =>
    run("INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)", username, name, hash).id;

  const alice = user("alice", "Alice Ng");
  const sam = user("sam", "Sam Patel");
  const bo = user("bo", "Bo Kim");
  const jo = user("jo", "Jo Rivera");

  requestFriend(alice, sam);
  acceptFriend(sam, alice);
  requestFriend(bo, alice);
  acceptFriend(alice, bo);
  requestFriend(jo, alice); // left pending, so Alice has a request to answer

  const padThai = saveRecipe(alice, {
    title: "Weeknight pad thai",
    image_url: catalogueImage("Pad Thai"),
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
      { text: "Fry the tofu until golden, push aside and scramble the eggs.", est_minutes: 6 },
      { text: "Add noodles and sauce, toss for two minutes, finish with spring onion.", est_minutes: 3 },
    ],
  });

  const shakshuka = saveRecipe(sam, {
    title: "Shakshuka",
    image_url: catalogueImage("Shakshuka"),
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
    ],
    steps: [
      { text: "Soften the onion and capsicum in olive oil.", est_minutes: 8 },
      { text: "Add garlic and spices, then the tomatoes; simmer until thick.", est_minutes: 10 },
      { text: "Make wells, crack in the eggs, cover until the whites set.", est_minutes: 6 },
    ],
  });

  const curry = saveRecipe(bo, {
    title: "Chicken & coconut curry",
    image_url: catalogueImage("Panang chicken curry"),
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
      { text: "Fry ginger and curry paste, add coconut milk and simmer the chicken.", est_minutes: 20 },
      { text: "Stir through spinach; serve over rice.", est_minutes: 2 },
    ],
  });

  const oats = saveRecipe(alice, {
    title: "Overnight oats",
    image_url: "/assets/recipe-placeholder.svg",
    description: "Five minutes the night before.",
    servings: 1,
    visibility: "private",
    dietary_tags: ["vegetarian", "budget", "quick"],
    ingredients: [
      { name: "rolled oats", quantity: 50, unit: "g", optional: false },
      { name: "milk", quantity: 150, unit: "ml", optional: false },
      { name: "banana", quantity: 1, unit: "", optional: false },
    ],
    steps: [{ text: "Stir oats and milk in a jar, top with banana, refrigerate overnight.", est_minutes: 5 }],
  });

  const now = today();
  const item = (owner: number, name: string, q: number, unit: string, expiresIn: number | null, cents: number | null) =>
    run(
      `INSERT INTO inventory_items (owner_type, owner_id, ingredient_id, quantity, unit, expiry_date, price_cents, added_by)
       VALUES ('user', ?, ?, ?, ?, ?, ?, ?)`,
      owner, ingredientId(name, unit), q, unit, expiresIn === null ? null : addDays(now, expiresIn), cents, owner,
    );

  item(alice, "eggs", 10, "", 2, 650);
  item(alice, "spinach", 120, "g", 0, 300);
  item(alice, "rice noodles", 400, "g", 200, 280);
  item(alice, "firm tofu", 300, "g", 5, 350);
  item(alice, "milk", 1000, "ml", -1, 210);
  item(alice, "fish sauce", 250, "ml", null, 420);
  item(alice, "rolled oats", 750, "g", 120, 199);
  item(alice, "canned tomatoes", 800, "g", 400, 240);
  item(sam, "eggs", 6, "", 6, 450);
  topUpAlice(alice);

  const plan = (owner: number, offset: number, meal: string, recipe: number, shared: number, status = "planned") =>
    run(
      `INSERT INTO calendar_entries (owner_type, owner_id, date, meal, recipe_id, planned_by, shared, status)
       VALUES ('user', ?, ?, ?, ?, ?, ?, ?)`,
      owner, addDays(now, offset), meal, recipe, owner, shared, status,
    );

  const monday = weekStart(now);
  plan(alice, 0, "dinner", padThai, 1);
  plan(alice, 1, "breakfast", oats, 0);
  plan(alice, 2, "dinner", shakshuka, 1);
  plan(alice, 4, "dinner", curry, 1);
  if (monday < now) plan(alice, -1, "dinner", shakshuka, 1, "completed");
  plan(sam, 1, "dinner", shakshuka, 1);
  plan(bo, 3, "dinner", curry, 1);

  seedHouseholdDemo();
  console.log("seeded demo users alice, sam, bo, jo");
  return true;
}
