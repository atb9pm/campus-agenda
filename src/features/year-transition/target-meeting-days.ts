/**
 * Contrat PREVIEW : plan de jours N+1 explicite par cours repris.
 *
 * Absent (`undefined`) : assembleur legacy, qui peut encore cloner les CourseScheduleSlot
 * de N pour des tests / APPLY déjà persistés. Le nouveau flux ne doit jamais
 * emprunter ce repli : dès que `targetMeetingDayPlans` est fourni, chaque cours
 * continué exige un plan valide, et les dates N+1 viennent uniquement de
 * MeetingDays × calendrier N+1.
 */

import {
  validateAnnualCourseMeetingDayPlan,
  type AnnualCourseMeetingDayInput,
} from "../annual-courses/meeting-days.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import type { YearTransitionClassMapping } from "./types.ts";

export const TARGET_MEETING_DAY_PLAN_REQUIRED = "TARGET_MEETING_DAY_PLAN_REQUIRED";
export const TARGET_MEETING_DAY_PLAN_REQUIRED_REASON =
  "Chaque cours repris doit avoir un plan de jours N+1. Aucun jour n’est repris automatiquement depuis l’année source.";
export const TARGET_MEETING_DAY_PLAN_DUPLICATE = "TARGET_MEETING_DAY_PLAN_DUPLICATE";
export const TARGET_MEETING_DAY_PLAN_DUPLICATE_REASON =
  "Un cours repris ne peut avoir qu’un seul plan de jours N+1.";
export const TARGET_MEETING_DAY_PLAN_INVALID = "TARGET_MEETING_DAY_PLAN_INVALID";

export class YearTransitionPreviewContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "YearTransitionPreviewContractError";
    this.code = code;
  }
}

export interface YearTransitionTargetMeetingDayPlan {
  sourceAnnualCourseId: string;
  days: AnnualCourseMeetingDayInput[];
}

export type CanonicalTargetMeetingDay = {
  dayOfWeek: AnnualCourseMeetingDayInput["dayOfWeek"];
  weekKind: AnnualCourseMeetingDayInput["weekKind"];
  role: AnnualCourseMeetingDayInput["role"];
};

export type CanonicalTargetMeetingDayPlan = {
  sourceAnnualCourseId: string;
  days: CanonicalTargetMeetingDay[];
};

const ROLE_ORDER: Record<AnnualCourseMeetingDayInput["role"], number> = {
  PRIMARY: 0,
  ADDITIONAL: 1,
};

export function canonicalizeTargetMeetingDayPlans(
  plans: readonly YearTransitionTargetMeetingDayPlan[],
): CanonicalTargetMeetingDayPlan[] {
  return [...plans]
    .map((plan) => ({
      sourceAnnualCourseId: plan.sourceAnnualCourseId.trim(),
      days: [...plan.days]
        .map((day) => ({
          dayOfWeek: day.dayOfWeek,
          weekKind: day.weekKind,
          role: day.role,
        }))
        .sort(
          (left, right) =>
            ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
            left.dayOfWeek - right.dayOfWeek ||
            left.weekKind.localeCompare(right.weekKind),
        ),
    }))
    .filter((plan) => plan.sourceAnnualCourseId)
    .sort((left, right) => left.sourceAnnualCourseId.localeCompare(right.sourceAnnualCourseId));
}

export function parseTargetMeetingDayPlans(raw: unknown): YearTransitionTargetMeetingDayPlan[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new YearTransitionPreviewContractError(
      TARGET_MEETING_DAY_PLAN_INVALID,
      "Plans de jours N+1 invalides.",
    );
  }
  const plans: YearTransitionTargetMeetingDayPlan[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      throw new YearTransitionPreviewContractError(
        TARGET_MEETING_DAY_PLAN_INVALID,
        "Plans de jours N+1 invalides.",
      );
    }
    const record = entry as Record<string, unknown>;
    const sourceAnnualCourseId =
      typeof record.sourceAnnualCourseId === "string" ? record.sourceAnnualCourseId.trim() : "";
    if (!sourceAnnualCourseId) {
      throw new YearTransitionPreviewContractError(
        TARGET_MEETING_DAY_PLAN_INVALID,
        "Chaque plan de jours N+1 doit identifier le cours source.",
      );
    }
    if (!Array.isArray(record.days)) {
      throw new YearTransitionPreviewContractError(
        TARGET_MEETING_DAY_PLAN_INVALID,
        "Chaque plan de jours N+1 doit contenir une liste de jours.",
      );
    }
    const days: AnnualCourseMeetingDayInput[] = [];
    for (const day of record.days) {
      if (!day || typeof day !== "object") {
        throw new YearTransitionPreviewContractError(
          TARGET_MEETING_DAY_PLAN_INVALID,
          "Jour de plan N+1 invalide.",
        );
      }
      const row = day as Record<string, unknown>;
      days.push({
        dayOfWeek: Number(row.dayOfWeek) as AnnualCourseMeetingDayInput["dayOfWeek"],
        weekKind: row.weekKind as AnnualCourseMeetingDayInput["weekKind"],
        role: row.role as AnnualCourseMeetingDayInput["role"],
      });
    }
    const parsed = validateAnnualCourseMeetingDayPlan(days);
    if (!parsed.ok) {
      throw new YearTransitionPreviewContractError(TARGET_MEETING_DAY_PLAN_INVALID, parsed.reason);
    }
    plans.push({ sourceAnnualCourseId, days: parsed.value });
  }
  return plans;
}

export function continuationSourceCourses(
  mappings: readonly YearTransitionClassMapping[],
  sourceCourses: readonly AnnualCourse[],
  selectedSourceClassIds?: readonly string[],
): AnnualCourse[] {
  const selected = new Set(
    (selectedSourceClassIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const continuedClassIds = new Set<string>();
  for (const mapping of mappings) {
    const sourceClassId = mapping.sourceClassId?.trim() || "";
    const targetClassId = mapping.targetClassId?.trim() || "";
    if (!sourceClassId || !targetClassId) continue;
    if (selected.size > 0 && !selected.has(sourceClassId)) continue;
    continuedClassIds.add(sourceClassId);
  }
  return sourceCourses
    .filter((course) => !course.isArchived && continuedClassIds.has(course.classId))
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Valide le contrat explicite. Un plan vide n’est pas un défaut vers N.
 * Les cours hors continuation peuvent figurer dans l’entrée ; ils n’exigent pas de plan.
 */
export function requireTargetMeetingDayPlans(
  plans: readonly YearTransitionTargetMeetingDayPlan[],
  requiredCourses: readonly AnnualCourse[],
): CanonicalTargetMeetingDayPlan[] {
  const canonical = canonicalizeTargetMeetingDayPlans(plans);
  const seen = new Set<string>();
  for (const plan of canonical) {
    if (seen.has(plan.sourceAnnualCourseId)) {
      throw new YearTransitionPreviewContractError(
        TARGET_MEETING_DAY_PLAN_DUPLICATE,
        TARGET_MEETING_DAY_PLAN_DUPLICATE_REASON,
      );
    }
    seen.add(plan.sourceAnnualCourseId);
  }

  const bySource = new Map(canonical.map((plan) => [plan.sourceAnnualCourseId, plan]));
  for (const course of requiredCourses) {
    const plan = bySource.get(course.id);
    if (!plan || plan.days.length === 0) {
      throw new YearTransitionPreviewContractError(
        TARGET_MEETING_DAY_PLAN_REQUIRED,
        TARGET_MEETING_DAY_PLAN_REQUIRED_REASON,
      );
    }
    const parsed = validateAnnualCourseMeetingDayPlan(plan.days);
    if (!parsed.ok) {
      throw new YearTransitionPreviewContractError(TARGET_MEETING_DAY_PLAN_INVALID, parsed.reason);
    }
  }
  return canonical;
}

export function usesExplicitTargetMeetingDayPlans(
  plans: readonly YearTransitionTargetMeetingDayPlan[] | undefined,
): plans is readonly YearTransitionTargetMeetingDayPlan[] {
  return plans !== undefined;
}
