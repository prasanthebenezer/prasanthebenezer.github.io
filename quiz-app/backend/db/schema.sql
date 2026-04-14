CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  color    TEXT DEFAULT '#3b82f6',
  score    INTEGER DEFAULT 0,
  position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questions (
  id       SERIAL PRIMARY KEY,
  ext_id   TEXT,
  type     TEXT NOT NULL,
  question TEXT NOT NULL,
  options  JSONB,
  answer   TEXT NOT NULL,
  points   INTEGER DEFAULT 10,
  time_sec INTEGER DEFAULT 30,
  image    TEXT
);

CREATE TABLE IF NOT EXISTS rounds (
  id           SERIAL PRIMARY KEY,
  round_no     INTEGER NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,
  question_ids INTEGER[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS scores (
  id             SERIAL PRIMARY KEY,
  team_id        INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  question_id    INTEGER REFERENCES questions(id) ON DELETE CASCADE,
  round_id       INTEGER REFERENCES rounds(id) ON DELETE SET NULL,
  points_awarded INTEGER NOT NULL,
  was_passed     BOOLEAN DEFAULT FALSE,
  pass_level     INTEGER DEFAULT 0,
  result         TEXT NOT NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scores_team     ON scores(team_id);
CREATE INDEX IF NOT EXISTS idx_scores_round    ON scores(round_id);
CREATE INDEX IF NOT EXISTS idx_scores_question ON scores(question_id);

CREATE TABLE IF NOT EXISTS session_state (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  current_round_id    INTEGER,
  current_question_id INTEGER,
  current_team_id     INTEGER,
  pass_level          INTEGER DEFAULT 0,
  revealed            BOOLEAN DEFAULT FALSE,
  attempted           BOOLEAN DEFAULT FALSE,
  selected_option     TEXT,
  timer_started_at    TIMESTAMPTZ,
  timer_duration      INTEGER,
  CHECK (id = 1)
);

INSERT INTO session_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Idempotent migrations for existing deployments
ALTER TABLE session_state ADD COLUMN IF NOT EXISTS wrong_options  TEXT[]  DEFAULT '{}';
ALTER TABLE session_state ADD COLUMN IF NOT EXISTS removed_option TEXT;
ALTER TABLE session_state ADD COLUMN IF NOT EXISTS clue           TEXT;
ALTER TABLE session_state ADD COLUMN IF NOT EXISTS hint_level     INTEGER DEFAULT 0;
