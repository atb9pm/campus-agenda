import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import { isoDateForSchoolWeekDay, SCHOOL_WEEKDAY_COUNT, SCHOOL_WEEKDAY_LABELS } from "../school-days/index.ts";
import type { SchoolWeekEntry, SchoolYearRecord } from "../school-year/types.ts";
import type {
  BuildControlPlanningInput,
  ControlPlanningAlert,
  ControlPlanningCard,
  ControlPlanningClass,
  ControlPlanningDay,
  ControlPlanningMode,
  ControlPlanningView,
  ControlPlanningWeekView,
  ControlPlanningYearOption,
} from "./types.ts";
import { CONTROL_PLANNING_MODES } from "./types.ts";

export function isControlAgendaItem(item: Pick<PrototypeAgendaItem, "type">): boolean {
  return item.type === "TEST";
}

export function resolveControlPlanningMode(
  classroomId: string | null,
  requested: string | null | undefined,
): ControlPlanningMode {
  if (!classroomId) return "mine";
  return requested === "class-all" ? "class-all" : "mine";
}

export function parseControlPlanningMode(value: string | null | undefined): ControlPlanningMode | null {
  if (!value) return "mine";
  return (CONTROL_PLANNING_MODES as readonly string[]).includes(value) ? (value as ControlPlanningMode) : null;
}

export function isConsultablePlanningYear(year: Pick<SchoolYearRecord, "status">): boolean {
  return year.status === "active" || year.status === "archived";
}

/** Années proposées au filtre enseignant : active + archivées, jamais draft. */
export function listConsultablePlanningYears(years: SchoolYearRecord[]): ControlPlanningYearOption[] {
  return years
    .filter((year) => isConsultablePlanningYear(year))
    .slice()
    .sort((left, right) => {
      if (left.status === "active" && right.status !== "active") return -1;
      if (right.status === "active" && left.status !== "active") return 1;
      return right.startsOn.localeCompare(left.startsOn) || left.label.localeCompare(right.label, "fr");
    })
    .map((year) => ({
      id: year.id,
      label: year.label,
      status: year.status as "active" | "archived",
    }));
}

/** Charge personnelle : tous les TEST du professeur, toutes classes de l’année, semaine courante. */
export function countOwnControlsForWeek(options: {
  items: PrototypeAgendaItem[];
  teacherId: string;
  accessibleClassroomIds: readonly string[];
  schoolYearId: string;
  includeUnscopedYearItems: boolean;
  schoolWeekNumber: number | null;
}): number {
  if (options.schoolWeekNumber === null) return 0;
  return selectControlItems({
    items: options.items,
    teacherId: options.teacherId,
    accessibleClassroomIds: options.accessibleClassroomIds,
    classroomId: null,
    mode: "mine",
    schoolYearId: options.schoolYearId,
    includeUnscopedYearItems: options.includeUnscopedYearItems,
  }).filter((item) => item.schoolWeekNumber === options.schoolWeekNumber).length;
}

/** « 2026-2027 » → « 2026–2027 ». */
export function formatControlPlanningYearLabel(label: string): string {
  return label.replace(/^(\d{4})-(\d{4})$/, "$1–$2");
}

/** « François Martin » → « F. Martin ». */
export function formatControlTeacherName(displayName: string, initials = ""): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const initial = parts[0]!.charAt(0).toUpperCase();
    return `${initial}. ${parts.slice(1).join(" ")}`;
  }
  if (parts[0]) return parts[0];
  return initials.trim() || "Enseignant";
}

export function itemBelongsToSchoolYear(
  item: Pick<PrototypeAgendaItem, "schoolYearId">,
  schoolYearId: string,
  includeUnscopedYearItems: boolean,
): boolean {
  const scoped = item.schoolYearId?.trim() || null;
  if (scoped === schoolYearId) return true;
  return includeUnscopedYearItems && scoped === null;
}

export function selectControlItems(options: {
  items: PrototypeAgendaItem[];
  teacherId: string;
  accessibleClassroomIds: readonly string[];
  classroomId: string | null;
  mode: ControlPlanningMode;
  schoolYearId: string;
  includeUnscopedYearItems: boolean;
}): PrototypeAgendaItem[] {
  const accessible = new Set(options.accessibleClassroomIds);
  const classroomId = options.classroomId;
  return options.items.filter((item) => {
    if (!isControlAgendaItem(item)) return false;
    if (!accessible.has(item.classroomId)) return false;
    if (classroomId && item.classroomId !== classroomId) return false;
    if (!itemBelongsToSchoolYear(item, options.schoolYearId, options.includeUnscopedYearItems)) return false;
    if (options.mode === "mine" && item.authorTeacherId !== options.teacherId) return false;
    return true;
  });
}

export function resolvePlanningWeekNumber(
  weeks: SchoolWeekEntry[],
  requested: number | null,
  todayIso: string,
): number | null {
  if (weeks.length === 0) return null;
  if (requested !== null && weeks.some((week) => week.number === requested)) {
    return requested;
  }
  for (const week of weeks) {
    const friday = isoDateForSchoolWeekDay([week], week.number, 4);
    if (friday && todayIso >= week.monday && todayIso <= friday) {
      return week.number;
    }
  }
  return weeks[0]!.number;
}

function lookupName(
  entries: Array<{ id: string; name?: string; displayName?: string; initials?: string }>,
  id: string,
  fallback: string,
): string {
  const match = entries.find((entry) => entry.id === id);
  if (!match) return fallback;
  if ("displayName" in match && match.displayName) {
    return formatControlTeacherName(match.displayName, match.initials ?? "");
  }
  return match.name?.trim() || fallback;
}

export function projectControlCard(
  item: PrototypeAgendaItem,
  options: {
    teacherId: string;
    classrooms: Array<{ id: string; name: string }>;
    subjects: Array<{ id: string; name: string }>;
    teachers: Array<{ id: string; displayName: string; initials: string }>;
    date: string | null;
  },
): ControlPlanningCard {
  return {
    agendaItemId: item.id,
    classroomId: item.classroomId,
    classroomName: lookupName(options.classrooms, item.classroomId, "Classe"),
    subjectId: item.subjectId,
    branchLabel: lookupName(options.subjects, item.subjectId, "Branche"),
    title: item.title.trim() || "Contrôle",
    teacherId: item.authorTeacherId,
    teacherName: lookupName(options.teachers, item.authorTeacherId, "Enseignant"),
    isOwn: item.authorTeacherId === options.teacherId,
    schoolWeekNumber: item.schoolWeekNumber,
    dayIndex: item.day,
    date: options.date,
  };
}

function sortCards(left: ControlPlanningCard, right: ControlPlanningCard): number {
  const classCmp = left.classroomName.localeCompare(right.classroomName, "fr");
  if (classCmp !== 0) return classCmp;
  const branchCmp = left.branchLabel.localeCompare(right.branchLabel, "fr");
  if (branchCmp !== 0) return branchCmp;
  return left.title.localeCompare(right.title, "fr") || left.agendaItemId - right.agendaItemId;
}

export function buildControlPlanningWeek(options: {
  weeks: SchoolWeekEntry[];
  schoolWeekNumber: number;
  cards: ControlPlanningCard[];
}): ControlPlanningWeekView | null {
  const week = options.weeks.find((entry) => entry.number === options.schoolWeekNumber) ?? null;
  if (!week) return null;
  const days: ControlPlanningDay[] = [];
  for (let dayIndex = 0; dayIndex < SCHOOL_WEEKDAY_COUNT; dayIndex += 1) {
    const date = isoDateForSchoolWeekDay([week], week.number, dayIndex);
    days.push({
      dayIndex,
      weekdayLabel: SCHOOL_WEEKDAY_LABELS[dayIndex] ?? `Jour ${dayIndex + 1}`,
      date,
      controls: options.cards
        .filter((card) => card.schoolWeekNumber === week.number && card.dayIndex === dayIndex)
        .slice()
        .sort(sortCards),
    });
  }
  return {
    number: week.number,
    kind: week.kind,
    monday: week.monday,
    days,
  };
}

export function buildControlPlanningAlerts(options: {
  days: ControlPlanningDay[];
  classroomName: string | null;
  ownCountThisWeek: number;
}): ControlPlanningAlert[] {
  const alerts: ControlPlanningAlert[] = [];
  for (const day of options.days) {
    if (day.controls.length >= 2) {
      const uniqueClasses = [...new Set(day.controls.map((card) => card.classroomName))];
      const classLabel = options.classroomName ?? (uniqueClasses.length === 1 ? uniqueClasses[0]! : null);
      alerts.push({
        kind: "busy-day",
        message: classLabel
          ? `${day.weekdayLabel} : ${day.controls.length} contrôles déjà prévus dans ${classLabel}`
          : `${day.weekdayLabel} : ${day.controls.length} contrôles déjà prévus`,
      });
    } else if (day.controls.length === 0) {
      alerts.push({
        kind: "free-day",
        message: `${day.weekdayLabel} : aucun contrôle`,
      });
    }
  }
  alerts.push({
    kind: "teacher-load",
    message:
      options.ownCountThisWeek === 1
        ? "1 contrôle cette semaine"
        : `${options.ownCountThisWeek} contrôles cette semaine`,
  });
  return alerts;
}

export function buildControlPlanningView(input: BuildControlPlanningInput): ControlPlanningView {
  const classroomId =
    input.classroomId && input.accessibleClasses.some((entry) => entry.id === input.classroomId)
      ? input.classroomId
      : null;
  const mode = resolveControlPlanningMode(classroomId, input.requestedMode);
  const selectedItems = selectControlItems({
    items: input.items,
    teacherId: input.teacherId,
    accessibleClassroomIds: input.accessibleClasses.map((entry) => entry.id),
    classroomId,
    mode,
    schoolYearId: input.schoolYearId,
    includeUnscopedYearItems: input.includeUnscopedYearItems,
  });

  const weekNumber = resolvePlanningWeekNumber(input.weeks, input.schoolWeekNumber, input.todayIso);
  const cards = selectedItems.map((item) => {
    const date =
      weekNumber !== null
        ? isoDateForSchoolWeekDay(
            input.weeks.filter((week) => week.number === item.schoolWeekNumber),
            item.schoolWeekNumber,
            item.day,
          )
        : null;
    return projectControlCard(item, {
      teacherId: input.teacherId,
      classrooms: input.catalog.classrooms,
      subjects: input.catalog.subjects,
      teachers: input.catalog.teachers,
      date,
    });
  });

  const week =
    weekNumber === null
      ? null
      : buildControlPlanningWeek({
          weeks: input.weeks,
          schoolWeekNumber: weekNumber,
          cards,
        });

  const classIds = new Set(selectedItems.map((item) => item.classroomId));
  const classroomName = classroomId
    ? input.accessibleClasses.find((entry) => entry.id === classroomId)?.name ?? null
    : null;
  const teacherLoadThisWeek = countOwnControlsForWeek({
    items: input.items,
    teacherId: input.teacherId,
    accessibleClassroomIds: input.accessibleClasses.map((entry) => entry.id),
    schoolYearId: input.schoolYearId,
    includeUnscopedYearItems: input.includeUnscopedYearItems,
    schoolWeekNumber: weekNumber,
  });

  return {
    schoolYearId: input.schoolYearId,
    schoolYearLabel: input.schoolYearLabel,
    mode,
    classroomId,
    classes: sortClasses(input.accessibleClasses),
    years: input.years,
    summary: {
      controlCount: selectedItems.length,
      classCount: classIds.size,
    },
    week,
    weeks: input.weeks.map((entry) => ({ number: entry.number, kind: entry.kind })),
    alerts: week
      ? buildControlPlanningAlerts({
          days: week.days,
          classroomName,
          ownCountThisWeek: teacherLoadThisWeek,
        })
      : [],
    teacherLoadThisWeek,
  };
}

function sortClasses(classes: ControlPlanningClass[]): ControlPlanningClass[] {
  return [...classes].sort((left, right) => left.name.localeCompare(right.name, "fr"));
}
