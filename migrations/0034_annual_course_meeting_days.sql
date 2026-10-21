-- Jours de séance d’un AnnualCourse (occupation minimale), sans périodes.
-- Distinct de class_attendance_days (classe) et de course_schedule_slots (horaire).
-- Un cours sans ligne reste valide. PRIMARY peut être all / A / B.

CREATE TABLE IF NOT EXISTS annual_course_meeting_days (
  id TEXT PRIMARY KEY,
  annual_course_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  week_kind TEXT NOT NULL CHECK (week_kind IN ('all', 'A', 'B')),
  role TEXT NOT NULL CHECK (role IN ('PRIMARY', 'ADDITIONAL')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (annual_course_id) REFERENCES annual_courses(id),
  UNIQUE (annual_course_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_acmd_course
  ON annual_course_meeting_days (annual_course_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_acmd_one_primary
  ON annual_course_meeting_days (annual_course_id)
  WHERE role = 'PRIMARY';
