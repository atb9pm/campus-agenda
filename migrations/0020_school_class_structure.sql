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

-- Pas d index unique retroactif sur parallel_code NULL : deux classes
-- pre-0020 deja structurees (MA3A / MA3B) recoivent NULL et doivent
-- survivre pour que l admin renseigne A/B ensuite.
DROP INDEX IF EXISTS idx_school_classes_structured_unique;

DROP TRIGGER IF EXISTS school_classes_structured_unique_insert;
DROP TRIGGER IF EXISTS school_classes_structured_unique_update;

-- Nouvelles ecritures uniquement : au plus une vraie classe unique NULL.
-- Les lignes deja NULL (meme annee / profession / annee de formation)
-- restent valides et restantes editables.
CREATE TRIGGER IF NOT EXISTS school_classes_structured_unique_insert
BEFORE INSERT ON school_classes
FOR EACH ROW
WHEN NEW.school_year_id IS NOT NULL
  AND NEW.profession_id IS NOT NULL
  AND NEW.training_year IS NOT NULL
  AND NEW.parallel_code IS NULL
BEGIN
  SELECT RAISE(
    ABORT,
    'Une classe unique existe déjà pour cette profession et cette année de formation.'
  )
  WHERE EXISTS (
    SELECT 1 FROM school_classes AS existing
    WHERE existing.id != NEW.id
      AND existing.school_year_id IS NOT NULL
      AND existing.profession_id IS NOT NULL
      AND existing.training_year IS NOT NULL
      AND existing.school_year_id = NEW.school_year_id
      AND existing.profession_id = NEW.profession_id
      AND existing.training_year = NEW.training_year
      AND existing.parallel_code IS NULL
  );
END;

CREATE TRIGGER IF NOT EXISTS school_classes_structured_unique_update
BEFORE UPDATE ON school_classes
FOR EACH ROW
WHEN NEW.school_year_id IS NOT NULL
  AND NEW.profession_id IS NOT NULL
  AND NEW.training_year IS NOT NULL
  AND NEW.parallel_code IS NULL
  AND NOT (
    OLD.school_year_id IS NOT NULL
    AND OLD.profession_id IS NOT NULL
    AND OLD.training_year IS NOT NULL
    AND OLD.parallel_code IS NULL
    AND OLD.school_year_id = NEW.school_year_id
    AND OLD.profession_id = NEW.profession_id
    AND OLD.training_year = NEW.training_year
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'Une classe unique existe déjà pour cette profession et cette année de formation.'
  )
  WHERE EXISTS (
    SELECT 1 FROM school_classes AS existing
    WHERE existing.id != NEW.id
      AND existing.school_year_id IS NOT NULL
      AND existing.profession_id IS NOT NULL
      AND existing.training_year IS NOT NULL
      AND existing.school_year_id = NEW.school_year_id
      AND existing.profession_id = NEW.profession_id
      AND existing.training_year = NEW.training_year
      AND existing.parallel_code IS NULL
  );
END;
