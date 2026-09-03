import type { PedagogicalContextRecord } from "../school-catalog/profession-types.ts";
import { isOperationalSchoolClass } from "../school-catalog/class-lifecycle.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../school-catalog/types.ts";
import {
  assignmentDisplayLabel,
  assignmentDisplayStatus,
  assignmentLifecycle,
  type AssignmentDisplayStatus,
} from "./admin-assign-ui.ts";
import { ASSIGNMENT_ROLE_LABELS, type AnnualCourse, type TeacherCourseAssignment } from "./types.ts";

export const TEACHER_ASSIGNMENT_HISTORY_CHECKBOX_LABEL = "Afficher l’historique";
export const TEACHER_ASSIGNMENT_EMPTY_ACTIVE_MESSAGE = "Aucune attribution active";

export interface TeacherAssignmentOverviewTeacher {
  id: string;
  isActive: boolean;
  isArchived: boolean;
}

export interface TeacherAssignmentOverviewYear {
  id: string;
  status: string;
}

export interface TeacherAssignmentOverviewRow {
  assignment: TeacherCourseAssignment;
  course: AnnualCourse | null;
  schoolClass: SchoolClassRecord | null;
  operational: boolean;
  displayStatus: AssignmentDisplayStatus;
  branchSortOrder: number;
}

export function activeSchoolYearIdForAssignments(
  years: readonly TeacherAssignmentOverviewYear[],
): string | null {
  return years.find((year) => year.status === "active")?.id ?? null;
}

/**
 * Chaîne opérationnelle unique : enseignant → TCA → AnnualCourse → SchoolClass → année active.
 * Alignée sur Mes cours (TCA à maintenant, classe opérationnelle, cours non archivé).
 */
export function isOperationalTeacherCourseAssignment(options: {
  teacher?: TeacherAssignmentOverviewTeacher | null;
  assignment: Pick<TeacherCourseAssignment, "validFrom" | "validTo" | "endedAt">;
  course?: Pick<AnnualCourse, "isArchived" | "schoolYearId"> | null;
  schoolClass?: Pick<SchoolClassRecord, "isActive" | "isArchived" | "schoolYearId"> | null;
  years: readonly TeacherAssignmentOverviewYear[];
  context?: Pick<PedagogicalContextRecord, "isActive" | "isArchived"> | null;
  branch?: Pick<SchoolBranchRecord, "isActive" | "isArchived"> | null;
  at?: string;
}): boolean {
  const teacher = options.teacher;
  if (!teacher || teacher.isArchived || !teacher.isActive) return false;
  if (assignmentLifecycle(options.assignment, options.at) !== "active") return false;
  const course = options.course;
  if (!course || course.isArchived) return false;
  const year = options.years.find((entry) => entry.id === course.schoolYearId);
  if (!year || year.status !== "active") return false;
  if (!isOperationalSchoolClass(options.schoolClass, course.schoolYearId)) return false;
  if (!options.context || options.context.isArchived || !options.context.isActive) return false;
  if (!options.branch || options.branch.isArchived || !options.branch.isActive) return false;
  return true;
}

export function teacherVisibleInAssignmentOverview(
  teacher: TeacherAssignmentOverviewTeacher,
  includeHistory: boolean,
): boolean {
  if (teacher.isArchived || !teacher.isActive) return includeHistory;
  return true;
}

function compareOverviewRows(left: TeacherAssignmentOverviewRow, right: TeacherAssignmentOverviewRow): number {
  if (left.operational !== right.operational) return left.operational ? -1 : 1;
  const leftClass = left.schoolClass;
  const rightClass = right.schoolClass;
  if ((leftClass?.sortOrder ?? 0) !== (rightClass?.sortOrder ?? 0)) {
    return (leftClass?.sortOrder ?? 0) - (rightClass?.sortOrder ?? 0);
  }
  const byCode = (leftClass?.code ?? "").localeCompare(rightClass?.code ?? "", "fr-CH", {
    numeric: true,
    sensitivity: "base",
  });
  if (byCode !== 0) return byCode;
  if (left.branchSortOrder !== right.branchSortOrder) return left.branchSortOrder - right.branchSortOrder;
  return left.assignment.id.localeCompare(right.assignment.id);
}

export function listTeacherAssignmentOverviewRows(options: {
  teacher: TeacherAssignmentOverviewTeacher;
  assignments: readonly TeacherCourseAssignment[];
  courses: readonly AnnualCourse[];
  classes: readonly SchoolClassRecord[];
  years: readonly TeacherAssignmentOverviewYear[];
  contexts: readonly PedagogicalContextRecord[];
  branches: readonly SchoolBranchRecord[];
  includeHistory: boolean;
  at?: string;
}): TeacherAssignmentOverviewRow[] {
  const activeSchoolYearId = activeSchoolYearIdForAssignments(options.years);
  const courseById = new Map(options.courses.map((course) => [course.id, course]));
  const classById = new Map(options.classes.map((entry) => [entry.id, entry]));
  const contextById = new Map(options.contexts.map((entry) => [entry.id, entry]));
  const branchById = new Map(options.branches.map((entry) => [entry.id, entry]));

  const rows: TeacherAssignmentOverviewRow[] = [];
  for (const assignment of options.assignments) {
    if (assignment.teacherId !== options.teacher.id) continue;
    const course = courseById.get(assignment.annualCourseId) ?? null;
    const schoolClass = course ? classById.get(course.classId) ?? null : null;
    const context = course ? contextById.get(course.contextId) ?? null : null;
    const branch = context ? branchById.get(context.branchId) ?? null : null;
    const operational = isOperationalTeacherCourseAssignment({
      teacher: options.teacher,
      assignment,
      course,
      schoolClass,
      years: options.years,
      context,
      branch,
      at: options.at,
    });
    if (!operational && !options.includeHistory) continue;
    rows.push({
      assignment,
      course,
      schoolClass,
      operational,
      branchSortOrder: branch?.sortOrder ?? 0,
      displayStatus: assignmentDisplayStatus(assignment, {
        schoolClass,
        courseSchoolYearId: course?.schoolYearId,
        courseIsArchived: course?.isArchived,
        activeSchoolYearId,
        at: options.at,
      }),
    });
  }

  return rows.sort(compareOverviewRows);
}

export function formatTeacherAssignmentOverviewLine(
  row: TeacherAssignmentOverviewRow,
  branchLabel: string,
): string {
  const classLabel = row.schoolClass?.label ?? "Classe";
  const role = ASSIGNMENT_ROLE_LABELS[row.assignment.role];
  return `${classLabel} → ${branchLabel} → ${role} · ${assignmentDisplayLabel(row.displayStatus)}`;
}
