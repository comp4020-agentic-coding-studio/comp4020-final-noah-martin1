# Larder in detail

The [README](../README.md) argues what good means for Larder. This page holds
the detail behind it: everything the tests in `spec/` check, how the AI and
scanning work, and where the data comes from.

## What the tests check

Each of these is enforced by a test in `spec/` that runs against the running
app; a failing check blocks the deploy.

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
  never treated as free: a recipe names any ingredient it couldn't price and
  the planner never offers such a meal as cheap
- expired food gets one grace day ("Do you still have this?") and then
  leaves the kitchen by itself; it stops counting as stock on the day after
  its date
- every recipe someone writes has a photo, checked by its bytes, on every
  way of saving it
- a catalogue recipe shows a video only if its recipe was transcribed from
  that video, and the "Has video" filter lists exactly the recipes whose page
  shows one (never a private recipe to someone who can't open it); a revised
  catalogue recipe updates in place on the next boot,
  keeping its id, but not while someone is cooking it; plant foods named after
  dairy ("vegan butter", "coconut milk", "butter beans") don't cost a recipe
  its vegan tag
- cook mode goes live by default within your own visibility setting, never
  on the map unless you picked a city, and turns off with one tap or for good
  in settings
- the server logs who did what (never passwords or what people typed), and
  each person sees their own trail in settings
- in a household only items about to go off can be claimed for "use tonight",
  each shopping item has one claimer at a time, a house meal must be a recipe
  every member can open, and adding stock that completes a planned meal
  nudges the house

## AI, and where it stops

The week planner and "ask about this recipe" both work out their answers with
plain rules over your data. An optional on-device model (Qwen2.5 0.5B, free,
Apache-2.0, downloaded once and run on your GPU with WebGPU) can reword an
answer into a friendly sentence. It never replaces the checked answer: its
reply appears underneath, labelled, and is thrown away if it names a food the
facts didn't, repeats itself, or just echoes the answer. Nothing you type
leaves your device for it, and every page works without it.

Adding to the pantry can start from a scan (Fridge → Scan a photo). Every
scan ends at the same review form, where each suggestion is an editable,
untickable row and nothing is saved until you press Add:

- **Barcode.** The camera (or a typed number, checked by its GS1 check digit)
  is looked up in [Open Food Facts](https://world.openfoodfacts.org), which
  gives the product and its exact pack size. Not every product is in it.
- **Photo on this device.** Qwen3-VL 2B runs in your browser on WebGPU (1.4 GB
  the first time). Your photo stays on your device.
- **Receipt on this device.** PaddleOCR (about 14 MB, cached after the first
  visit) reads the printed lines in your browser, in a worker; the camera
  takes the photo itself once the receipt is held still. Only the text is
  posted, and the server decides what was bought with plain code
  (`src/receipt-text.ts`): pack sizes and weights from the printed text,
  food names matched to ingredients the app knows, and the prices checked
  against the receipt's total, every line starting unticked when they don't
  add up. This is what the deployed site uses.
- **Photo or receipt on the server.** Only on a self-hosted install with a
  local vision model (Ollama, `VISION_URL`); the deployed 256 MB machine can't
  run one. Scans run in the background with a progress bar.

The models suggest names or read text; matching a name to an ingredient,
sizes, and the total check are plain code. Measured accuracy, photo by photo
and receipt by receipt, is in `testing/results.md`.

Recipes have **reviews** at the foot of the page: a 1–5 star rating (the
average sits by the byline), words, up to four photos and links to other
recipes, with replies and likes. Others see "Sam is writing…" with three
dots while someone types, and new reviews arrive without a reload. Reviews
follow the recipe's visibility, including their photos. Anyone can filter by
stars, photos or language. A review in another language can be translated
into English in the browser (a small Opus-MT model per language, about 110 MB
the first time, run only when you press Translate), shown beside the
original and labelled as a machine's; languages with no good model aren't
offered. Everyone picks a cooking character as their picture in Settings.
Deleting your account (Settings) removes your recipes, pantry and plans but
leaves your reviews of others' recipes, without your name or picture. The
**Top rated** filter on Recipes lists reviewed recipes best first, by an
average pulled towards 3.5 stars when there are few reviews, so one 5-star
review doesn't outrank twenty at 4.7. Some catalogue recipes carry sample
reviews so the feature shows before real people review much. Each is
labelled "Sample" under a preview banner. Their writers are placeholder
accounts that can't sign in, have no profile and can't be found
(`src/sample-reviews.ts`).

Each recipe's **What it costs** card shows three numbers, each named for
what it is: *cost to make* (the value of what goes in the dish, which "per
serve" divides), *at the checkout* (the whole packs you'd buy from an empty
kitchen) and, signed in, *after your pantry*. Stand-ins are listed with why
("no store sells monkfish"), and any ingredient with no price is named, so a
total is never quietly short. Writing a recipe, each ingredient shows what
it's priced at and asks what you paid when there's no price; your price
then prices your own recipes and shopping. **From my kitchen** on Recipes
lists what you can cook from what you have, then what's missing one
ingredient, then two, saying what's missing.

## Sources and credits

- **Recipes and photos:** [TheMealDB](https://www.themealdb.com/)'s free
  public API. The shared catalogue (`src/data/catalogue.json`) is 757 recipes
  from 62 cuisines, each with its TheMealDB photo and a `themealdb:<id>` key.
  Meals without a photo, with fewer than 4 ingredients or 2 usable steps, or
  duplicated were left out (33 in all). Ingredient names, amounts and steps
  were cleaned into metric units and short steps; brand names in titles were
  made generic. 51 of them were since rewritten to match their
  video (see Recipe videos).
- **Recipe videos:** a catalogue recipe shows a video only when its
  ingredients and steps were transcribed from that video and then checked a
  second time against the same source. The source is the video's own
  transcript, or the creator's written recipe for that video (linked from its
  description), or a full recipe in the description. Where TheMealDB's video
  had no amounts or was a different dish, a video of the same dish with a
  written recipe replaced it. Amounts are converted to metric. A title match
  alone (`scripts/fetch-videos.ts`) only finds candidates and never shows a
  video. Every other recipe says no matching video is available, and keeps
  TheMealDB's text. A video an author adds themselves is labelled as theirs and
  not checked.
- **Nutrition:** calories, protein, carbs and fat per 100 g for about 500
  ingredients (`src/nutrition.ts`), rounded from USDA FoodData Central
  reference values, with dry goods at uncooked values. 94.6% of ingredient
  lines in the catalogue are counted; "salt to taste" can't be. Every figure
  is labelled an estimate.
- **Prices:** every catalogue ingredient has a checked price source in
  `src/data/price-sources.json`: a Woolworths or ALDI product reviewed by
  hand as that food in the form recipes use it (fresh garlic, not minced
  jars), a labelled stand-in when neither store sells it ("priced as white
  fish fillets"), another ingredient it's bought as (egg yolks as eggs), or a
  dated estimate from a named shop for niche food (dried shrimp from an Asian
  grocer). Tap water is free. Shelf prices were read from Woolworths' public
  product search and ALDI's category pages (paths their robots.txt allows)
  and are stamped with when they were read; none is called live. The rules
  are in `docs/product/pricing.md`.
- **Videos:** YouTube cooking videos with the channel named on every recipe
  page. For each one, the recipe was transcribed from the video's transcript or
  the creator's own written recipe and checked again by a second pass on 21
  October 2026 (`src/data/videos.json`, `transcribed: true`). 51
  recipes have one; the rest say no matching video is available.
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
