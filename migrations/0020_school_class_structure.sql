-- Structure des classes : abreviation metier des professions, groupes paralleles,
-- unicite annuelle du code de classe (meme code possible d une annee a l autre).
-- Recree school_classes pour retirer UNIQUE(code) inline (SQLite).
-- Conserve toutes les colonnes et tous les IDs. Pas de ON DELETE CASCADE.
-- Le bloc CAMPUS:BEGIN/END ONCE n est execute qu une seule fois.

ALTER TABLE school_professions ADD COLUMN class_code_prefix TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_professions_class_code_prefix
  ON school_professions (class_code_prefix)
  WHERE class_code_prefix IS NOT NULL;

ALTER TABLE school_classes ADD COLUMN parallel_code TEXT;

-- CAMPUS:BEGIN ONCE 0020_school_class_structure.sql
DROP TABLE IF EXISTS school_classes_structure_0020;

CREATE TABLE school_classes_structure_0020 (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  school_year_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  profession_id TEXT,
  training_year INTEGER,
  school_year_id TEXT,
  parallel_code TEXT
);

DELETE FROM school_classes_structure_0020;

INSERT INTO school_classes_structure_0020 (
  id, code, label, sort_order, is_active, school_year_label, created_at,
  profession_id, training_year, school_year_id, parallel_code
)
SELECT
  id, code, label, sort_order, is_active, school_year_label, created_at,
  profession_id, training_year, school_year_id, parallel_code
FROM school_classes;

DROP TABLE school_classes;

ALTER TABLE school_classes_structure_0020 RENAME TO school_classes;
-- CAMPUS:END ONCE 0020_school_class_structure.sql

CREATE INDEX IF NOT EXISTS idx_school_classes_code
  ON school_classes (code);

CREATE INDEX IF NOT EXISTS idx_school_classes_school_year
  ON school_classes (school_year_id);

CREATE INDEX IF NOT EXISTS idx_school_classes_profession_year
  ON school_classes (profession_id, training_year);

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_classes_year_code
  ON school_classes (school_year_id, code)
  WHERE school_year_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_classes_legacy_code
  ON school_classes (code)
  WHERE school_year_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_classes_structured_parallel
  ON school_classes (school_year_id, profession_id, training_year, parallel_code)
  WHERE school_year_id IS NOT NULL
    AND profession_id IS NOT NULL
    AND training_year IS NOT NULL
    AND parallel_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_classes_structured_unique
  ON school_classes (school_year_id, profession_id, training_year)
  WHERE school_year_id IS NOT NULL
    AND profession_id IS NOT NULL
    AND training_year IS NOT NULL
    AND parallel_code IS NULL;
