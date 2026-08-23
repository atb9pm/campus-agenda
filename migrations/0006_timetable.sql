-- Import grille horaire secteur MA (phase 2.2).

CREATE TABLE IF NOT EXISTS timetable_imports (
  id TEXT PRIMARY KEY,
  school_year_id TEXT REFERENCES school_years(id),
  source_filename TEXT NOT NULL,
  school_year_label TEXT NOT NULL,
  source_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  slot_count INTEGER NOT NULL DEFAULT 0,
  excluded_sps_count INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timetable_slots (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES timetable_imports(id) ON DELETE CASCADE,
  class_code TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 10),
  branch_label TEXT NOT NULL,
  teacher_code TEXT,
  week_kind TEXT NOT NULL CHECK (week_kind IN ('all', 'A', 'B'))
);

CREATE INDEX IF NOT EXISTS idx_timetable_slots_import ON timetable_slots(import_id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_class ON timetable_slots(import_id, class_code, day_of_week);

CREATE TABLE IF NOT EXISTS timetable_class_mappings (
  import_id TEXT NOT NULL REFERENCES timetable_imports(id) ON DELETE CASCADE,
  class_code TEXT NOT NULL,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id),
  PRIMARY KEY (import_id, class_code)
);

CREATE TABLE IF NOT EXISTS timetable_teacher_codes (
  import_id TEXT NOT NULL REFERENCES timetable_imports(id) ON DELETE CASCADE,
  teacher_code TEXT NOT NULL,
  teacher_id TEXT REFERENCES teachers(id),
  PRIMARY KEY (import_id, teacher_code)
);
