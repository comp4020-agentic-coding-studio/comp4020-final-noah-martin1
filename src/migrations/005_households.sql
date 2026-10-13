-- Households: people who live together sharing one pantry, one meal calendar
-- and one shopping list. Shared stock and house meals reuse inventory_items
-- and calendar_entries with owner_type = 'household' (allowed since 001), so
-- this migration only adds who belongs where, the two kinds of claim, and a
-- log of what happened in the house.

-- AUTOINCREMENT so a deleted household's id is never handed to a new one:
-- inventory_items and calendar_entries point at it by owner_id, without a
-- foreign key, and a reused id must never inherit anything.
CREATE TABLE households (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  -- what a housemate types to join; regenerating it stops the old one working
  invite_code         TEXT NOT NULL UNIQUE,
  weekly_budget_cents INTEGER CHECK (weekly_budget_cents IS NULL OR weekly_budget_cents >= 0),
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One household per person (user_id UNIQUE) keeps "the house" unambiguous on
-- every page. The last member leaving deletes the household (src/household.ts).
CREATE TABLE household_members (
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (household_id, user_id)
);

-- "I've got this" on the shared shopping list: one claimer per ingredient per
-- house, so two people never buy the same thing. The primary key makes the
-- first claim win when two arrive together.
CREATE TABLE shopping_claims (
  household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  claimed_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (household_id, ingredient_id)
);

-- The expiry race: "I'll use it tonight" on a shared item about to go off.
-- One claim per item; a claim for an earlier date is stale and can be taken.
CREATE TABLE item_claims (
  inventory_item_id INTEGER PRIMARY KEY REFERENCES inventory_items(id) ON DELETE CASCADE,
  claimed_by        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  for_date          TEXT NOT NULL,
  claimed_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only house activity: the overview's feed, the pantry nudges, and the
-- version number the page polls to know something changed. A nudge with
-- for_user set is shown to that person only (it was worked out from their
-- own pantry); with for_user NULL it is about a house meal and everyone sees it.
CREATE TABLE household_events (
  id           INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN (
                 'created', 'joined', 'left', 'renamed', 'code', 'budget',
                 'added', 'moved', 'updated', 'removed', 'bought',
                 'planned', 'cooked', 'skipped', 'unplanned',
                 'claimed', 'unclaimed', 'tonight', 'released', 'nudge')),
  subject      TEXT NOT NULL DEFAULT '',
  recipe_id    INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
  ref_date     TEXT,
  for_user     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX household_events_house ON household_events(household_id, id);
