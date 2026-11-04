-- A photo or receipt scan runs in the background: the upload creates a job,
-- the server works through it and records progress, and the person's page
-- polls until it's ready to review. Each job belongs to one person; nobody
-- else can read it. The photo is kept only until the job is a day old.
CREATE TABLE scan_jobs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('photo', 'receipt')),
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  -- passes finished and planned (whole photo plus bands), for the progress bar
  step        INTEGER NOT NULL DEFAULT 0,
  steps       INTEGER NOT NULL DEFAULT 1,
  mime        TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  image       BLOB,
  -- the review rows as JSON once done; the reason once failed
  result      TEXT,
  error       TEXT,
  model       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX scan_jobs_user ON scan_jobs(user_id, created_at);
