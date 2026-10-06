// Sample data for the preview pages (household, live cooking, planner). It is
// fixed, never written to the database, and every page that shows it carries
// a preview banner. When a phase lands, its pages switch to real queries and
// the matching samples here are deleted.

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
