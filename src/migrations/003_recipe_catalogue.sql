-- The shared recipe catalogue: photos, cuisine and course for browsing, prep
-- and cook times, and a source key so seeding the catalogue is idempotent.
-- Catalogue recipes belong to a system "larder" account and are public.

ALTER TABLE recipes ADD COLUMN image_url TEXT;
ALTER TABLE recipes ADD COLUMN cuisine TEXT NOT NULL DEFAULT '';
ALTER TABLE recipes ADD COLUMN course TEXT NOT NULL DEFAULT '';
ALTER TABLE recipes ADD COLUMN prep_minutes INTEGER CHECK (prep_minutes IS NULL OR prep_minutes >= 0);
-- Active cooking time. NULL means "add up the step timers" (people's own
-- recipes); the catalogue sets it, since its steps don't all carry a timer.
ALTER TABLE recipes ADD COLUMN cook_minutes INTEGER CHECK (cook_minutes IS NULL OR cook_minutes >= 0);
ALTER TABLE recipes ADD COLUMN source TEXT;
CREATE UNIQUE INDEX recipes_source ON recipes(source) WHERE source IS NOT NULL;

-- Free-text preparation notes ("finely chopped", "to serve") per ingredient.
ALTER TABLE recipe_ingredients ADD COLUMN note TEXT NOT NULL DEFAULT '';
