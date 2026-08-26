-- Année scolaire configurable (phase 2.0) : plan des semaines A/B en base.

CREATE TABLE IF NOT EXISTS school_years (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  source_filename TEXT,
  imported_at TEXT,
  activated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS school_weeks (
  school_year_id TEXT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 38),
  week_kind TEXT NOT NULL CHECK (week_kind IN ('A', 'B')),
  monday TEXT NOT NULL,
  PRIMARY KEY (school_year_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_school_years_status ON school_years(status);
