-- Pont explicite SchoolClass / AnnualCourse → runtime Agenda (classrooms / subjects).
-- Provenance des publications structurées. Aucune table CourseSession.
-- Liens logiques contrôlés par l'application : pas de FK SQL, pas de PRAGMA foreign_keys.

ALTER TABLE classrooms ADD COLUMN school_class_id TEXT;
ALTER TABLE subjects ADD COLUMN annual_course_id TEXT;

ALTER TABLE agenda_items ADD COLUMN annual_course_id TEXT;
ALTER TABLE agenda_items ADD COLUMN course_session_key TEXT;
ALTER TABLE agenda_items ADD COLUMN course_session_date TEXT;
ALTER TABLE agenda_items ADD COLUMN reference_session_id TEXT;
ALTER TABLE agenda_items ADD COLUMN reference_item_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_classrooms_school_class_id
  ON classrooms(school_class_id)
  WHERE school_class_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_annual_course_id
  ON subjects(annual_course_id)
  WHERE annual_course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agenda_items_annual_course_id
  ON agenda_items(annual_course_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_items_course_reference
  ON agenda_items(annual_course_id, reference_item_id)
  WHERE annual_course_id IS NOT NULL AND reference_item_id IS NOT NULL;
