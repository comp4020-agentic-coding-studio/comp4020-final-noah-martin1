-- Sample reviewers: accounts that exist only to hold the example reviews
-- the demo seeds (src/sample-reviews.ts), so a recipe page shows what
-- reviews look like before real people write any. They can't be signed
-- into, every review they write is shown labelled "Sample", and removing
-- the demo removes them in one statement: DELETE FROM users WHERE is_sample.
ALTER TABLE users ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
CREATE INDEX users_sample ON users(is_sample) WHERE is_sample = 1;
