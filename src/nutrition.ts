import { readFileSync } from "node:fs";

// Automatic nutrition and cost for any recipe, the catalogue's and the ones
// people write themselves. Nutrition is per 100 g (kcal, protein, carbs,
// fat) from public food-composition tables (USDA FoodData Central style
// values), rounded. Prices are reference prices in src/data/prices.json:
// Australian supermarket prices per 100 g, each with its source and the
// month it was checked. Both are estimates by design: pages label them as
// such, nothing here is a live price, and unknown ingredients count as zero
// rather than guessing.

interface Ref {
  kcal: number;
  p: number;
  c: number;
  f: number;
  // grams in one "each" (an egg, an onion), when it has no unit
  each?: number;
  // grams per millilitre, for liquids measured by volume (default 1)
  density?: number;
}

const R = (kcal: number, p: number, c: number, f: number, each?: number, density?: number): Ref => ({
  kcal, p, c, f, each, density,
});

// Keys are canonical names (src/data/catalogue.json uses the same ones).
// Matching falls back to the longest key found as whole words in the name,
// so "red onion" and "spring onion" find their own rows, "baby spinach"
// finds "spinach", and "rum" never matches "crumbs".
const FOODS: Record<string, Ref> = {
  // poultry and meat
  "chicken thigh": R(177, 24, 0, 9, 110),
  "chicken breast": R(120, 23, 0, 2.6, 200),
  "chicken legs": R(185, 20, 0, 11, 250),
  "chicken drumsticks": R(172, 19, 0, 10, 110),
  "chicken wings": R(203, 18, 0, 14, 90),
  "chicken livers": R(119, 17, 0.7, 4.8, 40),
  chicken: R(165, 25, 0, 7, 1500),
  "beef mince": R(250, 26, 0, 17),
  "beef shin": R(150, 21, 0, 7, 300),
  "beef brisket": R(250, 19, 0, 19, 1500),
  "beef fillet": R(180, 27, 0, 8, 200),
  "sirloin steak": R(200, 26, 0, 10, 250),
  "flank steak": R(165, 25, 0, 6.5, 400),
  "chuck steak": R(210, 20, 0, 14),
  "beef schnitzel": R(180, 25, 0, 8, 150),
  oxtail: R(262, 30, 0, 15),
  beef: R(190, 26, 0, 9),
  veal: R(150, 22, 0, 6, 150),
  "lamb mince": R(282, 17, 0, 23),
  "lamb leg": R(230, 20, 0, 16, 2000),
  "lamb leg steaks": R(200, 21, 0, 12, 150),
  "lamb chops": R(280, 18, 0, 23, 90),
  "lamb shanks": R(200, 19, 0, 13, 400),
  "lamb kidney": R(97, 16, 0.8, 3, 60),
  lamb: R(230, 20, 0, 16),
  goat: R(143, 27, 0, 3),
  "pork mince": R(263, 17, 0, 21),
  "pork chops": R(230, 24, 0, 14, 200),
  "pork belly": R(518, 9, 0, 53),
  "pork fillet": R(143, 21, 0, 6, 400),
  "pork ribs": R(277, 16, 0, 23),
  "pork shoulder": R(250, 17, 0, 20),
  pork: R(242, 27, 0, 14, 150),
  ham: R(145, 21, 1.5, 6, 20),
  prosciutto: R(250, 28, 0, 15, 15),
  bacon: R(417, 13, 1, 40, 25),
  chorizo: R(455, 24, 2, 38, 100),
  "smoked sausage": R(300, 13, 3, 26, 100),
  "black pudding": R(379, 15, 1.3, 35, 50),
  sausages: R(300, 13, 4, 26, 70),
  "italian fennel sausages": R(300, 14, 3, 26, 80),
  "turkey mince": R(170, 20, 0, 9.5),
  turkey: R(135, 29, 0, 1.5),
  "duck legs": R(337, 19, 0, 28, 250),
  "frog legs": R(73, 16, 0, 0.3),

  // seafood
  "salmon fillet": R(208, 20, 0, 13, 150),
  "smoked salmon": R(117, 18, 0, 4.3, 25),
  prawns: R(99, 24, 0.2, 0.3, 12),
  "white fish": R(90, 20, 0, 1, 140),
  tuna: R(116, 26, 0, 1),
  mussels: R(86, 12, 4, 2.2, 20),
  clams: R(74, 13, 2.6, 1),
  squid: R(92, 16, 3, 1.4, 200),
  "anchovy fillet": R(210, 29, 0, 10, 4),
  "salt cod": R(290, 63, 0, 2.4, 200),
  "smoked haddock": R(101, 23, 0, 0.9),
  haddock: R(90, 20, 0, 0.6, 150),
  cod: R(82, 18, 0, 0.7, 150),
  "sea bass": R(97, 18, 0, 2, 150),
  barramundi: R(100, 20, 0, 2),
  snapper: R(100, 21, 0, 1.3, 150),
  trout: R(141, 20, 0, 6, 250),
  sardines: R(208, 25, 0, 11, 25),
  mackerel: R(205, 19, 0, 14, 150),
  herring: R(158, 18, 0, 9, 100),
  monkfish: R(76, 15, 0, 1.5, 200),
  hake: R(90, 18, 0, 1.4, 150),
  "crab meat": R(83, 18, 0, 0.7),
  lobster: R(89, 19, 0, 0.9, 150),
  oysters: R(68, 7, 4, 2.5, 15),
  conch: R(130, 26, 1.7, 1.2),
  "seafood mix": R(85, 17, 1.5, 1),
  "dried shrimp": R(296, 59, 2, 4),

  // plant proteins
  tofu: R(144, 15, 3, 8, 300),
  "silken tofu": R(55, 5, 2, 2.7, 300),
  "marinated tofu": R(160, 15, 5, 9),
  tempeh: R(192, 20, 8, 11),
  falafel: R(333, 13, 32, 18, 20),

  // eggs and dairy
  eggs: R(143, 13, 0.7, 10, 55),
  "egg yolks": R(322, 16, 3.6, 27, 17),
  "egg whites": R(52, 11, 0.7, 0.2, 33),
  milk: R(64, 3.4, 4.8, 3.6, undefined, 1.03),
  buttermilk: R(40, 3.3, 4.8, 0.9, undefined, 1.03),
  "plant milk": R(40, 3, 2, 2, undefined, 1.03),
  butter: R(717, 0.9, 0.1, 81),
  "vegan butter": R(700, 0, 0, 78),
  ghee: R(900, 0, 0, 100),
  cream: R(340, 2.1, 2.8, 36, undefined, 1.0),
  "creme fraiche": R(292, 2.4, 2.6, 30),
  "sour cream": R(198, 2.4, 4.6, 19),
  "cream cheese": R(342, 6, 4, 34),
  mascarpone: R(429, 4.6, 4.8, 44),
  ricotta: R(174, 11, 3, 13),
  "cottage cheese": R(98, 11, 3.4, 4.3),
  "greek yoghurt": R(97, 9, 4, 5, undefined, 1.05),
  yoghurt: R(61, 3.5, 4.7, 3.3, undefined, 1.05),
  "fromage frais": R(113, 6.8, 4.4, 7.1),
  parmesan: R(431, 38, 4, 29),
  pecorino: R(387, 32, 3.6, 27),
  "gruyère": R(413, 30, 0.4, 32),
  mozzarella: R(280, 22, 2.2, 21, 125),
  feta: R(264, 14, 4, 21),
  "goat's cheese": R(364, 22, 0.1, 30),
  "cheddar cheese": R(403, 25, 1.3, 33),
  "swiss cheese": R(380, 27, 1.5, 28, 20),
  gouda: R(356, 25, 2.2, 27),
  brie: R(334, 21, 0.5, 28),
  stilton: R(410, 24, 0.1, 35),
  manchego: R(390, 26, 0.5, 32),
  halloumi: R(321, 22, 2, 25),
  "monterey jack cheese": R(373, 24, 0.7, 30, 20),
  "shredded mexican cheese": R(380, 24, 2, 31),
  cheese: R(403, 25, 1.3, 33, 20),
  paneer: R(296, 21, 3.6, 22),
  "ice cream": R(207, 3.5, 24, 11, 70),
  "condensed milk": R(321, 7.9, 54, 8.7),
  "evaporated milk": R(134, 6.8, 10, 7.6),
  "dulce de leche": R(315, 7, 55, 7.4),
  custard: R(122, 3.5, 17, 4.4),
  "clotted cream": R(586, 1.6, 2.3, 64),

  // grains, pasta, bread, baking (dry weights: recipes list them uncooked)
  rice: R(360, 6.6, 80, 0.6),
  "jasmine rice": R(360, 6.6, 80, 0.6),
  "basmati rice": R(355, 7.5, 78, 0.6),
  "sushi rice": R(358, 6.5, 79, 0.5),
  "paella rice": R(350, 7, 78, 0.6),
  "arborio rice": R(350, 7, 78, 0.6),
  "glutinous rice": R(370, 6.8, 81, 0.6),
  "pudding rice": R(358, 6.5, 79, 0.5),
  "brown rice": R(362, 7.5, 76, 2.7),
  "rice noodles": R(364, 6, 80, 0.6),
  "egg noodles": R(384, 14, 71, 4.4),
  noodles: R(384, 14, 71, 4.4, 70),
  "udon noodles": R(140, 3.5, 29, 0.6, 200),
  spaghetti: R(371, 13, 75, 1.5),
  fettuccine: R(371, 13, 75, 1.5),
  "linguine pasta": R(371, 13, 75, 1.5),
  rigatoni: R(371, 13, 75, 1.5),
  "penne rigate": R(371, 13, 75, 1.5),
  macaroni: R(371, 13, 75, 1.5),
  farfalle: R(371, 13, 75, 1.5),
  "vermicelli pasta": R(371, 13, 75, 1.5),
  pasta: R(371, 13, 75, 1.5),
  "lasagne sheets": R(371, 13, 75, 1.5, 20),
  couscous: R(376, 13, 77, 0.6),
  "bulgur wheat": R(342, 12, 76, 1.3),
  quinoa: R(368, 14, 64, 6),
  buckwheat: R(343, 13, 72, 3.4),
  "dried hominy": R(365, 9, 74, 4.7),
  cornmeal: R(370, 8, 79, 3.6),
  semolina: R(360, 13, 73, 1),
  "rolled oats": R(389, 17, 66, 7),
  "porridge oats": R(389, 17, 66, 7),
  "plain flour": R(364, 10, 76, 1),
  "self-raising flour": R(354, 10, 74, 1.2),
  "bread flour": R(361, 12, 73, 1.7),
  "wholemeal flour": R(340, 13, 72, 2.5),
  "rice flour": R(366, 6, 80, 1.4),
  "chickpea flour": R(387, 22, 58, 6.7),
  "rye flour": R(325, 10, 69, 1.6),
  "buckwheat flour": R(335, 13, 71, 3.1),
  "cassava flour": R(357, 0.2, 88, 0),
  "tempura flour": R(360, 9, 78, 1),
  "ground almonds": R(579, 21, 22, 50),
  cornflour: R(381, 0.3, 91, 0.1),
  "potato starch": R(357, 0.1, 83, 0.1),
  starch: R(381, 0.3, 91, 0.1),
  tapioca: R(358, 0.2, 89, 0),
  breadcrumbs: R(395, 13, 72, 5),
  "bread rolls": R(280, 9, 50, 4.3, 60),
  bread: R(265, 9, 49, 3.2, 40),
  baguette: R(270, 9, 55, 1.5, 250),
  ciabatta: R(271, 9, 50, 3.5, 300),
  "pita bread": R(275, 9, 56, 1.2, 60),
  "naan bread": R(310, 9, 50, 8, 90),
  "english muffins": R(227, 9, 44, 1.7, 60),
  "flour tortilla": R(306, 8, 50, 8, 45),
  "corn tortillas": R(218, 5.7, 45, 2.9, 26),
  "taco shells": R(468, 6, 63, 22, 13),
  "puff pastry": R(551, 7.4, 45, 38, 160),
  "shortcrust pastry": R(527, 6.5, 55, 32, 160),
  "filo pastry": R(299, 7, 53, 6, 20),
  "kataifi pastry": R(330, 9, 60, 5),
  "digestive biscuits": R(480, 7, 63, 21, 15),
  "chocolate sandwich biscuits": R(470, 5, 69, 20, 11),
  "meringue nests": R(390, 5, 93, 0, 12),
  "wonton skin": R(291, 9.8, 58, 1.5, 8),
  "egg rolls": R(250, 6, 30, 12, 70),
  "spring roll wrappers": R(290, 8, 60, 1.5, 15),
  "rice paper sheets": R(330, 6, 80, 0.5, 9),
  yeast: R(325, 40, 41, 7.6, 7),
  gelatine: R(335, 86, 0, 0, 2),
  "baking powder": R(53, 0, 28, 0),
  "bicarbonate of soda": R(0, 0, 0, 0),
  "cream of tartar": R(258, 0, 62, 0),
  "custard powder": R(350, 0.5, 87, 0.5),

  // legumes, nuts, seeds (cooked/canned weight for beans, dry for lentils)
  chickpeas: R(139, 7, 18, 2.6),
  "kidney beans": R(127, 8.7, 22, 0.5),
  "black beans": R(132, 8.9, 24, 0.5),
  "cannellini beans": R(110, 7.5, 18, 0.5),
  "butter beans": R(105, 7, 18, 0.4),
  "borlotti beans": R(150, 10, 27, 0.5, 400),
  "pinto beans": R(143, 9, 26, 0.7),
  "black-eyed peas": R(336, 24, 60, 1.3),
  "baked beans": R(94, 4.8, 15, 0.4),
  "refried beans": R(91, 5.5, 15, 1.2),
  "brown lentils": R(353, 25, 60, 1.1),
  "red lentils": R(358, 24, 63, 2.2),
  "toor dal": R(343, 22, 63, 1.5),
  "yellow split peas": R(341, 25, 60, 1.2),
  "broad beans": R(88, 7.9, 12, 0.6),
  "soya bean": R(173, 17, 10, 9),
  peanuts: R(567, 26, 16, 49),
  "peanut butter": R(588, 25, 20, 50),
  cashews: R(553, 18, 30, 44),
  almonds: R(579, 21, 22, 50, 1.2),
  walnuts: R(654, 15, 14, 65, 4),
  "pecan nuts": R(691, 9, 14, 72),
  pistachios: R(560, 20, 28, 45),
  hazelnuts: R(628, 15, 17, 61, 1.5),
  "pine nuts": R(673, 14, 13, 68),
  chestnuts: R(196, 1.6, 44, 1.3, 10),
  "sesame seed": R(573, 18, 23, 50),
  "poppy seeds": R(525, 18, 28, 42),
  "desiccated coconut": R(660, 7, 24, 64),
  tahini: R(595, 17, 21, 54),
  marzipan: R(458, 9, 57, 23),
  hummus: R(166, 8, 14, 9.6),

  // vegetables
  onion: R(40, 1.1, 9.3, 0.1, 150),
  "red onion": R(40, 1.1, 9.3, 0.1, 150),
  "spring onion": R(32, 1.8, 7.3, 0.2, 15),
  shallot: R(72, 2.5, 17, 0.1, 25),
  leek: R(61, 1.5, 14, 0.3, 250),
  garlic: R(149, 6.4, 33, 0.5, 5),
  ginger: R(80, 1.8, 18, 0.8, 15),
  galangal: R(70, 1, 15, 0.6, 15),
  lemongrass: R(99, 1.8, 25, 0.5, 20),
  carrot: R(41, 0.9, 10, 0.2, 120),
  potato: R(77, 2, 17, 0.1, 200),
  "baby potatoes": R(70, 1.7, 16, 0.1, 50),
  "sweet potato": R(86, 1.6, 20, 0.1, 250),
  tomato: R(18, 0.9, 3.9, 0.2, 120),
  "vine tomatoes": R(18, 0.9, 3.9, 0.2, 100),
  "cherry tomatoes": R(18, 0.9, 3.9, 0.2, 15),
  "canned tomatoes": R(32, 1.6, 7, 0.3, 400),
  passata: R(29, 1.4, 5.5, 0.2),
  "tomato puree": R(82, 4.3, 19, 0.5),
  "sun-dried tomatoes": R(213, 5, 23, 14),
  capsicum: R(26, 1, 6, 0.3, 160),
  "roasted capsicum": R(30, 1, 5, 0.5, 80),
  chilli: R(40, 1.9, 9, 0.4, 10),
  "dried chillies": R(324, 12, 70, 6, 1),
  "ancho chillies": R(280, 12, 51, 8, 8),
  "scotch bonnet": R(40, 1.9, 9, 0.4, 10),
  "jalapeño": R(29, 0.9, 6.5, 0.4, 15),
  aubergine: R(25, 1, 6, 0.2, 300),
  courgette: R(17, 1.2, 3.1, 0.3, 200),
  mushrooms: R(22, 3.1, 3.3, 0.3, 20),
  "oyster mushrooms": R(33, 3.3, 6, 0.4),
  "shiitake mushrooms": R(34, 2.2, 7, 0.5, 15),
  spinach: R(23, 2.9, 3.6, 0.4),
  "water spinach": R(19, 2.6, 3.1, 0.2),
  kale: R(49, 4.3, 9, 0.9),
  broccoli: R(34, 2.8, 7, 0.4, 350),
  "chinese broccoli": R(22, 1.1, 3.8, 0.7),
  "pak choi": R(13, 1.5, 2.2, 0.2, 150),
  "pak choy": R(13, 1.5, 2.2, 0.2, 150),
  "chinese cabbage": R(16, 1.2, 3.2, 0.2, 1000),
  cabbage: R(25, 1.3, 6, 0.1, 900),
  lettuce: R(15, 1.4, 2.9, 0.2, 300),
  "little gem lettuce": R(15, 1.4, 2.9, 0.2, 150),
  rocket: R(25, 2.6, 3.7, 0.7),
  celery: R(16, 0.7, 3, 0.2, 40),
  celeriac: R(42, 1.5, 9, 0.3, 700),
  "fennel bulb": R(31, 1.2, 7, 0.2, 250),
  "butternut squash": R(45, 1, 12, 0.1, 1000),
  squash: R(45, 1, 12, 0.1, 1000),
  pumpkin: R(26, 1, 6.5, 0.1, 1000),
  "jerusalem artichokes": R(73, 2, 17, 0),
  asparagus: R(20, 2.2, 3.9, 0.1, 20),
  peas: R(81, 5.4, 14, 0.4),
  "green beans": R(31, 1.8, 7, 0.2),
  "snow peas": R(42, 2.8, 7.6, 0.2),
  "sugar snap peas": R(42, 2.8, 7.6, 0.2),
  "bean sprouts": R(30, 3, 6, 0.2),
  sweetcorn: R(86, 3.3, 19, 1.4, 150),
  "corn cob": R(86, 3.3, 19, 1.4, 150),
  "creamed corn": R(72, 1.7, 18, 0.4),
  cucumber: R(15, 0.7, 3.6, 0.1, 300),
  avocado: R(160, 2, 9, 15, 170),
  beetroot: R(43, 1.6, 10, 0.2, 150),
  "cooked beetroot": R(44, 1.7, 10, 0.2),
  parsnip: R(75, 1.2, 18, 0.3, 150),
  turnip: R(28, 0.9, 6.4, 0.1, 150),
  swede: R(37, 1.1, 8.6, 0.2, 500),
  radish: R(16, 0.7, 3.4, 0.1, 10),
  daikon: R(18, 0.6, 4.1, 0.1, 400),
  "water chestnut": R(97, 1.4, 24, 0.1),
  "bamboo shoots": R(27, 2.6, 5.2, 0.3),
  cassava: R(160, 1.4, 38, 0.3, 400),
  plantain: R(122, 1.3, 32, 0.4, 250),
  yam: R(118, 1.5, 28, 0.2, 400),
  "green papaya": R(39, 0.6, 10, 0.1, 500),
  "mixed vegetables": R(65, 3, 13, 0.4),
  "stir-fry vegetables": R(35, 2, 6, 0.3),
  "dill pickles": R(12, 0.5, 2.3, 0.2, 60),
  sauerkraut: R(19, 0.9, 4.3, 0.1),
  "pitted black olives": R(115, 0.8, 6, 11, 4),
  "black olives": R(115, 0.8, 6, 11, 4),
  "green olives": R(145, 1, 3.8, 15, 4),
  capers: R(23, 2.4, 4.9, 0.9),
  "vine leaves": R(93, 5.6, 17, 2.1, 3),

  // fruit
  lemon: R(29, 1.1, 9, 0.3, 100),
  lime: R(30, 0.7, 11, 0.2, 65),
  "lemon juice": R(22, 0.4, 7, 0.2, 30),
  "lime juice": R(25, 0.4, 8, 0.1, 20),
  "lemon zest": R(47, 1.5, 16, 0.3, 5),
  orange: R(47, 0.9, 12, 0.1, 180),
  "orange juice": R(45, 0.7, 10, 0.2, 80),
  "orange zest": R(97, 1.5, 25, 0.2, 5),
  banana: R(89, 1.1, 23, 0.3, 120),
  apple: R(52, 0.3, 14, 0.2, 180),
  "braeburn apples": R(52, 0.3, 14, 0.2, 180),
  pear: R(57, 0.4, 15, 0.1, 180),
  peach: R(39, 0.9, 10, 0.3, 150),
  mango: R(60, 0.8, 15, 0.4, 300),
  pineapple: R(50, 0.5, 13, 0.1, 1000),
  rhubarb: R(21, 0.9, 4.5, 0.2),
  figs: R(74, 0.8, 19, 0.3, 50),
  cherries: R(63, 1.1, 16, 0.2, 8),
  apricot: R(241, 3.4, 63, 0.5, 8),
  "dried apricots": R(241, 3.4, 63, 0.5, 8),
  raisins: R(299, 3.1, 79, 0.5),
  dates: R(282, 2.5, 75, 0.4, 8),
  prunes: R(240, 2.2, 64, 0.4, 10),
  "dried cranberries": R(308, 0.2, 83, 1.1),
  "dried cherries": R(325, 2.5, 80, 0.7),
  "mixed peel": R(320, 0.3, 80, 0.3),
  "glacé cherries": R(320, 0.4, 80, 0.2, 5),
  blackberries: R(43, 1.4, 10, 0.5, 5),
  blueberries: R(57, 0.7, 14, 0.3, 2),
  raspberries: R(52, 1.2, 12, 0.7, 4),
  strawberries: R(32, 0.7, 7.7, 0.3, 15),
  "mixed berries": R(50, 1, 11, 0.4),
  "passionfruit pulp": R(97, 2.2, 23, 0.7, 20),
  pomegranate: R(83, 1.7, 19, 1.2, 250),

  // oils, fats, stock, sauces, condiments
  "olive oil": R(884, 0, 0, 100, undefined, 0.92),
  "vegetable oil": R(884, 0, 0, 100, undefined, 0.92),
  "sesame oil": R(884, 0, 0, 100, undefined, 0.92),
  "coconut oil": R(892, 0, 0, 99, undefined, 0.92),
  lard: R(902, 0, 0, 100),
  suet: R(854, 1.5, 0, 94),
  shortening: R(884, 0, 0, 100),
  "goose fat": R(900, 0, 0, 100),
  "coconut milk": R(197, 2, 2.8, 21, undefined, 1.0),
  "coconut cream": R(330, 3.6, 6.7, 35, undefined, 1.0),
  "chicken stock": R(4, 0.6, 0.3, 0.1, 250),
  "beef stock": R(5, 0.8, 0.2, 0.1, 250),
  "vegetable stock": R(5, 0.2, 0.9, 0.1, 250),
  "fish stock": R(8, 1.2, 0.4, 0.2),
  "stock cube": R(250, 12, 20, 14, 10),
  "soy sauce": R(53, 8, 4.9, 0.6, undefined, 1.2),
  "dark soy sauce": R(80, 6, 14, 0, undefined, 1.2),
  "fish sauce": R(35, 5, 3.6, 0, undefined, 1.2),
  "oyster sauce": R(51, 1.4, 11, 0.3, undefined, 1.2),
  "hoisin sauce": R(220, 3.3, 44, 3.4),
  "plum sauce": R(184, 0.9, 43, 1),
  "sweet chilli sauce": R(230, 0.4, 56, 0.2),
  "hot sauce": R(11, 0.5, 1.8, 0.4),
  "worcestershire sauce": R(78, 0, 19, 0),
  "tomato ketchup": R(112, 1.7, 26, 0.1),
  "barbecue sauce": R(172, 0.8, 41, 0.6),
  mayonnaise: R(680, 1, 0.6, 75),
  aioli: R(680, 1, 1, 74),
  vinaigrette: R(350, 0.2, 8, 35),
  mustard: R(66, 4, 5.3, 3.3),
  "mustard powder": R(508, 26, 28, 36),
  "white vinegar": R(18, 0, 0.04, 0),
  "white wine vinegar": R(19, 0, 0.3, 0),
  "red wine vinegar": R(19, 0, 0.3, 0),
  "rice vinegar": R(18, 0, 0.1, 0),
  "apple cider vinegar": R(21, 0, 0.9, 0),
  "sherry vinegar": R(20, 0, 0.5, 0),
  "malt vinegar": R(21, 0, 0.1, 0),
  "balsamic vinegar": R(88, 0.5, 17, 0),
  mirin: R(241, 0.2, 43, 0),
  sake: R(134, 0.5, 5, 0),
  "shaoxing wine": R(120, 1.5, 4, 0),
  "dry sherry": R(117, 0.2, 1.4, 0),
  "dry white wine": R(82, 0.1, 2.6, 0),
  "white wine": R(82, 0.1, 2.6, 0),
  "red wine": R(85, 0.1, 2.6, 0),
  beer: R(43, 0.5, 3.6, 0, 375),
  cider: R(49, 0, 5.5, 0),
  brandy: R(231, 0, 0, 0),
  rum: R(231, 0, 0, 0),
  "orange liqueur": R(320, 0, 30, 0),
  espresso: R(2, 0.1, 0, 0.2),
  "ginger cordial": R(250, 0, 62, 0),
  "fruit syrup": R(280, 0.5, 70, 0),
  "tamarind paste": R(239, 2.8, 63, 0.6),
  "shrimp paste": R(254, 35, 11, 3),
  doubanjiang: R(180, 9, 18, 7),
  gochujang: R(220, 4, 45, 2),
  "fermented black beans": R(250, 18, 20, 9),
  "thai green curry paste": R(140, 2.6, 13, 9),
  "thai red curry paste": R(140, 2.6, 13, 9),
  "red curry paste": R(140, 2.6, 13, 9),
  "panang curry paste": R(160, 3, 14, 10),
  "massaman curry paste": R(170, 3, 16, 10),
  "madras paste": R(170, 3, 12, 12),
  "red pepper paste": R(90, 3, 15, 1.5),
  harissa: R(130, 3, 12, 8),
  "galangal paste": R(90, 1.5, 18, 1),
  "ginger paste": R(90, 1.5, 18, 1),
  "ginger garlic paste": R(110, 3, 22, 1),
  salsa: R(36, 1.5, 7, 0.2),
  "soured cream and chive dip": R(330, 2.5, 4, 33),
  pesto: R(450, 5, 6, 45),
  horseradish: R(48, 1.2, 11, 0.7),
  jam: R(250, 0.4, 65, 0.1),
  "raspberry jam": R(250, 0.4, 65, 0.1),
  honey: R(304, 0.3, 82, 0),
  "golden syrup": R(325, 0.3, 81, 0),
  "maple syrup": R(260, 0, 67, 0.1, undefined, 1.32),
  molasses: R(290, 0, 75, 0.1),
  "black treacle": R(290, 1.2, 74, 0),
  sugar: R(387, 0, 100, 0),
  "brown sugar": R(380, 0.1, 98, 0),
  "palm sugar": R(375, 0, 94, 0.2),
  "icing sugar": R(389, 0, 100, 0),
  "dark chocolate": R(546, 4.9, 61, 31),
  "milk chocolate": R(535, 7.6, 59, 30),
  "white chocolate": R(539, 5.9, 59, 32),
  "chocolate chips": R(480, 4.2, 63, 24),
  "cocoa powder": R(228, 20, 58, 14),
  marshmallows: R(318, 1.8, 81, 0.2, 7),
  "vanilla extract": R(288, 0.1, 13, 0.1),
  "vanilla pod": R(288, 0.1, 13, 0.1, 5),
  "almond extract": R(288, 0, 13, 0),
  "food colouring": R(0, 0, 0, 0),

  // herbs and spices (small amounts; cost is what you'd use, not the jar)
  coriander: R(23, 2.1, 3.7, 0.5, 1),
  parsley: R(36, 3, 6, 0.8, 1),
  basil: R(23, 3.2, 2.7, 0.6, 0.5),
  mint: R(70, 3.8, 15, 0.9, 0.5),
  dill: R(43, 3.5, 7, 1.1),
  chives: R(30, 3.3, 4.4, 0.7),
  thyme: R(101, 5.6, 24, 1.7, 1),
  rosemary: R(131, 3.3, 21, 5.9, 1),
  sage: R(315, 11, 61, 13, 0.5),
  tarragon: R(295, 23, 50, 7, 1),
  oregano: R(265, 9, 69, 4.3),
  "dried oregano": R(265, 9, 69, 4.3),
  marjoram: R(271, 13, 60, 7),
  savory: R(272, 7, 69, 6),
  "dried mint": R(285, 20, 52, 6),
  "dried dill": R(253, 20, 56, 4.4),
  "italian seasoning": R(265, 9, 69, 4.3),
  "bay leaf": R(313, 7.6, 75, 8.4, 0.2),
  "lime leaves": R(30, 1, 7, 0.3, 0.3),
  "bouquet garni": R(100, 3, 20, 2, 5),
  "black pepper": R(251, 10, 64, 3.3),
  "black peppercorns": R(251, 10, 64, 3.3, 0.05),
  salt: R(0, 0, 0, 0),
  "ground cumin": R(375, 18, 44, 22),
  "cumin seeds": R(375, 18, 44, 22),
  "ground coriander": R(298, 12, 55, 18),
  "coriander seeds": R(298, 12, 55, 18),
  turmeric: R(312, 9.7, 67, 3.3),
  paprika: R(282, 14, 54, 13),
  "smoked paprika": R(282, 14, 54, 13),
  "cayenne pepper": R(318, 12, 57, 17, 1),
  "chilli powder": R(282, 13, 50, 14),
  "red chilli flakes": R(318, 12, 57, 17),
  "garam masala": R(379, 15, 45, 15),
  "curry powder": R(325, 14, 58, 14),
  cinnamon: R(247, 4, 81, 1.2, 3),
  "cinnamon stick": R(247, 4, 81, 1.2, 3),
  cardamom: R(311, 11, 68, 6.7, 0.2),
  cloves: R(274, 6, 66, 13, 0.1),
  allspice: R(263, 6, 72, 8.7, 0.2),
  nutmeg: R(525, 5.8, 49, 36, 5),
  "star anise": R(337, 18, 50, 16, 0.5),
  "fennel seeds": R(345, 16, 52, 15),
  "caraway seeds": R(333, 20, 50, 15),
  fenugreek: R(323, 23, 58, 6.4),
  "mustard seeds": R(508, 26, 28, 36),
  "sichuan pepper": R(296, 6, 66, 9),
  saffron: R(310, 11, 65, 6),
  "chinese five spice powder": R(350, 10, 65, 9),
  "mixed spice": R(300, 6, 70, 8),
  "ras el hanout": R(300, 12, 55, 10),
  sumac: R(300, 4, 70, 12),
  "harissa spice": R(300, 12, 50, 12),
  cajun: R(300, 12, 55, 8),
  "jerk seasoning": R(250, 8, 50, 5),
  "taco seasoning": R(300, 8, 55, 6, 30),
  "all-purpose seasoning": R(150, 5, 30, 2),
  "sazon seasoning": R(100, 2, 20, 1, 5),
  annatto: R(300, 10, 60, 5),
  "ground ginger": R(335, 9, 72, 4.2),
  "garlic powder": R(331, 17, 73, 0.7),
  "onion powder": R(341, 10, 79, 1),
  "celery salt": R(30, 1, 6, 1),
  "juniper berries": R(300, 3, 70, 10, 0.1),
  water: R(0, 0, 0, 0),
};

// Reference prices, per 100 g, with where and when each was read.
interface Price {
  cents: number;
  source: string;
  checked: string;
}
const PRICES: Record<string, Price> = JSON.parse(
  readFileSync(new URL("./data/prices.json", import.meta.url), "utf8"),
);

// Grams in one unit, for units that aren't a weight. Volumes are millilitres
// and become grams through the food's density.
const ML_PER: Record<string, number> = { cup: 250, tbsp: 15, tsp: 5, ml: 1 };
const GRAMS_PER: Record<string, number> = {
  g: 1, pinch: 0.4, dash: 0.6, drop: 0.05, handful: 30, bunch: 60, clove: 5, stick: 40, slice: 25, sprig: 1,
  leaf: 0.5, can: 400, pack: 250, jar: 300, cm: 5, knob: 15, rasher: 25, bulb: 50,
};
// A handful or bunch of leaves weighs far less than a handful of nuts.
const LEAFY = /coriander|parsley|basil|mint|dill|chives|thyme|rosemary|oregano|rocket|spinach|lettuce|herb|sage|tarragon|kale|marjoram|leaves/;
const LEAFY_GRAMS: Record<string, number> = { handful: 10, bunch: 40 };
// A dash of a liquid is a few millilitres; of a powder, under a gram.
const DASH_ML = /sauce|oil|vinegar|milk|water|stock|wine|juice|extract|syrup/;

// No single line costs more than its typical pack: a recipe that says "a
// bunch of coriander" costs the bunch, not a kilo-rate share of it.
const PACK_CENTS: Record<string, number> = {
  saffron: 600, "vanilla extract": 400, cardamom: 300, cloves: 250, "star anise": 300, "vanilla pod": 600,
  "almond extract": 400, "pine nuts": 700, "sichuan pepper": 400, "juniper berries": 300,
};
// A cup of a dry food weighs less than a cup of water.
const CUP_GRAMS: Record<string, number> = {
  rice: 185, "jasmine rice": 185, "basmati rice": 185, "brown rice": 190, "sushi rice": 200, "glutinous rice": 200,
  "plain flour": 125, "self-raising flour": 125, "bread flour": 130, "wholemeal flour": 120, "rice flour": 160,
  "chickpea flour": 92, "cassava flour": 130, "rye flour": 100, "ground almonds": 96, cornflour: 128, cornmeal: 160,
  semolina: 167, sugar: 200, "brown sugar": 200, "icing sugar": 120, "palm sugar": 200, "cocoa powder": 85,
  butter: 227, parmesan: 100, "cheddar cheese": 113, mozzarella: 113, "monterey jack cheese": 113, "swiss cheese": 113,
  "shredded mexican cheese": 113, feta: 150, "cottage cheese": 225, ricotta: 245, "cream cheese": 230,
  peas: 145, onion: 160, mushrooms: 70, "chinese broccoli": 90, chicken: 140, spinach: 30, kale: 67, cabbage: 90, ginger: 96,
  capsicum: 150, carrot: 128, "green beans": 110, "bean sprouts": 100, sweetcorn: 165, cassava: 206, pumpkin: 245,
  cashews: 140, peanuts: 145, almonds: 143, walnuts: 117, "pecan nuts": 110, pistachios: 123, hazelnuts: 135,
  "pine nuts": 135, "desiccated coconut": 85, "sesame seed": 144, raisins: 145, dates: 147, "dried apricots": 130,
  "dried cranberries": 120, "chocolate chips": 170, "white chocolate": 170, "dark chocolate": 170, marshmallows: 50,
  "brown lentils": 190, "red lentils": 190, "toor dal": 200, "yellow split peas": 200, macaroni: 105, quinoa: 170,
  couscous: 175, "bulgur wheat": 140, buckwheat: 170, "rolled oats": 90, "porridge oats": 90, breadcrumbs: 108,
  "potato starch": 160, tahini: 240, "tamarind paste": 280, "canned tomatoes": 240, lemon: 240, mango: 165,
  strawberries: 150, blueberries: 148, raspberries: 123, "mixed berries": 140, rhubarb: 122, pineapple: 165,
  "cannellini beans": 180, "black beans": 172, chickpeas: 164, "kidney beans": 177, "broad beans": 170, tapioca: 152,
  "beef mince": 225, "flank steak": 200, "smoked sausage": 140, "dried hominy": 170, "dried shrimp": 60,
  "digestive biscuits": 100, "chocolate sandwich biscuits": 100, "mixed peel": 150, "glacé cherries": 160,
};

export interface IngredientLine {
  name: string;
  quantity: number | null;
  unit: string;
}

// Longest key that appears in the name as whole words, cached: the browse
// page and planner look up the same few hundred names many times over.
const KEYS = Object.keys(FOODS).sort((a, b) => b.length - a.length);
const PRICE_KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD = new Map(
  [...new Set([...KEYS, ...PRICE_KEYS])].map((k) => [k, new RegExp(`(^|[^\\p{L}])${escape(k)}(es|s)?($|[^\\p{L}])`, "u")]),
);
const keyCache = new Map<string, string | null>();
const priceKeyCache = new Map<string, string | null>();

function bestKey(n: string, keys: string[], table: Record<string, unknown>, cache: Map<string, string | null>): string | null {
  const hit = cache.get(n);
  if (hit !== undefined) return hit;
  // exact name, then its plural ("egg" → "eggs"), then the longest key
  // inside it as whole words
  let found: string | null = n in table ? n : `${n}s` in table ? `${n}s` : null;
  if (!found) for (const k of keys) if (WORD.get(k)!.test(n)) { found = k; break; }
  if (cache.size < 5000) cache.set(n, found);
  return found;
}

function lookup(name: string): Ref | undefined {
  const key = bestKey(name.toLowerCase().trim(), KEYS, FOODS, keyCache);
  return key ? FOODS[key] : undefined;
}

function priceOf(name: string): Price | undefined {
  const key = bestKey(name.toLowerCase().trim(), PRICE_KEYS, PRICES, priceKeyCache);
  return key ? PRICES[key] : undefined;
}

// What's known about converting this ingredient between mass, volume and
// count. Only what the food table states for it: a density is given only for
// liquids whose density is listed, and a weight per item only where one is.
// Callers must not convert without these (CLAUDE.md pricing rules).
export function conversionFor(name: string): { density?: number; each?: number; cupGrams?: number } {
  const ref = lookup(name);
  const cup = CUP_GRAMS[name.toLowerCase().trim()];
  return { density: ref?.density, each: ref?.each, cupGrams: cup };
}

// The reference price row for an ingredient, with its source text, so the
// package parser can read the shelf size and price it was taken from.
export function referencePrice(name: string): { centsPer100: number; source: string; checked: string } | null {
  const p = priceOf(name);
  return p ? { centsPer100: p.cents, source: p.source, checked: p.checked } : null;
}

// Where an ingredient's reference price comes from, for pages that cite it.
export function priceSource(name: string): { source: string; checked: string } | null {
  const p = priceOf(name);
  return p ? { source: p.source, checked: p.checked } : null;
}

// How many reference prices there are and the latest month one was checked,
// for a one-line footnote ("prices checked Oct 2026").
export function priceReference(): { count: number; checked: string } {
  const months = Object.values(PRICES).map((p) => p.checked).sort();
  return { count: months.length, checked: months[months.length - 1] ?? "" };
}

// Grams of an ingredient line, or null when it can't be weighed ("salt to taste").
export function gramsOf(line: IngredientLine): number | null {
  if (line.quantity === null || line.quantity <= 0) return null;
  const ref = lookup(line.name);
  const name = line.name.toLowerCase();
  const unit = line.unit.toLowerCase();
  if (unit === "" || unit === "each") return ref?.each ? line.quantity * ref.each : null;
  // a pinch of saffron is a few threads, not a pinch of salt
  if (unit === "pinch" && name === "saffron") return line.quantity * 0.05;
  if (unit === "cup" && CUP_GRAMS[name]) return line.quantity * CUP_GRAMS[name];
  if (unit in LEAFY_GRAMS && LEAFY.test(name)) return line.quantity * LEAFY_GRAMS[unit];
  if (unit === "dash" && DASH_ML.test(name)) return line.quantity * 3 * (ref?.density ?? 1);
  if (unit === "stick" && ref?.each && !/butter/.test(name)) return line.quantity * ref.each;
  if (unit === "knob" && /ginger|galangal/.test(name)) return line.quantity * 10;
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
    const price = priceOf(line.name);
    if (price) {
      const cap = PACK_CENTS[line.name.toLowerCase()];
      out.costCents += cap === undefined ? price.cents * k : Math.min(cap, price.cents * k);
    }
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
