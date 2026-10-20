-- Who did what (crit 10), expired food leaving the kitchen on its own,
-- uploaded recipe photos, cooking live by default, and prices people paid.

-- Append-only, server-side record of what each person did. It lives in the
-- database on the volume, so it outlives restarts, redeploys and the crit.
-- Never holds passwords, tokens or free text someone typed beyond a short
-- subject (a recipe title, an ingredient name).
CREATE TABLE activity_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- "recipe.create", "pantry.auto_remove", "prices.refresh_failed", ...
  action     TEXT NOT NULL,
  outcome    TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'denied', 'failed')),
  subject    TEXT NOT NULL DEFAULT '',
  -- small JSON object of non-sensitive facts (ids, counts, reasons)
  detail     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX activity_log_actor ON activity_log(actor_id, id);
CREATE INDEX activity_log_action ON activity_log(action, id);

CREATE TRIGGER activity_log_append_only
BEFORE UPDATE ON activity_log
BEGIN
  SELECT RAISE(ABORT, 'activity_log is append-only');
END;

-- Expiry: an item stays usable through its expiry date; the next day is a
-- one-day grace period in which the owner is asked "Do you still have
-- this?"; after that it leaves the active inventory by itself. The row is
-- kept (removed_at set), so history and reporting still see it.
ALTER TABLE inventory_items ADD COLUMN removed_at TEXT;
ALTER TABLE inventory_items ADD COLUMN removed_reason TEXT
  CHECK (removed_reason IS NULL OR removed_reason IN ('expired', 'gone'));
-- the owner said they still have it after its date: never removed for that
-- date, and counted as stock again
ALTER TABLE inventory_items ADD COLUMN kept_at TEXT;
CREATE INDEX inventory_active ON inventory_items(owner_type, owner_id) WHERE removed_at IS NULL;

-- Uploaded recipe photos, stored in the database on the volume ($DATA_DIR).
CREATE TABLE recipe_images (
  id         INTEGER PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes      BLOB NOT NULL,
  width      INTEGER,
  height     INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every recipe written from now on has a photo. Recipes from before this
-- migration keep working (their authors are asked to add one); new rows and
-- edits can't drop it, whichever code path writes them.
CREATE TRIGGER recipes_need_image_insert
BEFORE INSERT ON recipes
WHEN NEW.image_url IS NULL OR trim(NEW.image_url) = ''
BEGIN
  SELECT RAISE(ABORT, 'a recipe needs an image');
END;

CREATE TRIGGER recipes_keep_image_update
BEFORE UPDATE OF image_url ON recipes
WHEN NEW.image_url IS NULL OR trim(NEW.image_url) = ''
BEGIN
  SELECT RAISE(ABORT, 'a recipe needs an image');
END;

-- Cooking live by default, and where/for whom an automatic session appears.
-- Location defaults to "not on the map": going live automatically never
-- places someone anywhere they didn't choose.
ALTER TABLE users ADD COLUMN auto_live INTEGER NOT NULL DEFAULT 1 CHECK (auto_live IN (0, 1));
ALTER TABLE users ADD COLUMN live_city TEXT NOT NULL DEFAULT '';

-- Prices people paid for a package, for budgeting future shops. Kept until
-- the person replaces or deletes it; never overwritten by an online price.
CREATE TABLE user_prices (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  price_cents   INTEGER NOT NULL CHECK (price_cents > 0),
  size_amount   REAL NOT NULL CHECK (size_amount > 0),
  size_unit     TEXT NOT NULL CHECK (size_unit IN ('g', 'ml', 'each')),
  retailer      TEXT NOT NULL DEFAULT '',
  product       TEXT NOT NULL DEFAULT '',
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- the pantry item it was recorded from, if any
  inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL
);
CREATE INDEX user_prices_user ON user_prices(user_id, ingredient_id);
