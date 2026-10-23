/**
 * Saisie UI des jours N+1, sans lecture de l’horaire de N.
 * Isolé de meeting-days.ts / target-meeting-days.ts (node:crypto) pour rester
 * importable par l’assistant client.
 */

import {
  COURSE_WEEKDAY_LABELS,
  type CourseWeekKind,
  type CourseWeekday,
} from "../course-schedule/types.ts";

export const YEAR_TRANSITION_WEEKDAYS: readonly CourseWeekday[] = [1, 2, 3, 4, 5];

export const YEAR_TRANSITION_WEEK_KIND_UI_LABELS: Record<CourseWeekKind, string> = {
  all: "Chaque semaine",
  A: "Semaine A",
  B: "Semaine B",
};

export const YEAR_TRANSITION_WEEK_KIND_OPTIONS: ReadonlyArray<{
  value: CourseWeekKind;
  label: string;
}> = [
  { value: "all", label: YEAR_TRANSITION_WEEK_KIND_UI_LABELS.all },
  { value: "A", label: YEAR_TRANSITION_WEEK_KIND_UI_LABELS.A },
  { value: "B", label: YEAR_TRANSITION_WEEK_KIND_UI_LABELS.B },
];

export const YEAR_TRANSITION_WEEKDAY_OPTIONS: ReadonlyArray<{
  value: CourseWeekday;
  label: string;
}> = YEAR_TRANSITION_WEEKDAYS.map((value) => ({
  value,
  label: COURSE_WEEKDAY_LABELS[value],
}));

export const YEAR_TRANSITION_PRIMARY_DAY_REQUIRED = "Choisissez le jour principal de ce cours.";
export const YEAR_TRANSITION_ADDITIONAL_SAME_DAY = "Le deuxième jour doit être différent du jour principal.";

export interface MeetingDayDraft {
  primaryDay: CourseWeekday | null;
  primaryWeekKind: CourseWeekKind;
  additionalDay: CourseWeekday | null;
  additionalWeekKind: CourseWeekKind;
}

export interface MeetingDayPlanPayload {
  sourceAnnualCourseId: string;
  days: Array<{
    dayOfWeek: CourseWeekday;
    weekKind: CourseWeekKind;
    role: "PRIMARY" | "ADDITIONAL";
  }>;
}

export function emptyMeetingDayDraft(): MeetingDayDraft {
  return {
    primaryDay: null,
    primaryWeekKind: "all",
    additionalDay: null,
    additionalWeekKind: "all",
  };
}

export function meetingDayDraftSignature(draft: MeetingDayDraft): string {
  return [
    draft.primaryDay ?? "",
    draft.primaryWeekKind,
    draft.additionalDay ?? "",
    draft.additionalWeekKind,
  ].join("|");
}

export function validateMeetingDayDraft(draft: MeetingDayDraft): { ok: true } | { ok: false; reason: string } {
  if (draft.primaryDay == null) {
    return { ok: false, reason: YEAR_TRANSITION_PRIMARY_DAY_REQUIRED };
  }
  if (draft.additionalDay != null && draft.additionalDay === draft.primaryDay) {
    return { ok: false, reason: YEAR_TRANSITION_ADDITIONAL_SAME_DAY };
  }
  return { ok: true };
}

export function meetingDayDraftToPlanDays(
  draft: MeetingDayDraft,
): MeetingDayPlanPayload["days"] | null {
  if (!validateMeetingDayDraft(draft).ok || draft.primaryDay == null) return null;
  const days: MeetingDayPlanPayload["days"] = [
    {
      dayOfWeek: draft.primaryDay,
      weekKind: draft.primaryWeekKind,
      role: "PRIMARY",
    },
  ];
  if (draft.additionalDay != null) {
    days.push({
      dayOfWeek: draft.additionalDay,
      weekKind: draft.additionalWeekKind,
      role: "ADDITIONAL",
    });
  }
  return days;
}

export function buildTargetMeetingDayPlans(
  selectedSourceAnnualCourseIds: readonly string[],
  drafts: Readonly<Record<string, MeetingDayDraft>>,
): { ok: true; plans: MeetingDayPlanPayload[] } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const plans: MeetingDayPlanPayload[] = [];
  for (const courseId of selectedSourceAnnualCourseIds) {
    const draft = drafts[courseId] ?? emptyMeetingDayDraft();
    const validated = validateMeetingDayDraft(draft);
    if (!validated.ok) {
      errors[courseId] = validated.reason;
      continue;
    }
    const days = meetingDayDraftToPlanDays(draft);
    if (!days) {
      errors[courseId] = YEAR_TRANSITION_PRIMARY_DAY_REQUIRED;
      continue;
    }
    plans.push({ sourceAnnualCourseId: courseId, days });
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, plans };
}

export function meetingDayDraftFromPlanDays(
  days: ReadonlyArray<MeetingDayPlanPayload["days"][number]> | null | undefined,
): MeetingDayDraft {
  const draft = emptyMeetingDayDraft();
  const primary = days?.find((day) => day.role === "PRIMARY");
  const additional = days?.find((day) => day.role === "ADDITIONAL");
  if (primary) {
    draft.primaryDay = primary.dayOfWeek;
    draft.primaryWeekKind = primary.weekKind;
  }
  if (additional) {
    draft.additionalDay = additional.dayOfWeek;
    draft.additionalWeekKind = additional.weekKind;
  }
  return draft;
}

export function sameMeetingDayDraft(left: MeetingDayDraft, right: MeetingDayDraft): boolean {
  const normalize = (draft: MeetingDayDraft) =>
    draft.additionalDay == null ? { ...draft, additionalWeekKind: "all" as const } : draft;
  return meetingDayDraftSignature(normalize(left)) === meetingDayDraftSignature(normalize(right));
}

/** « Lundi, chaque semaine · Jeudi, semaine A » */
export function meetingDayPlanLabel(
  days: ReadonlyArray<MeetingDayPlanPayload["days"][number]> | null | undefined,
): string {
  const draft = meetingDayDraftFromPlanDays(days);
  if (draft.primaryDay == null) return "Plan de jours non renseigné";
  const rhythm = (kind: CourseWeekKind) => (kind === "all" ? "chaque semaine" : `semaine ${kind}`);
  const parts = [`${COURSE_WEEKDAY_LABELS[draft.primaryDay]}, ${rhythm(draft.primaryWeekKind)}`];
  if (draft.additionalDay != null) {
    parts.push(`${COURSE_WEEKDAY_LABELS[draft.additionalDay]}, ${rhythm(draft.additionalWeekKind)}`);
  }
  return parts.join(" · ");
}

export function yearTransitionConfigSignature(input: {
  sourceSchoolYearId: string;
  targetSchoolYearId: string;
  selectedSourceClassIds: readonly string[];
  selectedSourceAnnualCourseIds: readonly string[];
  drafts: Readonly<Record<string, MeetingDayDraft>>;
}): string {
  const drafts = input.selectedSourceAnnualCourseIds
    .map((id) => `${id}:${meetingDayDraftSignature(input.drafts[id] ?? emptyMeetingDayDraft())}`)
    .sort((left, right) => left.localeCompare(right));
  return JSON.stringify({
    sourceSchoolYearId: input.sourceSchoolYearId,
    targetSchoolYearId: input.targetSchoolYearId,
    selectedSourceClassIds: [...input.selectedSourceClassIds].slice().sort(),
    selectedSourceAnnualCourseIds: [...input.selectedSourceAnnualCourseIds].slice().sort(),
    drafts,
  });
}

/**
 * Cours déjà importés, cochés, dont le plan saisi diffère du plan actuel :
 * ce sont les seuls à réimporter. Un plan identique ne remplace rien.
 */
export function reimportSourceAnnualCourseIds(
  selectedCourseIds: readonly string[],
  drafts: Readonly<Record<string, MeetingDayDraft>>,
  currentPlans: ReadonlyMap<string, ReadonlyArray<MeetingDayPlanPayload["days"][number]> | null>,
): string[] {
  return selectedCourseIds
    .filter((courseId) => {
      if (!currentPlans.has(courseId)) return false;
      const draft = drafts[courseId];
      if (!draft) return false;
      return !sameMeetingDayDraft(draft, meetingDayDraftFromPlanDays(currentPlans.get(courseId)));
    })
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Cours déjà importés dont l’administration demande de reprendre le contenu actuel de N
 * sans changer les jours. Un plan modifié est déjà une réimportation : il n’est pas répété ici.
 */
export function refreshSourceAnnualCourseIds(
  selectedCourseIds: readonly string[],
  requestedCourseIds: readonly string[],
  reimportCourseIds: readonly string[],
  importedCourseIds: ReadonlySet<string>,
): string[] {
  const requested = new Set(requestedCourseIds);
  const reimport = new Set(reimportCourseIds);
  return selectedCourseIds
    .filter((courseId) => requested.has(courseId) && importedCourseIds.has(courseId) && !reimport.has(courseId))
    .sort((left, right) => left.localeCompare(right));
}
