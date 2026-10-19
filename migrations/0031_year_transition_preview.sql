-- PREVIEW N → N+1 persisté (immuable au niveau applicatif).
-- fingerprint n'est PAS UNIQUE : deux PREVIEW historiques peuvent partager le même état matériel.
-- IF NOT EXISTS : applyMigrations rejoue les fichiers à chaque démarrage.
-- Liens parent/enfant : logiques (store atomique + validateur backup). Pas de FK SQL.

CREATE TABLE IF NOT EXISTS year_transition_previews (
  id TEXT PRIMARY KEY,
  source_school_year_id TEXT NOT NULL,
  target_school_year_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  engine_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_year_transition_previews_years
  ON year_transition_previews (source_school_year_id, target_school_year_id);

CREATE INDEX IF NOT EXISTS idx_year_transition_previews_fingerprint
  ON year_transition_previews (fingerprint);

CREATE INDEX IF NOT EXISTS idx_year_transition_previews_created_at
  ON year_transition_previews (created_at);

CREATE TABLE IF NOT EXISTS year_transition_preview_entries (
  transition_id TEXT NOT NULL,
  source_agenda_item_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_item_id TEXT,
  target_annual_course_id TEXT,
  entry_json TEXT NOT NULL,
  PRIMARY KEY (transition_id, source_agenda_item_id)
);

CREATE INDEX IF NOT EXISTS idx_year_transition_preview_entries_reason
  ON year_transition_preview_entries (reason);

CREATE INDEX IF NOT EXISTS idx_year_transition_preview_entries_reference
  ON year_transition_preview_entries (reference_item_id);
