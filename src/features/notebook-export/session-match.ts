import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import { splitControlPlanningPeriods } from "../control-planning/periods.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { SchoolWeekEntry } from "../school-year/types.ts";
import type { NotebookExportPeriod } from "./types.ts";

export const SESSION_MATCH_KINDS = ["MATCH_KEY", "MATCH_DATE", "MATCH_WEEK_DAY", "UNMATCHED"] as const;
export type SessionMatchKind = (typeof SESSION_MATCH_KINDS)[number];

export type AgendaItemMatchFields = Pick<
  PrototypeAgendaItem,
  "courseSessionKey" | "courseSessionDate" | "schoolWeekNumber" | "day"
>;

export type SessionMatchFields = Pick<CourseSession, "key" | "date" | "schoolWeekNumber" | "dayOfWeek">;

export type ResolvedAgendaItemSession<S extends SessionMatchFields> =
  | { kind: "MATCH_KEY" | "MATCH_DATE" | "MATCH_WEEK_DAY"; session: S }
  | { kind: "UNMATCHED"; session: null };

export interface AgendaItemSessionDiagnosis {
  id: number;
  title: string;
  annualCourseId: string | null;
  schoolWeekNumber: number;
  day: number;
  courseSessionKey: string | null;
  courseSessionDate: string | null;
  result: SessionMatchKind;
  matchedSessionKey: string | null;
}

function filled(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function addDaysIso(monday: string, days: number): string | null {
  const [year, month, day] = monday.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isoDateInSchoolWeek(date: string, week: Pick<SchoolWeekEntry, "monday">): boolean {
  const sunday = addDaysIso(week.monday, 6);
  return sunday != null && date >= week.monday && date <= sunday;
}

export function agendaItemBelongsToExportPeriod(
  item: Pick<PrototypeAgendaItem, "courseSessionDate" | "schoolWeekNumber">,
  period: NotebookExportPeriod,
  weeks: readonly SchoolWeekEntry[],
): boolean {
  if (period === "year") return true;
  const wanted = splitControlPlanningPeriods(weeks).find((entry) => entry.id === period);
  if (!wanted) return false;
  const numbers = new Set(wanted.weeks.map((week) => week.number));
  const date = filled(item.courseSessionDate);
  if (date) {
    const week = weeks.find((entry) => isoDateInSchoolWeek(date, entry));
    return week ? numbers.has(week.number) : false;
  }
  return numbers.has(item.schoolWeekNumber);
}

/**
 * Associe un agenda_item à une CourseSession.
 * Ordre sûr : key encore valide → date encore valide → fallback semaine/jour non ambigu.
 * Une key devenue invalide ne bloque pas le palier date ; une date invalide ne bloque pas
 * le fallback historique s’il n’existe qu’une séance candidate.
 */
export function resolveAgendaItemSession<S extends SessionMatchFields>(
  item: AgendaItemMatchFields,
  sessions: readonly S[],
): ResolvedAgendaItemSession<S> {
  const key = filled(item.courseSessionKey);
  if (key) {
    const session = sessions.find((entry) => entry.key === key);
    if (session) return { kind: "MATCH_KEY", session };
  }
  const date = filled(item.courseSessionDate);
  if (date) {
    const session = sessions.find((entry) => entry.date === date);
    if (session) return { kind: "MATCH_DATE", session };
  }
  const weekDayMatches = sessions.filter(
    (entry) => item.schoolWeekNumber === entry.schoolWeekNumber && item.day === entry.dayOfWeek - 1,
  );
  if (weekDayMatches.length === 1) {
    return { kind: "MATCH_WEEK_DAY", session: weekDayMatches[0]! };
  }
  return { kind: "UNMATCHED", session: null };
}

export interface LegacyTestCourseIdentity {
  annualCourseId: string;
  classroomId: string;
  subjectId: string;
  schoolYearId: string;
}

/**
 * TEST legacy (annualCourseId vide) attribuable sans ambiguïté à un AnnualCourse.
 * Exige la classe runtime + la matière du cours ; jamais un simple voisinage de date.
 */
export function isUnambiguousLegacyTestForCourse(
  item: PrototypeAgendaItem,
  course: LegacyTestCourseIdentity,
  sessions: readonly SessionMatchFields[],
): boolean {
  if (item.type !== "TEST") return false;
  if (item.annualCourseId?.trim()) return false;
  if (item.classroomId !== course.classroomId) return false;
  if (item.subjectId !== course.subjectId) return false;
  const itemYear = item.schoolYearId?.trim() ?? "";
  if (itemYear && itemYear !== course.schoolYearId) return false;
  return resolveAgendaItemSession(item, sessions).kind !== "UNMATCHED";
}

export function selectLegacyTestsForAnnualCourseExport(
  classroomItems: readonly PrototypeAgendaItem[],
  course: LegacyTestCourseIdentity,
  sessions: readonly SessionMatchFields[],
): PrototypeAgendaItem[] {
  return classroomItems.filter((item) => isUnambiguousLegacyTestForCourse(item, course, sessions));
}

export function matchAgendaItemToSession(
  item: AgendaItemMatchFields,
  session: SessionMatchFields,
): SessionMatchKind {
  return resolveAgendaItemSession(item, [session]).kind;
}

export function diagnoseAgendaItemSession(
  item: Pick<
    PrototypeAgendaItem,
    | "id"
    | "title"
    | "annualCourseId"
    | "schoolWeekNumber"
    | "day"
    | "courseSessionKey"
    | "courseSessionDate"
  >,
  sessions: readonly SessionMatchFields[],
): AgendaItemSessionDiagnosis {
  const resolved = resolveAgendaItemSession(item, sessions);
  return {
    id: item.id,
    title: item.title,
    annualCourseId: item.annualCourseId ?? null,
    schoolWeekNumber: item.schoolWeekNumber,
    day: item.day,
    courseSessionKey: item.courseSessionKey ?? null,
    courseSessionDate: item.courseSessionDate ?? null,
    result: resolved.kind,
    matchedSessionKey: resolved.session?.key ?? null,
  };
}

/** Diagnostic non destructif des TEST d’un AnnualCourse. Ne mute aucune donnée. */
export function diagnoseAnnualCourseTests(
  items: readonly PrototypeAgendaItem[],
  sessions: readonly SessionMatchFields[],
  annualCourseId: string,
): AgendaItemSessionDiagnosis[] {
  return items
    .filter((item) => item.type === "TEST" && item.annualCourseId === annualCourseId)
    .map((item) => diagnoseAgendaItemSession(item, sessions));
}
