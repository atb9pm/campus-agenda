-- Configuration personnelle enseignant (classes, jour, branches, icône).
-- Un document JSON par enseignant : suit l'enseignant, pas le navigateur.

CREATE TABLE IF NOT EXISTS teacher_setups (
  teacher_id TEXT PRIMARY KEY REFERENCES teachers(id),
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
