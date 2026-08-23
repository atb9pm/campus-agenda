-- Bibliothèque pédagogique (phase 2.1) : modèles réutilisables et lien instance ↔ modèle.

CREATE TABLE IF NOT EXISTS publication_templates (
  id TEXT PRIMARY KEY,
  owner_teacher_id TEXT NOT NULL REFERENCES teachers(id),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('HOMEWORK', 'TEST', 'INFORMATION')),
  subject_id TEXT REFERENCES subjects(id),
  default_school_week_number INTEGER CHECK (default_school_week_number BETWEEN 1 AND 38),
  default_day INTEGER CHECK (default_day IN (0, 3)),
  source_school_year_id TEXT REFERENCES school_years(id),
  source_item_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_publication_templates_owner ON publication_templates(owner_teacher_id);

ALTER TABLE agenda_items ADD COLUMN template_id TEXT REFERENCES publication_templates(id);
ALTER TABLE agenda_items ADD COLUMN school_year_id TEXT REFERENCES school_years(id);
