import type { AnnualCourse, TeacherCourseAssignment } from "../annual-courses/types.ts";
import {
  assignmentInstantForSessionDate,
  teacherHasStructuredClassroomReadAccess,
  teacherHasStructuredPublishAccess,
} from "../agenda-bridge/access.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { PedagogicalContextRecord } from "../school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";
import {
  assignedSchoolClassIdsFromTeacherCourses,
  buildTeacherCourseWorkspace,
} from "../teacher-workspace/index.ts";
import type { RuntimeClassroomListItem } from "../../lib/persistence/runtime-agenda-types.ts";
import type { ControlPlanningClass } from "./types.ts";

export function structuredClassMatchesPlanningYear(
  schoolClass: Pick<SchoolClassRecord, "schoolYearId">,
  schoolYearId: string,
): boolean {
  return (schoolClass.schoolYearId?.trim() || null) === schoolYearId;
}

export function teacherCoursesForPlanningYear(options: {
  teacherId: string;
  schoolYearId: string;
  at?: string;
  assignments: TeacherCourseAssignment[];
  courses: AnnualCourse[];
  classes: SchoolClassRecord[];
  contexts: PedagogicalContextRecord[];
  branches: SchoolBranchRecord[];
  years: SchoolYearRecord[];
}) {
  return buildTeacherCourseWorkspace({
    teacherId: options.teacherId,
    schoolYearId: options.schoolYearId,
    at: options.at,
    assignments: options.assignments,
    courses: options.courses,
    classes: options.classes,
    contexts: options.contexts,
    branches: options.branches,
    years: options.years,
  }).courses;
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
 * Classe du module Contrôles : au moins un AnnualCourse attribué selon « Mes cours ».
 * Les CourseSessions ne sont pas une source d’autorité pour cette liste.
 */
export function teacherHasAssignedStructuredPlanningClass(options: {
  teacherId: string;
  schoolClass: SchoolClassRecord;
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  years: SchoolYearRecord[];
  contexts: PedagogicalContextRecord[];
  branches: SchoolBranchRecord[];
  schoolYearId?: string;
  at?: string;
}): boolean {
  const schoolYearId = options.schoolYearId?.trim() || options.schoolClass.schoolYearId?.trim() || "";
  if (!schoolYearId) return false;
  return teacherCoursesForPlanningYear({
    teacherId: options.teacherId,
    schoolYearId,
    at: options.at,
    assignments: options.assignments,
    courses: options.courses,
    classes: [options.schoolClass],
    contexts: options.contexts,
    branches: options.branches,
    years: options.years,
  }).some((course) => course.classId === options.schoolClass.id);
}

/** Alias : Contrôles et Mes cours partagent la même règle d’attribution. */
export const teacherHasControlPlanningClassAccess = teacherHasAssignedStructuredPlanningClass;

/**
 * Classes proposées dans Contrôles : dérivées des AnnualCourse de « Mes cours »
 * pour l’année. Pas de membership, pas de CourseSession, pas de catalogue démo.
 */
export function listAssignedStructuredPlanningClassrooms(options: {
  teacherId: string;
  classrooms: RuntimeClassroomListItem[];
  classes: SchoolClassRecord[];
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  years: SchoolYearRecord[];
  contexts: PedagogicalContextRecord[];
  branches: SchoolBranchRecord[];
  schoolYearId: string;
  at?: string;
}): ControlPlanningClass[] {
  const assignedClassIds = new Set(
    assignedSchoolClassIdsFromTeacherCourses(
      teacherCoursesForPlanningYear({
        teacherId: options.teacherId,
        schoolYearId: options.schoolYearId,
        at: options.at,
        assignments: options.assignments,
        courses: options.courses,
        classes: options.classes,
        contexts: options.contexts,
        branches: options.branches,
        years: options.years,
      }),
    ),
  );
  const classroomBySchoolClassId = new Map(
    options.classrooms
      .filter((classroom) => classroom.schoolClassId?.trim())
      .map((classroom) => [classroom.schoolClassId!.trim(), classroom]),
  );
  const yearClasses = options.classes
    .filter((schoolClass) => structuredClassMatchesPlanningYear(schoolClass, options.schoolYearId))
    .filter((schoolClass) => assignedClassIds.has(schoolClass.id))
    .slice()
    .sort((left, right) => (left.code || left.label).localeCompare(right.code || right.label, "fr"));
  const result: ControlPlanningClass[] = [];
  const seen = new Set<string>();
  for (const schoolClass of yearClasses) {
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
  contexts: PedagogicalContextRecord[];
  branches: SchoolBranchRecord[];
  sessions?: readonly CourseSession[];
  teacherCanAccessClassroom?: (teacherId: string, classroomId: string) => Promise<boolean>;
  schoolYearId?: string | null;
  at?: string;
}): Promise<ControlPlanningClass[]> {
  const schoolYearId =
    options.schoolYearId?.trim() || options.years.find((year) => year.status === "active")?.id || "";
  if (!schoolYearId) return [];
  return listAssignedStructuredPlanningClassrooms({
    teacherId: options.teacherId,
    classrooms: options.classrooms,
    classes: options.classes,
    courses: options.courses,
    assignments: options.assignments,
    years: options.years,
    contexts: options.contexts,
    branches: options.branches,
    schoolYearId,
    at: options.at,
  });
}

/**
 * Classes dont au moins une CourseSession de la semaine a une TCA active à la date.
 * Ne sert qu’au filtrage des jours / charge, jamais à élargir la liste des classes.
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
