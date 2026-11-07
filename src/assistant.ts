// "Ask about this recipe": a plain, checkable answer worked out on the server
// from the recipe, the substitution table and (signed in) the viewer's own
// pantry. The optional on-device model only rewords these facts; with no
// model, or a slow one, this answer stands on its own (CLAUDE.md: AI is
// advisory and the page works when the model is down).

import { stockParams, stockSql } from "./expiry.ts";
import { all } from "./db.ts";
import type { Recipe, RecipeIngredient } from "./recipes.ts";
import { pantryMatch } from "./recipes.ts";
import { swapAnswer, swapsFor } from "./swaps.ts";
import { t, tn } from "./i18n.ts";

export interface Answer {
  kind: "swap" | "diet" | "pantry" | "scale" | "unknown";
  headline: string;
  lines: string[];
  // the same facts as plain sentences, for the model's prompt
  facts: string;
}

const MEAT = /\b(chicken|beef|pork|lamb|mince|bacon|sausage|steak|ham|chorizo|prosciutto|pancetta|turkey|duck|veal|salami)\b/;
const SEAFOOD = /\b(fish|salmon|tuna|prawn|shrimp|anchov|cod|trout|crab|mussel|squid|fish sauce|oyster sauce)\b/;
const DAIRY = /\b(milk|butter|cream|cheese|cheddar|parmesan|mozzarella|feta|ricotta|yoghurt|yogurt|ghee|buttermilk)\b/;
const EGG = /\begg/;
const GLUTEN = /\b(flour|bread|breadcrumb|pasta|spaghetti|penne|noodle|couscous|soy sauce|barley|tortilla|pastry|lasagne)\b/;
const STOCK = /\b(chicken|beef) (stock|broth)\b/;

function pantryNames(viewerId: number): string[] {
  return all<{ name: string }>(
    `SELECT i.name FROM inventory_items inv JOIN ingredients i ON i.id = inv.ingredient_id
     WHERE inv.owner_type = 'user' AND inv.owner_id = ? AND ${stockSql("inv")}`,
    viewerId,
    ...stockParams(),
  ).map((r) => r.name.toLowerCase());
}

// the diet as the page names it (the key stays English for the facts)
const DIET_LABEL: Record<string, string> = {
  vegan: "vegan",
  vegetarian: "vegetarian",
  "gluten-free": "gluten-free",
  "dairy-free": "dairy-free",
};

// "olive oil" is in the pantry when any held item shares its key word
function holds(pantry: string[], use: string): boolean {
  const words = use.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !["with", "little", "juice", "blitzed", "reduced", "down", "splash"].includes(w));
  return words.length > 0 && pantry.some((p) => words.some((w) => p.includes(w)));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function answerFor(recipe: Recipe, lines: RecipeIngredient[], question: string, viewerId: number | null): Answer {
  const q = question.toLowerCase().trim();
  const names = lines.map((l) => l.name);
  const pantry = viewerId ? pantryNames(viewerId) : [];
  const mark = (use: string) => (pantry.length && holds(pantry, use) ? " (you have this)" : "");
  // the same mark on the page, in the page's language
  const markT = (use: string) => (mark(use) ? t(" (you have this)") : "");
  const intro = `Recipe: ${recipe.title}, serves ${recipe.servings}. Ingredients: ${names.join(", ")}.`;

  // make it vegetarian / vegan / gluten-free / dairy-free
  const diet = /\bvegan\b/.test(q) ? "vegan"
    : /\b(vegetarian|veggie|meat[- ]?free|no meat)\b/.test(q) ? "vegetarian"
    : /\b(gluten|coeliac|celiac)\b/.test(q) ? "gluten-free"
    : /\b(dairy|lactose)\b/.test(q) ? "dairy-free"
    : null;
  if (diet) {
    const tests: RegExp[] =
      diet === "vegan" ? [MEAT, SEAFOOD, DAIRY, EGG, STOCK, /\bhoney\b/]
      : diet === "vegetarian" ? [MEAT, SEAFOOD, STOCK]
      : diet === "gluten-free" ? [GLUTEN]
      : [DAIRY];
    const affected = lines.filter((l) => tests.some((t) => t.test(` ${l.name.toLowerCase()} `)));
    const dietT = t(DIET_LABEL[diet]);
    if (!affected.length) {
      const headline = t("This one is already {diet}, going by its ingredients.", { diet: dietT });
      return { kind: "diet", headline, lines: [t("Check packaged items like stock and sauces for hidden ingredients.")], facts: `${intro} Fact: none of the ingredients are a problem for a ${diet} diet; packaged items like stock should still be checked.` };
    }
    const picks = affected.map((l) => ({
      l,
      s: swapsFor(l.name).find((h) => {
        const u = ` ${h.use.toLowerCase()} `;
        return !tests.some((re) => re.test(u));
      }),
    }));
    const out = picks.map(({ l, s }) => (s ? `${cap(l.name)} → ${s.use}${mark(s.use)}: ${s.how}.` : `${cap(l.name)}: leave it out, or look for a ${diet} version at the shop.`));
    return {
      kind: "diet",
      headline: tn(affected.length, "To make it {diet}, change {n} ingredient:", "To make it {diet}, change {n} ingredients:", { diet: dietT }),
      lines: picks.map(({ l, s }) =>
        s
          ? `${cap(l.name)} → ${s.use}${markT(s.use)}: ${s.how}.`
          : t("{name}: leave it out, or look for a {diet} version at the shop.", { name: cap(l.name), diet: dietT }),
      ),
      facts: `${intro} To make it ${diet}: ${out.join(" ")}`,
    };
  }

  // what am I missing / do I have everything
  if (/\b(missing|do i have|have everything|need to buy|shopping|what.*buy)\b/.test(q)) {
    if (!viewerId) {
      return { kind: "pantry", headline: t("Sign in and Larder checks this against your pantry."), lines: [tn(lines.filter((l) => !l.optional).length, "You'd need {n} ingredient in all.", "You'd need {n} ingredients in all.")], facts: `${intro} The visitor is not signed in, so their pantry is unknown.` };
    }
    const m = pantryMatch(viewerId, lines);
    const need = lines.filter((l) => !l.optional && !m.have.has(l.ingredient_id)).map((l) => l.name);
    const total = lines.filter((l) => !l.optional).length;
    const said = need.length ? `You're missing ${need.length} of ${total}.` : "You have everything for this one.";
    const headline = need.length ? t("You're missing {n} of {total}.", { n: need.length, total }) : t("You have everything for this one.");
    return { kind: "pantry", headline, lines: need.length ? [t("To buy: {items}.", { items: need.join(", ") })] : [], facts: `${intro} ${said} ${need.length ? `Missing: ${need.join(", ")}.` : ""}` };
  }

  // feed more or fewer people
  const people = /\b(?:for|feed|serve|serves|make)\s+(\d{1,2})\b/.exec(q);
  const factor = /\b(double|twice)\b/.test(q) ? 2 : /\b(half|halve)\b/.test(q) ? 0.5 : people ? Number(people[1]) / recipe.servings : null;
  if (factor && factor > 0 && factor !== 1) {
    const serves = Math.round(recipe.servings * factor * 10) / 10;
    const samples = lines.filter((l) => l.quantity).slice(0, 3).map((l) => `${l.name}: ${+(l.quantity! * factor).toFixed(2)} ${l.unit}`.trim());
    return {
      kind: "scale",
      headline: t("For {serves}, multiply everything by {factor}.", { serves, factor: +factor.toFixed(2) }),
      lines: [t("For example {samples}.", { samples: samples.join("; ") }), t("The serves control on the ingredients list does this for every line, and cook mode keeps the new amounts.")],
      facts: `${intro} Scaling to ${serves} servings means multiplying every quantity by ${+factor.toFixed(2)}, e.g. ${samples.join("; ")}. Cooking times stay about the same; a bigger pan may need a few extra minutes.`,
    };
  }

  // substitutions: "can I use X instead of Y", "no coriander, what instead?"
  const s = swapAnswer(q, names);
  if (s.ingredient && s.hits.length) {
    const top = s.hits.slice(0, 3);
    const asked = s.asked;
    const ok = asked ? top.some((h) => h.use.includes(asked)) : false;
    return {
      kind: "swap",
      headline: !asked
        ? t("Instead of {name}:", { name: s.ingredient })
        : ok
          ? t("Yes, {asked} works instead of {name}.", { asked, name: s.ingredient })
          : t("{asked} isn't a tested swap for {name}. These are:", { asked: cap(asked), name: s.ingredient }),
      lines: top.map((h) => `${cap(h.use)}${markT(h.use)}: ${h.how}.`),
      facts: `${intro} Vetted swaps for ${s.ingredient}: ${top.map((h) => `${h.use} (${h.how})`).join("; ")}.${asked ? (ok ? ` Using ${asked} is one of the vetted swaps.` : ` ${asked} is not on the vetted list, so suggest the vetted swaps instead.`) : ""}`,
    };
  }
  if (s.ingredient) {
    return {
      kind: "swap",
      headline: t("Larder has no tested swap for {name}.", { name: s.ingredient }),
      lines: [t("If it's a small amount, leaving it out usually works. For a key ingredient, ask a cook who's making it live on the globe.")],
      facts: `${intro} There is no vetted substitute for ${s.ingredient} in Larder's table.`,
    };
  }
  return {
    kind: "unknown",
    headline: t("Larder doesn't have a checked answer for that one."),
    lines: [t("Try asking about swapping an ingredient, making it vegetarian or gluten-free, feeding more people, or what you're missing.")],
    facts: `${intro} Larder has no vetted fact for this question.`,
  };
}

// A few questions worth asking about this recipe, shown as chips: the
// question as answerFor reads it (English), and as the page shows it.
export function suggestions(lines: RecipeIngredient[]): { q: string; label: string }[] {
  const out: { q: string; label: string }[] = [];
  const add = (q: string, label = t(q)) => out.push({ q, label });
  const swappable = lines.find((l) => swapsFor(l.name).length && !/\b(salt|pepper|water|oil)\b/.test(l.name.toLowerCase()));
  if (swappable) {
    const name = swappable.name.toLowerCase();
    add(`What can I use instead of ${name}?`, t("What can I use instead of {name}?", { name }));
  }
  if (lines.some((l) => MEAT.test(` ${l.name.toLowerCase()} `) || SEAFOOD.test(` ${l.name.toLowerCase()} `))) add("Can I make it vegetarian?");
  else if (lines.some((l) => GLUTEN.test(` ${l.name.toLowerCase()} `))) add("Can I make it gluten-free?");
  else add("Can I make it vegan?");
  add("What am I missing?");
  add("Double it");
  return out;
}
