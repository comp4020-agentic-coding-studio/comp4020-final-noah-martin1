-- Live cooking: someone cooking a recipe step by step, seen by friends or the
-- whole world on the globe, with questions from watchers and answers back.

-- One row per time someone goes live. Location is city-level only: a picked
-- city's centre, or browser coordinates rounded to one decimal place (about
-- 11 km) before they ever reach this table. A session is live while ended_at
-- is NULL, it started under 3 hours ago, and the cook's page changed step or
-- checked in within the last 45 minutes (src/live.ts computes this at read
-- time and a sweep closes the stragglers).
CREATE TABLE cook_sessions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  serves       INTEGER NOT NULL CHECK (serves BETWEEN 1 AND 50),
  visibility   TEXT NOT NULL CHECK (visibility IN ('public', 'friends', 'private')),
  current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step >= 1),
  step_count   INTEGER NOT NULL CHECK (step_count >= 1),
  city         TEXT NOT NULL DEFAULT '',
  country      TEXT NOT NULL DEFAULT '',
  lat          REAL CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng          REAL CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  help_text    TEXT CHECK (help_text IS NULL OR length(help_text) <= 280),
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  active_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT,
  end_reason   TEXT CHECK (end_reason IN ('finished', 'ended', 'replaced', 'expired')),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
-- one live session per person: starting another ends the first
CREATE UNIQUE INDEX cook_sessions_one_open ON cook_sessions(user_id) WHERE ended_at IS NULL;
CREATE INDEX cook_sessions_open ON cook_sessions(ended_at, active_at);
CREATE INDEX cook_sessions_recipe ON cook_sessions(recipe_id);

-- While live the step only moves forward, so watchers never see a silent
-- rewind (src/live.ts enforces it too; this is the last line).
CREATE TRIGGER cook_sessions_no_rewind
BEFORE UPDATE OF current_step ON cook_sessions
WHEN NEW.current_step < OLD.current_step
BEGIN
  SELECT RAISE(ABORT, 'a live session never goes back a step');
END;

-- Watchers' questions ("can I use butter instead?") and the cook's answers.
CREATE TABLE cook_questions (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES cook_sessions(id) ON DELETE CASCADE,
  asker_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 280),
  answer      TEXT CHECK (answer IS NULL OR length(answer) BETWEEN 1 AND 280),
  asked_at    TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);
CREATE INDEX cook_questions_session ON cook_questions(session_id, id);

-- Append-only log of everything that happened in a session.
CREATE TABLE cook_events (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES cook_sessions(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('start', 'step', 'question', 'answer', 'help', 'end')),
  -- cascade rather than SET NULL: the log is never updated, only appended to
  actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  step       INTEGER,
  detail     TEXT,
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX cook_events_session ON cook_events(session_id, id);

CREATE TRIGGER cook_events_append_only
BEFORE UPDATE ON cook_events
BEGIN
  SELECT RAISE(ABORT, 'cook_events is append-only');
END;
