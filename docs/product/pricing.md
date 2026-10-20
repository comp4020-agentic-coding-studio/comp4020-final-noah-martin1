# Pricing and budgeting

How Larder works out what food costs. The rules live in `src/pricing.ts`
(package purchases), `src/products.ts` (retailer listings) and
`src/nutrition.ts` (reference prices and conversions); every page that shows
a price calls them rather than doing its own arithmetic. Tests:
`spec/pricing.test.ts`, `spec/products.test.ts`, `spec/shopping.test.ts`.

## The quantities, kept apart

| Concept | Meaning | Where it's shown |
| --- | --- | --- |
| Consumption cost | The value of the amount a recipe uses, at a reference or pack rate | Recipe "Per serve" card; "Used by these meals" on the shopping list |
| Cost per serve | Consumption cost of the recipe batch ÷ its servings | Recipe tiles and "Per serve" |
| Purchase quantity | What's still needed after usable pantry stock, summed across every planned meal | Shopping list amounts |
| Package purchase | Whole packs covering the purchase quantity: `ceil(need / pack size)` | Each shopping line ("1 × White Mill Plain Flour 2kg") |
| Checkout cost | What those packs cost | "At the checkout" on the shopping list, calendar budget, home, household ticker, recipe "To cook it as written" |
| Budget total | Compared against **checkout cost** everywhere | Shopping list, calendar, home, household |

200 g of flour with none at home buys the whole bag ($2.39 for 2 kg at ALDI)
and uses $0.24 of it. Holding 500 g buys nothing.

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
- About a quarter of catalogue ingredients have no like-for-like listing
  (bay leaves, fresh tomatoes, pecans); those use the reference estimate or
  stay unpriced.
