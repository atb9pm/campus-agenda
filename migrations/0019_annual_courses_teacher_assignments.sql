-- Cours annuels et attributions enseignants.
-- Additive après 0018_admin_referential_coherence (teaching_type déjà présent).
-- Aucune suppression de colonnes ni de données existantes.

CREATE TABLE IF NOT EXISTS annual_courses (
  id TEXT PRIMARY KEY,
  school_year_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (school_year_id, class_id, context_id)
);

CREATE INDEX IF NOT EXISTS idx_annual_courses_context
  ON annual_courses (context_id);

CREATE TABLE IF NOT EXISTS teacher_course_assignments (
  id TEXT PRIMARY KEY,
  annual_course_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PRIMARY', 'CO_TEACHER', 'REPLACEMENT')),
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  created_by_admin_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  override_reason TEXT,
  override_by_admin_id TEXT,
  FOREIGN KEY (annual_course_id) REFERENCES annual_courses(id)
);

DROP INDEX IF EXISTS idx_tca_open_teacher;
DROP INDEX IF EXISTS idx_tca_open_primary;

CREATE INDEX IF NOT EXISTS idx_tca_teacher
  ON teacher_course_assignments (teacher_id);

CREATE INDEX IF NOT EXISTS idx_tca_course_teacher
  ON teacher_course_assignments (annual_course_id, teacher_id);

-- Unicité temporelle : interdire uniquement les périodes qui se chevauchent.
-- valid_to NULL = +∞. Les lignes explicitement closes (ended_at) sont ignorées.
-- Un unique index (annual_course_id, teacher_id) WHERE ended_at IS NULL
-- refuserait un second remplacement non chevauchant (ex. nov. puis janv.).

DROP TRIGGER IF EXISTS tca_no_teacher_overlap_insert;
DROP TRIGGER IF EXISTS tca_no_teacher_overlap_update;
DROP TRIGGER IF EXISTS tca_no_primary_overlap_insert;
DROP TRIGGER IF EXISTS tca_no_primary_overlap_update;

CREATE TRIGGER IF NOT EXISTS tca_no_teacher_overlap_insert
BEFORE INSERT ON teacher_course_assignments
FOR EACH ROW
WHEN NEW.ended_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'teacher assignment period overlaps')
  WHERE EXISTS (
    SELECT 1 FROM teacher_course_assignments AS existing
    WHERE existing.annual_course_id = NEW.annual_course_id
      AND existing.teacher_id = NEW.teacher_id
      AND existing.ended_at IS NULL
      AND existing.valid_from <= COALESCE(NEW.valid_to, '9999-12-31T23:59:59.999Z')
      AND NEW.valid_from <= COALESCE(existing.valid_to, '9999-12-31T23:59:59.999Z')
  );
END;

CREATE TRIGGER IF NOT EXISTS tca_no_teacher_overlap_update
BEFORE UPDATE ON teacher_course_assignments
FOR EACH ROW
WHEN NEW.ended_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'teacher assignment period overlaps')
  WHERE EXISTS (
    SELECT 1 FROM teacher_course_assignments AS existing
    WHERE existing.id != NEW.id
      AND existing.annual_course_id = NEW.annual_course_id
      AND existing.teacher_id = NEW.teacher_id
      AND existing.ended_at IS NULL
      AND existing.valid_from <= COALESCE(NEW.valid_to, '9999-12-31T23:59:59.999Z')
      AND NEW.valid_from <= COALESCE(existing.valid_to, '9999-12-31T23:59:59.999Z')
  );
END;

CREATE TRIGGER IF NOT EXISTS tca_no_primary_overlap_insert
BEFORE INSERT ON teacher_course_assignments
FOR EACH ROW
WHEN NEW.ended_at IS NULL AND NEW.role = 'PRIMARY'
BEGIN
  SELECT RAISE(ABORT, 'primary assignment period overlaps')
  WHERE EXISTS (
    SELECT 1 FROM teacher_course_assignments AS existing
    WHERE existing.annual_course_id = NEW.annual_course_id
      AND existing.role = 'PRIMARY'
      AND existing.ended_at IS NULL
      AND existing.valid_from <= COALESCE(NEW.valid_to, '9999-12-31T23:59:59.999Z')
      AND NEW.valid_from <= COALESCE(existing.valid_to, '9999-12-31T23:59:59.999Z')
  );
END;

CREATE TRIGGER IF NOT EXISTS tca_no_primary_overlap_update
BEFORE UPDATE ON teacher_course_assignments
FOR EACH ROW
WHEN NEW.ended_at IS NULL AND NEW.role = 'PRIMARY'
BEGIN
  SELECT RAISE(ABORT, 'primary assignment period overlaps')
  WHERE EXISTS (
    SELECT 1 FROM teacher_course_assignments AS existing
    WHERE existing.id != NEW.id
      AND existing.annual_course_id = NEW.annual_course_id
      AND existing.role = 'PRIMARY'
      AND existing.ended_at IS NULL
      AND existing.valid_from <= COALESCE(NEW.valid_to, '9999-12-31T23:59:59.999Z')
      AND NEW.valid_from <= COALESCE(existing.valid_to, '9999-12-31T23:59:59.999Z')
  );
END;

CREATE TABLE IF NOT EXISTS teacher_course_assignment_events (
  id TEXT PRIMARY KEY,
  annual_course_id TEXT NOT NULL,
  assignment_id TEXT,
  teacher_id TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  role TEXT,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tca_events_course
  ON teacher_course_assignment_events (annual_course_id);

ALTER TABLE annual_course_notes ADD COLUMN annual_course_id TEXT;

UPDATE annual_course_notes
SET annual_course_id = (
  SELECT ac.id FROM annual_courses ac
  WHERE ac.school_year_id = annual_course_notes.school_year_id
    AND ac.class_id = annual_course_notes.class_id
    AND ac.context_id = annual_course_notes.context_id
)
WHERE annual_course_id IS NULL;

-- 0018 a déjà créé ce trigger (parcours + notes). On l'étend aux AnnualCourse.
DROP TRIGGER IF EXISTS pedagogical_contexts_delete_guard;

CREATE TRIGGER IF NOT EXISTS pedagogical_contexts_delete_guard
BEFORE DELETE ON pedagogical_contexts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CTX used archive instead')
  WHERE EXISTS (SELECT 1 FROM pedagogical_paths WHERE context_id = OLD.id)
     OR EXISTS (SELECT 1 FROM annual_course_notes WHERE context_id = OLD.id)
     OR EXISTS (SELECT 1 FROM annual_courses WHERE context_id = OLD.id);
END;
