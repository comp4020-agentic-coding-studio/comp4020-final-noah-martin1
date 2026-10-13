// Where an ingredient lives and what it looks like on the shelf. The fridge
// and pantry scene draws each inventory item as one of these containers;
// this module decides which, from the ingredient's name and category, so the
// scene script stays a dumb renderer. Deterministic: same item, same model.

export type Place = "fridge" | "pantry";

export type Model =
  | "milk" // tall carton
  | "juice" // carton with a cap
  | "bottle" // glass bottle: sauces, oils, wine
  | "jar" // squat glass jar with a lid: jams, pastes, honey
  | "tub" // round plastic tub: yoghurt, dips
  | "butter" // wrapped block
  | "eggs" // egg carton
  | "cheese" // wedge
  | "tray" // shallow tray with a film: meat, fish, tofu
  | "veg" // loose produce: round fruit/veg
  | "leafy" // bag of leaves / bunch of herbs
  | "can" // tin can
  | "box" // cereal / pasta box
  | "sack" // paper bag: flour, sugar, rice
  | "loaf" // bread
  | "spice"; // small shaker

export interface Shelfware {
  place: Place;
  model: Model;
  // a pastel label colour so the shelf reads as a pleasant sprinkle
  tint: string;
}

// Ordered: the first rule whose words appear in the name wins, so put the
// specific before the general ("coconut milk" is a can, "milk" a carton).
const RULES: [RegExp, Place, Model][] = [
  [/\b(coconut milk|coconut cream|canned|tinned|chickpea|black bean|kidney bean|lentils? \(tin|baked beans|tomato paste|tuna)\b/, "pantry", "can"],
  [/\b(milk|buttermilk|cream|custard)\b/, "fridge", "milk"],
  [/\b(juice|kombucha)\b/, "fridge", "juice"],
  [/\begg/, "fridge", "eggs"],
  [/\b(butter|margarine|ghee)\b/, "fridge", "butter"],
  [/\b(cheddar|parmesan|mozzarella|feta|cheese|halloumi|gruy|pecorino|brie|camembert|paneer)\b/, "fridge", "cheese"],
  [/\b(yoghurt|yogurt|hummus|sour cream|creme fraiche|ricotta|mascarpone|cottage|dip|tzatziki)\b/, "fridge", "tub"],
  [/\b(chicken|beef|pork|lamb|mince|bacon|sausage|steak|ham|chorizo|salmon|fish|prawn|shrimp|tofu|tempeh|turkey|duck)\b/, "fridge", "tray"],
  [/\b(spinach|lettuce|kale|rocket|coriander|parsley|basil|mint|dill|herb|cabbage|spring onion|bok choy|silverbeet|chard|leaves)\b/, "fridge", "leafy"],
  [/\b(jam|honey|peanut butter|nutella|paste|curry paste|miso|pesto|mustard|mayo|mayonnaise|pickles?|olives|capers|chutney|harissa|tahini)\b/, "pantry", "jar"],
  [/\b(sauce|oil|vinegar|wine|syrup|mirin|sake|stock|extract)\b/, "pantry", "bottle"],
  [/\b(oats|cereal|muesli|granola|pasta|spaghetti|penne|noodle|lasagne|crackers|biscuit|couscous|quinoa)\b/, "pantry", "box"],
  [/\b(flour|sugar|rice|polenta|semolina|cornflour|breadcrumb|lentil|split pea)\b/, "pantry", "sack"],
  [/\b(bread|loaf|baguette|wrap|tortilla|pita|naan|bagel|roll)\b/, "pantry", "loaf"],
  [/\b(cumin|paprika|turmeric|cinnamon|pepper|salt|chilli powder|garam masala|oregano|thyme|nutmeg|spice|seasoning|cardamom|clove|bay)\b/, "pantry", "spice"],
  [/\b(onion|garlic|potato|sweet potato|pumpkin|squash|shallot)\b/, "pantry", "veg"],
  [/\b(tomato|capsicum|pepper|carrot|broccoli|cauliflower|mushroom|zucchini|eggplant|aubergine|cucumber|avocado|lemon|lime|apple|orange|banana|berries|berry|ginger|chilli|celery|leek|corn|peas|beans)\b/, "fridge", "veg"],
];

const BY_CATEGORY: Record<string, [Place, Model]> = {
  dairy: ["fridge", "tub"],
  meat: ["fridge", "tray"],
  seafood: ["fridge", "tray"],
  protein: ["fridge", "tray"],
  produce: ["fridge", "veg"],
  bakery: ["pantry", "loaf"],
  pantry: ["pantry", "jar"],
};

const TINTS = ["#f6c9b8", "#bfe3cf", "#d9d2f4", "#f7e3a9", "#bcd9ef", "#f4c4cf", "#cfe6c2", "#f3d6bd"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function shelfware(name: string, category: string): Shelfware {
  const n = ` ${name.toLowerCase()} `;
  const tint = TINTS[hash(name) % TINTS.length];
  for (const [re, place, model] of RULES) if (re.test(n)) return { place, model, tint };
  const [place, model] = BY_CATEGORY[category] ?? ["pantry", "jar"];
  return { place, model, tint };
}
