import type { SqlDatabase } from "./types.ts";
import {
  CAMPUS_BACKUP_DELETE_ORDER,
  CAMPUS_BACKUP_INSERT_ORDER,
  type CampusBackupTableName,
} from "../campus-backup-tables.ts";

export type CampusTableDump = Record<string, Array<Record<string, unknown>>>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function asId(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function idSet(rows: Array<Record<string, unknown>> | undefined, ...keys: string[]): Set<string> {
  return new Set((rows ?? []).map((row) => asId(row, ...keys)).filter(Boolean));
}

function isDateOnly(value: unknown): boolean {
  return typeof value === "string" && DATE_ONLY.test(value);
}

export async function dumpCampusTables(db: SqlDatabase): Promise<CampusTableDump> {
  const tables: CampusTableDump = {};
  for (const table of CAMPUS_BACKUP_INSERT_ORDER) {
    const { results } = await db.prepare(`SELECT * FROM ${table}`).bind().all<Record<string, unknown>>();
    tables[table] = (results ?? []).map((row) => ({ ...row }));
  }
  return tables;
}

export function validateCampusTables(tables: unknown): { ok: true; tables: CampusTableDump } | { ok: false; reason: string } {
  if (!tables || typeof tables !== "object") {
    return { ok: false, reason: "Tables de sauvegarde manquantes." };
  }
  const dump = tables as CampusTableDump;
  for (const table of CAMPUS_BACKUP_INSERT_ORDER) {
    if (dump[table] !== undefined && !Array.isArray(dump[table])) {
      return { ok: false, reason: `Table ${table} invalide.` };
    }
  }

  const teachers = dump.teachers ?? [];
  const hasActiveAdmin = teachers.some((row) => {
    const isAdmin = Boolean(row.is_admin ?? row.isAdmin);
    const isActive = row.is_active === undefined && row.isActive === undefined
      ? true
      : Boolean(row.is_active ?? row.isActive);
    const archived = row.archived_at ?? row.archivedAt ?? null;
    return isAdmin && isActive && (archived === null || archived === undefined);
  });
  if (!hasActiveAdmin) {
    return { ok: false, reason: "La sauvegarde ne contient aucun administrateur actif." };
  }

  const classroomIds = idSet(dump.classrooms, "id");
  const teacherIds = idSet(teachers, "id");
  const subjectIds = idSet(dump.subjects, "id");
  const yearIds = idSet(dump.school_years, "id");
  const classIds = idSet(dump.school_classes, "id");
  const branchIds = idSet(dump.school_branches, "id");
  const professionIds = idSet(dump.school_professions, "id");
  const contextIds = idSet(dump.pedagogical_contexts, "id");
  const courseIds = idSet(dump.annual_courses, "id");
  const membershipIds = idSet(dump.memberships, "id");

  for (const item of dump.agenda_items ?? []) {
    const classroomId = asId(item, "classroom_id", "classroomId");
    const authorId = asId(item, "author_teacher_id", "authorTeacherId");
    const subjectId = asId(item, "subject_id", "subjectId");
    if (classroomIds.size > 0 && classroomId && !classroomIds.has(classroomId)) {
      return { ok: false, reason: "Référence agenda → classe incohérente." };
    }
    if (teacherIds.size > 0 && authorId && !teacherIds.has(authorId)) {
      return { ok: false, reason: "Référence agenda → enseignant incohérente." };
    }
    if (subjectIds.size > 0 && subjectId && !subjectIds.has(subjectId)) {
      return { ok: false, reason: "Référence agenda → branche incohérente." };
    }
  }

  const agendaIds = (dump.agenda_items ?? []).map((row) => asId(row, "id"));
  if (new Set(agendaIds).size !== agendaIds.length) {
    return { ok: false, reason: "Identifiants de publication en double." };
  }

  for (const week of dump.school_weeks ?? []) {
    const yearId = asId(week, "school_year_id", "schoolYearId");
    if (yearIds.size > 0 && yearId && !yearIds.has(yearId)) {
      return { ok: false, reason: "Référence semaine → année scolaire incohérente." };
    }
    const monday = week.monday;
    if (monday != null && monday !== "" && !isDateOnly(monday)) {
      return { ok: false, reason: "Date de lundi de semaine invalide." };
    }
  }

  for (const year of dump.school_years ?? []) {
    const startsOn = year.starts_on ?? year.startsOn;
    const endsOn = year.ends_on ?? year.endsOn;
    if (startsOn != null && startsOn !== "" && !isDateOnly(startsOn)) {
      return { ok: false, reason: "Date de début d'année scolaire invalide." };
    }
    if (endsOn != null && endsOn !== "" && !isDateOnly(endsOn)) {
      return { ok: false, reason: "Date de fin d'année scolaire invalide." };
    }
  }

  for (const exception of dump.school_day_exceptions ?? []) {
    const yearId = asId(exception, "school_year_id", "schoolYearId");
    if (yearIds.size > 0 && yearId && !yearIds.has(yearId)) {
      return { ok: false, reason: "Référence exception de jour → année scolaire incohérente." };
    }
    const date = exception.day_date ?? exception.date;
    if (date != null && date !== "" && !isDateOnly(date)) {
      return { ok: false, reason: "Date d'exception scolaire invalide." };
    }
  }

  for (const membership of dump.memberships ?? []) {
    const teacherId = asId(membership, "teacher_id", "teacherId");
    const classroomId = asId(membership, "classroom_id", "classroomId");
    if (teacherIds.size > 0 && teacherId && !teacherIds.has(teacherId)) {
      return { ok: false, reason: "Référence membership → enseignant incohérente." };
    }
    if (classroomIds.size > 0 && classroomId && !classroomIds.has(classroomId)) {
      return { ok: false, reason: "Référence membership → classe incohérente." };
    }
  }

  for (const link of dump.membership_subjects ?? []) {
    const membershipId = asId(link, "membership_id", "membershipId");
    const subjectId = asId(link, "subject_id", "subjectId");
    if (membershipIds.size > 0 && membershipId && !membershipIds.has(membershipId)) {
      return { ok: false, reason: "Référence membership_subjects incohérente." };
    }
    if (subjectIds.size > 0 && subjectId && !subjectIds.has(subjectId)) {
      return { ok: false, reason: "Référence membership_subjects → branche incohérente." };
    }
  }

  for (const access of dump.student_accesses ?? []) {
    const classroomId = asId(access, "classroom_id", "classroomId");
    if (classroomIds.size > 0 && classroomId && !classroomIds.has(classroomId)) {
      return { ok: false, reason: "Référence accès élève → classe incohérente." };
    }
  }

  for (const schoolClass of dump.school_classes ?? []) {
    const yearId = asId(schoolClass, "school_year_id", "schoolYearId");
    if (yearId && yearIds.size > 0 && !yearIds.has(yearId)) {
      return { ok: false, reason: "Référence classe structurée → année scolaire incohérente." };
    }
    const professionId = asId(schoolClass, "profession_id", "professionId");
    if (professionId && professionIds.size > 0 && !professionIds.has(professionId)) {
      return { ok: false, reason: "Référence classe structurée → profession incohérente." };
    }
  }

  for (const context of dump.pedagogical_contexts ?? []) {
    const professionId = asId(context, "profession_id", "professionId");
    const branchId = asId(context, "branch_id", "branchId");
    if (professionIds.size > 0 && professionId && !professionIds.has(professionId)) {
      return { ok: false, reason: "Référence CTX → profession incohérente." };
    }
    if (branchIds.size > 0 && branchId && !branchIds.has(branchId)) {
      return { ok: false, reason: "Référence CTX → branche incohérente." };
    }
  }

  for (const course of dump.annual_courses ?? []) {
    const classId = asId(course, "class_id", "classId");
    const contextId = asId(course, "context_id", "contextId");
    const yearId = asId(course, "school_year_id", "schoolYearId");
    if (classIds.size > 0 && classId && !classIds.has(classId)) {
      return { ok: false, reason: "Référence cours annuel → classe incohérente." };
    }
    if (contextIds.size > 0 && contextId && !contextIds.has(contextId)) {
      return { ok: false, reason: "Référence cours annuel → CTX incohérente." };
    }
    if (yearIds.size > 0 && yearId && !yearIds.has(yearId)) {
      return { ok: false, reason: "Référence cours annuel → année scolaire incohérente." };
    }
  }

  for (const assignment of dump.teacher_course_assignments ?? []) {
    const courseId = asId(assignment, "annual_course_id", "annualCourseId");
    const teacherId = asId(assignment, "teacher_id", "teacherId");
    if (courseIds.size > 0 && courseId && !courseIds.has(courseId)) {
      return { ok: false, reason: "Référence attribution → cours annuel incohérente." };
    }
    if (teacherIds.size > 0 && teacherId && !teacherIds.has(teacherId)) {
      return { ok: false, reason: "Référence attribution → enseignant incohérente." };
    }
  }

  for (const slot of dump.course_schedule_slots ?? []) {
    const courseId = asId(slot, "annual_course_id", "annualCourseId");
    if (courseIds.size > 0 && courseId && !courseIds.has(courseId)) {
      return { ok: false, reason: "Référence créneau → cours annuel incohérente." };
    }
  }

  for (const day of dump.class_attendance_days ?? []) {
    const classId = asId(day, "class_id", "classId");
    if (classIds.size > 0 && classId && !classIds.has(classId)) {
      return { ok: false, reason: "Référence jour de présence → classe incohérente." };
    }
  }

  return { ok: true, tables: dump };
}

export async function restoreCampusTables(db: SqlDatabase, dump: CampusTableDump): Promise<void> {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  for (const table of CAMPUS_BACKUP_DELETE_ORDER) {
    statements.push({ sql: `DELETE FROM ${table}`, values: [] });
  }
  for (const table of CAMPUS_BACKUP_INSERT_ORDER) {
    const rows = dump[table] ?? [];
    for (const row of rows) {
      const columns = Object.keys(row);
      if (columns.length === 0) continue;
      const placeholders = columns.map(() => "?").join(", ");
      statements.push({
        sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
        values: columns.map((column) => row[column] ?? null),
      });
    }
  }
  await db.batch(statements);
}

export function isCampusBackupTableName(value: string): value is CampusBackupTableName {
  return (CAMPUS_BACKUP_INSERT_ORDER as readonly string[]).includes(value);
}
