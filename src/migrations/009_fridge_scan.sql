-- Photo-to-pantry corrections: when someone saves a scanned suggestion under
-- a different name, the pair is kept for them so the next scan proposes
-- their name straight away. One row per person per detected name; a later
-- correction replaces an earlier one.
CREATE TABLE scan_corrections (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  detected   TEXT NOT NULL,
  corrected  TEXT NOT NULL,
  times      INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, detected)
);
