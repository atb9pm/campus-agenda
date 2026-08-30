-- Professions, contextes pédagogiques (PRF / BR / CTX) et rattachement des classes.
-- Migrations additives : aucune suppression de données existantes.
-- Pas de ON DELETE CASCADE : l'historique et les publications restent protégés.

CREATE TABLE IF NOT EXISTS admin_code_counters (
  kind TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS school_professions (
  id TEXT PRIMARY KEY,
  admin_code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  duration_years INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pedagogical_contexts (
  id TEXT PRIMARY KEY,
  admin_code TEXT NOT NULL UNIQUE,
  profession_id TEXT NOT NULL,
  training_year INTEGER NOT NULL,
  branch_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (profession_id, training_year, branch_id)
);

ALTER TABLE school_branches ADD COLUMN admin_code TEXT;
ALTER TABLE school_classes ADD COLUMN profession_id TEXT;
ALTER TABLE school_classes ADD COLUMN training_year INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_branches_admin_code
  ON school_branches (admin_code)
  WHERE admin_code IS NOT NULL;
