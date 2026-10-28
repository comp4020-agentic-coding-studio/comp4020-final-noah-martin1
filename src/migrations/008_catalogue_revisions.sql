-- Which version of its catalogue entry a seeded recipe holds. When
-- src/data/catalogue.json changes a recipe (rewritten to match its video),
-- the hash differs and seeding rewrites that recipe in place, keeping its id
-- so calendar entries, cook history and links still point at it.
ALTER TABLE recipes ADD COLUMN source_hash TEXT;
