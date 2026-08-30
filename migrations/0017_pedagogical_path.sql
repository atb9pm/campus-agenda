-- Parcours pédagogique de référence par CTX + préparation notes annuelles.
-- Migration additive : aucune suppression ni altération des notes legacy (teacher_notes)
-- ni des publications Agenda (template_id inchangé).

CREATE TABLE IF NOT EXISTS pedagogical_paths (
  context_id TEXT PRIMARY KEY,
  path_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notes de cours annuelles (architecture future).
-- Identité : school_year_id + class_id + context_id + reference_session_id.
-- author_teacher_id = provenance uniquement (pas propriété exclusive).
-- Les notes legacy (teacher_notes / classSetupId:semaine) restent inchangées.
CREATE TABLE IF NOT EXISTS annual_course_notes (
  id TEXT PRIMARY KEY,
  school_year_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  reference_session_id TEXT,
  author_teacher_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source_note_id TEXT,
  source_school_year_id TEXT,
  inherited_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_annual_course_notes_course
  ON annual_course_notes (school_year_id, class_id, context_id);

CREATE INDEX IF NOT EXISTS idx_annual_course_notes_session
  ON annual_course_notes (reference_session_id);
