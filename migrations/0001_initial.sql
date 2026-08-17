-- Schéma initial Campus Agenda (données fictives uniquement en démonstration).
-- Les secrets et mots de passe réels ne sont jamais stockés en clair.

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  initials TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classrooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  program_label TEXT NOT NULL,
  access_code_hint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id),
  classroom_id TEXT NOT NULL REFERENCES classrooms(id)
);

CREATE TABLE IF NOT EXISTS membership_subjects (
  membership_id TEXT NOT NULL REFERENCES memberships(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  PRIMARY KEY (membership_id, subject_id)
);

CREATE TABLE IF NOT EXISTS student_accesses (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id),
  label TEXT NOT NULL UNIQUE,
  access_code_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agenda_items (
  id INTEGER PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  author_teacher_id TEXT NOT NULL REFERENCES teachers(id),
  day INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  week_offset INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN ('HOMEWORK', 'TEST', 'INFORMATION')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agenda_classroom ON agenda_items(classroom_id);
CREATE INDEX IF NOT EXISTS idx_agenda_author ON agenda_items(author_teacher_id);
