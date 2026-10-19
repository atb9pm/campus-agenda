-- APPLY N → N+1 : provenance AgendaItem + ledger append-only.
-- PREVIEW (0031) reste immuable. Pas de FK SQL, pas de PRAGMA foreign_keys.
-- IF NOT EXISTS : applyMigrations rejoue les fichiers. ALTER ADD COLUMN : duplicate column ignoré.

ALTER TABLE agenda_items ADD COLUMN source_transition_id TEXT;
ALTER TABLE agenda_items ADD COLUMN source_agenda_item_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_agenda_items_source_transition
  ON agenda_items (source_transition_id);

CREATE TABLE IF NOT EXISTS year_transition_applies (
  transition_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  engine_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS year_transition_apply_entries (
  transition_id TEXT NOT NULL,
  source_agenda_item_id INTEGER NOT NULL,
  preview_reason TEXT NOT NULL,
  apply_result TEXT NOT NULL,
  target_annual_course_id TEXT,
  reference_item_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (transition_id, source_agenda_item_id)
);

CREATE INDEX IF NOT EXISTS idx_year_transition_apply_entries_result
  ON year_transition_apply_entries (apply_result);

CREATE INDEX IF NOT EXISTS idx_year_transition_apply_entries_course
  ON year_transition_apply_entries (target_annual_course_id);

CREATE INDEX IF NOT EXISTS idx_year_transition_apply_entries_reference
  ON year_transition_apply_entries (reference_item_id);
