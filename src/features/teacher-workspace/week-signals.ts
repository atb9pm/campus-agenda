import type { AgendaItemType } from "../../types/agenda.ts";
import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";

const SIGNAL_ORDER = ["HOMEWORK", "INFORMATION", "TEST"] as const satisfies readonly AgendaItemType[];

const SIGNAL_LABELS: Record<(typeof SIGNAL_ORDER)[number], string> = {
  HOMEWORK: "Devoir",
  INFORMATION: "Information",
  TEST: "Contrôle",
};

function countsTowardSignal(item: PrototypeAgendaItem): boolean {
  if (item.type === "TEST") return true;
  if (item.type === "HOMEWORK" || item.type === "INFORMATION") {
    return item.studentVisible !== false;
  }
  return false;
}

/** Résumé court d’un AnnualCourse pour une semaine scolaire. Pas de titres. */
export function summarizeMaSemaineCourseWeek(
  items: readonly PrototypeAgendaItem[],
  annualCourseId: string,
  schoolWeekNumber: number,
): string {
  const wanted = annualCourseId.trim();
  if (!wanted || !Number.isInteger(schoolWeekNumber)) return "";
  const present = new Set<(typeof SIGNAL_ORDER)[number]>();
  for (const item of items) {
    if ((item.annualCourseId ?? "").trim() !== wanted) continue;
    if (item.schoolWeekNumber !== schoolWeekNumber) continue;
    if (!countsTowardSignal(item)) continue;
    if (item.type === "HOMEWORK" || item.type === "INFORMATION" || item.type === "TEST") {
      present.add(item.type);
    }
  }
  return SIGNAL_ORDER.filter((type) => present.has(type)).map((type) => SIGNAL_LABELS[type]).join(" · ");
}

export function maSemaineSignalsByCourse(
  items: readonly PrototypeAgendaItem[],
  courses: readonly { annualCourseId: string }[],
  schoolWeekNumber: number,
): Record<string, string> {
  const signals: Record<string, string> = {};
  for (const course of courses) {
    const id = course.annualCourseId.trim();
    if (!id || id in signals) continue;
    signals[id] = summarizeMaSemaineCourseWeek(items, id, schoolWeekNumber);
  }
  return signals;
}
