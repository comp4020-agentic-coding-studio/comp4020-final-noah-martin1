-- Per-person preferences: what the shopping list budgets against now, and
-- what the meal planner (crit 10) filters by.

ALTER TABLE users ADD COLUMN weekly_budget_cents INTEGER
  CHECK (weekly_budget_cents IS NULL OR weekly_budget_cents >= 0);
ALTER TABLE users ADD COLUMN dietary_prefs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN dislikes TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN default_visibility TEXT NOT NULL DEFAULT 'friends'
  CHECK (default_visibility IN ('public', 'friends', 'private'));
ALTER TABLE users ADD COLUMN default_servings INTEGER NOT NULL DEFAULT 2
  CHECK (default_servings > 0);
