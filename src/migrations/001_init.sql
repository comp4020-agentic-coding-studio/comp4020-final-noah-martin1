-- Phase 0: accounts, friends, recipes, personal inventory and calendar.
-- Households, reservations and cook sessions arrive in later migrations.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE auth_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);

-- One row per pair, stored with user_a < user_b so a pair can't exist twice.
CREATE TABLE friendships (
  id           INTEGER PRIMARY KEY,
  user_a       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  CHECK (user_a < user_b),
  CHECK (requested_by IN (user_a, user_b)),
  UNIQUE (user_a, user_b)
);

CREATE TABLE ingredients (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  default_unit TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'other'
);

CREATE TABLE inventory_items (
  id            INTEGER PRIMARY KEY,
  owner_type    TEXT NOT NULL CHECK (owner_type IN ('user', 'household')),
  owner_id      INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity      REAL NOT NULL CHECK (quantity >= 0),
  unit          TEXT NOT NULL DEFAULT '',
  expiry_date   TEXT,
  price_cents   INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  added_by      INTEGER NOT NULL REFERENCES users(id),
  added_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX inventory_owner ON inventory_items(owner_type, owner_id);

CREATE TABLE recipes (
  id           INTEGER PRIMARY KEY,
  author_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  servings     INTEGER NOT NULL DEFAULT 2 CHECK (servings > 0),
  visibility   TEXT NOT NULL CHECK (visibility IN ('public', 'friends', 'private')),
  dietary_tags TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX recipes_author ON recipes(author_id);

CREATE TABLE recipe_ingredients (
  recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity      REAL CHECK (quantity IS NULL OR quantity >= 0),
  unit          TEXT NOT NULL DEFAULT '',
  optional      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (recipe_id, position)
);

CREATE TABLE recipe_steps (
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  text        TEXT NOT NULL,
  est_minutes INTEGER CHECK (est_minutes IS NULL OR est_minutes >= 0),
  PRIMARY KEY (recipe_id, step_number)
);

CREATE TABLE calendar_entries (
  id         INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'household')),
  owner_id   INTEGER NOT NULL,
  date       TEXT NOT NULL,
  meal       TEXT NOT NULL DEFAULT 'dinner' CHECK (meal IN ('breakfast', 'lunch', 'dinner')),
  recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  planned_by INTEGER NOT NULL REFERENCES users(id),
  status     TEXT NOT NULL DEFAULT 'planned'
             CHECK (status IN ('planned', 'live', 'completed', 'cancelled')),
  shared     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX calendar_owner_date ON calendar_entries(owner_type, owner_id, date);
