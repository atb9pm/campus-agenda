import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AnnualCourseMeetingDayInput } from "../annual-courses/meeting-days.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import type { AnnualCourseNote } from "../pedagogical-path/annual-notes.ts";
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
  sourceItems?: SourceItemMaterial[];
  sourceNotes?: SourceNoteMaterial[];
}

export type SourceItemMaterial = Pick<
  PrototypeAgendaItem,
  "id" | "type" | "title" | "detail" | "schoolYearId" | "annualCourseId" | "courseSessionKey" | "referenceItemId" | "referenceSessionId"
>;

export type SourceNoteMaterial = Pick<
  AnnualCourseNote,
  "id" | "schoolYearId" | "annualCourseId" | "text" | "body" | "courseSessionKey" | "referenceSessionId"
>;

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
  /**
   * Vrai si les publications ou notes du cours dans N ont changé (ajout, modification,
   * déplacement, suppression) depuis la dernière préparation. Les copies N+1 ne suivent pas N.
   */
  sourceContentChanged: boolean;
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

function itemMaterial(item: SourceItemMaterial) {
  return [
    item.id,
    item.type,
    item.title,
    item.detail,
    item.courseSessionKey ?? null,
    item.referenceItemId ?? null,
    item.referenceSessionId ?? null,
  ];
}

function noteMaterial(note: SourceNoteMaterial) {
  return [note.id, note.text, note.body ?? null, note.courseSessionKey ?? null, note.referenceSessionId ?? null];
}

function materialToken<T extends { id: number | string }>(rows: readonly T[], material: (row: T) => unknown[]): string {
  return JSON.stringify(
    [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id))).map(material),
  );
}

/** Contenu N du cours comparé au snapshot de sa dernière préparation. Notes ignorées si le snapshot n’en a pas. */
export function sourceContentChangedSincePreparation(options: {
  snapshot: AppliedTransitionSnapshot;
  sourceSchoolYearId: string;
  sourceAnnualCourseId: string;
  items: readonly SourceItemMaterial[];
  notes: readonly SourceNoteMaterial[];
}): boolean {
  if (!options.snapshot.sourceItems) return false;
  const ofCourse = <T extends { schoolYearId?: string | null; annualCourseId?: string | null }>(rows: readonly T[]) =>
    rows.filter(
      (row) =>
        (row.schoolYearId ?? null) === options.sourceSchoolYearId &&
        (row.annualCourseId ?? null) === options.sourceAnnualCourseId,
    );
  if (
    materialToken(ofCourse(options.snapshot.sourceItems), itemMaterial) !==
    materialToken(ofCourse(options.items), itemMaterial)
  ) {
    return true;
  }
  if (!options.snapshot.sourceNotes) return false;
  return (
    materialToken(ofCourse(options.snapshot.sourceNotes), noteMaterial) !==
    materialToken(ofCourse(options.notes), noteMaterial)
  );
}

export function importedSourceCourseIds(snapshot: AppliedTransitionSnapshot): string[] {
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
  /** Contenu actuel de N ; sans lui, aucun changement n’est signalé. */
  sourceContent?: { items: readonly SourceItemMaterial[]; notes: readonly SourceNoteMaterial[] };
}): YearTransitionCourseImportState[] {
  const preparationsBySource = new Map<string, YearTransitionCoursePreparation[]>();
  const lastSnapshotBySource = new Map<string, AppliedTransitionSnapshot>();
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
      lastSnapshotBySource.set(sourceCourseId, record.snapshot);
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
      sourceContentChanged: options.sourceContent
        ? sourceContentChangedSincePreparation({
            snapshot: lastSnapshotBySource.get(sourceAnnualCourseId)!,
            sourceSchoolYearId: options.sourceSchoolYearId,
            sourceAnnualCourseId,
            items: options.sourceContent.items,
            notes: options.sourceContent.notes,
          })
        : false,
      preparations,
    });
  }
  return states.sort((left, right) => left.sourceAnnualCourseId.localeCompare(right.sourceAnnualCourseId));
}
