import type { AnnualCourse, TeacherCourseAssignment } from "../annual-courses/types.ts";
import {
  assignmentInstantForSessionDate,
  teacherHasStructuredClassroomReadAccess,
  teacherHasStructuredPublishAccess,
} from "../agenda-bridge/access.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";
import type { RuntimeClassroomListItem } from "../../lib/persistence/runtime-agenda-types.ts";
import type { ControlPlanningClass } from "./types.ts";

export function structuredClassMatchesPlanningYear(
  schoolClass: Pick<SchoolClassRecord, "schoolYearId">,
  schoolYearId: string,
): boolean {
  return (schoolClass.schoolYearId?.trim() || null) === schoolYearId;
}

/**
 * Accès générique (Mes cours, /api/teacher/classrooms, Agenda lecture).
 * Année active : TCA à maintenant. Ne pas élargir aux attributions futures.
 */
export async function listAccessibleRuntimeClassroomsForTeacher(options: {
  teacherId: string;
  classrooms: RuntimeClassroomListItem[];
  classes: SchoolClassRecord[];
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  years: SchoolYearRecord[];
  teacherCanAccessClassroom: (teacherId: string, classroomId: string) => Promise<boolean>;
  /** Si fourni, les SchoolClass structurées hors de cette année sont exclues. */
  schoolYearId?: string | null;
}): Promise<ControlPlanningClass[]> {
  return listRuntimeClassroomsWhere(options, (linked) =>
    teacherHasStructuredClassroomReadAccess({
      teacherId: options.teacherId,
      schoolClass: linked,
      courses: options.courses,
      assignments: options.assignments,
      years: options.years,
    }),
  );
}

/**
 * Accès spécifique au module Contrôles (coordination live, APIs génériques).
 * Une classe structurée est visible si la lecture actuelle l’autorise
 * OU si l’enseignant a au moins une CourseSession de l’année avec TCA à la date de séance.
 */
export function teacherHasControlPlanningClassAccess(options: {
  teacherId: string;
  schoolClass: SchoolClassRecord;
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  years: SchoolYearRecord[];
  sessions: readonly CourseSession[];
}): boolean {
  if (
    teacherHasStructuredClassroomReadAccess({
      teacherId: options.teacherId,
      schoolClass: options.schoolClass,
      courses: options.courses,
      assignments: options.assignments,
      years: options.years,
    })
  ) {
    return true;
  }
  return teacherHasAssignedStructuredPlanningClass(options);
}

/**
 * Classe proposée dans le planning structuré : SchoolClass de l’année,
 * AnnualCourse, et au moins une CourseSession avec TCA (PRIMARY / CO_TEACHER /
 * REPLACEMENT) valable à la date de séance. Pas de membership, pas de legacy.
 */
export function teacherHasAssignedStructuredPlanningClass(options: {
  teacherId: string;
  schoolClass: SchoolClassRecord;
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  years: SchoolYearRecord[];
  sessions: readonly CourseSession[];
}): boolean {
  const hasAnnualCourse = options.courses.some((course) => course.classId === options.schoolClass.id);
  if (!hasAnnualCourse) return false;
  return options.sessions.some(
    (session) =>
      session.classId === options.schoolClass.id &&
      teacherHasStructuredPublishAccess({
        teacherId: options.teacherId,
        annualCourseId: session.annualCourseId,
        assignments: options.assignments,
        at: assignmentInstantForSessionDate(session.date),
      }),
  );
}

export function listAssignedStructuredPlanningClassrooms(options: {
  teacherId: string;
  classrooms: RuntimeClassroomListItem[];
  classes: SchoolClassRecord[];
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  years: SchoolYearRecord[];
  sessions: readonly CourseSession[];
  schoolYearId: string;
}): ControlPlanningClass[] {
  const yearClasses = options.classes
    .filter((schoolClass) => structuredClassMatchesPlanningYear(schoolClass, options.schoolYearId))
    .slice()
    .sort((left, right) => (left.code || left.label).localeCompare(right.code || right.label, "fr"));
  const classroomBySchoolClassId = new Map(
    options.classrooms
      .filter((classroom) => classroom.schoolClassId?.trim())
      .map((classroom) => [classroom.schoolClassId!.trim(), classroom]),
  );
  const result: ControlPlanningClass[] = [];
  const seen = new Set<string>();
  for (const schoolClass of yearClasses) {
    if (
      !teacherHasAssignedStructuredPlanningClass({
        teacherId: options.teacherId,
        schoolClass,
        courses: options.courses,
        assignments: options.assignments,
        years: options.years,
        sessions: options.sessions,
      })
    ) {
      continue;
    }
    const classroom = classroomBySchoolClassId.get(schoolClass.id);
    if (!classroom || seen.has(classroom.id)) continue;
    seen.add(classroom.id);
    result.push({ id: classroom.id, name: classroom.name });
  }
  return result;
}

export async function listAccessibleControlPlanningClassrooms(options: {
  teacherId: string;
  classrooms: RuntimeClassroomListItem[];
  classes: SchoolClassRecord[];
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  years: SchoolYearRecord[];
  sessions: readonly CourseSession[];
  teacherCanAccessClassroom: (teacherId: string, classroomId: string) => Promise<boolean>;
  schoolYearId?: string | null;
}): Promise<ControlPlanningClass[]> {
  return listRuntimeClassroomsWhere(options, (linked) =>
    teacherHasControlPlanningClassAccess({
      teacherId: options.teacherId,
      schoolClass: linked,
      courses: options.courses,
      assignments: options.assignments,
      years: options.years,
      sessions: options.sessions,
    }),
  );
}

/**
 * Classes dont au moins une CourseSession de la semaine a une TCA active à la date.
 * Legacy : conserve l’accès déjà établi. Sans séances calculées : toutes les classes accessibles.
 */
export function controlPlanningClassroomIdsCoveredInWeek(options: {
  accessible: readonly ControlPlanningClass[];
  classrooms: readonly RuntimeClassroomListItem[];
  sessions: readonly CourseSession[];
  assignments: TeacherCourseAssignment[];
  teacherId: string;
  schoolWeekNumber: number | null;
}): string[] {
  if (options.schoolWeekNumber === null || options.sessions.length === 0) {
    return options.accessible.map((entry) => entry.id);
  }
  const runtimeById = new Map(options.classrooms.map((entry) => [entry.id, entry]));
  const covered: string[] = [];
  for (const entry of options.accessible) {
    const schoolClassId = runtimeById.get(entry.id)?.schoolClassId?.trim() || null;
    if (!schoolClassId) {
      covered.push(entry.id);
      continue;
    }
    const hasCoveredSession = options.sessions.some(
      (session) =>
        session.classId === schoolClassId &&
        session.schoolWeekNumber === options.schoolWeekNumber &&
        teacherHasStructuredPublishAccess({
          teacherId: options.teacherId,
          annualCourseId: session.annualCourseId,
          assignments: options.assignments,
          at: assignmentInstantForSessionDate(session.date),
        }),
    );
    if (hasCoveredSession) covered.push(entry.id);
  }
  return covered;
}

async function listRuntimeClassroomsWhere(
  options: {
    teacherId: string;
    classrooms: RuntimeClassroomListItem[];
    classes: SchoolClassRecord[];
    schoolYearId?: string | null;
    teacherCanAccessClassroom: (teacherId: string, classroomId: string) => Promise<boolean>;
  },
  structuredAllowed: (linked: SchoolClassRecord) => boolean,
): Promise<ControlPlanningClass[]> {
  const yearId = options.schoolYearId?.trim() || null;
  const accessible: ControlPlanningClass[] = [];
  const seen = new Set<string>();
  for (const classroom of options.classrooms) {
    if (seen.has(classroom.id)) continue;
    const linkedId = classroom.schoolClassId?.trim() || null;
    const linked = linkedId ? options.classes.find((entry) => entry.id === linkedId) ?? null : null;
    if (linked) {
      if (yearId && !structuredClassMatchesPlanningYear(linked, yearId)) continue;
      if (!structuredAllowed(linked)) continue;
    } else if (!(await options.teacherCanAccessClassroom(options.teacherId, classroom.id))) {
      continue;
    }
    seen.add(classroom.id);
    accessible.push({ id: classroom.id, name: classroom.name });
  }
  return accessible;
}
