// How long common foods typically keep, unopened, where a person would
// store them, so a scanned item can arrive with a suggested expiry date. A
// starting point the person sees and can change, never a fact: packaged
// goods carry their own best-before, which beats this table.
//
// Days are conservative midpoints of Australian and US food-safety storage
// guidance (Food Standards Australia New Zealand "Food safety" pages; USDA
// FoodKeeper), rounded down. First matching rule wins, so specific names
// come before general ones.

export interface ShelfLife {
  days: number;
  where: "fridge" | "pantry" | "freezer";
}

const RULES: [RegExp, number, ShelfLife["where"]][] = [
  // bottled sauces and spreads first: "tomato ketchup" is a sauce, not a
  // tomato, and "apple sauce" not an apple (unopened; opened they keep less)
  [/\b(mayonnaise|mayo|aioli|mustard|ketchup|tomato sauce|apple sauce|bbq sauce|barbecue sauce|hot sauce|chilli sauce|sweet chilli|soy sauce|fish sauce|oyster sauce|dressing|vinaigrette|jam|marmalade|honey|peanut butter|nutella|chocolate spread|hazelnut spread|vegemite|chutney|relish)\b/, 180, "pantry"],
  // fresh meat and seafood
  [/\b(mince|ground (beef|pork|lamb|chicken))\b/, 2, "fridge"],
  [/\b(prawn|shrimp|fish|salmon|tuna steak|barramundi|snapper|squid|calamari|mussel|oyster|scallop)\b/, 2, "fridge"],
  [/\b(chicken|turkey|duck)\b/, 2, "fridge"],
  [/\b(sausage|chorizo)\b/, 3, "fridge"],
  [/\b(steak|beef|pork|lamb|veal|goat)\b/, 4, "fridge"],
  [/\b(bacon|ham|prosciutto|salami|pastrami|deli)\b/, 7, "fridge"],
  // dairy and eggs
  [/\b(milk|buttermilk|cream)\b(?! cheese)/, 7, "fridge"],
  [/\b(yoghurt|yogurt|kefir|sour cream|creme fraiche|tzatziki|dip|hummus)\b/, 10, "fridge"],
  [/\b(ricotta|cottage cheese|mozzarella|burrata|feta|cream cheese|mascarpone|paneer|halloumi)\b/, 10, "fridge"],
  [/\b(cheddar|parmesan|pecorino|gruy[eè]re|gouda|edam|tasty|swiss|cheese)\b/, 28, "fridge"],
  [/\b(butter|margarine|ghee)\b/, 30, "fridge"],
  [/\beggs?\b/, 28, "fridge"],
  [/\b(tofu|tempeh)\b/, 7, "fridge"],
  // bread and baked
  [/\b(bread|loaf|roll|bun|bagel|muffin|crumpet|pikelet|wrap|tortilla|pita|naan|croissant|doughnut|donut)\b/, 5, "pantry"],
  [/\b(cake|teacake|pastry)\b/, 4, "pantry"],
  // fruit
  [/\b(berr(y|ies)|strawberr|raspberr|blueberr|grape|cherr(y|ies))\b/, 5, "fridge"],
  [/\b(banana|avocado|mango|peach|nectarine|plum|kiwi|pear)\b/, 5, "pantry"],
  [/\b(apple|orange|mandarin|lemon|lime|grapefruit)\b/, 21, "fridge"],
  [/\b(pineapple|melon|watermelon|rockmelon)\b/, 5, "pantry"],
  // vegetables
  [/\b(lettuce|spinach|rocket|kale|salad|leaves|basil|coriander|parsley|mint|dill|herbs?|bean sprouts?|bean shoots?)\b/, 4, "fridge"],
  [/\b(mushroom|asparagus|bok choy|silverbeet|spring onion|green beans?|snow peas?|corn)\b/, 5, "fridge"],
  [/\b(tomato|zucchini|eggplant|capsicum|cucumber|broccoli|cauliflower|celery|leek|chilli|chili)\b/, 7, "fridge"],
  [/\b(carrot|beetroot|cabbage|parsnip|radish|turnip|ginger)\b/, 21, "fridge"],
  [/\b(potato|sweet potato|pumpkin|squash|onion|shallot|garlic)\b/, 30, "pantry"],
  // fridge jars and sauces (opened, they keep less; unopened, best-before)
  [/\b(pesto|salsa|curry paste|fresh pasta|gnocchi)\b/, 10, "fridge"],
  [/\b(juice)\b/, 7, "fridge"],
  // dry pantry staples
  [/\b(flour|sugar|salt|rice|pasta|spaghetti|penne|noodles?|oats|cereal|muesli|couscous|quinoa|lentils?|split peas?|polenta|semolina|breadcrumbs?)\b/, 365, "pantry"],
  [/\b(canned|tinned|chickpeas|kidney beans|black beans|baked beans|coconut milk|coconut cream|tuna|sardines|soup)\b/, 540, "pantry"],
  [/\b(oil|vinegar|stock|broth|spice|cumin|paprika|turmeric|cinnamon|pepper|oregano|thyme|seasoning|tea|coffee|cocoa)\b/, 365, "pantry"],
  [/\b(biscuits?|cookies?|crackers|chips|crisps|chocolate|nuts?|almonds|cashews|peanuts|dried fruit|raisins)\b/, 120, "pantry"],
  [/\b(wine|beer|soda|soft drink|sparkling water|mineral water|water)\b/, 365, "pantry"],
];

export function shelfLife(name: string): ShelfLife | null {
  const n = ` ${name.toLowerCase()} `;
  for (const [re, days, where] of RULES) if (re.test(n)) return { days, where };
  return null;
}
