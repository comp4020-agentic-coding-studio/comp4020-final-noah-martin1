// Where an ingredient lives and what it looks like on the shelf. The fridge
// and pantry scene (public/kitchen.mjs) draws each inventory item from what
// this module decides, so the scene script stays a dumb renderer.
// Deterministic: same name, same model.
//
// The point of the 3D kitchen is that you can tell what's in it at a glance,
// so every common ingredient (the 250-odd used in five or more catalogue
// recipes) has its own look: produce in its own shape and colour (a lemon
// isn't an orange isn't an onion), meat on a tray in its own cut, and
// packaged food in the package it's sold in with its name on the label (a
// jar of peanut butter, not a block of butter). Rare ingredients share the
// look of what they most resemble. spec/kitchen-models.test.ts checks the
// table: the common ingredients, that no two of them look the same, and the
// mistakes a word rule makes ("butter beans" aren't butter, "chicken stock"
// isn't chicken).

export type Place = "fridge" | "pantry";

export type Model =
  // produce, each in its own shape
  | "citrus" // lemon, lime, orange: dimpled ovals
  | "apple" // apple, pear, peach: round with a stalk
  | "tomato" // flattened round with a green calyx
  | "capsicum" // lobed bell pepper
  | "chilli" // curved tapering pod
  | "banana" // a bunch of three curved fingers
  | "carrot" // tapering roots with green tops
  | "potato" // lumpy ovals
  | "onion" // round with a papery tip and roots
  | "garlic" // a segmented bulb
  | "broccoli" // a crown of florets on a stalk
  | "cabbage" // a round head of leaves
  | "avocado" // dark pear-shaped
  | "mushroom" // a punnet of caps on stems
  | "cucumber" // long green: cucumber, zucchini
  | "eggplant" // glossy purple with a green cap
  | "stalk" // long stems: celery, leek, spring onion, lemongrass
  | "corn" // a cob in its husk
  | "pumpkin" // a wedge with seeds
  | "ginger" // a knobbly root
  | "herbs" // a bunch standing in a glass of water
  | "leaves" // a bag of salad leaves
  | "berries" // a punnet of berries
  | "beans" // a pile of green beans or pods
  | "beetroot" // round purple with stems
  | "mango" // a kidney-shaped fruit
  | "pineapple" // with a crown
  // the fridge's packaging
  | "milk" // tall gable-top carton
  | "cream" // small carton
  | "juice" // carton with a cap
  | "tub" // round tub with a lid: yoghurt, sour cream, dips
  | "butter" // foil-wrapped block
  | "eggs" // egg carton
  | "cheese" // a cheese: wedge, block or ball
  | "tray" // a meat or fish tray, with the cut on it
  // the pantry's packaging
  | "jar" // glass jar with a lid and a label: jams, pastes, spreads
  | "bottle" // a bottle with a label: oils, sauces, vinegars, wine
  | "can" // a tin with a label
  | "carton" // a tall pack: stock, coconut milk
  | "box" // a box with a window: pasta, cereal, biscuits
  | "sack" // a paper bag: flour, sugar, rice
  | "pouch" // a stand-up bag: nuts, seeds, dried fruit
  | "spice" // a small shaker with a label
  | "bar" // a block of chocolate
  | "loaf"; // bread: loaf, baguette, flatbread

// How one ingredient looks, beyond its model: the word on its label, the
// label's colour, what shows through glass, and a variant of the shape
// (a cheese wedge or block; a meat tray's cut; a bottle's shape).
export interface Look {
  label?: string;
  colour?: string;
  fill?: string;
  variant?: string;
}

export interface Shelfware {
  place: Place;
  model: Model;
  // a pastel accent colour (lids, stickers), so the shelf reads as a pleasant sprinkle
  tint: string;
  look: Look;
}

type Entry = [Place, Model, Look?];

// Every common ingredient, by its canonical name. Checked one by one against
// what it is and how it's sold in an Australian supermarket.
const NAMED: Record<string, Entry> = {
  // ---- fresh produce (fridge crisper; onions, garlic and potatoes in the pantry)
  lemon: ["fridge", "citrus", { colour: "#f2d24b", variant: "lemon" }],
  lime: ["fridge", "citrus", { colour: "#7fb546", variant: "lime" }],
  orange: ["fridge", "citrus", { colour: "#f29a2e", variant: "orange" }],
  mandarin: ["fridge", "citrus", { colour: "#f5952f", variant: "mandarin" }],
  grapefruit: ["fridge", "citrus", { colour: "#f4a07a", variant: "orange" }],
  apple: ["fridge", "apple", { colour: "#d6453d" }],
  "green apple": ["fridge", "apple", { colour: "#9ccc56" }],
  "braeburn apples": ["fridge", "apple", { colour: "#c9443b" }],
  pear: ["fridge", "apple", { colour: "#c9cf5a", variant: "pear" }],
  peach: ["fridge", "apple", { colour: "#f5a96a", variant: "peach" }],
  apricot: ["fridge", "apple", { colour: "#f4a54b", variant: "peach" }],
  plum: ["fridge", "apple", { colour: "#7a3b5e", variant: "peach" }],
  tomato: ["fridge", "tomato", { colour: "#e2463a" }],
  "cherry tomatoes": ["fridge", "tomato", { colour: "#e64b3c", variant: "cherry" }],
  capsicum: ["fridge", "capsicum", { colour: "#d93a2f" }],
  "red capsicum": ["fridge", "capsicum", { colour: "#d93a2f" }],
  "green capsicum": ["fridge", "capsicum", { colour: "#4f9a3a" }],
  "yellow capsicum": ["fridge", "capsicum", { colour: "#f0c331" }],
  chilli: ["fridge", "chilli", { colour: "#d8362b" }],
  "green chilli": ["fridge", "chilli", { colour: "#4c9a35" }],
  "scotch bonnet": ["fridge", "chilli", { colour: "#f08a1c", variant: "bonnet" }],
  jalapeño: ["fridge", "chilli", { colour: "#3f8a35", variant: "fat" }],
  banana: ["pantry", "banana", { colour: "#f2d34d" }],
  carrot: ["fridge", "carrot", { colour: "#ee8a2c" }],
  parsnip: ["fridge", "carrot", { colour: "#eee0c0", variant: "parsnip" }],
  potato: ["pantry", "potato", { colour: "#cfa86e" }],
  "baby potatoes": ["pantry", "potato", { colour: "#d8b47a", variant: "baby" }],
  "sweet potato": ["pantry", "potato", { colour: "#c4683f", variant: "long" }],
  swede: ["pantry", "potato", { colour: "#c9a96a", variant: "round" }],
  cassava: ["pantry", "potato", { colour: "#8a5a3a", variant: "long" }],
  onion: ["pantry", "onion", { colour: "#d39a52" }],
  "red onion": ["pantry", "onion", { colour: "#8e3b5c" }],
  "white onion": ["pantry", "onion", { colour: "#efe6d2" }],
  shallot: ["pantry", "onion", { colour: "#b9765a", variant: "shallot" }],
  "pearl onions": ["pantry", "onion", { colour: "#efe6d2", variant: "shallot" }],
  garlic: ["pantry", "garlic"],
  broccoli: ["fridge", "broccoli", { colour: "#3f8a3e" }],
  cauliflower: ["fridge", "broccoli", { colour: "#f1ecd8", variant: "cauliflower" }],
  broccolini: ["fridge", "broccoli", { colour: "#3f8a3e", variant: "stems" }],
  cabbage: ["fridge", "cabbage", { colour: "#a9cf86" }],
  "red cabbage": ["fridge", "cabbage", { colour: "#7a3f74" }],
  "chinese cabbage": ["fridge", "cabbage", { colour: "#d8e8b0", variant: "long" }],
  lettuce: ["fridge", "cabbage", { colour: "#8fc96a", variant: "lettuce" }],
  avocado: ["fridge", "avocado", { colour: "#3c4f26" }],
  mushrooms: ["fridge", "mushroom", { colour: "#e8dccb" }],
  "shiitake mushrooms": ["fridge", "mushroom", { colour: "#8a5f3f" }],
  cucumber: ["fridge", "cucumber", { colour: "#3f7a3a" }],
  courgette: ["fridge", "cucumber", { colour: "#4f8a3a", variant: "zucchini" }],
  zucchini: ["fridge", "cucumber", { colour: "#4f8a3a", variant: "zucchini" }],
  aubergine: ["fridge", "eggplant", { colour: "#4a2a4f" }],
  eggplant: ["fridge", "eggplant", { colour: "#4a2a4f" }],
  celery: ["fridge", "stalk", { colour: "#9ccb6f", variant: "celery" }],
  leek: ["fridge", "stalk", { colour: "#8fbf6a", variant: "leek" }],
  "spring onion": ["fridge", "stalk", { colour: "#5fa34a", variant: "spring" }],
  lemongrass: ["fridge", "stalk", { colour: "#b8cf82", variant: "lemongrass" }],
  "corn cob": ["fridge", "corn"],
  sweetcorn: ["fridge", "corn"],
  pumpkin: ["pantry", "pumpkin", { colour: "#ee8f2e" }],
  "butternut squash": ["pantry", "pumpkin", { colour: "#e9a24a", variant: "butternut" }],
  ginger: ["fridge", "ginger", { colour: "#d7b07a" }],
  galangal: ["fridge", "ginger", { colour: "#e8cfa0" }],
  "fennel bulb": ["fridge", "cabbage", { colour: "#d9e8b8", variant: "fennel" }],
  parsley: ["fridge", "herbs", { colour: "#3f8f3f", variant: "flat" }],
  coriander: ["fridge", "herbs", { colour: "#5aa84a", variant: "lobed" }],
  mint: ["fridge", "herbs", { colour: "#4caf6a", variant: "mint" }],
  basil: ["fridge", "herbs", { colour: "#3f9a3a", variant: "round" }],
  dill: ["fridge", "herbs", { colour: "#6fae4a", variant: "fine" }],
  chives: ["fridge", "herbs", { colour: "#4f9a3a", variant: "chives" }],
  thyme: ["fridge", "herbs", { colour: "#6f8f4f", variant: "sprig" }],
  marjoram: ["fridge", "herbs", { colour: "#7a9a5a", variant: "mint" }],
  rosemary: ["fridge", "herbs", { colour: "#4f7a5a", variant: "needles" }],
  sage: ["fridge", "herbs", { colour: "#8fa88a", variant: "round" }],
  "lime leaves": ["fridge", "herbs", { colour: "#2f7a35", variant: "round" }],
  "thai basil": ["fridge", "herbs", { colour: "#3f8a3a", variant: "round" }],
  spinach: ["fridge", "leaves", { colour: "#3f7f3a", label: "Spinach" }],
  "baby spinach": ["fridge", "leaves", { colour: "#3f7f3a", label: "Spinach" }],
  rocket: ["fridge", "leaves", { colour: "#4f8f3a", label: "Rocket" }],
  kale: ["fridge", "leaves", { colour: "#2f5f3a", label: "Kale" }],
  "mixed salad leaves": ["fridge", "leaves", { colour: "#7fbf5a", label: "Salad" }],
  "pak choi": ["fridge", "cabbage", { colour: "#9fcf7a", variant: "bokchoy" }],
  "bean sprouts": ["fridge", "leaves", { colour: "#efe8c8", label: "Sprouts" }],
  strawberries: ["fridge", "berries", { colour: "#e23b3b", variant: "strawberry" }],
  blueberries: ["fridge", "berries", { colour: "#3f4f9a" }],
  raspberries: ["fridge", "berries", { colour: "#d43a5a" }],
  "mixed berries": ["fridge", "berries", { colour: "#8a2f5a" }],
  grapes: ["fridge", "berries", { colour: "#8fbf4a", variant: "grapes" }],
  "green beans": ["fridge", "beans", { colour: "#4f9a3a" }],
  "snow peas": ["fridge", "beans", { colour: "#7fbf5a", variant: "flat" }],
  peas: ["fridge", "beans", { colour: "#6faf3f", variant: "frozen", label: "Peas" }],
  beetroot: ["fridge", "beetroot", { colour: "#7a1f3a" }],
  mango: ["fridge", "mango", { colour: "#f2a63a" }],
  pineapple: ["pantry", "pineapple"],

  // ---- dairy and eggs
  milk: ["fridge", "milk", { label: "Milk", colour: "#3f7fd0" }],
  buttermilk: ["fridge", "milk", { label: "Buttermilk", colour: "#7fa6c8" }],
  "almond milk": ["fridge", "milk", { label: "Almond", colour: "#c79a5f" }],
  "oat milk": ["fridge", "milk", { label: "Oat", colour: "#c8a86a" }],
  "plant milk": ["fridge", "milk", { label: "Plant milk", colour: "#7faf6a" }],
  cream: ["fridge", "cream", { label: "Cream", colour: "#d9a43a" }],
  "thickened cream": ["fridge", "cream", { label: "Cream", colour: "#d9a43a" }],
  "sour cream": ["fridge", "tub", { label: "Sour cream", colour: "#3f8fbf" }],
  "greek yoghurt": ["fridge", "tub", { label: "Greek yoghurt", colour: "#3a6fbf", variant: "big" }],
  yoghurt: ["fridge", "tub", { label: "Yoghurt", colour: "#5f9fd8", variant: "big" }],
  "cream cheese": ["fridge", "tub", { label: "Cream cheese", colour: "#4f9fd0", variant: "flat" }],
  ricotta: ["fridge", "tub", { label: "Ricotta", colour: "#5fa8a0" }],
  mascarpone: ["fridge", "tub", { label: "Mascarpone", colour: "#3f7f9f" }],
  "cottage cheese": ["fridge", "tub", { label: "Cottage", colour: "#5f9fc8" }],
  "creme fraiche": ["fridge", "tub", { label: "Crème fraîche", colour: "#7f8fbf" }],
  custard: ["fridge", "cream", { label: "Custard", colour: "#e9b83a" }],
  butter: ["fridge", "butter", { label: "Butter", colour: "#e9c53a" }],
  ghee: ["pantry", "jar", { label: "Ghee", colour: "#e9b83a", fill: "#f2d27a" }],
  eggs: ["fridge", "eggs"],
  "egg yolks": ["fridge", "eggs"],
  "egg whites": ["fridge", "eggs"],
  parmesan: ["fridge", "cheese", { colour: "#f0d78a", variant: "wedge", label: "Parmesan" }],
  pecorino: ["fridge", "cheese", { colour: "#efdc9a", variant: "wedge", label: "Pecorino" }],
  "cheddar cheese": ["fridge", "cheese", { colour: "#f2b63a", variant: "block", label: "Cheddar" }],
  cheese: ["fridge", "cheese", { colour: "#f2c64a", variant: "block", label: "Cheese" }],
  mozzarella: ["fridge", "cheese", { colour: "#f6f2e6", variant: "ball", label: "Mozzarella" }],
  feta: ["fridge", "cheese", { colour: "#f7f4ea", variant: "cube", label: "Feta" }],
  halloumi: ["fridge", "cheese", { colour: "#f4ecd4", variant: "cube", label: "Halloumi" }],
  "goat's cheese": ["fridge", "cheese", { colour: "#f7f5ee", variant: "log", label: "Goat's cheese" }],
  brie: ["fridge", "cheese", { colour: "#f5ecd2", variant: "round", label: "Brie" }],
  "gruyère": ["fridge", "cheese", { colour: "#ead07a", variant: "wedge", label: "Gruyère" }],
  "swiss cheese": ["fridge", "cheese", { colour: "#ecd27a", variant: "wedge", label: "Swiss" }],
  paneer: ["fridge", "cheese", { colour: "#f7f3e8", variant: "cube", label: "Paneer" }],
  "shredded mexican cheese": ["fridge", "pouch", { label: "Grated cheese", colour: "#f2b63a" }],

  // ---- meat and fish (fridge tray, each with its cut)
  "chicken breast": ["fridge", "tray", { variant: "breast", label: "Chicken breast" }],
  "chicken thigh": ["fridge", "tray", { variant: "thigh", label: "Chicken thigh" }],
  "chicken drumsticks": ["fridge", "tray", { variant: "drumstick", label: "Drumsticks" }],
  "chicken wings": ["fridge", "tray", { variant: "drumstick", label: "Wings" }],
  "chicken legs": ["fridge", "tray", { variant: "drumstick", label: "Chicken legs" }],
  chicken: ["fridge", "tray", { variant: "whole", label: "Whole chicken" }],
  "beef mince": ["fridge", "tray", { variant: "mince", label: "Beef mince" }],
  "pork mince": ["fridge", "tray", { variant: "mince", colour: "#efa09a", label: "Pork mince" }],
  "lamb mince": ["fridge", "tray", { variant: "mince", colour: "#c9645a", label: "Lamb mince" }],
  beef: ["fridge", "tray", { variant: "diced", label: "Beef" }],
  "chuck steak": ["fridge", "tray", { variant: "steak", label: "Chuck steak" }],
  "sirloin steak": ["fridge", "tray", { variant: "steak", label: "Steak" }],
  "beef fillet": ["fridge", "tray", { variant: "steak", label: "Beef fillet" }],
  "flank steak": ["fridge", "tray", { variant: "steak", label: "Flank steak" }],
  "beef brisket": ["fridge", "tray", { variant: "roast", label: "Brisket" }],
  lamb: ["fridge", "tray", { variant: "diced", colour: "#c45a52", label: "Lamb" }],
  "lamb shoulder": ["fridge", "tray", { variant: "roast", colour: "#c45a52", label: "Lamb shoulder" }],
  "lamb leg": ["fridge", "tray", { variant: "roast", colour: "#c45a52", label: "Lamb leg" }],
  "lamb chops": ["fridge", "tray", { variant: "chops", colour: "#c45a52", label: "Lamb chops" }],
  "lamb shanks": ["fridge", "tray", { variant: "roast", colour: "#c45a52", label: "Lamb shanks" }],
  pork: ["fridge", "tray", { variant: "diced", colour: "#eaa49a", label: "Pork" }],
  "pork shoulder": ["fridge", "tray", { variant: "roast", colour: "#eaa49a", label: "Pork shoulder" }],
  "pork belly": ["fridge", "tray", { variant: "belly", label: "Pork belly" }],
  "pork chops": ["fridge", "tray", { variant: "chops", colour: "#eaa49a", label: "Pork chops" }],
  "pork ribs": ["fridge", "tray", { variant: "chops", colour: "#d98a7a", label: "Pork ribs" }],
  bacon: ["fridge", "tray", { variant: "bacon", label: "Bacon" }],
  ham: ["fridge", "tray", { variant: "ham", label: "Ham" }],
  prosciutto: ["fridge", "tray", { variant: "ham", colour: "#d9786a", label: "Prosciutto" }],
  chorizo: ["fridge", "tray", { variant: "salami", label: "Chorizo" }],
  sausages: ["fridge", "tray", { variant: "sausages", label: "Sausages" }],
  "smoked sausage": ["fridge", "tray", { variant: "sausages", colour: "#9a4f3a", label: "Smoked sausage" }],
  "italian fennel sausages": ["fridge", "tray", { variant: "sausages", label: "Italian sausages" }],
  "corned beef": ["fridge", "tray", { variant: "roast", colour: "#d4706a", label: "Corned beef" }],
  "salmon fillet": ["fridge", "tray", { variant: "salmon", label: "Salmon" }],
  "smoked salmon": ["fridge", "tray", { variant: "smoked", label: "Smoked salmon" }],
  "white fish": ["fridge", "tray", { variant: "fish", label: "White fish" }],
  snapper: ["fridge", "tray", { variant: "fish", label: "Snapper" }],
  prawns: ["fridge", "tray", { variant: "prawns", label: "Prawns" }],
  squid: ["fridge", "tray", { variant: "squid", label: "Squid" }],
  mussels: ["fridge", "tray", { variant: "mussels", label: "Mussels" }],
  tofu: ["fridge", "tray", { variant: "tofu", label: "Tofu" }],
  "firm tofu": ["fridge", "tray", { variant: "tofu", label: "Firm tofu" }],
  "chicken livers": ["fridge", "tray", { variant: "mince", colour: "#7a2f2a", label: "Chicken livers" }],

  // ---- bottles: oils, sauces, vinegars, wine
  "olive oil": ["pantry", "bottle", { label: "Olive oil", colour: "#5f8a3a", fill: "#b8a83a", variant: "oil" }],
  "vegetable oil": ["pantry", "bottle", { label: "Vegetable oil", colour: "#e9b83a", fill: "#f0d36a", variant: "oil" }],
  "sesame oil": ["pantry", "bottle", { label: "Sesame oil", colour: "#a8642a", fill: "#b06a2a", variant: "small" }],
  "sunflower oil": ["pantry", "bottle", { label: "Sunflower oil", colour: "#f0c330", fill: "#f0d36a", variant: "oil" }],
  "peanut oil": ["pantry", "bottle", { label: "Peanut oil", colour: "#c8873a", fill: "#e9c86a", variant: "oil" }],
  "coconut oil": ["pantry", "jar", { label: "Coconut oil", colour: "#5fa8a0", fill: "#f6f3ea" }],
  "soy sauce": ["pantry", "bottle", { label: "Soy sauce", colour: "#c8302a", fill: "#2a160c", variant: "sauce" }],
  "dark soy sauce": ["pantry", "bottle", { label: "Dark soy", colour: "#3a2a20", fill: "#1a0e08", variant: "sauce" }],
  "fish sauce": ["pantry", "bottle", { label: "Fish sauce", colour: "#2f7fa8", fill: "#a8641e", variant: "sauce" }],
  "oyster sauce": ["pantry", "bottle", { label: "Oyster sauce", colour: "#8a2a2a", fill: "#3a1e10", variant: "sauce" }],
  "hoisin sauce": ["pantry", "bottle", { label: "Hoisin", colour: "#7a2a3a", fill: "#3a1410", variant: "squat" }],
  "worcestershire sauce": ["pantry", "bottle", { label: "Worcestershire", colour: "#e9a02a", fill: "#2a1408", variant: "sauce" }],
  "hot sauce": ["pantry", "bottle", { label: "Hot sauce", colour: "#d8302a", fill: "#c8281e", variant: "small" }],
  "chilli sauce": ["pantry", "bottle", { label: "Chilli sauce", colour: "#d8302a", fill: "#c8281e", variant: "squeeze" }],
  "sweet chilli sauce": ["pantry", "bottle", { label: "Sweet chilli", colour: "#e85a2a", fill: "#e8602a", variant: "sauce" }],
  sriracha: ["pantry", "bottle", { label: "Sriracha", colour: "#2f8a3a", fill: "#d42a1e", variant: "squeeze" }],
  "tomato ketchup": ["pantry", "bottle", { label: "Tomato sauce", colour: "#d8302a", fill: "#b8201a", variant: "squeeze" }],
  "tomato sauce": ["pantry", "bottle", { label: "Tomato sauce", colour: "#d8302a", fill: "#b8201a", variant: "squeeze" }],
  "white vinegar": ["pantry", "bottle", { label: "White vinegar", colour: "#3f8fbf", fill: "#eef4f4", variant: "oil" }],
  "red wine vinegar": ["pantry", "bottle", { label: "Red wine vinegar", colour: "#8a2a3a", fill: "#7a1a2a", variant: "sauce" }],
  "white wine vinegar": ["pantry", "bottle", { label: "White wine vinegar", colour: "#b8a83a", fill: "#ede8c0", variant: "sauce" }],
  "apple cider vinegar": ["pantry", "bottle", { label: "Cider vinegar", colour: "#c8642a", fill: "#d8a04a", variant: "sauce" }],
  "rice vinegar": ["pantry", "bottle", { label: "Rice vinegar", colour: "#d8a83a", fill: "#efe6c0", variant: "sauce" }],
  "balsamic vinegar": ["pantry", "bottle", { label: "Balsamic", colour: "#3a2a2a", fill: "#2a1410", variant: "sauce" }],
  "sherry vinegar": ["pantry", "bottle", { label: "Sherry vinegar", colour: "#a8642a", fill: "#b8743a", variant: "sauce" }],
  "white wine": ["pantry", "bottle", { label: "White wine", colour: "#e9d88a", fill: "#ece2a0", variant: "wine" }],
  "dry white wine": ["pantry", "bottle", { label: "White wine", colour: "#e9d88a", fill: "#ece2a0", variant: "wine" }],
  "red wine": ["pantry", "bottle", { label: "Red wine", colour: "#7a1a2a", fill: "#4a0a14", variant: "wine" }],
  "shaoxing wine": ["pantry", "bottle", { label: "Shaoxing wine", colour: "#c8302a", fill: "#8a4a1a", variant: "sauce" }],
  mirin: ["pantry", "bottle", { label: "Mirin", colour: "#d8a83a", fill: "#e9c86a", variant: "sauce" }],
  sake: ["pantry", "bottle", { label: "Sake", colour: "#3f6fa8", fill: "#eef0ee", variant: "wine" }],
  brandy: ["pantry", "bottle", { label: "Brandy", colour: "#a8642a", fill: "#a85a1a", variant: "wine" }],
  rum: ["pantry", "bottle", { label: "Rum", colour: "#6a3a1a", fill: "#8a4a1a", variant: "wine" }],
  beer: ["fridge", "can", { label: "Beer", colour: "#d8a82a", variant: "drink" }],
  "vanilla extract": ["pantry", "bottle", { label: "Vanilla", colour: "#5a3a2a", fill: "#3a1e10", variant: "tiny" }],
  "almond extract": ["pantry", "bottle", { label: "Almond", colour: "#c8a06a", fill: "#c89a5a", variant: "tiny" }],
  "golden syrup": ["pantry", "can", { label: "Golden syrup", colour: "#2f7a4a", variant: "squat" }],
  "maple syrup": ["pantry", "bottle", { label: "Maple syrup", colour: "#a8541a", fill: "#a8541a", variant: "squat" }],
  honey: ["pantry", "jar", { label: "Honey", colour: "#e9a02a", fill: "#e8a42a", variant: "honey" }],
  molasses: ["pantry", "jar", { label: "Molasses", colour: "#3a2a1a", fill: "#2a160a" }],
  rhubarb: ["fridge", "stalk", { colour: "#c8304a", variant: "rhubarb" }],
  asparagus: ["fridge", "stalk", { colour: "#6f9a3a", variant: "asparagus" }],
  "water spinach": ["fridge", "leaves", { colour: "#3f8a3a", label: "Water spinach" }],
  "banana leaves": ["fridge", "leaves", { colour: "#2f7a3a", label: "Banana leaves" }],
  "banana pepper": ["fridge", "chilli", { colour: "#e9d04a", variant: "fat" }],
  "egg rolls": ["fridge", "box", { label: "Spring rolls", colour: "#d8903a", variant: "flat" }],
  "chicken stock powder": ["pantry", "spice", { label: "Stock powder", colour: "#e9b83a", fill: "#e8c87a", variant: "tin" }],
  "mushroom broth powder": ["pantry", "spice", { label: "Mushroom stock", colour: "#8a5f3f", fill: "#a8845a", variant: "tin" }],
  "dried shrimp": ["pantry", "pouch", { label: "Dried shrimp", colour: "#e8805a" }],
  "dried anchovies": ["pantry", "pouch", { label: "Dried anchovies", colour: "#8a9aa8" }],
  "salt beef": ["fridge", "tray", { variant: "roast", colour: "#d4706a", label: "Salt beef" }],
  "sugar snap peas": ["fridge", "beans", { colour: "#6faf3f", variant: "pods" }],
  "bean curd sheets": ["pantry", "pouch", { label: "Tofu skin", colour: "#e8d8a8" }],
  "ice cream cone": ["pantry", "box", { label: "Cones", colour: "#d8903a", variant: "small" }],
  "red wine jelly": ["pantry", "jar", { label: "Wine jelly", colour: "#7a1a2a", fill: "#8a1a2a", variant: "jam" }],
  "pizza dough": ["fridge", "box", { label: "Pizza dough", colour: "#d8302a", variant: "flat" }],
  ciabatta: ["pantry", "loaf", { variant: "ciabatta" }],
  chestnuts: ["pantry", "pouch", { label: "Chestnuts", colour: "#7a3f1a" }],
  buckwheat: ["pantry", "pouch", { label: "Buckwheat", colour: "#8a6a3a" }],
  kombu: ["pantry", "pouch", { label: "Kombu", colour: "#2f3f2a" }],
  nori: ["pantry", "pouch", { label: "Nori", colour: "#1f2f1f" }],
  "bamboo shoots": ["pantry", "can", { label: "Bamboo shoots", colour: "#c8a03a" }],
  "artichoke hearts": ["pantry", "jar", { label: "Artichokes", colour: "#5f7a3a", fill: "#8a9a5a" }],
  "mixed vegetables": ["fridge", "pouch", { label: "Frozen veg", colour: "#3f7fbf" }],
  "stir-fry vegetables": ["fridge", "pouch", { label: "Stir-fry veg", colour: "#3f8a5a" }],
  "seafood mix": ["fridge", "tray", { variant: "prawns", label: "Seafood mix" }],
  "fish pie mix": ["fridge", "tray", { variant: "fish", label: "Fish pie mix" }],
  marshmallows: ["pantry", "pouch", { label: "Marshmallows", colour: "#f4b8c8" }],
  pretzels: ["pantry", "pouch", { label: "Pretzels", colour: "#a8642a" }],
  "turkish delight": ["pantry", "box", { label: "Turkish delight", colour: "#d8508a", variant: "small" }],
  "mars bar": ["pantry", "bar", { label: "Mars", colour: "#2a2a2a" }],
  "black tea": ["pantry", "box", { label: "Tea", colour: "#3a5a3a", variant: "small" }],
  espresso: ["pantry", "pouch", { label: "Coffee", colour: "#3a2414" }],
  "taco shells": ["pantry", "box", { label: "Taco shells", colour: "#e9b83a", variant: "wide" }],
  "christmas pudding": ["pantry", "box", { label: "Pudding", colour: "#8a1a2a", variant: "small" }],
  "meringue nests": ["pantry", "box", { label: "Meringues", colour: "#e88aa0", variant: "small" }],
  "ready-rolled icing": ["pantry", "box", { label: "Icing", colour: "#5fa8d8", variant: "small" }],
  "instant pudding mix": ["pantry", "box", { label: "Pudding mix", colour: "#e9b83a", variant: "small" }],
  "dried chickpeas": ["pantry", "pouch", { label: "Chickpeas", colour: "#d8a03a" }],
  "toor dal": ["pantry", "pouch", { label: "Toor dal", colour: "#e9b83a" }],
  "moong dal": ["pantry", "pouch", { label: "Moong dal", colour: "#7fa83a" }],
  "cracked wheat": ["pantry", "pouch", { label: "Cracked wheat", colour: "#c8a03a" }],
  "rye grain": ["pantry", "pouch", { label: "Rye", colour: "#8a6a3a" }],
  "mixed grain": ["pantry", "pouch", { label: "Grains", colour: "#a8843a" }],
  "dried hominy": ["pantry", "pouch", { label: "Hominy", colour: "#efe0b8" }],
  "fresh yeast": ["fridge", "butter", { label: "Fresh yeast", colour: "#d8c07a" }],
  shortening: ["pantry", "butter", { label: "Copha", colour: "#5fa8d8" }],
  "goose fat": ["pantry", "jar", { label: "Goose fat", colour: "#efe0b8", fill: "#f4ecd0" }],
  "duck fat": ["pantry", "jar", { label: "Duck fat", colour: "#efe0b8", fill: "#f4ecd0" }],
  "lamb fat": ["fridge", "butter", { label: "Lamb fat", colour: "#efe6d0" }],
  "beef tallow": ["pantry", "jar", { label: "Tallow", colour: "#efe6d0", fill: "#f4ecd8" }],
  "black pudding": ["fridge", "tray", { variant: "salami", colour: "#2a1a1a", label: "Black pudding" }],
  "liver spread": ["fridge", "tub", { label: "Pâté", colour: "#8a4a3a" }],
  guacamole: ["fridge", "tub", { label: "Guacamole", colour: "#5f8a3a" }],
  "pico de gallo": ["fridge", "tub", { label: "Pico de gallo", colour: "#d8302a" }],
  "marinated tofu": ["fridge", "tray", { variant: "tofu", label: "Marinated tofu" }],
  "pickled beetroot": ["pantry", "can", { label: "Beetroot", colour: "#7a1f3a" }],
  gouda: ["fridge", "cheese", { colour: "#f2c03a", variant: "round", label: "Gouda" }],
  stilton: ["fridge", "cheese", { colour: "#efe6c8", variant: "wedge", label: "Stilton" }],
  manchego: ["fridge", "cheese", { colour: "#efd88a", variant: "wedge", label: "Manchego" }],
  "blue cheese": ["fridge", "cheese", { colour: "#efe6d0", variant: "wedge", label: "Blue cheese" }],
  "kalamata olives": ["pantry", "jar", { label: "Kalamata", colour: "#4a2a3a", fill: "#3a1a2a", variant: "olives" }],
  "pitted black olives": ["pantry", "jar", { label: "Olives", colour: "#2a2a2a", fill: "#2a2420", variant: "olives" }],
  "harissa paste": ["pantry", "jar", { label: "Harissa", colour: "#c8301e", fill: "#a8281a", variant: "small" }],
  "sambal": ["pantry", "jar", { label: "Sambal", colour: "#c8281e", fill: "#a81e14", variant: "small" }],
  aioli: ["pantry", "jar", { label: "Aioli", colour: "#3f7fbf", fill: "#f6efd8" }],
  "japanese mayonnaise": ["pantry", "bottle", { label: "Kewpie", colour: "#d8302a", fill: "#f6e8c0", variant: "squeeze" }],
  "vegan mayonnaise": ["pantry", "jar", { label: "Vegan mayo", colour: "#3f8a5a", fill: "#f6efd8" }],
  wasabi: ["pantry", "bottle", { label: "Wasabi", colour: "#5f9a3a", fill: "#8aba5a", variant: "tiny" }],
  "kecap manis": ["pantry", "bottle", { label: "Kecap manis", colour: "#c8302a", fill: "#2a160c", variant: "sauce" }],
  "liquid smoke": ["pantry", "bottle", { label: "Liquid smoke", colour: "#5a3a2a", fill: "#3a2414", variant: "tiny" }],
  "food colouring": ["pantry", "bottle", { label: "Colouring", colour: "#d8302a", fill: "#d8302a", variant: "tiny" }],
  "lemon zest": ["fridge", "citrus", { colour: "#f2d24b", variant: "lemon" }],
  "orange zest": ["fridge", "citrus", { colour: "#f29a2e", variant: "orange" }],
  "salt cod": ["fridge", "tray", { variant: "fish", label: "Salt cod" }],
  "potato starch": ["pantry", "box", { label: "Potato starch", colour: "#5f8aa8", variant: "small" }],
  "roasted capsicum": ["pantry", "jar", { label: "Roast capsicum", colour: "#d93a2f", fill: "#c8401e" }],
  "ice cream": ["fridge", "tub", { label: "Ice cream", colour: "#e88aa0", variant: "big" }],
  "vanilla pod": ["pantry", "spice", { label: "Vanilla pods", colour: "#3a2414", fill: "#2a1a10", variant: "tiny" }],
  "shrimp paste": ["pantry", "jar", { label: "Shrimp paste", colour: "#8a4a3a", fill: "#5a3a2a", variant: "small" }],
  "harissa spice": ["pantry", "spice", { label: "Harissa", colour: "#c8301e", fill: "#b8401e" }],
  "lemon juice": ["fridge", "bottle", { label: "Lemon juice", colour: "#f0cf3a", fill: "#f4e48a", variant: "squeeze" }],
  "lime juice": ["fridge", "bottle", { label: "Lime juice", colour: "#7fb546", fill: "#d8e89a", variant: "squeeze" }],
  "orange juice": ["fridge", "juice", { label: "Orange juice", colour: "#f29a2e" }],
  "frog legs": ["fridge", "tray", { variant: "drumstick", label: "Frog legs" }],
  "pigs trotters": ["fridge", "tray", { variant: "roast", colour: "#eaa49a", label: "Pig's trotters" }],
  breadfruit: ["pantry", "potato", { colour: "#9ab84a", variant: "round" }],
  mulukhiyah: ["fridge", "leaves", { colour: "#2f6f2f", label: "Mulukhiyah" }],
  mastic: ["pantry", "spice", { label: "Mastic", colour: "#e8dcb0", fill: "#f0e8c8", variant: "tiny" }],
  charcoal: ["pantry", "box", { label: "Charcoal", colour: "#2a2a2a", variant: "wide" }],
  "bamboo skewers": ["pantry", "box", { label: "Skewers", colour: "#c8a06a", variant: "small" }],
  "ginger and garlic": ["pantry", "jar", { label: "Ginger garlic", colour: "#c8a03a", fill: "#d8c08a", variant: "small" }],
  water: ["pantry", "bottle", { label: "Water", colour: "#5fa8d8", fill: "#e8f4fa", variant: "oil" }],
  suet: ["fridge", "butter", { label: "Suet", colour: "#efe6d0" }],
  lard: ["fridge", "butter", { label: "Lard", colour: "#f4ece0" }],
  "caraway seeds": ["pantry", "spice", { label: "Caraway", colour: "#6a4a2a", fill: "#5a4a2a" }],
  "dry sherry": ["pantry", "bottle", { label: "Dry sherry", colour: "#a8642a", fill: "#c8843a", variant: "wine" }],
  // the long tail a word rule can't read, each given the look of what it is
  savory: ["pantry", "spice", { label: "Savory", colour: "#6f8a4f", fill: "#7a8a5a" }],
  "kasuri methi": ["pantry", "spice", { label: "Kasuri methi", colour: "#5f7a3a", fill: "#8a9a5a" }],
  "bouquet garni": ["pantry", "spice", { label: "Bouquet garni", colour: "#5f8a3a", fill: "#6f7a3a" }],
  "fines herbes": ["pantry", "spice", { label: "Fines herbes", colour: "#5f8a3a", fill: "#6f7a3a" }],
  "dried sorrel": ["pantry", "spice", { label: "Sorrel", colour: "#8a1a2a", fill: "#7a1a24" }],
  cajun: ["pantry", "spice", { label: "Cajun", colour: "#c8401e", fill: "#b8501e" }],
  annatto: ["pantry", "spice", { label: "Annatto", colour: "#d8501e", fill: "#c8401e" }],
  msg: ["pantry", "spice", { label: "MSG", colour: "#d8302a", fill: "#ffffff", variant: "salt" }],
  "nutritional yeast": ["pantry", "spice", { label: "Nutritional yeast", colour: "#e9b83a", fill: "#f0d36a", variant: "tin" }],
  "soya bean": ["pantry", "pouch", { label: "Soya beans", colour: "#d8c07a" }],
  tapioca: ["pantry", "pouch", { label: "Tapioca", colour: "#efe8d8" }],
  candlenuts: ["pantry", "pouch", { label: "Candlenuts", colour: "#e8d8b0" }],
  "mixed peel": ["pantry", "pouch", { label: "Mixed peel", colour: "#e88a2a" }],
  "seasoned croutons": ["pantry", "pouch", { label: "Croutons", colour: "#d8903a" }],
  "bean thread vermicelli": ["pantry", "pouch", { label: "Vermicelli", colour: "#e8e4dc" }],
  marzipan: ["pantry", "bar", { label: "Marzipan", colour: "#efe0b8" }],
  nougatine: ["pantry", "bar", { label: "Nougatine", colour: "#d8a05a" }],
  mentsuyu: ["pantry", "bottle", { label: "Mentsuyu", colour: "#3a2a20", fill: "#2a160c", variant: "sauce" }],
  "salsa lizano": ["pantry", "bottle", { label: "Lizano", colour: "#2f6fa8", fill: "#6a4a1a", variant: "sauce" }],
  browning: ["pantry", "bottle", { label: "Browning", colour: "#3a2a1a", fill: "#1a0e08", variant: "small" }],
  vinaigrette: ["fridge", "bottle", { label: "Vinaigrette", colour: "#5f8a3a", fill: "#c8b04a", variant: "sauce" }],
  malta: ["fridge", "can", { label: "Malta", colour: "#3a2a1a", variant: "drink" }],
  konnyaku: ["fridge", "tray", { variant: "tofu", label: "Konnyaku" }],
  aburaage: ["fridge", "tray", { variant: "tofu", label: "Aburaage" }],
  natto: ["fridge", "tub", { label: "Natto", colour: "#c8a03a", variant: "flat" }],
  mirepoix: ["fridge", "tub", { label: "Mirepoix", colour: "#ee8a2c", variant: "flat" }],
  ackee: ["pantry", "can", { label: "Ackee", colour: "#e9b83a" }],
  redcurrants: ["fridge", "berries", { colour: "#d8202a" }],
  blackcurrants: ["fridge", "berries", { colour: "#2a1a3a" }],
  "sashimi-grade tuna": ["fridge", "tray", { variant: "steak", colour: "#b8303a", label: "Sashimi tuna" }],
  "pea shoot tips": ["fridge", "leaves", { colour: "#6faf4a", label: "Pea shoots" }],

  // ---- cartons: stock, coconut
  "chicken stock": ["pantry", "carton", { label: "Chicken stock", colour: "#e9b83a" }],
  "beef stock": ["pantry", "carton", { label: "Beef stock", colour: "#8a3a2a" }],
  "vegetable stock": ["pantry", "carton", { label: "Veg stock", colour: "#5f9a3a" }],
  "fish stock": ["pantry", "carton", { label: "Fish stock", colour: "#3f7fa8" }],
  "stock cube": ["pantry", "box", { label: "Stock cubes", colour: "#e9b83a", variant: "small" }],
  "coconut milk": ["pantry", "can", { label: "Coconut milk", colour: "#3f7a5a" }],
  "coconut cream": ["pantry", "can", { label: "Coconut cream", colour: "#2f6a8a" }],
  "condensed milk": ["pantry", "can", { label: "Condensed milk", colour: "#2f5fa8", variant: "squat" }],
  "evaporated milk": ["pantry", "can", { label: "Evaporated milk", colour: "#3f6fbf", variant: "squat" }],

  // ---- cans
  "canned tomatoes": ["pantry", "can", { label: "Tomatoes", colour: "#d8302a" }],
  "tomato paste": ["pantry", "jar", { label: "Tomato paste", colour: "#d8302a", fill: "#b8201a", variant: "small" }],
  "tomato puree": ["pantry", "jar", { label: "Tomato paste", colour: "#d8302a", fill: "#b8201a", variant: "small" }],
  passata: ["pantry", "bottle", { label: "Passata", colour: "#d8302a", fill: "#b8201a", variant: "jar" }],
  chickpeas: ["pantry", "can", { label: "Chickpeas", colour: "#d8a03a" }],
  "kidney beans": ["pantry", "can", { label: "Kidney beans", colour: "#8a2a2a" }],
  "black beans": ["pantry", "can", { label: "Black beans", colour: "#2a2a2a" }],
  "cannellini beans": ["pantry", "can", { label: "Cannellini", colour: "#5f8aa8" }],
  "butter beans": ["pantry", "can", { label: "Butter beans", colour: "#c8b04a" }],
  "baked beans": ["pantry", "can", { label: "Baked beans", colour: "#3f6fbf" }],
  tuna: ["pantry", "can", { label: "Tuna", colour: "#2f6fa8", variant: "flat" }],
  "lentils": ["pantry", "pouch", { label: "Lentils", colour: "#c8642a" }],
  "brown lentils": ["pantry", "pouch", { label: "Brown lentils", colour: "#8a5a2a" }],
  "red lentils": ["pantry", "pouch", { label: "Red lentils", colour: "#e86a3a" }],

  // ---- jars: spreads, pastes, preserves, condiments
  "peanut butter": ["pantry", "jar", { label: "Peanut butter", colour: "#c8302a", fill: "#c08a4a", variant: "peanut" }],
  jam: ["pantry", "jar", { label: "Jam", colour: "#d8303a", fill: "#a81a2a", variant: "jam" }],
  marmalade: ["pantry", "jar", { label: "Marmalade", colour: "#f29a2e", fill: "#e8781a", variant: "jam" }],
  mustard: ["pantry", "jar", { label: "Mustard", colour: "#f0c330", fill: "#e8b82a", variant: "small" }],
  "dijon mustard": ["pantry", "jar", { label: "Dijon", colour: "#2f3f6a", fill: "#c8a02a", variant: "small" }],
  mayonnaise: ["pantry", "jar", { label: "Mayo", colour: "#3f7fbf", fill: "#f6efd8" }],
  tahini: ["pantry", "jar", { label: "Tahini", colour: "#a8743a", fill: "#d8b47a" }],
  "thai red curry paste": ["pantry", "jar", { label: "Red curry", colour: "#c8282a", fill: "#b8301e", variant: "small" }],
  "thai green curry paste": ["pantry", "jar", { label: "Green curry", colour: "#3f8a3a", fill: "#5f7a2a", variant: "small" }],
  "chilli paste": ["pantry", "jar", { label: "Chilli paste", colour: "#c8282a", fill: "#a81e14", variant: "small" }],
  "tamarind paste": ["pantry", "jar", { label: "Tamarind", colour: "#6a3a1a", fill: "#4a2410", variant: "small" }],
  "ginger garlic paste": ["pantry", "jar", { label: "Ginger garlic", colour: "#c8a03a", fill: "#d8c08a", variant: "small" }],
  "black olives": ["pantry", "jar", { label: "Olives", colour: "#2a2a2a", fill: "#2a2420", variant: "olives" }],
  "green olives": ["pantry", "jar", { label: "Green olives", colour: "#5f7a2a", fill: "#7a8a3a", variant: "olives" }],
  capers: ["pantry", "jar", { label: "Capers", colour: "#5f7a3a", fill: "#6f7a3a", variant: "small" }],
  "dill pickles": ["fridge", "jar", { label: "Pickles", colour: "#3f8a3a", fill: "#7a9a3a", variant: "pickles" }],
  sauerkraut: ["fridge", "jar", { label: "Sauerkraut", colour: "#9a8a3a", fill: "#ddd6a0" }],
  "pickled ginger": ["fridge", "jar", { label: "Pickled ginger", colour: "#e88aa0", fill: "#f4b8c0", variant: "small" }],
  salsa: ["fridge", "jar", { label: "Salsa", colour: "#d8302a", fill: "#c8402a" }],
  pesto: ["fridge", "jar", { label: "Pesto", colour: "#3f8a3a", fill: "#4f7a2a", variant: "small" }],
  "miso paste": ["fridge", "tub", { label: "Miso", colour: "#c8843a" }],
  horseradish: ["fridge", "jar", { label: "Horseradish", colour: "#efe6c0", fill: "#f4f0e0", variant: "small" }],
  hummus: ["fridge", "tub", { label: "Hummus", colour: "#c8a05a" }],
  "dulce de leche": ["pantry", "jar", { label: "Dulce de leche", colour: "#a8642a", fill: "#b8743a" }],
  "nutella": ["pantry", "jar", { label: "Choc spread", colour: "#6a3a1a", fill: "#4a2410" }],

  // ---- dry goods: sacks
  "plain flour": ["pantry", "sack", { label: "Plain flour", colour: "#3f7fbf" }],
  "self-raising flour": ["pantry", "sack", { label: "Self-raising", colour: "#d8302a" }],
  "bread flour": ["pantry", "sack", { label: "Bread flour", colour: "#a8642a" }],
  "wholemeal flour": ["pantry", "sack", { label: "Wholemeal", colour: "#8a5a2a" }],
  "rice flour": ["pantry", "sack", { label: "Rice flour", colour: "#5fa8a0" }],
  cornflour: ["pantry", "box", { label: "Cornflour", colour: "#e9b83a", variant: "small" }],
  sugar: ["pantry", "sack", { label: "Sugar", colour: "#5f9fd8", fill: "#ffffff" }],
  "caster sugar": ["pantry", "sack", { label: "Caster sugar", colour: "#bf5fa8" }],
  "brown sugar": ["pantry", "sack", { label: "Brown sugar", colour: "#8a5a2a" }],
  "icing sugar": ["pantry", "sack", { label: "Icing sugar", colour: "#e88aa0" }],
  "palm sugar": ["pantry", "pouch", { label: "Palm sugar", colour: "#a8743a" }],
  rice: ["pantry", "sack", { label: "Rice", colour: "#3f8a5a", variant: "rice" }],
  "basmati rice": ["pantry", "sack", { label: "Basmati", colour: "#8a3a5a", variant: "rice" }],
  "jasmine rice": ["pantry", "sack", { label: "Jasmine rice", colour: "#5f8a3a", variant: "rice" }],
  "sushi rice": ["pantry", "sack", { label: "Sushi rice", colour: "#c8302a", variant: "rice" }],
  "paella rice": ["pantry", "sack", { label: "Paella rice", colour: "#e9a02a", variant: "rice" }],
  "arborio rice": ["pantry", "sack", { label: "Arborio", colour: "#3f6fa8", variant: "rice" }],
  semolina: ["pantry", "sack", { label: "Semolina", colour: "#d8a83a" }],
  cornmeal: ["pantry", "sack", { label: "Polenta", colour: "#f0c330" }],
  couscous: ["pantry", "box", { label: "Couscous", colour: "#d8a03a" }],
  quinoa: ["pantry", "pouch", { label: "Quinoa", colour: "#8a6a3a" }],
  "rolled oats": ["pantry", "box", { label: "Oats", colour: "#c8a03a", variant: "tall" }],
  breadcrumbs: ["pantry", "pouch", { label: "Breadcrumbs", colour: "#d8903a" }],
  "baking powder": ["pantry", "spice", { label: "Baking powder", colour: "#d8302a", variant: "tin" }],
  "bicarbonate of soda": ["pantry", "spice", { label: "Bicarb soda", colour: "#f0a02a", variant: "tin" }],
  yeast: ["pantry", "spice", { label: "Yeast", colour: "#d8302a", variant: "sachet" }],
  gelatine: ["pantry", "spice", { label: "Gelatine", colour: "#5f9fd8", variant: "sachet" }],
  "cocoa powder": ["pantry", "box", { label: "Cocoa", colour: "#5a2a1a", variant: "small" }],
  "custard powder": ["pantry", "box", { label: "Custard powder", colour: "#e9b83a", variant: "small" }],
  "cream of tartar": ["pantry", "spice", { label: "Cream of tartar", colour: "#5f9fd8" }],

  // ---- pasta, noodles, boxes
  spaghetti: ["pantry", "box", { label: "Spaghetti", colour: "#2f5fa8", variant: "pasta" }],
  pasta: ["pantry", "box", { label: "Pasta", colour: "#2f5fa8", variant: "pasta" }],
  penne: ["pantry", "box", { label: "Penne", colour: "#2f5fa8", variant: "pasta" }],
  macaroni: ["pantry", "box", { label: "Macaroni", colour: "#2f5fa8", variant: "pasta" }],
  "linguine pasta": ["pantry", "box", { label: "Linguine", colour: "#2f5fa8", variant: "pasta" }],
  "lasagne sheets": ["pantry", "box", { label: "Lasagne", colour: "#2f5fa8", variant: "wide" }],
  "rice noodles": ["pantry", "pouch", { label: "Rice noodles", colour: "#d8302a" }],
  "egg noodles": ["pantry", "pouch", { label: "Egg noodles", colour: "#e9b83a" }],
  "udon noodles": ["pantry", "pouch", { label: "Udon", colour: "#f0e6c8" }],
  "digestive biscuits": ["pantry", "box", { label: "Biscuits", colour: "#c8302a", variant: "wide" }],
  "puff pastry": ["fridge", "box", { label: "Puff pastry", colour: "#3f7fbf", variant: "flat" }],
  "shortcrust pastry": ["fridge", "box", { label: "Shortcrust", colour: "#d8903a", variant: "flat" }],
  "filo pastry": ["fridge", "box", { label: "Filo", colour: "#5fa8a0", variant: "flat" }],

  // ---- bread
  bread: ["pantry", "loaf", { variant: "loaf" }],
  baguette: ["pantry", "loaf", { variant: "baguette" }],
  "pita bread": ["pantry", "loaf", { variant: "flat", label: "Pita" }],
  "corn tortillas": ["pantry", "loaf", { variant: "flat", colour: "#f2d48a", label: "Tortillas" }],
  "burger bun": ["pantry", "loaf", { variant: "bun" }],
  "rye bread": ["pantry", "loaf", { variant: "rye" }],

  // ---- nuts, seeds, dried fruit (stand-up pouches)
  almonds: ["pantry", "pouch", { label: "Almonds", colour: "#a8743a" }],
  "ground almonds": ["pantry", "pouch", { label: "Almond meal", colour: "#c8a06a" }],
  walnuts: ["pantry", "pouch", { label: "Walnuts", colour: "#8a5a2a" }],
  cashews: ["pantry", "pouch", { label: "Cashews", colour: "#d8b47a" }],
  peanuts: ["pantry", "pouch", { label: "Peanuts", colour: "#c8843a" }],
  pistachios: ["pantry", "pouch", { label: "Pistachios", colour: "#7fa83a" }],
  "pine nuts": ["pantry", "pouch", { label: "Pine nuts", colour: "#e9c86a" }],
  hazelnuts: ["pantry", "pouch", { label: "Hazelnuts", colour: "#8a5a2a" }],
  "pecan nuts": ["pantry", "pouch", { label: "Pecans", colour: "#7a4a2a" }],
  "sesame seed": ["pantry", "pouch", { label: "Sesame", colour: "#efe0b8" }],
  "desiccated coconut": ["pantry", "pouch", { label: "Coconut", colour: "#5fa8a0" }],
  raisins: ["pantry", "pouch", { label: "Raisins", colour: "#5a2a3a" }],
  sultanas: ["pantry", "pouch", { label: "Sultanas", colour: "#c8843a" }],
  currants: ["pantry", "pouch", { label: "Currants", colour: "#3a1a2a" }],
  dates: ["pantry", "pouch", { label: "Dates", colour: "#6a3a1a" }],
  "dried apricots": ["pantry", "pouch", { label: "Apricots", colour: "#f29a2e" }],
  "dried cranberries": ["pantry", "pouch", { label: "Cranberries", colour: "#b81a2a" }],
  prunes: ["pantry", "pouch", { label: "Prunes", colour: "#3a1a2a" }],
  "mixed dried fruit": ["pantry", "pouch", { label: "Dried fruit", colour: "#a8541a" }],
  "chocolate chips": ["pantry", "pouch", { label: "Choc chips", colour: "#5a2a1a" }],
  "dark chocolate": ["pantry", "bar", { label: "Dark chocolate", colour: "#3a1a10" }],
  "milk chocolate": ["pantry", "bar", { label: "Milk chocolate", colour: "#7a3f1a" }],
  "white chocolate": ["pantry", "bar", { label: "White chocolate", colour: "#efe6d0" }],

  // ---- spices and dried herbs (shakers)
  salt: ["pantry", "spice", { label: "Salt", colour: "#3f7fbf", fill: "#ffffff", variant: "salt" }],
  "sea salt": ["pantry", "spice", { label: "Sea salt", colour: "#3f7fbf", fill: "#ffffff", variant: "salt" }],
  "sea salt flakes": ["pantry", "spice", { label: "Salt flakes", colour: "#3f7fbf", fill: "#ffffff", variant: "salt" }],
  "black pepper": ["pantry", "spice", { label: "Pepper", colour: "#2a2a2a", fill: "#3a3430", variant: "grinder" }],
  "black peppercorns": ["pantry", "spice", { label: "Peppercorns", colour: "#2a2a2a", fill: "#3a3430", variant: "grinder" }],
  "white pepper": ["pantry", "spice", { label: "White pepper", colour: "#a8a8a0", fill: "#e8e0cc" }],
  "ground cumin": ["pantry", "spice", { label: "Cumin", colour: "#a8643a", fill: "#a87038" }],
  "cumin seeds": ["pantry", "spice", { label: "Cumin seed", colour: "#a8643a", fill: "#8a6a3a" }],
  cinnamon: ["pantry", "spice", { label: "Cinnamon", colour: "#a8541a", fill: "#a8602a" }],
  "ground cinnamon": ["pantry", "spice", { label: "Cinnamon", colour: "#a8541a", fill: "#a8602a" }],
  "cinnamon stick": ["pantry", "spice", { label: "Cinnamon sticks", colour: "#8a4a1a", fill: "#8a4a1a" }],
  paprika: ["pantry", "spice", { label: "Paprika", colour: "#c8301e", fill: "#c8361e" }],
  "smoked paprika": ["pantry", "spice", { label: "Smoked paprika", colour: "#8a2a1e", fill: "#a8301e" }],
  turmeric: ["pantry", "spice", { label: "Turmeric", colour: "#e9a01a", fill: "#e8a01a" }],
  nutmeg: ["pantry", "spice", { label: "Nutmeg", colour: "#8a5a2a", fill: "#a8743a" }],
  cardamom: ["pantry", "spice", { label: "Cardamom", colour: "#6f8a3a", fill: "#8a9a5a" }],
  allspice: ["pantry", "spice", { label: "Allspice", colour: "#6a3a1a", fill: "#7a4a2a" }],
  cloves: ["pantry", "spice", { label: "Cloves", colour: "#5a2a1a", fill: "#4a2414" }],
  "ground cloves": ["pantry", "spice", { label: "Cloves", colour: "#5a2a1a", fill: "#4a2414" }],
  "chilli powder": ["pantry", "spice", { label: "Chilli powder", colour: "#c8281e", fill: "#b8281a" }],
  "cayenne pepper": ["pantry", "spice", { label: "Cayenne", colour: "#d8361e", fill: "#c8361e" }],
  "red chilli flakes": ["pantry", "spice", { label: "Chilli flakes", colour: "#c8281e", fill: "#b8301e" }],
  "chilli flakes": ["pantry", "spice", { label: "Chilli flakes", colour: "#c8281e", fill: "#b8301e" }],
  "dried chillies": ["pantry", "pouch", { label: "Dried chillies", colour: "#a81e14" }],
  "ground coriander": ["pantry", "spice", { label: "Coriander", colour: "#8a7a3a", fill: "#a8904a" }],
  "coriander seeds": ["pantry", "spice", { label: "Coriander seed", colour: "#8a7a3a", fill: "#b8a06a" }],
  "ground ginger": ["pantry", "spice", { label: "Ginger", colour: "#c8a03a", fill: "#d8b46a" }],
  "garam masala": ["pantry", "spice", { label: "Garam masala", colour: "#8a3a1a", fill: "#8a5a2a" }],
  "curry powder": ["pantry", "spice", { label: "Curry powder", colour: "#e9a01a", fill: "#d8901a" }],
  "garlic powder": ["pantry", "spice", { label: "Garlic powder", colour: "#e9dcc0", fill: "#efe2c4" }],
  "onion powder": ["pantry", "spice", { label: "Onion powder", colour: "#d8b47a", fill: "#e8d4a0" }],
  "dried oregano": ["pantry", "spice", { label: "Oregano", colour: "#5f7a3a", fill: "#6f7a3a" }],
  oregano: ["pantry", "spice", { label: "Oregano", colour: "#5f7a3a", fill: "#6f7a3a" }],
  "dried thyme": ["pantry", "spice", { label: "Thyme", colour: "#6f8a4f", fill: "#7a8a5a" }],
  "dried mint": ["pantry", "spice", { label: "Mint", colour: "#4caf6a", fill: "#6f8a5a" }],
  "mixed herbs": ["pantry", "spice", { label: "Mixed herbs", colour: "#5f8a3a", fill: "#6f7a3a" }],
  "bay leaf": ["pantry", "spice", { label: "Bay leaves", colour: "#5f7a3a", fill: "#7a8a4a", variant: "leaves" }],
  "fennel seeds": ["pantry", "spice", { label: "Fennel seed", colour: "#8a9a4a", fill: "#a8b06a" }],
  "star anise": ["pantry", "spice", { label: "Star anise", colour: "#6a2a1a", fill: "#6a3a1a" }],
  saffron: ["pantry", "spice", { label: "Saffron", colour: "#d8281e", fill: "#d8401e", variant: "tiny" }],
  "mixed spice": ["pantry", "spice", { label: "Mixed spice", colour: "#a8541a", fill: "#a86a3a" }],
  "all-purpose seasoning": ["pantry", "spice", { label: "Seasoning", colour: "#c8843a", fill: "#c8843a" }],
  sumac: ["pantry", "spice", { label: "Sumac", colour: "#8a1a2a", fill: "#8a2a2a" }],
  "ras el hanout": ["pantry", "spice", { label: "Ras el hanout", colour: "#a8541a", fill: "#a8643a" }],
  "five spice": ["pantry", "spice", { label: "Five spice", colour: "#8a3a1a", fill: "#8a5a3a" }],
  "chinese five spice powder": ["pantry", "spice", { label: "Five spice", colour: "#8a3a1a", fill: "#8a5a3a" }],
  "mustard powder": ["pantry", "spice", { label: "Mustard powder", colour: "#e9b83a", fill: "#e8c03a" }],
  "celery salt": ["pantry", "spice", { label: "Celery salt", colour: "#7faf5a", fill: "#e8e4d0" }],
  "garlic salt": ["pantry", "spice", { label: "Garlic salt", colour: "#e9dcc0", fill: "#f0e8d8" }],
};

// What the rest look like, by the words in their name. Ordered: the first
// rule that matches wins, so the specific comes before the general
// ("chicken stock" is a carton, not a chicken; "butter beans" a tin, not
// butter; "ground ginger" a shaker, not a root; "peanut butter" a jar).
const RULES: [RegExp, Place, Model, Look?][] = [
  [/^ (\w+ )?water $/, "pantry", "bottle", { label: "Water", colour: "#5fa8d8", fill: "#e8f4fa", variant: "oil" }],
  // how it's sold, before what it's made of: dried, candied, fried and
  // cooked things aren't the fresh produce their name starts with
  [/ (glac[eé]|maraschino|candied|crystallised|crystallized) /, "pantry", "jar", { label: "Jar", colour: "#c8302a", fill: "#c8202a", variant: "small" }],
  [/\b(juniper|allspice) berries\b/, "pantry", "spice", { label: "Spice", colour: "#5a3a4a", fill: "#3a2a3a" }],
  [/\bdried (peach|peaches|mushrooms?|wild mushrooms?|porcini|shiitake|fruit|figs?|mango|apricots?|cranberries|cherries|plums?)\b|\bdried \w+ mushrooms?\b/, "pantry", "pouch", { label: "Dried", colour: "#8a5a2a" }],
  [/\b(fried shallots|fried onions|crispy shallots)\b/, "pantry", "jar", { label: "Fried shallots", colour: "#c8843a", fill: "#c8843a", variant: "small" }],
  [/\b(black-eyed|pinto|refried|borlotti|cannellini|kidney|navy|haricot|fermented soy) beans?\b|\bblack-eyed peas\b/, "pantry", "can", { label: "Beans", colour: "#8a5a3a" }],
  [/\bsplit peas\b/, "pantry", "pouch", { label: "Split peas", colour: "#c8a03a" }],
  [/\b(rice flour pancakes|spring roll wrappers|rice paper)\b/, "pantry", "pouch", { label: "Wrappers", colour: "#e8e4dc" }],
  [/\b(cooked|steamed|leftover) (white |brown )?rice\b|\b(greek lemon|fried) rice\b/, "fridge", "tub", { label: "Rice", colour: "#5f8a5a" }],
  [/\b(krispies|cornflakes|cereal|muesli|granola)\b/, "pantry", "box", { label: "Cereal", colour: "#d8502a", variant: "tall" }],
  [/\b(bread rolls?|dinner rolls?|buns?)\b/, "pantry", "loaf", { variant: "bun" }],
  [/\b(tortillas?|wraps?|naan|chapati|roti|lavash|flatbreads?)\b/, "pantry", "loaf", { variant: "flat" }],
  [/\b(wild garlic|garlic chives|garlic scapes)\b/, "fridge", "herbs", { colour: "#3f8a3a", variant: "chives" }],
  [/\b(ginger and garlic|garlic and ginger)\b/, "pantry", "jar", { label: "Ginger garlic", colour: "#c8a03a", fill: "#d8c08a", variant: "small" }],
  [/\b(stock|broth)\b(?! cube)/, "pantry", "carton", { label: "Stock", colour: "#c8a03a" }],
  [/\b(stock cubes?|bouillon|gravy)\b/, "pantry", "box", { label: "Stock cubes", colour: "#e9b83a", variant: "small" }],
  [/\b(peanut butter|nut butter|almond butter|spread)\b/, "pantry", "jar", { label: "Spread", colour: "#c8843a", fill: "#c08a4a" }],
  [/\b(butter beans|beans? \(|baked beans|canned|tinned|in brine)\b/, "pantry", "can", { label: "Tin", colour: "#8a8a8a" }],
  [/\b(coconut milk|coconut cream|condensed|evaporated)\b/, "pantry", "can", { label: "Coconut", colour: "#3f7a5a" }],
  [/\b(sauce|ketchup|sriracha|dressing)\b/, "pantry", "bottle", { label: "Sauce", colour: "#a83a2a", fill: "#6a2a1a", variant: "sauce" }],
  [/\b(oil|cooking spray)\b/, "pantry", "bottle", { label: "Oil", colour: "#d8a83a", fill: "#e9c86a", variant: "oil" }],
  [/\b(vinegar)\b/, "pantry", "bottle", { label: "Vinegar", colour: "#a8642a", fill: "#c89a5a", variant: "sauce" }],
  [/\b(wine|sherry|port|liqueur|brandy|whisky|bourbon|vodka|rum|cider|sake)\b/, "pantry", "bottle", { label: "Wine", colour: "#7a1a2a", fill: "#5a1a1a", variant: "wine" }],
  [/\b(syrup|molasses|extract|essence|water$)\b/, "pantry", "bottle", { label: "Syrup", colour: "#a8541a", fill: "#a8541a", variant: "small" }],
  [/\b(juice)\b/, "fridge", "juice", { label: "Juice", colour: "#f29a2e" }],
  [/\b(ground|powder|flakes|seeds?|seasoning|spice|masala|salt|(?<!bell |sweet |banana |red |green |yellow )pepper(?!s|corns? \()|dried (oregano|thyme|basil|parsley|dill|sage|herbs)|paprika|cumin|turmeric|cinnamon|nutmeg|clove|cardamom|anise|fenugreek|asafoetida|sumac|za'?atar|togarashi)\b/, "pantry", "spice", { label: "Spice", colour: "#a8643a", fill: "#a8743a" }],
  [/\b(paste|curry paste|miso|harissa|pesto|jam|jelly|chutney|relish|marmalade|honey|mustard|mayo|mayonnaise|olives|capers|pickle|pickled|tahini|sauerkraut|kimchi|roasted|chargrilled|marinated|puree|purée)\b/, "pantry", "jar", { label: "Jar", colour: "#c8643a", fill: "#a8542a" }],
  [/\b(starch|frozen)\b/, "pantry", "box", { label: "Pack", colour: "#5f8aa8", variant: "small" }],
  [/\b(milk)\b/, "fridge", "milk", { label: "Milk", colour: "#3f7fd0" }],
  [/\b(cream)\b/, "fridge", "cream", { label: "Cream", colour: "#d9a43a" }],
  [/\b(yoghurt|yogurt|hummus|dip|tzatziki|quark|fromage)\b/, "fridge", "tub", { label: "Yoghurt", colour: "#5f9fd8" }],
  [/\b(butter|margarine|ghee|lard|dripping|tallow|suet)\b/, "fridge", "butter", { label: "Butter", colour: "#e9c53a" }],
  [/\begg/, "fridge", "eggs"],
  [/\b(cheese|cheddar|parmesan|mozzarella|feta|halloumi|gruy|pecorino|brie|camembert|paneer|bryndza|queso|curds?)\b/, "fridge", "cheese", { colour: "#f2c64a", variant: "block", label: "Cheese" }],
  [/\b(salmon|trout|fish|cod|haddock|hake|snapper|barramundi|bass|mackerel|sardines?|herring|monkfish|tuna steak)\b/, "fridge", "tray", { variant: "fish", label: "Fish" }],
  [/\b(prawns?|shrimp|lobster|crab|scallops?)\b/, "fridge", "tray", { variant: "prawns", label: "Seafood" }],
  [/\b(squid|calamari|octopus|clams?|mussels?|oysters?|conch)\b/, "fridge", "tray", { variant: "squid", label: "Seafood" }],
  [/\b(mince)\b/, "fridge", "tray", { variant: "mince", label: "Mince" }],
  [/\b(bacon|pancetta|guanciale)\b/, "fridge", "tray", { variant: "bacon", label: "Bacon" }],
  [/\b(sausages?|chorizo|kransky|salami|frankfurt)\b/, "fridge", "tray", { variant: "sausages", label: "Sausages" }],
  [/\b(ham|prosciutto|jamon|jamón)\b/, "fridge", "tray", { variant: "ham", label: "Ham" }],
  [/\b(chicken|turkey|duck|poussin)\b/, "fridge", "tray", { variant: "thigh", label: "Poultry" }],
  [/\b(steak|fillet|sirloin|rump|eye fillet)\b/, "fridge", "tray", { variant: "steak", label: "Steak" }],
  [/\b(beef|pork|lamb|veal|goat|venison|kangaroo|meat|oxtail|ribs?|shanks?|brisket|chops?|liver|kidneys?|offal)\b/, "fridge", "tray", { variant: "diced", label: "Meat" }],
  [/\b(tofu|tempeh|seitan)\b/, "fridge", "tray", { variant: "tofu", label: "Tofu" }],
  [/\b(flour|sugar|polenta|semolina|meal)\b/, "pantry", "sack", { label: "Flour", colour: "#c8a03a" }],
  [/\b(rice)\b(?! (noodles|paper|vinegar|wine))/, "pantry", "sack", { label: "Rice", colour: "#3f8a5a", variant: "rice" }],
  [/\b(pasta|spaghetti|penne|fusilli|linguine|fettuccine|rigatoni|lasagne|farfalle|macaroni|orzo|vermicelli pasta|cereal|muesli|granola|oats|crackers?|biscuits?|pastry|couscous|cornflour|cocoa)\b/, "pantry", "box", { label: "Pasta", colour: "#2f5fa8", variant: "pasta" }],
  [/\b(noodles?|rice paper|wrappers?|wonton)\b/, "pantry", "pouch", { label: "Noodles", colour: "#e9b83a" }],
  [/\b(nuts?|almonds?|walnuts?|cashews?|pecans?|pistachios?|hazelnuts?|macadamias?|peanuts?|seeds|raisins|sultanas|currants|dates|prunes|apricots? \(dried|dried (fruit|apricots?|cranberries|figs|mango|cherries)|chips|lentils?|split peas|quinoa|barley|bulgur|freekeh|breadcrumbs|panko|coconut)\b/, "pantry", "pouch", { label: "Pantry", colour: "#a8743a" }],
  [/\b(chocolate)\b/, "pantry", "bar", { label: "Chocolate", colour: "#5a2a1a" }],
  [/\b(bread|loaf|baguette|roll|bun|tortilla|pita|naan|bagel|brioche|croissant|wrap)\b/, "pantry", "loaf", { variant: "loaf" }],
  // fresh produce last: "ground ginger" and "chilli flakes" were caught above
  [/\b(lemon|lime|orange|mandarin|grapefruit|clementine|yuzu|kumquat)\b/, "fridge", "citrus", { colour: "#f2d24b", variant: "lemon" }],
  [/\b(apples?|pears?|peach(es)?|nectarines?|plums?|apricots?|quince)\b/, "fridge", "apple", { colour: "#d6453d" }],
  [/\b(tomato(es)?)\b/, "fridge", "tomato", { colour: "#e2463a" }],
  [/\b(capsicum|bell pepper|peppers)\b/, "fridge", "capsicum", { colour: "#d93a2f" }],
  [/\b(chill(i|ies)|jalape|habanero|bird'?s eye)\b/, "fridge", "chilli", { colour: "#d8362b" }],
  [/\b(bananas?|plantains?)\b/, "pantry", "banana", { colour: "#f2d34d" }],
  [/\b(carrots?|parsnips?|daikon|radish|turnip)\b/, "fridge", "carrot", { colour: "#ee8a2c" }],
  [/\b(potato(es)?|yam|taro|cassava|kumara|swede|celeriac|jerusalem)\b/, "pantry", "potato", { colour: "#cfa86e" }],
  [/\b(onions?|shallots?|eschalots?)\b/, "pantry", "onion", { colour: "#d39a52" }],
  [/\b(garlic)\b/, "pantry", "garlic"],
  [/\b(broccoli|cauliflower|broccolini)\b/, "fridge", "broccoli", { colour: "#3f8a3e" }],
  [/\b(cabbage|lettuce|wombok|bok choy|pak choi|choy|iceberg|cos)\b/, "fridge", "cabbage", { colour: "#a9cf86" }],
  [/\b(avocados?)\b/, "fridge", "avocado", { colour: "#3c4f26" }],
  [/\b(mushrooms?|fungus)\b/, "fridge", "mushroom", { colour: "#e8dccb" }],
  [/\b(cucumbers?|zucchini|courgettes?|marrow)\b/, "fridge", "cucumber", { colour: "#3f7a3a" }],
  [/\b(eggplants?|aubergines?)\b/, "fridge", "eggplant", { colour: "#4a2a4f" }],
  [/\b(celery|leeks?|spring onions?|scallions?|lemongrass|asparagus)\b/, "fridge", "stalk", { colour: "#8fbf6a", variant: "celery" }],
  [/\b(corn|sweetcorn)\b/, "fridge", "corn"],
  [/\b(pumpkin|squash)\b/, "pantry", "pumpkin", { colour: "#ee8f2e" }],
  [/\b(ginger|galangal|turmeric root|fingerroot)\b/, "fridge", "ginger", { colour: "#d7b07a" }],
  [/\b(parsley|coriander|cilantro|mint|basil|dill|chives|thyme|rosemary|sage|tarragon|oregano|marjoram|herbs?|curry leaves|lime leaves)\b/, "fridge", "herbs", { colour: "#4f9f45", variant: "flat" }],
  [/\b(spinach|rocket|kale|silverbeet|chard|watercress|salad|leaves|sprouts|callaloo)\b/, "fridge", "leaves", { colour: "#3f7f3a", label: "Greens" }],
  [/\b(strawberr|blueberr|raspberr|blackberr|cranberr|berries|cherries|grapes|currants)/, "fridge", "berries", { colour: "#d43a5a" }],
  [/\b(beans|peas|okra|edamame)\b/, "fridge", "beans", { colour: "#4f9a3a" }],
  [/\b(beetroot|beets?)\b/, "fridge", "beetroot", { colour: "#7a1f3a" }],
  [/\b(mangoes|mango|papaya|melon|kiwi|figs?|pomegranates?|passionfruit|lychees?|longan)\b/, "fridge", "mango", { colour: "#f2a63a" }],
  [/\b(pineapple)\b/, "pantry", "pineapple"],
];

// The aisle a name couldn't be read from, as a last resort.
const BY_CATEGORY: Record<string, Entry> = {
  dairy: ["fridge", "tub", { label: "Dairy", colour: "#5f9fd8" }],
  meat: ["fridge", "tray", { variant: "diced", label: "Meat" }],
  seafood: ["fridge", "tray", { variant: "fish", label: "Seafood" }],
  protein: ["fridge", "tray", { variant: "tofu", label: "Protein" }],
  produce: ["fridge", "leaves", { colour: "#5f9a3a", label: "Produce" }],
  bakery: ["pantry", "loaf", { variant: "loaf" }],
  pantry: ["pantry", "jar", { label: "Pantry", colour: "#c8843a", fill: "#a8743a" }],
};

const TINTS = ["#f6c9b8", "#bfe3cf", "#d9d2f4", "#f7e3a9", "#bcd9ef", "#f4c4cf", "#cfe6c2", "#f3d6bd"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// A name for a label: the ingredient's own words, title-cased, short enough
// to fit ("Self-raising", "Coconut milk").
function labelFrom(name: string): string {
  const words = name.replace(/\([^)]*\)/g, "").trim().split(/\s+/);
  const short = words.length > 2 ? words.slice(-2).join(" ") : words.join(" ");
  return short.charAt(0).toUpperCase() + short.slice(1);
}

// Packaging a shopper reads by its label: a rule's generic "Sauce" or "Jar"
// label becomes the ingredient's own name.
const LABELLED = new Set<Model>(["jar", "bottle", "can", "carton", "box", "sack", "pouch", "spice", "bar", "milk", "cream", "juice", "tub", "butter", "leaves", "tray", "cheese"]);

// Packaging whose label colour a rule gives only as a default: each
// ingredient matched by the rule gets its own colour from this range (the
// same every time), so a shelf of long-tail jars and shakers isn't one
// colour and neighbours tell apart before their names are read.
const PRINTED = new Set<Model>(["jar", "bottle", "can", "carton", "box", "sack", "pouch", "spice", "tub"]);
const LABEL_COLOURS = ["#c8302a", "#d8642a", "#e9a02a", "#c8a03a", "#5f8a3a", "#2f7a5a", "#2f7fa8", "#3f5fa8", "#6a3f8a", "#a8306a", "#8a5a2a", "#3a3a3a"];

export function shelfware(name: string, category: string): Shelfware {
  const n = name.toLowerCase().trim().replace(/\s+/g, " ");
  const tint = TINTS[hash(n) % TINTS.length];
  const named = NAMED[n];
  if (named) return { place: named[0], model: named[1], tint, look: { ...(named[2] ?? {}) } };
  const padded = ` ${n} `;
  for (const [re, place, model, look] of RULES) {
    if (re.test(padded)) {
      const l = { ...(look ?? {}) };
      if (LABELLED.has(model)) l.label = labelFrom(n);
      if (PRINTED.has(model)) l.colour = LABEL_COLOURS[hash(`label ${n}`) % LABEL_COLOURS.length];
      return { place, model, tint, look: l };
    }
  }
  const [place, model, look] = BY_CATEGORY[category] ?? ["pantry", "jar", { label: "Pantry", colour: "#c8843a", fill: "#a8743a" }];
  const l = { ...(look ?? {}) };
  if (LABELLED.has(model)) l.label = labelFrom(n);
  return { place, model, tint, look: l };
}

// The table's named ingredients, for the spec.
export const NAMED_INGREDIENTS = Object.keys(NAMED);
