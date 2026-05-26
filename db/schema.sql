-- AI Clinical Trial Cards — Postgres schema
--
-- Run once against your Neon database. Safe to re-run (uses IF NOT EXISTS).
-- From this folder:  node db/migrate.js

CREATE TABLE IF NOT EXISTS cards (
  paper_id      SERIAL PRIMARY KEY,
  paper_title   TEXT NOT NULL UNIQUE,
  data          JSONB NOT NULL,
  created_by    TEXT,
  status        TEXT NOT NULL DEFAULT 'published',
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS card_edits (
  id         SERIAL PRIMARY KEY,
  paper_id   INT NOT NULL REFERENCES cards(paper_id) ON DELETE CASCADE,
  edited_by  TEXT,
  edited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changes    JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS card_edits_paper_id_idx ON card_edits(paper_id);
