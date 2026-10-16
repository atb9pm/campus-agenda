import { isoDateForSchoolWeekDay } from "../school-days/index.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { PrototypeAgendaItem } from "./demo-items.ts";
import type { PublicationPatch } from "./publications.ts";

export const AGENDA_PLACEMENT_NO_SESSION_REASON =
  "Aucune séance de cours ne correspond à ce jour.";
export const AGENDA_PLACEMENT_NO_DATE_REASON =
  "La date de cette semaine scolaire ne peut pas être déterminée.";
export const AGENDA_PLACEMENT_YEAR_REASON =
  "L’année scolaire de cette publication est introuvable.";

export interface AgendaPlacementContext {
  weeks: ReadonlyArray<{ number: number; monday: string }>;
  sessions?: readonly CourseSession[];
}

export interface NormalizedAgendaPlacement {
  schoolWeekNumber: number;
  day: number;
  courseSessionDate: string;
  courseSessionKey: string | null;
}

function sessionDayIndex(session: Pick<CourseSession, "dayOfWeek">): number {
  return session.dayOfWeek - 1;
}

export function isAgendaPlacementChange(
  item: Pick<PrototypeAgendaItem, "day" | "schoolWeekNumber" | "courseSessionKey">,
  patch: Pick<PublicationPatch, "day" | "schoolWeekNumber" | "courseSessionKey">,
): boolean {
  if (patch.day !== undefined && patch.day !== item.day) return true;
  if (patch.schoolWeekNumber !== undefined && patch.schoolWeekNumber !== item.schoolWeekNumber) {
    return true;
  }
  if (patch.courseSessionKey !== undefined && patch.courseSessionKey !== (item.courseSessionKey ?? null)) {
    return true;
  }
  return false;
}

export function normalizeAgendaPlacement(
  item: PrototypeAgendaItem,
  requested: { schoolWeekNumber: number; day: number; courseSessionKey?: string | null },
  context: AgendaPlacementContext,
): { ok: true; placement: NormalizedAgendaPlacement } | { ok: false; reason: string } {
  const annualCourseId = item.annualCourseId?.trim() || "";
  const wantedKey = requested.courseSessionKey?.trim() || "";
  const sessions = context.sessions ?? [];
  if (wantedKey || (annualCourseId && sessions.length)) {
    const session = wantedKey
      ? sessions.find((entry) => entry.key === wantedKey)
      : sessions.find(
          (entry) =>
            (!annualCourseId || entry.annualCourseId === annualCourseId) &&
            entry.schoolWeekNumber === requested.schoolWeekNumber &&
            sessionDayIndex(entry) === requested.day,
        );
    if (!session) {
      return { ok: false, reason: AGENDA_PLACEMENT_NO_SESSION_REASON };
    }
    return {
      ok: true,
      placement: {
        schoolWeekNumber: session.schoolWeekNumber,
        day: sessionDayIndex(session),
        courseSessionDate: session.date,
        courseSessionKey: session.key,
      },
    };
  }

  const date = isoDateForSchoolWeekDay(context.weeks, requested.schoolWeekNumber, requested.day);
  if (!date) {
    return { ok: false, reason: AGENDA_PLACEMENT_NO_DATE_REASON };
  }
  return {
    ok: true,
    placement: {
      schoolWeekNumber: requested.schoolWeekNumber,
      day: requested.day,
      courseSessionDate: date,
      courseSessionKey: item.courseSessionKey ?? null,
    },
  };
}

/** Patch store : date/clé seulement si le placement change. */
export function buildAgendaItemUpdatePatch(
  item: PrototypeAgendaItem,
  patch: PublicationPatch,
  context: AgendaPlacementContext,
): { ok: true; patch: PublicationPatch } | { ok: false; reason: string } {
  if (!isAgendaPlacementChange(item, patch)) {
    return { ok: true, patch };
  }
  const weekOrDayChanged =
    (patch.day !== undefined && patch.day !== item.day) ||
    (patch.schoolWeekNumber !== undefined && patch.schoolWeekNumber !== item.schoolWeekNumber);
  const requested = {
    schoolWeekNumber: patch.schoolWeekNumber ?? item.schoolWeekNumber,
    day: patch.day ?? item.day,
    courseSessionKey:
      patch.courseSessionKey !== undefined
        ? patch.courseSessionKey
        : weekOrDayChanged
          ? null
          : item.courseSessionKey,
  };
  const normalized = normalizeAgendaPlacement(item, requested, context);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    patch: {
      ...patch,
      schoolWeekNumber: normalized.placement.schoolWeekNumber,
      day: normalized.placement.day,
      courseSessionDate: normalized.placement.courseSessionDate,
      courseSessionKey: normalized.placement.courseSessionKey,
    },
  };
}
