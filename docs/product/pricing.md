# Pricing and budgeting

How Larder works out what food costs. The rules live in `src/pricing.ts`
(package purchases and cost to make), `src/products.ts` (retailer listings
and the checked price sources) and `src/nutrition.ts` (reference prices and
conversions); every page that shows a price calls them rather than doing its
own arithmetic. Tests: `spec/pricing.test.ts`, `spec/products.test.ts`,
`spec/shopping.test.ts`, `spec/price-sources.test.ts`.

## The quantities, kept apart

| Concept | Meaning | Where it's shown |
| --- | --- | --- |
| Cost to make (consumption cost) | The value of the amounts a recipe uses, from an empty kitchen, each at the rate of the pack the checkout would buy (`costToMake`) | Recipe "What it costs" and "Per serve"; "Used by these meals" on the shopping list |
| Cost per serve | Cost to make ÷ the recipe's servings | Recipe tiles and "Per serve" |
| Purchase quantity | What's still needed after usable pantry stock, summed across every planned meal | Shopping list amounts |
| Package purchase | Whole packs covering the purchase quantity: `ceil(need / pack size)` | Each shopping line ("1 × White Mill Plain Flour 2kg") |
| Checkout cost | What those packs cost | "At the checkout" on the shopping list, calendar budget, home, household ticker |
| At the checkout, from an empty kitchen | Whole packs for the recipe as written, owning nothing | Recipe "What it costs" |
| At the checkout, after your pantry | Whole packs after your usable stock (signed in) | Recipe "What it costs" |
| Budget total | Compared against **checkout cost** everywhere | Shopping list, calendar, home, household |

200 g of flour with none at home buys the whole bag ($2.39 for 2 kg at ALDI)
and uses $0.24 of it. Holding 500 g buys nothing.

Cost to make and the checkout come from the same engine, so they never
disagree about what an ingredient costs; they differ only in whole packs and
your pantry. A total that leaves out an ingredient with no price at all
shows a "+" and the recipe names the ingredient; a tile shows no per-serve
price, and the planner never ranks such a meal on cost (a lamb bake with no
lamb once read $5.50).

## Where each ingredient's price comes from

`src/data/price-sources.json` holds, for every catalogue ingredient, one of:

- **products**: Woolworths or ALDI products checked by hand to be that food,
  in the form recipes use it (fresh garlic, not a jar of minced garlic), by
  store product code. A piece cut to no fixed weight ("Lamb Shoulder Roast
  1.1kg - 1.7kg", $18/kg) is bought whole at its middle weight and used at
  its price per kilogram.
- **similar**: the nearest product when the stores don't sell the food, with
  a note the recipe shows ("No store sells monkfish: priced as white fish
  fillets").
- **from**: bought as another ingredient, with how much of it one unit takes
  (two egg yolks buy a carton of eggs; a teaspoon of zest is a third of a
  lemon; flank steak at 1.3 times a stewing cut). The same food under two
  names is one entry and a link, so no product prices two names.
- **estimate**: a dated price from a named shop for food neither store sells
  (dried shrimp from an Asian grocer), with its pack, always labelled as an
  estimate.
- **reference**: the dated reference shelf price, for fresh produce whose
  listings were all jars or tins.
- **free**: tap water: never bought, never missing from a pantry.

`scripts/build-price-sources.ts` builds the file from reviewed decisions and
refuses to write it if a product prices two names, a link ends at an
unpriced ingredient, or a stand-in has no note. `spec/price-sources.test.ts`
checks the same rules on the committed file, and that every catalogue
ingredient has a source.

## Prices people give

Writing a recipe, each ingredient shows what Larder prices it at (the
product, or the stand-in and why), asks "what did you pay?" when there's no
price, and takes a correction (`/prices`). A price someone gives is theirs:
it prices their own recipes and shopping (like a price recorded from a
pantry item) and is logged (`price.record`) so corrections can be reviewed
into the shared data. It never changes anyone else's prices by itself.

## Steps (src/pricing.ts `purchasePlan`)

1. Each planned meal is scaled to the servings the person cooks for
   (`default_servings ÷ recipe servings`). House meals use the recipe's own
   servings.
2. Ingredient amounts are converted to a base unit (g, ml or each) and summed
   per ingredient. Mass, volume and count are only converted through exact
   units (kg, l, tsp, tbsp, cup) or the ingredient's own listed density, cup
   weight or weight per item (`conversionFor`). Kitchen units like "clove" or
   "bunch" go through the food table's rules of thumb and are marked `~`.
3. Usable stock is subtracted (src/expiry.ts decides what counts: unexpired,
   or expired and kept by its owner). Stock in a unit that can't be compared is
   flagged "check", never guessed away.
4. For what's left, every way to buy it is compared: prices the person (or a
   housemate) recorded, Woolworths and ALDI listings, and as a last resort the
   dated reference shelf price. The cheapest option that covers the amount in
   whole packs wins; ties go to less waste. The reason is shown ("ALDI saves
   $1.50 over Woolworths for the same amount").
5. A second line for the same ingredient (another unit, or "to taste") comes
   out of the first pack's leftover when it fits, so no second pack is bought.
6. Anything with no compatible pack price is **unpriced**: listed, never
   treated as free, and kept out of the checkout total. Its reference-rate
   value is shown as a labelled estimate.

The week's calendar total pools shared ingredients the same way, so it's
never more than the dinners priced one by one; the planner keeps each draft
week under the budget on that basis.

## Where prices come from

- **Woolworths and ALDI listings** (`src/data/products.json`):
  `node scripts/refresh-prices.ts` reads Woolworths' public product search
  and ALDI's category pages (both allowed by the sites' robots.txt; about 3
  requests a second) and stores each product's name, pack size, shelf price,
  link and the time it was read. The app never scrapes at request time: the
  256 MB machine sleeps when idle and the retailers shouldn't be hit per
  page view. Every price says when it was read; after 3 days it also says
  "may have changed". Nothing is described as a live price.
- **Like for like** (`isEquivalent`): a product only counts for an
  ingredient when it *is* that ingredient. "Lemon & Pepper Tuna" isn't
  lemons, "Garlic Naan" isn't garlic, ground coriander isn't a coriander
  bunch, and non-food results (hand wash, bath mats) are dropped. Diced
  tomatoes do count for "canned tomatoes".
- **Prices people paid** (`user_prices`): a pantry item entered with a price
  records what that pack cost (its quantity and unit). It's kept until the
  person edits or removes that item, is never overwritten by a higher shelf
  price, and only applies to the same pack size: $2 for 500 g is never
  stretched to a 1 kg pack. Kitchen units ("1 jar") aren't recorded.
- **Reference prices** (`src/data/prices.json`): 504 dated per-100 g prices
  for consumption estimates, each with its source and month. The 54 that are
  named shelf readings ("ALDI shelf price: White Mill Plain Flour 2kg,
  $2.39") also give a pack, used only when no current listing exists.
  "Typical" prices never become packs.

## Refreshing prices

```sh
node scripts/refresh-prices.ts      # about 6–7 minutes; writes src/data/products.json
```

It prints one JSON line when it finishes (`prices.refresh`, or
`prices.refresh_failed` with the blocked retailer); a blocked retailer keeps
what was read. Commit the new file and deploy. If neither retailer can be
read, the previous file stays in place and its read date shows its age.

## Known limits

- Prices are read when the script runs, not continuously. Specials,
  member prices and stock levels at a particular store aren't known.
- Loose produce sold per kilogram has no fixed pack; it's priced by weight
  only where a dated per-kg reference exists.
- A handful of counted things with no weight per piece (half a breadfruit,
  a pack of vinaigrette) can't be turned into a pack; the recipe names them.
