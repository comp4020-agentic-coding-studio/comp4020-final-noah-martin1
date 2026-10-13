// Common kitchen substitutions, written out by hand so the answer to "can I
// use X instead of Y?" is something we can stand behind. The in-browser
// assistant phrases these; it never invents a swap that isn't here, and when
// the model can't load the table answer is shown on its own.

export interface Swap {
  // what the recipe calls for (matched as a word in the ingredient name)
  for: RegExp;
  use: string;
  // how much, and anything that changes in the cooking
  how: string;
}

const SWAPS: Swap[] = [
  { for: /\bbutter\b/, use: "olive oil", how: "use ¾ of the amount; fine for sautéing, not for creaming into cakes" },
  { for: /\bbutter\b/, use: "coconut oil", how: "same amount; works in baking, adds a faint coconut note" },
  { for: /\bbuttermilk\b/, use: "milk with lemon juice", how: "1 cup milk + 1 tbsp lemon juice, rest 5 minutes" },
  { for: /\b(heavy|thickened|double) cream\b|\bcream\b/, use: "evaporated milk", how: "same amount in sauces; it won't whip" },
  { for: /\bcream\b/, use: "Greek yoghurt", how: "same amount, stirred in off the heat so it doesn't split" },
  { for: /\bsour cream\b/, use: "Greek yoghurt", how: "same amount" },
  { for: /\bmilk\b/, use: "oat or soy milk", how: "same amount; unsweetened for savoury dishes" },
  { for: /\begg\b|\beggs\b/, use: "flax egg", how: "1 tbsp ground flaxseed + 3 tbsp water per egg, rest 10 minutes; for binding, not for rising" },
  { for: /\begg\b|\beggs\b/, use: "mashed banana", how: "¼ cup per egg in sweet bakes" },
  { for: /\bparmesan\b/, use: "pecorino or grana padano", how: "same amount; pecorino is saltier, so ease off the salt" },
  { for: /\bparmesan\b/, use: "nutritional yeast", how: "2 tbsp per ¼ cup grated, for a dairy-free version" },
  { for: /\bmozzarella\b/, use: "bocconcini or provolone", how: "same amount" },
  { for: /\bfeta\b/, use: "goat's cheese or ricotta salata", how: "same amount" },
  { for: /\bricotta\b/, use: "cottage cheese", how: "blend it smooth first, same amount" },
  { for: /\bchicken stock\b|\bchicken broth\b/, use: "vegetable stock", how: "same amount; add a pinch more salt" },
  { for: /\bbeef stock\b/, use: "mushroom or vegetable stock with a dash of soy sauce", how: "same amount" },
  { for: /\bwhite wine\b/, use: "stock with a squeeze of lemon", how: "same amount" },
  { for: /\bred wine\b/, use: "stock with a splash of balsamic vinegar", how: "same amount, 1 tsp vinegar per cup" },
  { for: /\bsoy sauce\b/, use: "tamari", how: "same amount; tamari is usually gluten-free" },
  { for: /\bsoy sauce\b/, use: "coconut aminos", how: "same amount; sweeter and less salty" },
  { for: /\bfish sauce\b/, use: "soy sauce with a little lime", how: "same amount" },
  { for: /\bmirin\b/, use: "rice vinegar with sugar", how: "1 tbsp vinegar + ½ tsp sugar per tbsp" },
  { for: /\brice vinegar\b/, use: "apple cider vinegar", how: "same amount, maybe a pinch of sugar" },
  { for: /\blemon juice\b|\blemon\b/, use: "lime juice", how: "same amount" },
  { for: /\blime\b/, use: "lemon", how: "same amount" },
  { for: /\bhoney\b/, use: "maple syrup", how: "same amount" },
  { for: /\bmaple syrup\b/, use: "honey or golden syrup", how: "same amount" },
  { for: /\bbrown sugar\b/, use: "white sugar with a little honey", how: "1 cup sugar + 1 tbsp honey" },
  { for: /\bcaster sugar\b/, use: "white sugar, blitzed", how: "same amount, pulse briefly in a blender" },
  { for: /\bself[- ]raising flour\b/, use: "plain flour with baking powder", how: "1 cup plain flour + 2 tsp baking powder" },
  { for: /\bplain flour\b|\ball[- ]purpose flour\b/, use: "a gluten-free flour blend", how: "same amount; add ½ tsp xanthan gum per cup for baking" },
  { for: /\bcornflour\b|\bcornstarch\b/, use: "plain flour", how: "double the amount to thicken" },
  { for: /\bbreadcrumbs?\b/, use: "crushed crackers or rolled oats", how: "same amount" },
  { for: /\bspaghetti\b|\blinguine\b|\bfettuccine\b/, use: "any long pasta", how: "same weight; check the packet time" },
  { for: /\bpenne\b|\brigatoni\b|\bfusilli\b/, use: "any short pasta", how: "same weight" },
  { for: /\barborio\b/, use: "any short-grain rice", how: "same amount; add stock a little slower" },
  { for: /\bbasmati\b|\bjasmine\b/, use: "any long-grain rice", how: "same amount" },
  { for: /\bquinoa\b/, use: "couscous or bulgur", how: "same amount; couscous only needs soaking" },
  { for: /\bchicken thigh/, use: "chicken breast", how: "same weight; cook a few minutes less so it stays juicy" },
  { for: /\bchicken breast/, use: "chicken thigh", how: "same weight; a few minutes more" },
  { for: /\bchicken\b/, use: "firm tofu or chickpeas", how: "same weight, for a vegetarian version; press tofu first" },
  { for: /\bbeef mince\b|\bminced beef\b|\bground beef\b/, use: "pork, lamb or turkey mince", how: "same weight" },
  { for: /\bmince\b/, use: "brown lentils", how: "1 cup cooked lentils per 250 g mince, for a vegetarian version" },
  { for: /\bbacon\b/, use: "pancetta or smoked paprika", how: "same amount of pancetta, or 1 tsp smoked paprika for the smoky note" },
  { for: /\bprawns?\b|\bshrimp\b/, use: "firm white fish", how: "same weight, in chunks" },
  { for: /\bsalmon\b/, use: "ocean trout", how: "same weight" },
  { for: /\b(salmon|trout|tuna|cod|barramundi|snapper|fish fillets?|white fish)\b/, use: "firm tofu, pressed and sliced", how: "same weight, for a vegetarian version; sear it hard so it browns" },
  { for: /\b(beef|steak|lamb|pork)\b/, use: "portobello mushrooms or eggplant", how: "same weight in thick slices, for a vegetarian version" },
  { for: /\b(sausages?|chorizo)\b/, use: "vegetarian sausages", how: "same number; they cook faster" },
  { for: /\bcoriander\b|\bcilantro\b/, use: "flat-leaf parsley with a little lime zest", how: "same amount" },
  { for: /\bbasil\b/, use: "baby spinach with a little mint", how: "same amount in pesto; in sauces just leave it out" },
  { for: /\bfresh herbs?\b|\bparsley\b/, use: "dried herbs", how: "use a third of the amount" },
  { for: /\bshallots?\b/, use: "brown onion", how: "½ small onion per shallot" },
  { for: /\bspring onions?\b|\bscallions?\b/, use: "chives or a little red onion", how: "same amount" },
  { for: /\bleek\b/, use: "brown onion", how: "1 onion per leek" },
  { for: /\bgarlic\b/, use: "garlic powder", how: "⅛ tsp per clove" },
  { for: /\bginger\b/, use: "ground ginger", how: "¼ tsp per tbsp of fresh" },
  { for: /\bfresh chilli\b|\bchilli\b|\bchili\b/, use: "chilli flakes", how: "½ tsp per chilli" },
  { for: /\bspinach\b/, use: "kale or silverbeet", how: "same amount; cook a little longer" },
  { for: /\bzucchini\b|\bcourgette\b/, use: "eggplant or squash", how: "same weight" },
  { for: /\bcapsicum\b|\bbell pepper\b/, use: "zucchini or carrot", how: "same weight, for crunch and colour" },
  { for: /\btinned tomatoes\b|\bcanned tomatoes\b|\bchopped tomatoes\b/, use: "passata", how: "same amount" },
  { for: /\btomato paste\b/, use: "tomato sauce reduced down", how: "3 tbsp sauce simmered to 1 tbsp" },
  { for: /\bcoconut milk\b/, use: "milk with a little coconut cream or yoghurt", how: "same amount" },
  { for: /\bchickpeas?\b/, use: "cannellini or butter beans", how: "same amount" },
  { for: /\bkidney beans?\b|\bblack beans?\b/, use: "any tinned bean", how: "same amount" },
  { for: /\bpeanut butter\b/, use: "almond butter or tahini", how: "same amount" },
  { for: /\btahini\b/, use: "peanut butter with sesame oil", how: "same amount, a few drops of oil" },
  { for: /\bcumin\b/, use: "ground coriander or chilli powder", how: "same amount" },
  { for: /\bpaprika\b/, use: "chilli powder", how: "half the amount; it's hotter" },
  { for: /\bgaram masala\b/, use: "curry powder", how: "same amount" },
  { for: /\bvanilla\b/, use: "maple syrup", how: "same amount" },
  { for: /\bbaking powder\b/, use: "bicarb soda with cream of tartar", how: "¼ tsp bicarb + ½ tsp cream of tartar per tsp" },
  { for: /\byoghurt\b|\byogurt\b/, use: "sour cream", how: "same amount" },
];

export interface SwapHit {
  ingredient: string;
  use: string;
  how: string;
}

// Every swap that applies to one ingredient name, best first.
export function swapsFor(ingredient: string): SwapHit[] {
  const n = ` ${ingredient.toLowerCase()} `;
  return SWAPS.filter((s) => s.for.test(n)).map((s) => ({ ingredient, use: s.use, how: s.how }));
}

// For a free-text question: the recipe ingredient it most likely asks about
// (the longest name mentioned), and whether a specific replacement was named.
export function swapAnswer(question: string, ingredients: string[]): { ingredient: string | null; hits: SwapHit[]; asked: string | null } {
  const q = question.toLowerCase();
  const named = ingredients
    .filter((name) => {
      const n = name.toLowerCase();
      if (q.includes(n)) return true;
      // "salmon fillet" is asked about as "salmon"
      const words = n.split(/\s+/).filter((w) => w.length > 3);
      return words.some((w) => new RegExp(`\\b${w.replace(/[^a-z]/g, "")}s?\\b`).test(q));
    })
    .sort((a, b) => b.length - a.length);
  const ingredient = named[0] ?? null;
  const hits = ingredient ? swapsFor(ingredient) : [];
  // "use X instead of Y" / "swap in X" names the replacement they have in
  // mind; "what can I use instead of Y" names none
  const m = /\b(?:use|swap in|substitute|sub in|replace (?:it|that) with|got|have)\s+(?!instead|something|anything|in place)([a-z][a-z \-']{2,30}?)\s+(?:for|instead|in place|rather)\b/.exec(q);
  const asked = m && !ingredient?.toLowerCase().includes(m[1].trim()) ? m[1].trim().replace(/^(some|the|a|an)\s+/, "") : null;
  if (asked) {
    const fits = (h: SwapHit) => Number(h.use.includes(asked) || asked.split(" ").some((w) => w.length > 3 && h.use.includes(w)));
    hits.sort((a, b) => fits(b) - fits(a));
  }
  return { ingredient, hits, asked };
}
