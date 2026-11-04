-- Small facts the app records about itself, e.g. which version of the demo
-- kitchen has been built, so a one-off rebuild runs once per deploy rather
-- than on every machine start (the Fly machine stops when idle and boots on
-- the next request).
CREATE TABLE app_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
