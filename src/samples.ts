// Sample data for the preview pages (live cooking, planner, global,
// schedule). It is fixed, never written to the database, and every
// page that shows it carries a preview banner. When a phase lands, its pages
// switch to real queries and the matching samples here are deleted.

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

// Demo cooks for the live globe: a clearly tagged sample layer shown beside
// real live sessions (src/live.ts) so the globe is never empty. The recipe
// (steps, ingredients, photo) comes from the database by title; the sample
// holds only who, where, which step, and a translated Q&A. Shown under the
// preview banner, tagged "Demo", and sorted after every real cook.
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
