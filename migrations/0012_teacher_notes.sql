-- Notes de carnet enseignant (texte libre par classe / semaine).
-- Un document JSON par enseignant : suit le compte, pas le navigateur.

CREATE TABLE IF NOT EXISTS teacher_notes (
  teacher_id TEXT PRIMARY KEY REFERENCES teachers(id),
  notes_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
