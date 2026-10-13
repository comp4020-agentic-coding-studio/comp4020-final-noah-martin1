// Sample data for the preview pages (household, live cooking, planner,
// global, schedule). It is fixed, never written to the database, and every
// page that shows it carries a preview banner. When a phase lands, its pages
// switch to real queries and the matching samples here are deleted.

export interface SampleMember {
  name: string;
  username: string;
  role: "owner" | "member";
  joined: string;
}

export const HOUSEHOLD = {
  name: "12 Example St",
  members: [
    { name: "Alice Ng", username: "alice", role: "owner", joined: "Aug 2026" },
    { name: "Sam Patel", username: "sam", role: "member", joined: "Aug 2026" },
    { name: "Jo Rivera", username: "jo", role: "member", joined: "Sep 2026" },
  ] as SampleMember[],
  invites: [{ username: "bo", sent: "2d ago" }],
};

export interface SampleItem {
  id: number;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  expires: string;
  state: "expired" | "soon" | "fresh" | "none";
  price: string;
  addedBy: string;
  reservations: { who: string; quantity: number; forMeal: string }[];
}

export const SHARED_PANTRY: SampleItem[] = [
  { id: 1, name: "eggs", category: "dairy", quantity: 12, unit: "", expires: "2d left", state: "soon", price: "$6.50", addedBy: "Sam",
    reservations: [{ who: "Alice", quantity: 4, forMeal: "Tue dinner · Pad thai" }, { who: "Jo", quantity: 2, forMeal: "Wed breakfast" }] },
  { id: 2, name: "spinach", category: "produce", quantity: 200, unit: "g", expires: "Expires today", state: "soon", price: "$3.00", addedBy: "You",
    reservations: [{ who: "You", quantity: 200, forMeal: "Tonight · Curry" }] },
  { id: 3, name: "chicken thigh", category: "meat", quantity: 800, unit: "g", expires: "11 Oct", state: "fresh", price: "$9.80", addedBy: "Alice",
    reservations: [{ who: "Sam", quantity: 500, forMeal: "Thu dinner" }] },
  { id: 4, name: "milk", category: "dairy", quantity: 2000, unit: "ml", expires: "Expired 1d ago", state: "expired", price: "$3.10", addedBy: "Jo", reservations: [] },
  { id: 5, name: "coconut milk", category: "pantry", quantity: 2, unit: "can", expires: "Mar 2027", state: "fresh", price: "$2.40", addedBy: "Alice", reservations: [] },
  { id: 6, name: "rice", category: "pantry", quantity: 2000, unit: "g", expires: "No date", state: "none", price: "$4.00", addedBy: "Sam", reservations: [] },
];

export const HOUSE_WEEK: { day: string; date: string; meals: { meal: string; title: string; cook: string; eating: number; status?: string }[] }[] = [
  { day: "Mon", date: "5 Oct", meals: [{ meal: "dinner", title: "Shakshuka", cook: "Sam", eating: 3, status: "completed" }] },
  { day: "Tue", date: "6 Oct", meals: [{ meal: "dinner", title: "Weeknight pad thai", cook: "Alice", eating: 4 }] },
  { day: "Wed", date: "7 Oct", meals: [{ meal: "breakfast", title: "Overnight oats", cook: "Jo", eating: 1 }, { meal: "dinner", title: "Chicken & coconut curry", cook: "You", eating: 4 }] },
  { day: "Thu", date: "8 Oct", meals: [{ meal: "dinner", title: "Chicken katsu", cook: "Sam", eating: 3 }] },
  { day: "Fri", date: "9 Oct", meals: [] },
  { day: "Sat", date: "10 Oct", meals: [{ meal: "lunch", title: "Peanut noodle bowl", cook: "Jo", eating: 2 }] },
  { day: "Sun", date: "11 Oct", meals: [{ meal: "dinner", title: "Roast vegetables", cook: "Alice", eating: 4 }] },
];

export const HOUSE_ACTIVITY: { who: string; what: string; when: string }[] = [
  { who: "Alice", what: "reserved 4 eggs for Tue dinner", when: "2m ago" },
  { who: "Sam", what: "added chicken thigh (800 g, $9.80)", when: "1h ago" },
  { who: "Jo", what: "marked milk as used up", when: "3h ago" },
  { who: "You", what: "planned Chicken & coconut curry for Wed", when: "yesterday" },
];

export interface SampleSession {
  id: number;
  cook: string;
  username: string;
  recipe: string;
  serves: number;
  scale: number;
  started: string;
  step: number;
  watchers: string[];
  ingredients: [string, string][];
  steps: string[];
  reactions: { who: string; emoji: string; text?: string; when: string }[];
}

export const SESSIONS: SampleSession[] = [
  {
    id: 1, cook: "Alice Ng", username: "alice", recipe: "Weeknight pad thai", serves: 4, scale: 2, started: "18 min ago", step: 4,
    watchers: ["Sam Patel", "Jo Rivera"],
    ingredients: [["400 g", "rice noodles"], ["300 g", "firm tofu"], ["4", "eggs"], ["60 ml", "fish sauce"], ["2", "limes"], ["4", "spring onions"]],
    steps: [
      "Soak the rice noodles in warm water until pliable.",
      "Whisk fish sauce, lime juice and a spoon of sugar into a sauce.",
      "Fry the tofu until golden.",
      "Push the tofu aside, scramble the eggs, then toss through.",
      "Add drained noodles and the sauce; toss for two minutes.",
      "Fold in spring onion and bean sprouts.",
      "Serve with peanuts, lime and chilli.",
    ],
    reactions: [
      { who: "Sam", emoji: "🔥", when: "1m ago" },
      { who: "Jo", emoji: "💬", text: "Save me a bowl!", when: "4m ago" },
      { who: "Sam", emoji: "👀", text: "Cooking along — I'm on step 2", when: "9m ago" },
    ],
  },
  {
    id: 2, cook: "Sam Patel", username: "sam", recipe: "Shakshuka", serves: 2, scale: 1, started: "6 min ago", step: 2,
    watchers: [],
    ingredients: [["400 g", "canned tomatoes"], ["4", "eggs"], ["1", "onion"], ["1", "capsicum"], ["2 clove", "garlic"]],
    steps: [
      "Soften the onion and capsicum in olive oil.",
      "Add garlic and spices, then the tomatoes; simmer until thick.",
      "Make wells, crack in the eggs, cover until the whites set.",
      "Finish with herbs and feta.",
      "Serve straight from the pan with bread.",
    ],
    reactions: [],
  },
  {
    id: 3, cook: "Bo Kim", username: "bo", recipe: "Chicken katsu", serves: 3, scale: 1.5, started: "41 min ago", step: 6,
    watchers: ["Alice Ng"],
    ingredients: [["600 g", "chicken breast"], ["150 g", "panko"], ["2", "eggs"], ["450 g", "rice"], ["¼", "cabbage"]],
    steps: [
      "Butterfly and flatten the chicken.",
      "Set up flour, egg and panko stations.",
      "Crumb each piece firmly.",
      "Start the rice.",
      "Shred the cabbage into iced water.",
      "Shallow-fry the chicken until deep gold.",
      "Rest, slice and serve with katsu sauce.",
      "Plate with rice and cabbage.",
    ],
    reactions: [{ who: "Alice", emoji: "😋", when: "12m ago" }],
  },
];

export interface SampleSuggestion {
  title: string;
  why: string;
  uses: string[];
  missing: string[];
  cost: string;
  minutes: number;
  tags: string[];
  score: number;
}

export const SUGGESTIONS: SampleSuggestion[] = [
  { title: "Spinach & feta omelette", why: "Spinach expires today and you have 10 eggs — this uses both before anything goes to waste.",
    uses: ["spinach", "eggs"], missing: ["feta"], cost: "$4.20", minutes: 12, tags: ["vegetarian", "quick"], score: 96 },
  { title: "Chicken & coconut curry", why: "Uses the chicken thigh before Wednesday and the coconut milk you already own. Only coriander to buy.",
    uses: ["chicken thigh", "coconut milk", "rice"], missing: ["coriander"], cost: "$1.80", minutes: 35, tags: ["gluten-free", "dairy-free"], score: 91 },
  { title: "Peanut noodle bowl", why: "Pantry staples only — nothing to buy, which keeps this week under budget.",
    uses: ["rice noodles", "peanut butter", "soy sauce"], missing: [], cost: "$0.00", minutes: 15, tags: ["vegan", "budget"], score: 84 },
  { title: "Tomato & chickpea stew", why: "Cheap, filling, and the canned tomatoes have been in the pantry longest.",
    uses: ["canned tomatoes", "onion"], missing: ["chickpeas"], cost: "$1.60", minutes: 30, tags: ["vegan", "budget"], score: 78 },
];

export const PLAN_WEEK: { day: string; meal: string; title: string; cost: string }[] = [
  { day: "Wed", meal: "dinner", title: "Spinach & feta omelette", cost: "$4.20" },
  { day: "Thu", meal: "dinner", title: "Chicken & coconut curry", cost: "$1.80" },
  { day: "Fri", meal: "dinner", title: "Peanut noodle bowl", cost: "$0.00" },
  { day: "Sat", meal: "lunch", title: "Tomato & chickpea stew", cost: "$1.60" },
  { day: "Sun", meal: "dinner", title: "Leftover curry", cost: "$0.00" },
];

// Global live cooking: people around the world cooking a public catalogue
// recipe right now, pinned where they are. The recipe (steps, ingredients,
// photo) comes from the database by title; the sample holds only who, where,
// which step, and the live Q&A. Replaced by real cook sessions in crit 9.
export interface SampleGlobalSession {
  id: number;
  cook: string;
  username: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  // a catalogue recipe title (src/data/catalogue.json)
  recipe: string;
  serves: number;
  started: string;
  step: number;
  watching: number;
  language: string;
  helpRequest?: { text: string; original?: string; when: string };
  questions: { who: string; country: string; text: string; original?: string; answer?: string; when: string }[];
}

export const GLOBAL_SESSIONS: SampleGlobalSession[] = [
  { id: 101, cook: "Giulia Bianchi", username: "giulia", city: "Rome", country: "Italy", lat: 41.9, lng: 12.5,
    recipe: "Spaghetti alla Carbonara", serves: 2, started: "6 min ago", step: 5, watching: 24, language: "Italian",
    helpRequest: { text: "Is it okay to use pancetta instead of guanciale? It's all the shop had.", original: "Va bene usare la pancetta invece del guanciale? Il negozio aveva solo quella.", when: "2 min ago" },
    questions: [
      { who: "Ben", country: "UK", text: "Pancetta is completely fine — just render it slowly so it crisps.", when: "1 min ago" },
      { who: "Ana", country: "Brazil", text: "Do you add cream?", original: "Você coloca creme?", answer: "Never! The egg and cheese make it creamy.", when: "4 min ago" },
    ] },
  { id: 102, cook: "Nok Srisai", username: "nok", city: "Bangkok", country: "Thailand", lat: 13.75, lng: 100.5,
    recipe: "Pad Thai", serves: 2, started: "12 min ago", step: 3, watching: 41, language: "Thai",
    questions: [
      { who: "Ellie", country: "Canada", text: "Can I swap the prawns for tofu?", answer: "Yes — press it dry and fry until golden first.", when: "5 min ago" },
      { who: "Priya", country: "India", text: "How spicy is half a teaspoon of cayenne?", answer: "Gentle warmth. Add chilli flakes at the table if you like heat.", when: "8 min ago" },
    ] },
  { id: 103, cook: "Yael Cohen", username: "yael", city: "Tel Aviv", country: "Israel", lat: 32.08, lng: 34.78,
    recipe: "Shakshuka", serves: 2, started: "3 min ago", step: 1, watching: 12, language: "Hebrew",
    questions: [] },
  { id: 104, cook: "Kenji Ito", username: "kenji", city: "Osaka", country: "Japan", lat: 34.69, lng: 135.5,
    recipe: "Chicken Karaage", serves: 4, started: "19 min ago", step: 4, watching: 18, language: "Japanese",
    helpRequest: { text: "My coating is falling off when I fry. Potato starch or cornflour?", original: "揚げると衣が剥がれます。片栗粉とコーンスターチ、どちらがいいですか？", when: "1 min ago" },
    questions: [
      { who: "Minh", country: "Vietnam", text: "Potato starch, and let the coated chicken rest five minutes before frying.", when: "just now" },
    ] },
  { id: 105, cook: "Minh Tran", username: "minh", city: "Hanoi", country: "Vietnam", lat: 21.03, lng: 105.85,
    recipe: "Beef pho", serves: 4, started: "48 min ago", step: 5, watching: 33, language: "Vietnamese",
    questions: [
      { who: "Liam", country: "Ireland", text: "Can I use star anise from a jar?", answer: "Yes, toast it in a dry pan first.", when: "12 min ago" },
    ] },
  { id: 106, cook: "Priya Rao", username: "priya", city: "Bengaluru", country: "India", lat: 12.97, lng: 77.59,
    recipe: "Dal fry", serves: 4, started: "15 min ago", step: 3, watching: 22, language: "Kannada",
    questions: [
      { who: "Tom", country: "UK", text: "Which lentils can I substitute for toor dal?", answer: "Red lentils cook faster and work well.", when: "6 min ago" },
    ] },
  { id: 107, cook: "Ellie Chen", username: "ellie", city: "Vancouver", country: "Canada", lat: 49.28, lng: -123.12,
    recipe: "Honey Teriyaki Salmon", serves: 2, started: "8 min ago", step: 2, watching: 9, language: "English",
    questions: [] },
  { id: 108, cook: "Diego Fernández", username: "diego", city: "Mexico City", country: "Mexico", lat: 19.43, lng: -99.13,
    recipe: "Cajun spiced fish tacos", serves: 4, started: "21 min ago", step: 4, watching: 27, language: "Spanish",
    helpRequest: { text: "No cajun seasoning here — what can I mix instead?", original: "No tengo condimento cajún — ¿qué puedo mezclar en su lugar?", when: "3 min ago" },
    questions: [
      { who: "Sam", country: "Australia", text: "Paprika, garlic powder, oregano, cayenne and a pinch of thyme.", when: "2 min ago" },
    ] },
  { id: 109, cook: "Ana Souza", username: "ana", city: "São Paulo", country: "Brazil", lat: -23.55, lng: -46.63,
    recipe: "Paella", serves: 6, started: "34 min ago", step: 7, watching: 16, language: "Portuguese",
    questions: [] },
  { id: 110, cook: "Ben Taylor", username: "ben", city: "London", country: "UK", lat: 51.51, lng: -0.13,
    recipe: "Toad In The Hole", serves: 4, started: "27 min ago", step: 3, watching: 14, language: "English",
    questions: [
      { who: "Giulia", country: "Italy", text: "Why must the oil be so hot?", original: "Perché l'olio deve essere così caldo?", answer: "So the batter puffs up the moment it hits the tin.", when: "9 min ago" },
    ] },
  { id: 111, cook: "Omar Haddad", username: "omar", city: "Amman", country: "Jordan", lat: 31.95, lng: 35.93,
    recipe: "Falafel pita with tahini", serves: 4, started: "11 min ago", step: 2, watching: 11, language: "Arabic",
    questions: [] },
  { id: 112, cook: "Sam Patel", username: "sampatel", city: "Melbourne", country: "Australia", lat: -37.81, lng: 144.96,
    recipe: "Lamingtons", serves: 16, started: "52 min ago", step: 6, watching: 38, language: "English",
    helpRequest: { text: "Icing is too thick to dip — add more milk or warm it up?", when: "4 min ago" },
    questions: [
      { who: "Nok", country: "Thailand", text: "Sit the bowl over warm water — it loosens without going thin.", original: "วางชามบนน้ำอุ่น ไอซิ่งจะเหลวขึ้นโดยไม่บางเกินไป", when: "3 min ago" },
    ] },
  { id: 113, cook: "Liam Walsh", username: "liam", city: "Dublin", country: "Ireland", lat: 53.35, lng: -6.26,
    recipe: "Thai Green Curry", serves: 4, started: "9 min ago", step: 2, watching: 7, language: "English",
    questions: [] },
  { id: 114, cook: "Grace Okafor", username: "grace", city: "Lagos", country: "Nigeria", lat: 6.52, lng: 3.38,
    recipe: "Kidney Bean Curry", serves: 4, started: "16 min ago", step: 3, watching: 13, language: "Yoruba",
    questions: [] },
  { id: 115, cook: "Camille Martin", username: "camille", city: "Lyon", country: "France", lat: 45.76, lng: 4.84,
    recipe: "French Onion Soup", serves: 4, started: "41 min ago", step: 2, watching: 20, language: "French",
    helpRequest: { text: "How dark should the onions go before I add the stock?", original: "Jusqu'à quel point les oignons doivent-ils dorer avant d'ajouter le bouillon ?", when: "5 min ago" },
    questions: [] },
  { id: 116, cook: "Sofia García", username: "sofia", city: "Buenos Aires", country: "Argentina", lat: -34.6, lng: -58.38,
    recipe: "Spanish Tortilla", serves: 4, started: "13 min ago", step: 4, watching: 10, language: "Spanish",
    questions: [] },
  { id: 117, cook: "Aiko Tanaka", username: "aiko", city: "Seattle", country: "USA", lat: 47.61, lng: -122.33,
    recipe: "Pancakes", serves: 4, started: "5 min ago", step: 2, watching: 6, language: "English",
    questions: [] },
  { id: 118, cook: "Lerato Dlamini", username: "lerato", city: "Cape Town", country: "South Africa", lat: -33.92, lng: 18.42,
    recipe: "Lamb Tagine", serves: 6, started: "58 min ago", step: 3, watching: 15, language: "Zulu",
    questions: [] },
];

// A recipe can show who else, worldwide, is cooking it right now — not just
// friends. Keyed by recipe title for the sample.
export const RECIPE_LIVE_COOKS: Record<string, { name: string; country: string }[]> = {
  "Weeknight pad thai": [
    { name: "Nok S.", country: "Thailand" },
    { name: "Priya R.", country: "India" },
    { name: "Sam Patel", country: "Australia" },
  ],
  "Pad Thai": [
    { name: "Nok Srisai", country: "Thailand" },
    { name: "Priya Rao", country: "India" },
    { name: "Ellie Chen", country: "Canada" },
  ],
  Shakshuka: [
    { name: "Yael Cohen", country: "Israel" },
    { name: "Omar Haddad", country: "Jordan" },
  ],
  "Thai Green Curry": [{ name: "Liam Walsh", country: "Ireland" }],
  "Spaghetti alla Carbonara": [
    { name: "Giulia Bianchi", country: "Italy" },
    { name: "Ben Taylor", country: "UK" },
    { name: "Ana Souza", country: "Brazil" },
    { name: "Kenji Ito", country: "Japan" },
  ],
  "Beef pho": [{ name: "Minh Tran", country: "Vietnam" }],
};

// Household: live shopping-list claims so two housemates don't buy the same
// thing, and a shared running total against the week's budget.
export interface SampleClaim {
  id: number;
  item: string;
  forMeal: string;
  estPrice: string;
  claimedBy: string | null;
}

export const SHOPPING_CLAIMS: SampleClaim[] = [
  { id: 1, item: "coriander", forMeal: "Wed · Chicken & coconut curry", estPrice: "$2.50", claimedBy: "Sam" },
  { id: 2, item: "feta", forMeal: "Wed · Spinach & feta omelette", estPrice: "$5.00", claimedBy: null },
  { id: 3, item: "panko breadcrumbs", forMeal: "Thu · Chicken katsu", estPrice: "$3.80", claimedBy: null },
  { id: 4, item: "bean sprouts", forMeal: "Tue · Pad thai", estPrice: "$1.90", claimedBy: "Alice" },
];

export const BUDGET_TICKER = { spentCents: 8130, budgetCents: 15000, label: "This week's shop" };

// Live nudges when one housemate's pantry change unlocks a meal for another.
export const PANTRY_NUDGES: { who: string; what: string; when: string }[] = [
  { who: "Jo", what: "added eggs — you can now make the spinach & feta omelette", when: "2m ago" },
  { who: "Alice", what: "added coconut milk — Wed's curry is fully covered", when: "19m ago" },
];

// Friends/family schedule: a shared week where housemates or family see each
// other picking nights live, plus one friend's recipe draft being watched and
// commented on before it's published.
export const SCHEDULE_PRESENCE: { who: string; lookingAt: string }[] = [
  { who: "Alice", lookingAt: "Thursday" },
  { who: "Jo", lookingAt: "the week total" },
];

export const SCHEDULE_WEEK: { day: string; date: string; meals: { meal: string; title: string; cook: string }[] }[] = [
  { day: "Mon", date: "12 Oct", meals: [{ meal: "dinner", title: "Shakshuka", cook: "Sam" }] },
  { day: "Tue", date: "13 Oct", meals: [{ meal: "dinner", title: "Weeknight pad thai", cook: "Alice" }] },
  { day: "Wed", date: "14 Oct", meals: [] },
  { day: "Thu", date: "15 Oct", meals: [] },
  { day: "Fri", date: "16 Oct", meals: [{ meal: "dinner", title: "Family roast", cook: "Mum" }] },
  { day: "Sat", date: "17 Oct", meals: [] },
  { day: "Sun", date: "18 Oct", meals: [{ meal: "lunch", title: "Leftovers", cook: "You" }] },
];

export const DRAFT_RECIPE = {
  author: "Jo Rivera",
  title: "Miso-butter mushrooms on toast",
  watching: ["Alice Ng", "Sam Patel"],
  steps: ["Slice mushrooms thickly.", "Fry hard in butter until deep brown.", "Stir through a spoon of miso off the heat."],
  comments: [
    { who: "Alice", onStep: 2, text: "Cast iron for this makes a big difference", when: "3m ago" },
    { who: "Sam", onStep: 3, text: "White or red miso?", when: "1m ago" },
  ],
};
