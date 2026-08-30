-- Cours annuels, attributions enseignants, types d'enseignement, garde-fou CTX.
-- Migration additive : aucune suppression de colonnes ni de données existantes.

ALTER TABLE teachers ADD COLUMN teaching_type TEXT;

ALTER TABLE school_branches ADD COLUMN teaching_type TEXT;

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
  role TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  created_by_admin_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  override_reason TEXT,
  override_by_admin_id TEXT,
  FOREIGN KEY (annual_course_id) REFERENCES annual_courses(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tca_open_teacher
  ON teacher_course_assignments (annual_course_id, teacher_id)
  WHERE ended_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tca_open_primary
  ON teacher_course_assignments (annual_course_id)
  WHERE role = 'PRIMARY' AND ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tca_teacher
  ON teacher_course_assignments (teacher_id);

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

CREATE TRIGGER IF NOT EXISTS pedagogical_contexts_delete_guard
BEFORE DELETE ON pedagogical_contexts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CTX used archive instead')
  WHERE EXISTS (SELECT 1 FROM pedagogical_paths WHERE context_id = OLD.id)
     OR EXISTS (SELECT 1 FROM annual_course_notes WHERE context_id = OLD.id)
     OR EXISTS (SELECT 1 FROM annual_courses WHERE context_id = OLD.id);
END;
