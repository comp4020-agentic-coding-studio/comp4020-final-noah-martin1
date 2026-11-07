-- Who can watch you cook live, chosen apart from who sees the recipes you
-- write: live defaults to everyone (it's for the room), recipes stay
-- friends-only by default. Never wider than the recipe itself allows
-- (clampVisibility in src/live.ts), so cooking a private recipe stays private.
--
-- Everyone moves to public, except someone who had deliberately chosen
-- "Only me" as their default: that choice carries over to live.
ALTER TABLE users ADD COLUMN live_visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (live_visibility IN ('public', 'friends', 'private'));

UPDATE users SET live_visibility = 'private' WHERE default_visibility = 'private';
