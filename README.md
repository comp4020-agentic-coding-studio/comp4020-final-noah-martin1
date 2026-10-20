# Larder

Larder is a shared kitchen for people who cook together. Your fridge and
pantry are a 3D kitchen of what you actually have, with expiry dates and what
you paid. Recipes know what's in that kitchen, work out their own nutrition and
cost, and cook one step at a time. A meal calendar can plan a costed week for
you, show what friends are cooking, and turn into a shopping list priced
against your budget. When you cook, you can go live: your pan appears on a
globe, and anyone who's allowed to can follow your steps and ask you
questions. Housemates can share one pantry, calendar and shopping list, claim
what they'll buy, and race to use what's about to go off. Browsing recipes,
cooking them and watching the globe need no account.

## The problem

Food goes off because nobody remembered it was there. Two housemates plan
around the same last eggs. A recipe looks cheap until you count what you'd
have to buy. The information that would fix all of this (what's in the
kitchen, what it cost, what everyone is planning) usually lives in people's
heads, so it can't be shared and it goes stale.

## What "good" means here

**Truthful about the kitchen.** A recipe page says which ingredients you
actually hold (fresh, not expired), how many you're missing, and what those
would cost at the prices *you* last paid. That comes from plain arithmetic
over your pantry, never from a guess. The on-device model can reword an
answer, but it can't change the maths.

**Private by default, shared on purpose.** A recipe is public, friends-only or
just yours. A planned meal is shared or private. A friendship only exists once
both people have agreed. Someone who isn't your friend sees none of your
friends-only recipes, your pantry or your calendar, and a hidden recipe looks
the same as one that doesn't exist.

**Works for everyone at the table.** Every page works without JavaScript and
with only a keyboard, at phone width, in light and dark mode. Forms keep what
you typed when they reject it and say why.

**Nothing is lost.** Everything lives in one SQLite database on the server's
persistent volume, so it survives restarts and redeploys.

## Checked vs judged

Some of "good" is enforced by tests in `spec/` that run against the live app:

- signing in, signing out, duplicate usernames, and protected pages
- a friend request can't be accepted by the person who sent it
- strangers get a 404 for friends-only and private recipes, and a shared meal
  never leaks the title of a recipe the viewer isn't allowed to see
- pantry quantities and prices can't be negative or nonsense, and one person
  can't see or change another's pantry
- the shopping list is planned meals minus fresh pantry stock: expired items
  and cancelled meals don't count
- forms posted from another site are refused
- anyone can browse, search and cook public recipes without an account,
  private recipes never show up in the results, and changing the servings
  scales every quantity
- a live cook session is never seen more widely than its own setting or its
  recipe: friends-only reaches friends, private reaches only the cook, and the
  live stream only tells each viewer about sessions they may see
- while live, the step only moves forward, only the cook can move or end it,
  going live again ends the last session, and only a city-level location is
  ever stored
- the week planner keeps to the budget, gives the same week for the same
  choices, and "add all" plans only for the person who asked and re-checks
  every recipe; a friend overlaid on the calendar shows only their shared meals
- "ask about this recipe" answers from checked facts (a substitution table,
  the pantry, scaling), says so when it has no answer, works without
  JavaScript, and never reveals a private recipe or someone else's pantry
- a household is its members and no one else: outsiders get a 404 for every
  household page and write, a person is in one household at a time, a new
  invite code stops the old one working, and the last one out closes it
- in a household only items about to go off can be claimed for "use tonight",
  each shopping item has one claimer at a time, a house meal must be a recipe
  every member can open, and adding stock that completes a planned meal
  nudges the house

Other parts can only be judged: whether the pages are clear and calm, whether
the 3D kitchen and the globe are a pleasure to use, whether the calendar is
pleasant to plan with.

## AI, and where it stops

The week planner and "ask about this recipe" both work out their answers with
plain rules over your data. An optional on-device model (Qwen2.5 0.5B, free,
Apache-2.0, downloaded once and run on your GPU with WebGPU) can reword an
answer into a friendly sentence. It never replaces the checked answer: its
reply appears underneath, labelled, and is thrown away if it names a food the
facts didn't, repeats itself, or just echoes the answer. Nothing you type
leaves your device for it, and every page works without it.

## Not built yet (on purpose)

The globe mixes real live cooks with a layer of demo cooks so it's never
empty; the demo layer is tagged and sits under a "preview with sample data"
banner (a test checks real sessions carry no caveat). There's no shopping
list export, and a recipe's nutrition and cost are estimates from a built-in
food and price table, not a full nutrition database or live supermarket
prices. Q&A translation is shown only for demo cooks. Each would add scope
without making the core loop (know what you have, cook it, share it) better.

## Sources

- **Recipes and photos:** [TheMealDB](https://www.themealdb.com/)'s free
  public API. The shared catalogue (`src/data/catalogue.json`) is 757 recipes
  from 62 cuisines, each with its TheMealDB photo and a `themealdb:<id>` key.
  Meals without a photo, with fewer than 4 ingredients or 2 usable steps, or
  duplicated were left out (33 in all). Ingredient names, amounts and steps
  were cleaned into metric units and short steps; brand names in titles were
  made generic.
- **Nutrition:** calories, protein, carbs and fat per 100 g for about 500
  ingredients (`src/nutrition.ts`), rounded from USDA FoodData Central
  reference values, with dry goods at uncooked values. 94.6% of ingredient
  lines in the catalogue are counted; "salt to taste" can't be. Every figure
  is labelled an estimate.
- **Prices:** 504 Australian supermarket reference prices in
  `src/data/prices.json`, each with its source and the month it was checked
  (October 2026). 54 staples are shelf prices from named ALDI and Woolworths
  listings; the rest are labelled typical everyday prices. Neither store has
  a public price API, so prices are references, not live.
- **Globe:** NASA imagery, all public domain, from
  [NASA Visible Earth](https://visibleearth.nasa.gov/): Blue Marble Next
  Generation (October, topography and bathymetry; Reto Stöckli, NASA Earth
  Observatory) by day, Black Marble 2016 city lights by night, GEBCO_08
  elevation for the relief, and the Blue Marble cloud composite.
  `scripts/build-earth.py` turns the downloads into the WebP textures in
  `public/textures/`. The sun's position comes from the standard
  low-precision solar formulas, so day, night and dusk sit where they really
  are right now; each cook's local time uses their city's IANA time zone.
  Drawn with [three.js](https://threejs.org/) (MIT, licence in
  `public/vendor/THREE-LICENSE`).
- **On-device assistant:** [Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct)
  (Apache-2.0) via [transformers.js](https://github.com/huggingface/transformers.js)
  (Apache-2.0), loaded only when a visitor switches it on.
- **Live locations:** about 90 built-in city centres; a browser location is
  rounded to 0.1° (about 11 km) before it's stored.
