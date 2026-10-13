# Larder

Larder is a shared kitchen for people who cook together. You keep track of
your pantry, with expiry dates and what you paid. You write recipes that know
what's in your kitchen, and cook them step by step. You plan meals on a
calendar, share them with friends, and get a shopping list priced against your
budget. Later phases add a shared household pantry where housemates reserve
ingredients live, a "who's cooking right now" feed you can cook along with, and
a planner that suggests meals from what's expiring and what you can afford.

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
over your pantry, never from a guess. When the AI planner arrives it can
explain a pick, but it can't change the maths.

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

Other parts can only be judged: whether the pages are clear, whether the
calendar is pleasant to plan with, whether the feed is worth reading.

## Not built yet (on purpose)

Live features (household reservations, live cooking, the real-time feed) come
in crit 9, and the budget-aware AI planner comes in crit 10. Their pages exist
now as previews with sample data, each under a banner that says so (a test
checks it), so the shape of the whole platform can be judged early without
anything pretending to work. There's no shopping list export, and a recipe's
nutrition and cost are estimates from a small built-in food table, not a full
nutrition database. Either would add scope without making the core loop
(know what you have, cook it, share it) any better.

## Sources

To be added: food waste research, and the cooking and pantry apps reviewed
while scoping.
