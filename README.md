# Larder

**For markers: no setup needed.** Sign in as `alice` in one Chrome profile and
`sam` in the other (password `password123` for both; please don't change it,
other markers use these accounts). They share a household with a stocked
kitchen; you can also register your own.

- **Real-time:** as alice, open a public recipe and press **Cook step by
  step**; as sam, follow that pan from **Live globe** while the steps move. Or
  start writing a review: the other profile sees the typing, then the review.
- **Multi-user:** in **Household → Shared shopping**, press **I've got this**
  as alice; sam's list shows it claimed.
- **Persists:** add something in **Fridge & pantry**, sign out, come back
  tomorrow.
- **Scanning (optional):** **Fridge & pantry → Scan a photo**. Everything is
  read in your browser; the photo model is a 1.4 GB download.

Larder is a shared kitchen for a household. The fridge and pantry are a 3D
model of what you actually have, with dates and what you paid. Recipes know
what's in it and what's missing, the calendar plans a costed week, and
housemates split one shopping list. When you cook you can go live, and friends or anyone
can follow your steps on a globe.

## What "good" means here

Food goes off because nobody remembered it was there, and two housemates plan
around the same last eggs. What would fix that lives in people's heads, where
it can't be shared and goes stale. Larder is good if a household trusts it over their memory, which
asks four things of it:

- **Truthful about the kitchen.** What you hold, what's missing and what it
  costs come from arithmetic over your own data. An unknown price is named,
  never counted as free. AI may reword an answer or suggest a name; it never
  decides one.
- **Private by default, shared on purpose.** Recipes and meals are friends-only by default; cooking live is for everyone unless you narrow it. A friendship needs both people. Something
  you can't see looks the same as something that doesn't exist.
- **Present, not loud.** You see a housemate claim the milk, or a friend's pan
  move on the globe, as it happens, and nothing pings you outside the app.
- **Nothing lost, nobody left out.** One database on the server's volume
  survives restarts and redeploys, and every page works without JavaScript,
  by keyboard and at phone width.

## What I read

Robin Sloan's
["An app can be a home-cooked meal"](https://www.robinsloan.com/notes/home-cooked-app/)
(2020) is about a messaging app he built for his family of four, replacing one
whose whole value was a quiet sense that the others were there. Larder takes
both ideas: the household is the user, not a market, and a claimed item or a
housemate typing tells you the house is alive without asking for a reply. It
departs from his simplicity. A kitchen is only useful with quantities, dates
and prices, so Larder is large where his app is tiny, and that size is what
`spec/` is for.

Clay Shirky's
["Situated Software"](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware.html)
(2004) argues that software built for one group can rely on its "existing
social fabric" instead of code: a group-buying tool can flag an unpaid share
and leave the chasing to the group, where a web-scale app would need escrow.
Larder does this inside a household, where **I've got this** is a promise
between housemates. But public recipes and the globe reach strangers who share
no fabric, so at that edge the software enforces: every visibility decision
goes through one file, and only a city-level location is ever stored. Situated
inside, enforced at the edge.

## Checked, measured, judged

- **Checked** by `spec/`, against the running app, and a failing check blocks
  the deploy: the kitchen's arithmetic (`pricing`, `shopping`, `expiry`,
  `planner-budget`), privacy at every edge (`visibility`, `household`, `live`,
  `reviews`), AI staying advisory (`assistant`, `scan-tools`), and a restart
  keeping what visitors added (`demo-refresh`). The rules the agent works under
  are in
  [`docs/ARCHITECTURAL_GUIDELINES.md`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-noah-martin1/blob/main/docs/ARCHITECTURAL_GUIDELINES.md).
- **Measured**, not pass or fail: how well scanning works, photo by photo and
  receipt by receipt, in `testing/results.md`. Receipts read in the browser
  name 91% of items correctly.
- **Judged:** whether pages feel calm and clear, and whether the 3D kitchen is
  a pleasure to use, from screenshots at phone and desktop widths, in light and
  dark, against the visual direction in the guidelines.

## Not built, on purpose

No notifications outside the app, no followers (a friendship is mutual or it
isn't there) and no shopping-list export, because none of them makes the core
loop of knowing what you have, cooking it and sharing it any better. Kept
honest instead: nutrition is an estimate, shelf prices are dated rather than
live, and the globe's demo cooks sit under a preview banner.

## Sources

Data from [TheMealDB](https://www.themealdb.com/) (recipes), USDA FoodData
Central (nutrition), [Open Food Facts](https://world.openfoodfacts.org)
(barcodes) and [NASA Visible Earth](https://visibleearth.nasa.gov/) (the
globe), drawn with [three.js](https://threejs.org/); every model runs in your
browser. Full provenance, and every claim the tests check, are in
[`docs/details.md`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-noah-martin1/blob/main/docs/details.md).
