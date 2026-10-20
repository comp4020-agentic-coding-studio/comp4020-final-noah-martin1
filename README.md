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
- the shopping list buys whole packs: needs are summed across meals, usable
  stock subtracted, and 200 g of flour from an empty pantry is a whole bag;
  checkout cost and the value the recipes use are shown apart, a price you
  paid is never replaced by a higher shelf price, and unknown prices are
  never treated as free
- expired food gets one grace day ("Do you still have this?") and then
  leaves the kitchen by itself; it stops counting as stock on the day after
  its date
- every recipe someone writes has a photo, checked by its bytes, on every
  way of saving it
- cook mode goes live by default within your own visibility setting, never
  on the map unless you picked a city, and turns off with one tap or for good
  in settings
- the server logs who did what (never passwords or what people typed), and
  each person sees their own trail in settings
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
list export. Nutrition is an estimate from a built-in food table, and shelf
prices are read when the refresh script runs, not continuously. Q&A translation is shown only for demo cooks. Each would add scope
without making the core loop (know what you have, cook it, share it) better.

## Sources

- **Recipes and photos:** [TheMealDB](https://www.themealdb.com/)'s free
  public API. The shared catalogue (`src/data/catalogue.json`) is 757 recipes
  from 62 cuisines, each with its TheMealDB photo and a `themealdb:<id>` key.
  Meals without a photo, with fewer than 4 ingredients or 2 usable steps, or
  duplicated were left out (33 in all). Ingredient names, amounts and steps
  were cleaned into metric units and short steps; brand names in titles were
  made generic.
- **Recipe videos:** a catalogue recipe shows only the video TheMealDB itself
  links to that meal (`strYoutube`), and only if YouTube's oEmbed endpoint
  confirms it exists and can be embedded and its title shares the dish's key
  words (`scripts/fetch-videos.ts`, `src/videos.ts`; results with the check
  date in `src/data/videos.json`). We can't watch videos, so this does not
  prove every amount agrees with the metric-converted recipe, and the page says
  so. Recipes with no passing video say none is available. A video an author
  adds themselves is labelled as theirs and not checked.
- **Nutrition:** calories, protein, carbs and fat per 100 g for about 500
  ingredients (`src/nutrition.ts`), rounded from USDA FoodData Central
  reference values, with dry goods at uncooked values. 94.6% of ingredient
  lines in the catalogue are counted; "salt to taste" can't be. Every figure
  is labelled an estimate.
- **Prices:** Woolworths and ALDI shelf prices, pack sizes and product links
  in `src/data/products.json`, read by `scripts/refresh-prices.ts` from
  Woolworths' public product search and ALDI's category pages (paths their
  robots.txt allows) and stamped with when they were read; every price says
  so, and none is called live. 504 dated reference prices in
  `src/data/prices.json` cover consumption estimates and gaps. The rules are
  in `docs/product/pricing.md`.
- **Videos:** the YouTube link TheMealDB gives each meal, kept when YouTube
  says it exists and can be embedded and its title names the dish
  (`scripts/fetch-videos.ts`, checked 20 October 2026; a few decisions made by
  reading each recipe beside its video are in `src/data/video-overrides.json`).
  420 recipes have one; the rest say no matching video is available.
- **Logs:** `activity_log` in the database and one JSON line per event on
  stdout (`fly logs`); `node scripts/activity.ts --follow` reads it, and
  accounts in `ADMIN_USERNAMES` get a live feed at `/admin/activity`.
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
