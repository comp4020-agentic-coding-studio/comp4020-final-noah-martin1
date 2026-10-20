-- A recipe's how-to video. Catalogue recipes get the one TheMealDB links to
-- that meal, checked against YouTube (src/data/videos.json, src/videos.ts);
-- 'user' is a link its author added, never checked against the recipe.
ALTER TABLE recipes ADD COLUMN video_id TEXT CHECK (video_id IS NULL OR length(video_id) = 11);
ALTER TABLE recipes ADD COLUMN video_title TEXT;
ALTER TABLE recipes ADD COLUMN video_channel TEXT;
ALTER TABLE recipes ADD COLUMN video_checked TEXT;
ALTER TABLE recipes ADD COLUMN video_status TEXT
  CHECK (video_status IS NULL OR video_status IN ('verified', 'unavailable', 'rejected', 'user'));
