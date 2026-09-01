/** Tables 0001→0023 — ordre d'INSERT (parents avant enfants). */
export const CAMPUS_BACKUP_INSERT_ORDER = [
  "teachers",
  "classrooms",
  "school_years",
  "school_weeks",
  "school_day_exceptions",
  "subjects",
  "memberships",
  "membership_subjects",
  "student_accesses",
  "publication_templates",
  "agenda_items",
  "timetable_imports",
  "timetable_slots",
  "timetable_class_mappings",
  "timetable_teacher_codes",
  "school_branches",
  "school_professions",
  "pedagogical_contexts",
  "admin_code_counters",
  "school_classes",
  "pedagogical_paths",
  "annual_courses",
  "teacher_course_assignments",
  "teacher_course_assignment_events",
  "annual_course_notes",
  "course_schedule_slots",
  "class_attendance_days",
  "teacher_setups",
  "teacher_notes",
] as const;

export type CampusBackupTableName = (typeof CAMPUS_BACKUP_INSERT_ORDER)[number];

export const CAMPUS_BACKUP_DELETE_ORDER = [...CAMPUS_BACKUP_INSERT_ORDER].reverse();

export const BACKUP_FORMAT_VERSION_V4 = 4 as const;
