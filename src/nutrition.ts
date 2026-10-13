// Automatic nutrition and cost for any recipe, the catalogue's and the ones
// people write themselves. Reference values per 100 g (kcal, protein, carbs,
// fat) and a typical Australian supermarket price per 100 g, from public
// food-composition tables and shelf prices, rounded. It is an estimate by
// design: the page labels it as one, and unknown ingredients count as zero
// rather than guessing.

interface Ref {
  kcal: number;
  p: number;
  c: number;
  f: number;
  // cents per 100 g
  cents: number;
  // grams in one "each" (an egg, an onion), when it has no unit
  each?: number;
  // grams per millilitre, for liquids measured by volume (default 1)
  density?: number;
}

const R = (kcal: number, p: number, c: number, f: number, cents: number, each?: number, density?: number): Ref => ({
  kcal, p, c, f, cents, each, density,
});

// Keys are canonical names (src/data/catalogue.json uses the same ones).
// Matching falls back to the longest key contained in the name, so "red
// onion" and "spring onion" find their own rows and "baby spinach" finds
// "spinach".
const FOODS: Record<string, Ref> = {
  // proteins
  "chicken thigh": R(177, 24, 0, 9, 140, 110),
  "chicken breast": R(120, 23, 0, 2.6, 150, 200),
  "chicken legs": R(185, 20, 0, 11, 90, 250),
  chicken: R(165, 25, 0, 7, 140, 150),
  "beef mince": R(250, 26, 0, 17, 150),
  "beef shin": R(150, 21, 0, 7, 180),
  "sirloin steak": R(200, 26, 0, 10, 380),
  beef: R(190, 26, 0, 9, 250),
  "lamb mince": R(282, 17, 0, 23, 180),
  "lamb leg": R(230, 20, 0, 16, 220),
  lamb: R(230, 20, 0, 16, 240),
  "pork mince": R(263, 17, 0, 21, 130),
  pork: R(242, 27, 0, 14, 160, 150),
  bacon: R(417, 13, 1, 40, 250),
  chorizo: R(455, 24, 2, 38, 300),
  sausages: R(300, 13, 4, 26, 130, 70),
  "italian fennel sausages": R(300, 14, 3, 26, 180, 80),
  "salmon fillet": R(208, 20, 0, 13, 450, 150),
  "smoked salmon": R(117, 18, 0, 4.3, 600, 25),
  prawns: R(99, 24, 0.2, 0.3, 300, 12),
  "white fish": R(90, 20, 0, 1, 300, 140),
  tuna: R(116, 26, 0, 1, 150),
  mussels: R(86, 12, 4, 2.2, 120),
  squid: R(92, 16, 3, 1.4, 220, 200),
  "anchovy fillet": R(210, 29, 0, 10, 900, 4),
  tofu: R(144, 15, 3, 8, 110),
  "marinated tofu": R(160, 15, 5, 9, 160),
  paneer: R(296, 21, 3.6, 22, 250),
  eggs: R(143, 13, 0.7, 10, 70, 55),
  "egg yolks": R(322, 16, 3.6, 27, 70, 17),
  "egg whites": R(52, 11, 0.7, 0.2, 70, 33),
  falafel: R(333, 13, 32, 18, 200, 20),

  // dairy
  milk: R(64, 3.4, 4.8, 3.6, 16, undefined, 1.03),
  butter: R(717, 0.9, 0.1, 81, 160),
  ghee: R(900, 0, 0, 100, 250),
  cream: R(340, 2.1, 2.8, 36, 70, undefined, 1.0),
  "creme fraiche": R(292, 2.4, 2.6, 30, 120),
  "sour cream": R(198, 2.4, 4.6, 19, 80),
  "cream cheese": R(342, 6, 4, 34, 120),
  "greek yoghurt": R(97, 9, 4, 5, 70, undefined, 1.05),
  yoghurt: R(61, 3.5, 4.7, 3.3, 50, undefined, 1.05),
  "fromage frais": R(113, 6.8, 4.4, 7.1, 90),
  parmesan: R(431, 38, 4, 29, 450),
  pecorino: R(387, 32, 3.6, 27, 450),
  "gruyère": R(413, 30, 0.4, 32, 500),
  mozzarella: R(280, 22, 2.2, 21, 200),
  feta: R(264, 14, 4, 21, 220),
  "shredded mexican cheese": R(380, 24, 2, 31, 180),
  "ice cream": R(207, 3.5, 24, 11, 60, 70),
  "condensed milk": R(321, 7.9, 54, 8.7, 70),

  // grains, bread, pasta
  rice: R(130, 2.7, 28, 0.3, 25),
  "jasmine rice": R(130, 2.7, 28, 0.3, 30),
  "basmati rice": R(130, 2.7, 28, 0.3, 35),
  "sushi rice": R(130, 2.4, 29, 0.2, 60),
  "paella rice": R(350, 7, 78, 0.6, 80),
  "rice noodles": R(364, 6, 80, 0.6, 70),
  noodles: R(384, 14, 71, 4.4, 60),
  "udon noodles": R(105, 2.6, 21, 0.4, 70),
  spaghetti: R(371, 13, 75, 1.5, 40),
  fettuccine: R(371, 13, 75, 1.5, 60),
  "linguine pasta": R(371, 13, 75, 1.5, 50),
  rigatoni: R(371, 13, 75, 1.5, 50),
  "penne rigate": R(371, 13, 75, 1.5, 40),
  macaroni: R(371, 13, 75, 1.5, 40),
  "lasagne sheets": R(371, 13, 75, 1.5, 70),
  couscous: R(112, 3.8, 23, 0.2, 50),
  quinoa: R(368, 14, 64, 6, 150),
  "porridge oats": R(389, 17, 66, 7, 40),
  "plain flour": R(364, 10, 76, 1, 15),
  "self-raising flour": R(354, 10, 74, 1.2, 18),
  cornflour: R(381, 0.3, 91, 0.1, 40),
  "potato starch": R(357, 0.1, 83, 0.1, 60),
  starch: R(381, 0.3, 91, 0.1, 40),
  breadcrumbs: R(395, 13, 72, 5, 60),
  bread: R(265, 9, 49, 3.2, 50, 40),
  baguette: R(270, 9, 55, 1.5, 120, 250),
  "pita bread": R(275, 9, 56, 1.2, 80, 60),
  "naan bread": R(310, 9, 50, 8, 120, 90),
  "english muffins": R(227, 9, 44, 1.7, 100, 60),
  "flour tortilla": R(306, 8, 50, 8, 90, 45),
  "corn tortillas": R(218, 5.7, 45, 2.9, 90, 26),
  "puff pastry": R(551, 7.4, 45, 38, 110),
  "digestive biscuits": R(480, 7, 63, 21, 70),
  "meringue nests": R(390, 5, 93, 0, 250, 12),
  "wonton skin": R(291, 9.8, 58, 1.5, 150),
  "egg rolls": R(250, 6, 30, 12, 150, 70),
  yeast: R(325, 40, 41, 7.6, 500),

  // legumes, nuts, seeds
  chickpeas: R(139, 7, 18, 2.6, 30),
  "kidney beans": R(127, 8.7, 22, 0.5, 30),
  "black beans": R(132, 8.9, 24, 0.5, 35),
  "borlotti beans": R(150, 10, 27, 0.5, 35, 400),
  "brown lentils": R(353, 25, 60, 1.1, 50),
  "toor dal": R(343, 22, 63, 1.5, 60),
  "broad beans": R(88, 7.9, 12, 0.6, 60),
  "soya bean": R(173, 17, 10, 9, 80),
  peanuts: R(567, 26, 16, 49, 100),
  cashews: R(553, 18, 30, 44, 300),
  "pecan nuts": R(691, 9, 14, 72, 450),
  "sesame seed": R(573, 18, 23, 50, 150),
  "desiccated coconut": R(660, 7, 24, 64, 120),
  tahini: R(595, 17, 21, 54, 150),

  // vegetables
  onion: R(40, 1.1, 9.3, 0.1, 30, 150),
  "red onion": R(40, 1.1, 9.3, 0.1, 40, 150),
  "spring onion": R(32, 1.8, 7.3, 0.2, 100, 15),
  shallot: R(72, 2.5, 17, 0.1, 150, 25),
  garlic: R(149, 6.4, 33, 0.5, 200, 5),
  ginger: R(80, 1.8, 18, 0.8, 250, 15),
  "pak choy": R(13, 1.5, 2.2, 0.2, 120, 150),
  galangal: R(70, 1, 15, 0.6, 400, 15),
  lemongrass: R(99, 1.8, 25, 0.5, 300, 20),
  carrot: R(41, 0.9, 10, 0.2, 25, 120),
  potato: R(77, 2, 17, 0.1, 30, 200),
  "sweet potato": R(86, 1.6, 20, 0.1, 50, 250),
  tomato: R(18, 0.9, 3.9, 0.2, 60, 120),
  "vine tomatoes": R(18, 0.9, 3.9, 0.2, 80, 100),
  "cherry tomatoes": R(18, 0.9, 3.9, 0.2, 110, 15),
  "canned tomatoes": R(32, 1.6, 7, 0.3, 30, 400),
  passata: R(29, 1.4, 5.5, 0.2, 35),
  capsicum: R(26, 1, 6, 0.3, 100, 160),
  chilli: R(40, 1.9, 9, 0.4, 250, 10),
  "ancho chillies": R(280, 12, 51, 8, 900, 8),
  aubergine: R(25, 1, 6, 0.2, 60, 300),
  courgette: R(17, 1.2, 3.1, 0.3, 60, 200),
  mushrooms: R(22, 3.1, 3.3, 0.3, 140),
  "oyster mushrooms": R(33, 3.3, 6, 0.4, 300),
  "shiitake mushrooms": R(34, 2.2, 7, 0.5, 400, 15),
  spinach: R(23, 2.9, 3.6, 0.4, 150),
  broccoli: R(34, 2.8, 7, 0.4, 70, 350),
  "chinese broccoli": R(22, 1.1, 3.8, 0.7, 120),
  "pak choi": R(13, 1.5, 2.2, 0.2, 120, 150),
  cabbage: R(25, 1.3, 6, 0.1, 25, 900),
  lettuce: R(15, 1.4, 2.9, 0.2, 80, 300),
  "little gem lettuce": R(15, 1.4, 2.9, 0.2, 150, 150),
  rocket: R(25, 2.6, 3.7, 0.7, 300),
  celery: R(16, 0.7, 3, 0.2, 30, 40),
  celeriac: R(42, 1.5, 9, 0.3, 60),
  leek: R(61, 1.5, 14, 0.3, 80, 250),
  "fennel bulb": R(31, 1.2, 7, 0.2, 100, 250),
  "butternut squash": R(45, 1, 12, 0.1, 40, 1000),
  squash: R(45, 1, 12, 0.1, 40, 1000),
  "jerusalem artichokes": R(73, 2, 17, 0, 150),
  asparagus: R(20, 2.2, 3.9, 0.1, 400),
  peas: R(81, 5.4, 14, 0.4, 40),
  "green beans": R(31, 1.8, 7, 0.2, 100),
  "sugar snap peas": R(42, 2.8, 7.6, 0.2, 200),
  "bean sprouts": R(30, 3, 6, 0.2, 80),
  sweetcorn: R(86, 3.3, 19, 1.4, 50),
  cucumber: R(15, 0.7, 3.6, 0.1, 40, 300),
  avocado: R(160, 2, 9, 15, 120, 170),
  "cooked beetroot": R(44, 1.7, 10, 0.2, 80),
  "water chestnut": R(97, 1.4, 24, 0.1, 100),
  "dill pickles": R(12, 0.5, 2.3, 0.2, 80, 60),
  "pitted black olives": R(115, 0.8, 6, 11, 200),
  "black olives": R(115, 0.8, 6, 11, 200),
  capers: R(23, 2.4, 4.9, 0.9, 400),

  // fruit
  lemon: R(29, 1.1, 9, 0.3, 80, 100),
  lime: R(30, 0.7, 11, 0.2, 100, 65),
  "lemon juice": R(22, 0.4, 7, 0.2, 80),
  "lemon zest": R(47, 1.5, 16, 0.3, 80, 5),
  banana: R(89, 1.1, 23, 0.3, 40, 120),
  "braeburn apples": R(52, 0.3, 14, 0.2, 50, 180),
  apricot: R(241, 3.4, 63, 0.5, 200),
  blackberries: R(43, 1.4, 10, 0.5, 500),
  blueberries: R(57, 0.7, 14, 0.3, 500, 2),
  raspberries: R(52, 1.2, 12, 0.7, 600, 4),
  strawberries: R(32, 0.7, 7.7, 0.3, 300),

  // pantry, sauces, sweet
  "olive oil": R(884, 0, 0, 100, 150, undefined, 0.92),
  "vegetable oil": R(884, 0, 0, 100, 60, undefined, 0.92),
  "sesame oil": R(884, 0, 0, 100, 250, undefined, 0.92),
  "goose fat": R(900, 0, 0, 100, 400),
  "coconut milk": R(197, 2, 2.8, 21, 50, undefined, 1.0),
  "coconut cream": R(330, 3.6, 6.7, 35, 70, undefined, 1.0),
  "chicken stock": R(4, 0.6, 0.3, 0.1, 15),
  "beef stock": R(5, 0.8, 0.2, 0.1, 15),
  "vegetable stock": R(5, 0.2, 0.9, 0.1, 15),
  "soy sauce": R(53, 8, 4.9, 0.6, 60, undefined, 1.2),
  "dark soy sauce": R(80, 6, 14, 0, 70, undefined, 1.2),
  "fish sauce": R(35, 5, 3.6, 0, 70, undefined, 1.2),
  "oyster sauce": R(51, 1.4, 11, 0.3, 80, undefined, 1.2),
  "hoisin sauce": R(220, 3.3, 44, 3.4, 100),
  "sweet chilli sauce": R(230, 0.4, 56, 0.2, 80),
  "worcestershire sauce": R(78, 0, 19, 0, 100),
  "tomato ketchup": R(112, 1.7, 26, 0.1, 50),
  "tomato puree": R(82, 4.3, 19, 0.5, 120),
  "white vinegar": R(18, 0, 0.04, 0, 20),
  "white wine vinegar": R(19, 0, 0.3, 0, 60),
  "red wine vinegar": R(19, 0, 0.3, 0, 60),
  "rice vinegar": R(18, 0, 0.1, 0, 70),
  "apple cider vinegar": R(21, 0, 0.9, 0, 60),
  "balsamic vinegar": R(88, 0.5, 17, 0, 150),
  mirin: R(241, 0.2, 43, 0, 120),
  sake: R(134, 0.5, 5, 0, 150),
  "dry sherry": R(117, 0.2, 1.4, 0, 150),
  "dry white wine": R(82, 0.1, 2.6, 0, 120),
  "white wine": R(82, 0.1, 2.6, 0, 120),
  "red wine": R(85, 0.1, 2.6, 0, 120),
  brandy: R(231, 0, 0, 0, 400),
  "ginger cordial": R(250, 0, 62, 0, 80),
  "tamarind paste": R(239, 2.8, 63, 0.6, 150),
  "shrimp paste": R(254, 35, 11, 3, 300),
  doubanjiang: R(180, 9, 18, 7, 200),
  "fermented black beans": R(250, 18, 20, 9, 200),
  "thai green curry paste": R(140, 2.6, 13, 9, 300),
  "thai red curry paste": R(140, 2.6, 13, 9, 300),
  "panang curry paste": R(160, 3, 14, 10, 300),
  "massaman curry paste": R(170, 3, 16, 10, 300),
  "madras paste": R(170, 3, 12, 12, 250),
  "galangal paste": R(90, 1.5, 18, 1, 400),
  "ginger paste": R(90, 1.5, 18, 1, 250),
  salsa: R(36, 1.5, 7, 0.2, 100),
  "soured cream and chive dip": R(330, 2.5, 4, 33, 150),
  honey: R(304, 0.3, 82, 0, 120),
  "golden syrup": R(325, 0.3, 81, 0, 60),
  "black treacle": R(290, 1.2, 74, 0, 80),
  sugar: R(387, 0, 100, 0, 15),
  "brown sugar": R(380, 0.1, 98, 0, 25),
  "palm sugar": R(375, 0, 94, 0.2, 100),
  "icing sugar": R(389, 0, 100, 0, 30),
  "dark chocolate": R(546, 4.9, 61, 31, 250),
  "milk chocolate": R(535, 7.6, 59, 30, 200),
  "cocoa powder": R(228, 20, 58, 14, 300),
  "raspberry jam": R(250, 0.4, 65, 0.1, 80),
  "vanilla extract": R(288, 0.1, 13, 0.1, 2000),
  "baking powder": R(53, 0, 28, 0, 200),
  "bicarbonate of soda": R(0, 0, 0, 0, 150),

  // herbs and spices (small amounts; cost is what you'd use, not the jar)
  coriander: R(23, 2.1, 3.7, 0.5, 450),
  parsley: R(36, 3, 6, 0.8, 450),
  basil: R(23, 3.2, 2.7, 0.6, 500),
  mint: R(70, 3.8, 15, 0.9, 500),
  dill: R(43, 3.5, 7, 1.1, 500),
  chives: R(30, 3.3, 4.4, 0.7, 500),
  thyme: R(101, 5.6, 24, 1.7, 900),
  rosemary: R(131, 3.3, 21, 5.9, 900),
  oregano: R(265, 9, 69, 4.3, 900),
  "dried oregano": R(265, 9, 69, 4.3, 900),
  "bay leaf": R(313, 7.6, 75, 8.4, 2000, 0.2),
  "lime leaves": R(30, 1, 7, 0.3, 2000, 0.3),
  "bouquet garni": R(100, 3, 20, 2, 2000, 5),
  "black pepper": R(251, 10, 64, 3.3, 600),
  salt: R(0, 0, 0, 0, 10),
  "ground cumin": R(375, 18, 44, 22, 600),
  "cumin seeds": R(375, 18, 44, 22, 600),
  "ground coriander": R(298, 12, 55, 18, 600),
  "coriander seeds": R(298, 12, 55, 18, 600),
  turmeric: R(312, 9.7, 67, 3.3, 600),
  paprika: R(282, 14, 54, 13, 600),
  "smoked paprika": R(282, 14, 54, 13, 700),
  "cayenne pepper": R(318, 12, 57, 17, 700, 1),
  "chilli powder": R(282, 13, 50, 14, 600),
  "red chilli flakes": R(318, 12, 57, 17, 700),
  "garam masala": R(379, 15, 45, 15, 700),
  "curry powder": R(325, 14, 58, 14, 600),
  cinnamon: R(247, 4, 81, 1.2, 600),
  "cinnamon stick": R(247, 4, 81, 1.2, 600, 3),
  cardamom: R(311, 11, 68, 6.7, 1500, 0.2),
  cloves: R(274, 6, 66, 13, 1200, 0.1),
  allspice: R(263, 6, 72, 8.7, 1000),
  nutmeg: R(525, 5.8, 49, 36, 1200),
  "star anise": R(337, 18, 50, 16, 1500, 0.5),
  "fennel seeds": R(345, 16, 52, 15, 700),
  fenugreek: R(323, 23, 58, 6.4, 700),
  "mustard seeds": R(508, 26, 28, 36, 600),
  "sichuan pepper": R(296, 6, 66, 9, 1500),
  saffron: R(310, 11, 65, 6, 150000),
  "chinese five spice powder": R(350, 10, 65, 9, 800),
  "italian seasoning": R(265, 9, 69, 4.3, 800),
  "harissa spice": R(300, 12, 50, 12, 800),
  cajun: R(300, 12, 55, 8, 800),
  "ground ginger": R(335, 9, 72, 4.2, 700),
  horseradish: R(48, 1.2, 11, 0.7, 300),
  water: R(0, 0, 0, 0, 0),
};

// Grams in one unit, for units that aren't a weight. Volumes are millilitres
// and become grams through the food's density.
const ML_PER: Record<string, number> = { cup: 250, tbsp: 15, tsp: 5, ml: 1 };
const GRAMS_PER: Record<string, number> = {
  g: 1, pinch: 0.4, handful: 30, bunch: 60, clove: 5, stick: 40, slice: 25, sprig: 1,
  leaf: 0.5, can: 400, pack: 250, jar: 300, cm: 5,
};
// A handful or bunch of leaves weighs far less than a handful of nuts.
const LEAFY = /coriander|parsley|basil|mint|dill|chives|thyme|rosemary|oregano|rocket|spinach|lettuce|herb/;
const LEAFY_GRAMS: Record<string, number> = { handful: 10, bunch: 40 };

// No single line costs more than its typical pack: a recipe that says "a
// bunch of coriander" costs the bunch, not a kilo-rate share of it.
const PACK_CENTS: Record<string, number> = {
  saffron: 600, "vanilla extract": 400, cardamom: 300, cloves: 250, "star anise": 300,
};
// A cup of a dry food weighs less than a cup of water.
const CUP_GRAMS: Record<string, number> = {
  rice: 185, "jasmine rice": 185, "basmati rice": 185, "plain flour": 125, sugar: 200, "brown sugar": 200,
  butter: 227, parmesan: 100, peas: 145, onion: 160, mushrooms: 70, "chinese broccoli": 90, chicken: 140,
  cashews: 140, peanuts: 145, "brown lentils": 190, "toor dal": 200, macaroni: 105, quinoa: 170,
  "bean sprouts": 100, sweetcorn: 165, "shredded mexican cheese": 113, "potato starch": 160, tahini: 240,
  "tamarind paste": 280, "canned tomatoes": 240, lemon: 240,
};

export interface IngredientLine {
  name: string;
  quantity: number | null;
  unit: string;
}

function lookup(name: string): Ref | undefined {
  const n = name.toLowerCase().trim();
  if (FOODS[n]) return FOODS[n];
  let best: string | undefined;
  for (const key of Object.keys(FOODS)) {
    if (n.includes(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? FOODS[best] : undefined;
}

// Grams of an ingredient line, or null when it can't be weighed ("salt to taste").
export function gramsOf(line: IngredientLine): number | null {
  if (line.quantity === null || line.quantity <= 0) return null;
  const ref = lookup(line.name);
  const unit = line.unit.toLowerCase();
  if (unit === "" || unit === "each") return ref?.each ? line.quantity * ref.each : null;
  if (unit === "cup" && CUP_GRAMS[line.name]) return line.quantity * CUP_GRAMS[line.name];
  if (unit in LEAFY_GRAMS && LEAFY.test(line.name)) return line.quantity * LEAFY_GRAMS[unit];
  if (unit in ML_PER) return line.quantity * ML_PER[unit] * (ref?.density ?? 1);
  if (unit in GRAMS_PER) return line.quantity * GRAMS_PER[unit];
  if (unit === "kg") return line.quantity * 1000;
  if (unit === "l") return line.quantity * 1000 * (ref?.density ?? 1);
  return null;
}

export interface Nutrition {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  // whole recipe, cents
  costCents: number;
  // how many ingredient lines fed the numbers, out of how many
  counted: number;
  total: number;
}

export function estimate(lines: IngredientLine[]): Nutrition {
  const out: Nutrition = { kcal: 0, protein: 0, carbs: 0, fat: 0, costCents: 0, counted: 0, total: lines.length };
  for (const line of lines) {
    const ref = lookup(line.name);
    const g = gramsOf(line);
    if (!ref || g === null) continue;
    const k = g / 100;
    out.kcal += ref.kcal * k;
    out.protein += ref.p * k;
    out.carbs += ref.c * k;
    out.fat += ref.f * k;
    const cap = PACK_CENTS[line.name.toLowerCase()];
    out.costCents += cap === undefined ? ref.cents * k : Math.min(cap, ref.cents * k);
    out.counted++;
  }
  return out;
}

export function perServing(n: Nutrition, servings: number): Nutrition {
  const s = Math.max(1, servings);
  return {
    ...n,
    kcal: n.kcal / s,
    protein: n.protein / s,
    carbs: n.carbs / s,
    fat: n.fat / s,
    costCents: n.costCents / s,
  };
}
