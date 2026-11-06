-- Reviews of recipes, replies to them, likes, photos and links to other
-- recipes, plus the cooking-character picture people show beside their name.
--
-- A review outlives its author's account: author_id is SET NULL when the
-- account goes, so the words, stars and photos stay on the recipe while the
-- name and picture are gone ("Deleted account"). It goes with the recipe:
-- a review of a deleted recipe has nowhere to be shown.

-- one of the app's own animated cooking characters (src/avatars.ts), or
-- NULL for the initials badge everyone starts with
ALTER TABLE users ADD COLUMN avatar TEXT;

CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- NULL for a review; the review it answers for a reply. Replies are one
  -- level deep: a reply to a reply hangs off the same review, naming who
  -- it answers in reply_to_id.
  parent_id   INTEGER REFERENCES reviews(id) ON DELETE CASCADE,
  reply_to_id INTEGER REFERENCES reviews(id) ON DELETE SET NULL,
  -- a review carries 1-5 stars; a reply carries none
  rating      INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  body        TEXT NOT NULL CHECK (length(body) <= 2000),
  -- detected from the words when written (src/language.ts): what the
  -- language filter and the translate button go by
  lang        TEXT NOT NULL DEFAULT 'und',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  edited_at   TEXT,
  -- deleted by its writer while it had replies: kept as "[deleted]" so the
  -- thread still reads
  deleted_at  TEXT,
  CHECK ((parent_id IS NULL AND (rating IS NOT NULL OR deleted_at IS NOT NULL)) OR (parent_id IS NOT NULL AND rating IS NULL))
);
CREATE INDEX reviews_recipe ON reviews(recipe_id, parent_id, created_at);
CREATE INDEX reviews_parent ON reviews(parent_id, created_at);
CREATE INDEX reviews_author ON reviews(author_id);
-- one review per person per recipe (edit it instead); deleted accounts and
-- replies aren't counted
CREATE UNIQUE INDEX reviews_one_each ON reviews(recipe_id, author_id)
  WHERE parent_id IS NULL AND author_id IS NOT NULL AND deleted_at IS NULL;

-- a like is a person's: it goes when they unlike or their account goes
CREATE TABLE review_likes (
  review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (review_id, user_id)
);
CREATE INDEX review_likes_user ON review_likes(user_id);

-- Photos on reviews. Kept apart from recipe_images, whose rows go with their
-- uploader's account: a review's photos stay with the review. A photo is
-- uploaded before the review is posted, so review_id is NULL until then
-- (owner_id says whose it is); unattached photos are swept after a day.
CREATE TABLE review_images (
  id         INTEGER PRIMARY KEY,
  review_id  INTEGER REFERENCES reviews(id) ON DELETE CASCADE,
  owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes      BLOB NOT NULL,
  width      INTEGER,
  height     INTEGER,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX review_images_review ON review_images(review_id, position);
CREATE INDEX review_images_loose ON review_images(owner_id) WHERE review_id IS NULL;

-- Other recipes a review points to ("I served it with ..."). Only recipes
-- the writer could see are linked, and a reader is shown only the ones they
-- can see too (src/visibility.ts), so a link never leaks a private title.
CREATE TABLE review_recipe_links (
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (review_id, recipe_id)
);

-- The activity log is append-only (migration 006), but a log row's actor
-- is set to NULL when their account is deleted (ON DELETE SET NULL), which
-- that trigger refused, so no account with any history could be deleted.
-- What happened stays unchangeable; only forgetting who did it is allowed.
DROP TRIGGER activity_log_append_only;
CREATE TRIGGER activity_log_append_only
BEFORE UPDATE ON activity_log
WHEN NOT (NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
  AND NEW.id = OLD.id AND NEW.at = OLD.at AND NEW.action = OLD.action AND NEW.outcome = OLD.outcome
  AND NEW.subject = OLD.subject AND NEW.detail = OLD.detail)
BEGIN
  SELECT RAISE(ABORT, 'activity_log is append-only');
END;
