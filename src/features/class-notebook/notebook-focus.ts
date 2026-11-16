import type { CourseSession } from "../course-sessions/types.ts";
import { orderedCourseSessions, shiftCourseSession, snapToCourseSession, visibleCourseSessions } from "./session-window.ts";
import type { WeekDisplayCount } from "./week-window.ts";

/** Calendrier de l’établissement : la date du jour ne dépend ni d’UTC ni du fuseau de l’appareil. */
export const NOTEBOOK_SCHOOL_TIME_ZONE = "Europe/Zurich";

/**
 * `auto` : la fenêtre d’affichage suit la séance du jour ou la prochaine séance réelle.
 * `manual` : la fenêtre est figée (flèches, semaine choisie, ou séance sélectionnée).
 * La séance sélectionnée est un état distinct : un clic sur une colonne visible ne la déplace pas.
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

/** Première séance de la fenêtre d’affichage. Elle ne porte le cadre bleu que si elle est aussi la séance sélectionnée. */
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

/**
 * Fenêtre d’affichage et séance de travail.
 * `windowStartKey` est la séance demandée en tête de fenêtre.
 * `selectedSessionKey` est la séance sur laquelle l’enseignant travaille, même si elle sort de la fenêtre.
 */
export interface NotebookColumnFocus {
  followMode: NotebookFollowMode;
  windowStartKey: string | null;
  selectedSessionKey: string | null;
}

/**
 * Un clic sur une colonne déjà visible sélectionne cette séance.
 * `resolvedWindowStartKey` est la séance de tête déjà résolue : elle est recopiée telle quelle.
 */
export function selectNotebookColumn(
  resolvedWindowStartKey: string | null,
  clickedSessionKey: string,
): NotebookColumnFocus {
  return {
    followMode: "manual",
    windowStartKey: resolvedWindowStartKey,
    selectedSessionKey: clickedSessionKey,
  };
}

/**
 * Les flèches déplacent uniquement la fenêtre.
 * La séance sélectionnée reste celle d’avant le déplacement, y compris si elle n’est plus visible.
 * `null` : la fenêtre est déjà au bord, rien ne change.
 */
export function shiftNotebookWindow(
  sessions: readonly CourseSession[],
  focus: NotebookColumnFocus,
  direction: -1 | 1,
  resolvedWindowStartKey: string | null,
): NotebookColumnFocus | null {
  const next = shiftCourseSession(sessions, resolvedWindowStartKey, direction);
  if (!next || next.key === resolvedWindowStartKey) return null;
  return {
    followMode: "manual",
    windowStartKey: next.key,
    selectedSessionKey:
      focus.followMode === "auto" || !focus.selectedSessionKey
        ? resolvedWindowStartKey
        : focus.selectedSessionKey,
  };
}

/** Le bouton « Aujourd’hui » ou « Prochain cours » ramène la fenêtre et la sélection sur la séance de référence. */
export function focusNotebookReference(
  sessions: readonly CourseSession[],
  todayIso: string,
): NotebookColumnFocus {
  const key = notebookReferenceSession(sessions, todayIso)?.session.key ?? null;
  return { followMode: "auto", windowStartKey: key, selectedSessionKey: key };
}

/**
 * Séance encadrée. En suivi automatique, c’est la séance de référence.
 * En manuel, c’est la séance choisie si elle existe encore. Sinon aucune colonne n’est mise en évidence.
 */
export function notebookHighlightedSessionKey(input: {
  sessions: readonly CourseSession[];
  followMode: NotebookFollowMode;
  windowStartKey: string | null;
  selectedSessionKey: string | null;
}): string | null {
  if (input.followMode === "auto") return input.windowStartKey;
  if (!input.selectedSessionKey) return input.windowStartKey;
  return input.sessions.some((session) => session.key === input.selectedSessionKey)
    ? input.selectedSessionKey
    : null;
}

export interface NotebookColumnView {
  key: string;
  date: string;
  schoolWeekNumber: number;
  weekKind: CourseSession["weekKind"];
  selected: boolean;
  referenceTag: "Aujourd’hui" | "Prochain cours" | null;
}

/** Colonnes actuellement visibles, sans déplacer les publications ni les notes qui restent indexées par séance. */
export function notebookVisibleColumns(input: {
  sessions: readonly CourseSession[];
  followMode: NotebookFollowMode;
  todayIso: string;
  windowStartKey: string | null;
  selectedSessionKey: string | null;
  centerWeekNumber: number;
  count: WeekDisplayCount;
  /** Faux pour une année archivée ou en préparation : pas de badge lié à la date réelle. */
  referenceEnabled?: boolean;
}): NotebookColumnView[] {
  const start = resolveNotebookStartSession({
    sessions: input.sessions,
    followMode: input.followMode,
    todayIso: input.todayIso,
    centerSessionKey: input.windowStartKey,
    centerWeekNumber: input.centerWeekNumber,
  });
  const highlighted = notebookHighlightedSessionKey({
    sessions: input.sessions,
    followMode: input.followMode,
    windowStartKey: start?.key ?? null,
    selectedSessionKey: input.selectedSessionKey,
  });
  const reference = input.referenceEnabled === false ? null : notebookReferenceSession(input.sessions, input.todayIso);
  return visibleCourseSessions(input.sessions, start?.key ?? null, input.count).map((session) => ({
    key: session.key,
    date: session.date,
    schoolWeekNumber: session.schoolWeekNumber,
    weekKind: session.weekKind,
    selected: session.key === highlighted,
    referenceTag: notebookReferenceTag(session, reference),
  }));
}
