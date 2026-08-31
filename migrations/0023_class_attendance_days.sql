-- Jours de présence d'une classe (disponibilité), distincts des CourseScheduleSlot (contenu).
-- Ne crée aucun ClassAttendanceDay pour les créneaux 0022 existants.

CREATE TABLE IF NOT EXISTS class_attendance_days (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  week_kind TEXT NOT NULL CHECK (week_kind IN ('all', 'A', 'B')),
  role TEXT NOT NULL CHECK (role IN ('PRIMARY', 'ADDITIONAL')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (class_id) REFERENCES school_classes(id),
  CHECK (role != 'PRIMARY' OR week_kind = 'all'),
  UNIQUE (class_id, day_of_week, week_kind)
);

CREATE INDEX IF NOT EXISTS idx_cad_class
  ON class_attendance_days (class_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cad_one_primary
  ON class_attendance_days (class_id)
  WHERE role = 'PRIMARY';
