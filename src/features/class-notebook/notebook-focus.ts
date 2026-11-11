import type { CourseSession } from "../course-sessions/types.ts";
import { orderedCourseSessions, snapToCourseSession } from "./session-window.ts";

/** Calendrier de l’établissement : la date du jour ne dépend ni d’UTC ni du fuseau de l’appareil. */
export const NOTEBOOK_SCHOOL_TIME_ZONE = "Europe/Zurich";

/**
 * `auto` : le Carnet suit la séance du jour ou la prochaine séance réelle.
 * `manual` : l’enseignant a choisi une séance (flèches, en-tête) ou ouvert une semaine précise.
 */
export type NotebookFollowMode = "auto" | "manual";

export type NotebookOpeningSource = "mes-cours" | "ma-semaine";

export type NotebookSchoolYearStatus = "draft" | "active" | "archived" | null | undefined;

export type NotebookReferenceRelation = "today" | "next" | "last";

export interface NotebookReferenceSession {
  session: CourseSession;
  relation: NotebookReferenceRelation;
}

const zurichDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NOTEBOOK_SCHOOL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const zurichClockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: NOTEBOOK_SCHOOL_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** `YYYY-MM-DD` du jour à Zurich pour l’instant donné. */
export function notebookSchoolTodayIso(now: Date): string {
  const parts = zurichDateFormatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Délai jusqu’au prochain minuit à Zurich (+1 s). Les jours de changement d’heure
 * peuvent décaler l’estimation d’une heure : l’appelant revérifie la date au réveil.
 */
export function msUntilNextSchoolMidnight(now: Date): number {
  const parts = zurichClockFormatter.formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const elapsedMs = ((value("hour") * 60 + value("minute")) * 60 + value("second")) * 1000 + now.getMilliseconds();
  return Math.max(1_000, 24 * 60 * 60 * 1000 - elapsedMs + 1_000);
}

/**
 * Séance de référence : la première séance réelle dont la date est ≥ aujourd’hui.
 * Sans séance future : la dernière séance réelle. Jamais de séance inventée.
 */
export function notebookReferenceSession(
  sessions: readonly CourseSession[],
  todayIso: string,
): NotebookReferenceSession | null {
  const ordered = orderedCourseSessions(sessions);
  if (!ordered.length) return null;
  const upcoming = ordered.find((session) => session.date >= todayIso);
  if (upcoming) return { session: upcoming, relation: upcoming.date === todayIso ? "today" : "next" };
  return { session: ordered[ordered.length - 1]!, relation: "last" };
}

/** Années archivées ou en préparation : pas de suivi de la date réelle. */
export function notebookAutoFollowAllowed(schoolYearStatus: NotebookSchoolYearStatus): boolean {
  return schoolYearStatus == null || schoolYearStatus === "active";
}

/**
 * Mes cours ouvre toujours en suivi automatique. Ma semaine aussi, sauf si l’enseignant
 * y consulte une autre semaine que celle d’aujourd’hui : son choix de semaine prime.
 */
export function notebookOpeningFollowMode(input: {
  source: NotebookOpeningSource;
  schoolYearStatus: NotebookSchoolYearStatus;
  selectedSchoolWeekNumber: number;
  todaySchoolWeekNumber: number | null;
}): NotebookFollowMode {
  if (!notebookAutoFollowAllowed(input.schoolYearStatus)) return "manual";
  if (input.source === "mes-cours") return "auto";
  return input.todaySchoolWeekNumber != null && input.selectedSchoolWeekNumber === input.todaySchoolWeekNumber
    ? "auto"
    : "manual";
}

/** Séance de départ du Carnet, qui porte le cadre bleu et reste la seule visible sur smartphone. */
export function resolveNotebookStartSession(input: {
  sessions: readonly CourseSession[];
  followMode: NotebookFollowMode;
  todayIso: string;
  centerSessionKey: string | null | undefined;
  centerWeekNumber: number;
}): CourseSession | null {
  if (input.followMode === "auto") {
    const reference = notebookReferenceSession(input.sessions, input.todayIso);
    if (reference) return reference.session;
  }
  return snapToCourseSession(input.sessions, input.centerSessionKey, input.centerWeekNumber);
}

/** Indication discrète sur la colonne de la séance du jour ou de la prochaine séance. */
export function notebookReferenceTag(
  session: Pick<CourseSession, "key">,
  reference: NotebookReferenceSession | null,
): "Aujourd’hui" | "Prochain cours" | null {
  if (!reference || reference.session.key !== session.key) return null;
  if (reference.relation === "today") return "Aujourd’hui";
  if (reference.relation === "next") return "Prochain cours";
  return null;
}

export function notebookReferenceButtonLabel(reference: NotebookReferenceSession | null): string {
  return reference?.relation === "today" ? "Aujourd’hui" : "Prochain cours";
}

/** Un changement de date n’est appliqué qu’en dehors d’une édition ; sinon il attend sa fermeture. */
export function notebookTodayUpdate(
  currentIso: string,
  observedIso: string,
  editing: boolean,
): "unchanged" | "apply" | "defer" {
  if (currentIso === observedIso) return "unchanged";
  return editing ? "defer" : "apply";
}
