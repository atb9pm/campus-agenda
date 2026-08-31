import type { AnnualCourse, TeacherCourseAssignment } from "../annual-courses/types.ts";
import { isAssignmentActiveAt } from "../annual-courses/assignments.ts";
import { formatTrainingYearLabel } from "../school-catalog/class-codes.ts";
import { classDisplayProfessionLabel } from "../school-catalog/class-display.ts";
import type { PedagogicalContextRecord, SchoolProfessionRecord } from "../school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";
import type { TeacherClassSetup, TeacherSetupConfig, WeekdayIndex } from "../teacher-setup/types.ts";
import { matchSetupPreference } from "./setup-match.ts";
import type {
  TeacherCourseClassGroup,
  TeacherCourseWorkspaceEntry,
  TeacherCourseWorkspaceResult,
} from "./types.ts";

const CLASS_ICONS = ["🔧", "⚙️", "🛠️", "🔩", "⚡", "📐", "🎓", "📋"];

export interface BuildTeacherCourseWorkspaceInput {
  teacherId: string;
  at?: string;
  /** Année ciblée. Absent = année scolaire active (espace opérationnel). */
  schoolYearId?: string | null;
  assignments: TeacherCourseAssignment[];
  courses: AnnualCourse[];
  classes: SchoolClassRecord[];
  contexts: PedagogicalContextRecord[];
  branches: SchoolBranchRecord[];
  years: SchoolYearRecord[];
  professions?: SchoolProfessionRecord[];
}

export function resolveWorkspaceSchoolYearId(
  years: SchoolYearRecord[],
  requestedSchoolYearId?: string | null,
): string | null {
  const requested = requestedSchoolYearId?.trim() || null;
  if (requested) {
    return years.some((year) => year.id === requested) ? requested : null;
  }
  return years.find((year) => year.status === "active")?.id ?? null;
}

function compareWorkspaceEntries(
  left: TeacherCourseWorkspaceEntry,
  right: TeacherCourseWorkspaceEntry,
): number {
  if (left.classSortOrder !== right.classSortOrder) return left.classSortOrder - right.classSortOrder;
  const byCode = left.classCode.localeCompare(right.classCode, "fr-CH", {
    numeric: true,
    sensitivity: "base",
  });
  if (byCode !== 0) return byCode;
  if (left.classId !== right.classId) return left.classId.localeCompare(right.classId);
  if (left.branchSortOrder !== right.branchSortOrder) return left.branchSortOrder - right.branchSortOrder;
  const byBranch = left.branchLabel.localeCompare(right.branchLabel, "fr-CH", { sensitivity: "base" });
  if (byBranch !== 0) return byBranch;
  return left.annualCourseId.localeCompare(right.annualCourseId);
}

/**
 * Source de vérité : TeacherCourseAssignment.
 * TeacherSetupConfig n’intervient pas ici et n’accorde jamais d’accès.
 */
export function buildTeacherCourseWorkspace(
  input: BuildTeacherCourseWorkspaceInput,
): TeacherCourseWorkspaceResult {
  const at = input.at ?? new Date().toISOString();
  const schoolYearId = resolveWorkspaceSchoolYearId(input.years, input.schoolYearId);
  if (!schoolYearId) {
    return { schoolYearId: null, courses: [] };
  }

  const yearById = new Map(input.years.map((year) => [year.id, year]));
  const courseById = new Map(input.courses.map((course) => [course.id, course]));
  const classById = new Map(input.classes.map((entry) => [entry.id, entry]));
  const contextById = new Map(input.contexts.map((entry) => [entry.id, entry]));
  const branchById = new Map(input.branches.map((entry) => [entry.id, entry]));
  const professionById = new Map((input.professions ?? []).map((entry) => [entry.id, entry]));

  const operational = !input.schoolYearId;
  const entries: TeacherCourseWorkspaceEntry[] = [];

  for (const assignment of input.assignments) {
    if (assignment.teacherId !== input.teacherId) continue;
    if (!isAssignmentActiveAt(assignment, at)) continue;

    const course = courseById.get(assignment.annualCourseId);
    if (!course || course.isArchived) continue;
    if (course.schoolYearId !== schoolYearId) continue;

    const year = yearById.get(course.schoolYearId);
    if (!year) continue;
    if (operational && year.status === "archived") continue;

    const schoolClass = classById.get(course.classId);
    if (!schoolClass || !schoolClass.isActive || schoolClass.isArchived) continue;

    const context = contextById.get(course.contextId);
    if (!context) continue;

    const branch = branchById.get(context.branchId);
    if (!branch) continue;

    const profession = schoolClass.professionId
      ? professionById.get(schoolClass.professionId) ?? null
      : null;

    entries.push({
      annualCourseId: course.id,
      assignmentId: assignment.id,
      role: assignment.role,
      validFrom: assignment.validFrom,
      validTo: assignment.validTo,
      schoolYearId: year.id,
      schoolYearLabel: year.label,
      classId: schoolClass.id,
      classCode: schoolClass.code,
      classLabel: schoolClass.label,
      classSortOrder: schoolClass.sortOrder,
      professionId: schoolClass.professionId,
      professionLabel: classDisplayProfessionLabel(schoolClass, profession),
      trainingYear: schoolClass.trainingYear,
      parallelCode: schoolClass.parallelCode,
      contextId: context.id,
      branchId: branch.id,
      branchCode: branch.code,
      branchLabel: branch.label,
      branchSortOrder: branch.sortOrder,
      teachingType: branch.teachingType,
    });
  }

  entries.sort(compareWorkspaceEntries);
  return { schoolYearId, courses: entries };
}

export function groupTeacherCoursesByClass(
  courses: TeacherCourseWorkspaceEntry[],
): TeacherCourseClassGroup[] {
  const groups: TeacherCourseClassGroup[] = [];
  const indexByClassId = new Map<string, number>();

  for (const course of courses) {
    const existing = indexByClassId.get(course.classId);
    if (existing !== undefined) {
      groups[existing]!.courses.push(course);
      continue;
    }
    indexByClassId.set(course.classId, groups.length);
    groups.push({
      classId: course.classId,
      classCode: course.classCode,
      classLabel: course.classLabel,
      professionLabel: course.professionLabel,
      trainingYear: course.trainingYear,
      parallelCode: course.parallelCode,
      courses: [course],
    });
  }
  return groups;
}

export function formatTeacherCourseClassMeta(group: Pick<
  TeacherCourseClassGroup,
  "trainingYear" | "parallelCode"
>): string {
  const parts: string[] = [];
  if (group.trainingYear !== null) parts.push(formatTrainingYearLabel(group.trainingYear));
  if (group.parallelCode) parts.push(`Groupe ${group.parallelCode}`);
  return parts.join(" · ");
}

export function toDisplayClassSetup(
  entry: TeacherCourseWorkspaceEntry,
  setup?: TeacherSetupConfig | null,
  index = 0,
): TeacherClassSetup {
  const matched = matchSetupPreference(entry, setup);
  if (matched) {
    return {
      ...matched,
      name: entry.classCode,
      programLabel: matched.programLabel.trim() || entry.professionLabel || entry.classLabel,
      branchNames: matched.branchNames.length ? matched.branchNames : [entry.branchLabel],
    };
  }
  return {
    id: entry.classId,
    name: entry.classCode,
    programLabel: entry.professionLabel ?? entry.classLabel,
    dayOfWeek: (((index % 5) + 1) as WeekdayIndex),
    branchNames: [entry.branchLabel],
    icon: CLASS_ICONS[index % CLASS_ICONS.length]!,
  };
}

export function displaySetupsFromAssignedCourses(
  courses: TeacherCourseWorkspaceEntry[],
  setup?: TeacherSetupConfig | null,
): TeacherClassSetup[] {
  const seen = new Set<string>();
  const result: TeacherClassSetup[] = [];
  courses.forEach((entry, index) => {
    const display = toDisplayClassSetup(entry, setup, index);
    if (seen.has(display.id)) return;
    seen.add(display.id);
    result.push(display);
  });
  return result;
}

export function upsertSetupPreferenceForCourse(
  setup: TeacherSetupConfig,
  entry: TeacherCourseWorkspaceEntry,
  patch: Partial<Pick<TeacherClassSetup, "dayOfWeek" | "icon">>,
): TeacherSetupConfig {
  const matched = matchSetupPreference(entry, setup);
  if (matched) {
    return {
      version: 1,
      classes: setup.classes.map((candidate) =>
        candidate.id === matched.id ? { ...candidate, ...patch } : candidate,
      ),
    };
  }
  return {
    version: 1,
    classes: [
      ...setup.classes,
      {
        ...toDisplayClassSetup(entry, null),
        ...patch,
        id: entry.annualCourseId,
        name: entry.classCode,
        programLabel: entry.professionLabel ?? entry.classLabel,
        branchNames: [entry.branchLabel],
      },
    ],
  };
}

export function removeSetupPreferenceForCourse(
  setup: TeacherSetupConfig,
  entry: TeacherCourseWorkspaceEntry,
): TeacherSetupConfig {
  const matched = matchSetupPreference(entry, setup);
  if (!matched) return setup;
  return {
    version: 1,
    classes: setup.classes.filter((candidate) => candidate.id !== matched.id),
  };
}
