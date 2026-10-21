-- PR3.4 — notes privées normalisées (Carnet → annual_course_notes).
-- Additive. teacher_notes n'est ni modifié ni supprimé.
-- applyMigrations rejoue les fichiers : ALTER ADD COLUMN ignore « duplicate column name ».
-- CREATE INDEX IF NOT EXISTS est rejouable.

ALTER TABLE annual_course_notes ADD COLUMN body_json TEXT;
ALTER TABLE annual_course_notes ADD COLUMN course_session_key TEXT;
ALTER TABLE annual_course_notes ADD COLUMN owner_teacher_id TEXT;
ALTER TABLE annual_course_notes ADD COLUMN legacy_note_id TEXT;
ALTER TABLE annual_course_notes ADD COLUMN notebook_position INTEGER;

CREATE INDEX IF NOT EXISTS idx_annual_course_notes_owner
  ON annual_course_notes (owner_teacher_id);

CREATE INDEX IF NOT EXISTS idx_annual_course_notes_course_session
  ON annual_course_notes (course_session_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_annual_course_notes_owner_legacy
  ON annual_course_notes (owner_teacher_id, legacy_note_id)
  WHERE owner_teacher_id IS NOT NULL AND legacy_note_id IS NOT NULL;
