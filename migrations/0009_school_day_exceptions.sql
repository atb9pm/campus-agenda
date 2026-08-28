-- Corrections manuelles des jours d'une année scolaire (fêtes, jours rattrapés).
-- Seules les exceptions sont stockées : la grille des jours reste calculée.

CREATE TABLE IF NOT EXISTS school_day_exceptions (
  school_year_id TEXT NOT NULL,
  day_date TEXT NOT NULL,
  day_state TEXT NOT NULL,
  label TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (school_year_id, day_date)
);

CREATE INDEX IF NOT EXISTS idx_school_day_exceptions_year
  ON school_day_exceptions (school_year_id);
