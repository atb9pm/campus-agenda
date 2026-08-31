-- Créneaux horaires des cours annuels (source de vérité de l'horaire de classe).
-- Distinct de TeacherCourseAssignment (qui enseigne) et de l'import PDF timetable (legacy).
-- Période 5 = pause de midi : jamais un créneau.

CREATE TABLE IF NOT EXISTS course_schedule_slots (
  id TEXT PRIMARY KEY,
  annual_course_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  period_start INTEGER NOT NULL CHECK (period_start IN (1, 2, 3, 4, 6, 7, 8, 9, 10)),
  period_end INTEGER NOT NULL CHECK (period_end IN (1, 2, 3, 4, 6, 7, 8, 9, 10)),
  week_kind TEXT NOT NULL CHECK (week_kind IN ('all', 'A', 'B')),
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (annual_course_id) REFERENCES annual_courses(id),
  CHECK (period_end >= period_start),
  CHECK (NOT (period_start <= 4 AND period_end >= 6))
);

CREATE INDEX IF NOT EXISTS idx_css_course
  ON course_schedule_slots (annual_course_id);

CREATE INDEX IF NOT EXISTS idx_css_day
  ON course_schedule_slots (day_of_week, week_kind);
