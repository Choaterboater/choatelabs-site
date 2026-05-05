-- LUMINA leaderboard schema
-- Run with: wrangler d1 execute lumina-leaderboard --file=lumina-schema.sql --remote

-- Global all-time scores
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,           -- anonymous UUID stored client-side in localStorage
  initials TEXT NOT NULL,            -- 3 char display name (uppercased, A-Z)
  score INTEGER NOT NULL,
  combo INTEGER NOT NULL,            -- max combo this run, integer (0-12)
  duration_ms INTEGER NOT NULL,      -- run length, helps anti-cheat
  perfects INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL        -- unix epoch seconds
);

-- One row per player only (best score). Fast top-N query.
CREATE INDEX IF NOT EXISTS idx_scores_top ON scores (score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player ON scores (player_id);

-- Daily challenge scores: keyed by date so each day starts fresh
CREATE TABLE IF NOT EXISTS scores_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_date TEXT NOT NULL,      -- YYYY-MM-DD UTC
  player_id TEXT NOT NULL,
  initials TEXT NOT NULL,
  score INTEGER NOT NULL,
  combo INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  perfects INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (challenge_date, player_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_top ON scores_daily (challenge_date, score DESC);

-- Aggregate counters for fairness checks (rate-limit, sanity)
CREATE TABLE IF NOT EXISTS submit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  ip_hash TEXT,                      -- SHA-256 of request IP, for soft-limit
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submit_log_player_time ON submit_log (player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_submit_log_ip_time ON submit_log (ip_hash, created_at);
