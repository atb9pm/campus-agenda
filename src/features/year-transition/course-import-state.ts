import type { AnnualCourseMeetingDayInput } from "../annual-courses/meeting-days.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import { resolveClassContinuations } from "./continuation-identity.ts";
import {
  canonicalizeTargetMeetingDayPlans,
  continuationSourceCourses,
  type CanonicalTargetMeetingDay,
  type YearTransitionTargetMeetingDayPlan,
} from "./target-meeting-days.ts";
import type { YearTransitionClassMapping } from "./types.ts";

/** Champs du snapshot matériel persisté nécessaires pour savoir quels cours un APPLY a repris. */
export interface AppliedTransitionSnapshot {
  classMappings?: YearTransitionClassMapping[];
  sourceCourses?: Array<Pick<AnnualCourse, "id" | "schoolYearId" | "classId" | "contextId" | "isArchived">>;
  selectedSourceClassIds?: string[];
  selectedSourceAnnualCourseIds?: string[];
  targetMeetingDayPlans?: YearTransitionTargetMeetingDayPlan[];
}

export interface AppliedTransitionRecord {
  transitionId: string;
  appliedAt: string;
  snapshot: AppliedTransitionSnapshot;
}

export interface YearTransitionCoursePreparation {
  transitionId: string;
  appliedAt: string;
  /** Null : transfert legacy sans plan de jours explicite. */
  days: CanonicalTargetMeetingDay[] | null;
}

export interface YearTransitionCourseImportState {
  sourceSchoolYearId: string;
  targetSchoolYearId: string;
  sourceAnnualCourseId: string;
  targetAnnualCourseId: string | null;
  /** Plan en vigueur : jours enregistrés sur le cours N+1, sinon plan de la dernière préparation. */
  currentPlan: CanonicalTargetMeetingDay[] | null;
  currentPlanOrigin: "target-course" | "last-preparation" | null;
  /** Faux si les jours du cours N+1 ne correspondent plus au plan de la dernière préparation. */
  matchesLastPreparation: boolean;
  preparations: YearTransitionCoursePreparation[];
}

const ROLE_ORDER: Record<AnnualCourseMeetingDayInput["role"], number> = { PRIMARY: 0, ADDITIONAL: 1 };

export function canonicalMeetingDays(
  days: readonly AnnualCourseMeetingDayInput[],
): CanonicalTargetMeetingDay[] {
  return days
    .map((day) => ({ dayOfWeek: day.dayOfWeek, weekKind: day.weekKind, role: day.role }))
    .sort(
      (left, right) =>
        ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
        left.dayOfWeek - right.dayOfWeek ||
        left.weekKind.localeCompare(right.weekKind),
    );
}

export function sameMeetingDayPlan(
  left: readonly AnnualCourseMeetingDayInput[] | null,
  right: readonly AnnualCourseMeetingDayInput[] | null,
): boolean {
  if (!left || !right) return left === right;
  return JSON.stringify(canonicalMeetingDays(left)) === JSON.stringify(canonicalMeetingDays(right));
}

function importedSourceCourseIds(snapshot: AppliedTransitionSnapshot): string[] {
  const sourceCourses = (snapshot.sourceCourses ?? []) as AnnualCourse[];
  return continuationSourceCourses(
    snapshot.classMappings ?? [],
    sourceCourses,
    snapshot.selectedSourceClassIds,
    snapshot.selectedSourceAnnualCourseIds,
  ).map((course) => course.id);
}

function liveTargetCourse(options: {
  sourceCourse: Pick<AnnualCourse, "classId" | "contextId">;
  classes: readonly SchoolClassRecord[];
  courses: readonly AnnualCourse[];
  sourceSchoolYearId: string;
  targetSchoolYearId: string;
}): AnnualCourse | null {
  const resolution = resolveClassContinuations({
    selectedSourceClassIds: [options.sourceCourse.classId],
    sourceClasses: options.classes,
    targetClasses: options.classes,
    sourceSchoolYearId: options.sourceSchoolYearId,
    targetSchoolYearId: options.targetSchoolYearId,
  });
  const row = resolution.planned.find((entry) => entry.sourceClassId === options.sourceCourse.classId);
  if (row?.action !== "reuse" || !row.targetClassId) return null;
  const matches = options.courses.filter(
    (course) =>
      course.classId === row.targetClassId &&
      course.schoolYearId === options.targetSchoolYearId &&
      course.contextId === options.sourceCourse.contextId &&
      !course.isArchived,
  );
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * État « Déjà importé » par cours source, déduit du registre des APPLY et des
 * snapshots persistés. Lecture seule : aucune donnée n’est créée ni modifiée.
 */
export function buildYearTransitionCourseImportStates(options: {
  sourceSchoolYearId: string;
  targetSchoolYearId: string;
  applied: readonly AppliedTransitionRecord[];
  classes: readonly SchoolClassRecord[];
  courses: readonly AnnualCourse[];
  meetingDays: ReadonlyArray<AnnualCourseMeetingDayInput & { annualCourseId: string }>;
}): YearTransitionCourseImportState[] {
  const preparationsBySource = new Map<string, YearTransitionCoursePreparation[]>();
  const ordered = [...options.applied].sort(
    (left, right) => left.appliedAt.localeCompare(right.appliedAt) || left.transitionId.localeCompare(right.transitionId),
  );
  for (const record of ordered) {
    const plans = new Map(
      canonicalizeTargetMeetingDayPlans(record.snapshot.targetMeetingDayPlans ?? []).map((plan) => [
        plan.sourceAnnualCourseId,
        plan.days,
      ]),
    );
    for (const sourceCourseId of importedSourceCourseIds(record.snapshot)) {
      const list = preparationsBySource.get(sourceCourseId) ?? [];
      list.push({
        transitionId: record.transitionId,
        appliedAt: record.appliedAt,
        days: plans.get(sourceCourseId) ?? null,
      });
      preparationsBySource.set(sourceCourseId, list);
    }
  }

  const states: YearTransitionCourseImportState[] = [];
  for (const [sourceAnnualCourseId, preparations] of preparationsBySource) {
    const sourceCourse = options.courses.find((course) => course.id === sourceAnnualCourseId) ?? null;
    const targetCourse = sourceCourse
      ? liveTargetCourse({
          sourceCourse,
          classes: options.classes,
          courses: options.courses,
          sourceSchoolYearId: options.sourceSchoolYearId,
          targetSchoolYearId: options.targetSchoolYearId,
        })
      : null;
    const targetDays = targetCourse
      ? canonicalMeetingDays(options.meetingDays.filter((day) => day.annualCourseId === targetCourse.id))
      : [];
    const lastDays = preparations[preparations.length - 1]!.days;
    const currentPlan = targetDays.length > 0 ? targetDays : lastDays;
    states.push({
      sourceSchoolYearId: options.sourceSchoolYearId,
      targetSchoolYearId: options.targetSchoolYearId,
      sourceAnnualCourseId,
      targetAnnualCourseId: targetCourse?.id ?? null,
      currentPlan,
      currentPlanOrigin: targetDays.length > 0 ? "target-course" : lastDays ? "last-preparation" : null,
      matchesLastPreparation: targetDays.length === 0 || sameMeetingDayPlan(targetDays, lastDays),
      preparations,
    });
  }
  return states.sort((left, right) => left.sourceAnnualCourseId.localeCompare(right.sourceAnnualCourseId));
}
