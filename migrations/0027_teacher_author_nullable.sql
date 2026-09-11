-- Auteur des publications et notes annuelles : nullable pour permettre
-- la suppression d'un compte professeur sans effacer le travail pédagogique.
-- Reconstruction non destructive : toutes les lignes et tous les IDs sont copiés.
-- Le bloc CAMPUS:BEGIN/END ONCE n'est exécuté qu'une seule fois.

-- CAMPUS:BEGIN ONCE 0027_agenda_items_author_nullable.sql
DROP TABLE IF EXISTS agenda_items_author_0027;

CREATE TABLE agenda_items_author_0027 (
  id INTEGER PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  author_teacher_id TEXT REFERENCES teachers(id),
  day INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  week_offset INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN ('HOMEWORK', 'TEST', 'INFORMATION')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  school_week_number INTEGER,
  template_id TEXT REFERENCES publication_templates(id),
  school_year_id TEXT REFERENCES school_years(id),
  annual_course_id TEXT,
  course_session_key TEXT,
  course_session_date TEXT,
  reference_session_id TEXT,
  reference_item_id TEXT
);

INSERT INTO agenda_items_author_0027 (
  id, classroom_id, subject_id, author_teacher_id, day, hour, week_offset,
  type, title, detail, created_at, updated_at, school_week_number, template_id,
  school_year_id, annual_course_id, course_session_key, course_session_date,
  reference_session_id, reference_item_id
)
SELECT
  id, classroom_id, subject_id, author_teacher_id, day, hour, week_offset,
  type, title, detail, created_at, updated_at, school_week_number, template_id,
  school_year_id, annual_course_id, course_session_key, course_session_date,
  reference_session_id, reference_item_id
FROM agenda_items;

DROP TABLE agenda_items;

ALTER TABLE agenda_items_author_0027 RENAME TO agenda_items;
-- CAMPUS:END ONCE 0027_agenda_items_author_nullable.sql

CREATE INDEX IF NOT EXISTS idx_agenda_classroom ON agenda_items(classroom_id);
CREATE INDEX IF NOT EXISTS idx_agenda_author ON agenda_items(author_teacher_id);
CREATE INDEX IF NOT EXISTS idx_agenda_items_annual_course_id
  ON agenda_items(annual_course_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_items_course_reference
  ON agenda_items(annual_course_id, reference_item_id)
  WHERE annual_course_id IS NOT NULL AND reference_item_id IS NOT NULL;

-- CAMPUS:BEGIN ONCE 0027_annual_course_notes_author_nullable.sql
DROP TRIGGER IF EXISTS pedagogical_contexts_delete_guard;
DROP TRIGGER IF EXISTS school_classes_delete_guard;
DROP TABLE IF EXISTS annual_course_notes_author_0027;

CREATE TABLE annual_course_notes_author_0027 (
  id TEXT PRIMARY KEY,
  school_year_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  reference_session_id TEXT,
  author_teacher_id TEXT,
  text TEXT NOT NULL,
  source_note_id TEXT,
  source_school_year_id TEXT,
  inherited_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  annual_course_id TEXT
);

INSERT INTO annual_course_notes_author_0027 (
  id, school_year_id, class_id, context_id, reference_session_id,
  author_teacher_id, text, source_note_id, source_school_year_id,
  inherited_at, created_at, updated_at, annual_course_id
)
SELECT
  id, school_year_id, class_id, context_id, reference_session_id,
  author_teacher_id, text, source_note_id, source_school_year_id,
  inherited_at, created_at, updated_at, annual_course_id
FROM annual_course_notes;

DROP TABLE annual_course_notes;

ALTER TABLE annual_course_notes_author_0027 RENAME TO annual_course_notes;

CREATE TRIGGER IF NOT EXISTS pedagogical_contexts_delete_guard
BEFORE DELETE ON pedagogical_contexts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CTX used archive instead')
  WHERE EXISTS (SELECT 1 FROM pedagogical_paths WHERE context_id = OLD.id)
     OR EXISTS (SELECT 1 FROM annual_course_notes WHERE context_id = OLD.id)
     OR EXISTS (SELECT 1 FROM annual_courses WHERE context_id = OLD.id);
END;

CREATE TRIGGER IF NOT EXISTS school_classes_delete_guard
BEFORE DELETE ON school_classes
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'school class used archive instead')
  WHERE EXISTS (SELECT 1 FROM annual_courses WHERE class_id = OLD.id)
     OR EXISTS (SELECT 1 FROM annual_course_notes WHERE class_id = OLD.id);
END;
-- CAMPUS:END ONCE 0027_annual_course_notes_author_nullable.sql

CREATE INDEX IF NOT EXISTS idx_annual_course_notes_course
  ON annual_course_notes (school_year_id, class_id, context_id);

CREATE INDEX IF NOT EXISTS idx_annual_course_notes_session
  ON annual_course_notes (reference_session_id);
