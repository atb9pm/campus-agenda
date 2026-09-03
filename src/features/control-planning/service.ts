import type { AgendaStore } from "../../lib/persistence/types.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { RuntimeAgendaAdapterStore } from "../../lib/persistence/runtime-agenda-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import { contextBranchForCourse } from "../agenda-bridge/index.ts";
import {
  controlPlanningClassroomIdsCoveredInWeek,
  listAssignedStructuredPlanningClassrooms,
} from "./classrooms.ts";
import { parseControlPlanningLayout, parseControlPlanningPeriodId } from "./period-types.ts";
import { resolveControlPlanningPeriodId } from "./periods.ts";
import { listControlPlacementOptions } from "./placements.ts";
import { loadControlPlanningYearSessions } from "./year-sessions.ts";
import {
  buildControlPlanningView,
  isConsultablePlanningYear,
  listConsultablePlanningYears,
  parseControlPlanningMode,
  resolvePlanningWeekNumber,
} from "./project.ts";
import { parseControlPlanningClassroomIds, resolveAssignedClassroomSelection } from "./selection.ts";
import type { ControlPlacementOption, ControlPlanningView } from "./types.ts";

export interface ControlPlanningServiceDeps {
  agenda: AgendaStore;
  adapters: RuntimeAgendaAdapterStore;
  catalog: SchoolCatalogStore;
  courses: AnnualCourseStore;
  years: SchoolYearStore;
  teachers: TeacherAccountStore;
  schedules?: CourseScheduleStore;
}

export interface ControlPlanningQuery {
  teacherId: string;
  schoolYearId?: string | null;
  classroomId?: string | null;
  classroomIds?: string | string[] | null;
  mode?: string | null;
  week?: number | null;
  view?: string | null;
  layout?: string | null;
  period?: string | null;
  todayIso?: string;
}

export type ControlPlanningResult =
  | { ok: true; view: ControlPlanningView }
  | { ok: false; reason: string; status: 400 | 403 | 404 };

function todayIsoDate(value?: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

export async function getControlPlanning(
  deps: ControlPlanningServiceDeps,
  query: ControlPlanningQuery,
): Promise<ControlPlanningResult> {
  const teacherId = query.teacherId.trim();
  if (!teacherId) {
    return { ok: false, reason: "Session enseignant requise.", status: 403 };
  }
  if (query.mode != null && query.mode !== "" && parseControlPlanningMode(query.mode) === null) {
    return { ok: false, reason: "Mode d’affichage invalide.", status: 400 };
  }
  const layoutValue = query.view ?? query.layout;
  if (layoutValue != null && layoutValue !== "" && parseControlPlanningLayout(layoutValue) === null) {
    return { ok: false, reason: "Vue d’affichage invalide.", status: 400 };
  }
  if (query.period != null && query.period !== "" && parseControlPlanningPeriodId(query.period) === null) {
    return { ok: false, reason: "Période invalide.", status: 400 };
  }

  await deps.catalog.ensureSeeded();
  const [classrooms, classes, courses, assignments, yearList, contexts, branches] = await Promise.all([
    deps.adapters.listClassrooms(),
    deps.catalog.listClasses(),
    deps.courses.listCourses(),
    deps.courses.listAssignments(),
    deps.years.listSchoolYears(),
    deps.catalog.listContexts(),
    deps.catalog.listBranches(),
  ]);

  const requestedYearId = query.schoolYearId?.trim() || null;
  const active = await deps.years.getActiveSchoolYear();
  const year = requestedYearId
    ? await deps.years.getSchoolYearById(requestedYearId)
    : active;
  if (!year || !isConsultablePlanningYear(year)) {
    return { ok: false, reason: "Année scolaire introuvable.", status: 404 };
  }

  const consultableYears = listConsultablePlanningYears(yearList);
  const todayIso = todayIsoDate(query.todayIso);
  const assignmentAt = `${todayIso}T12:00:00.000Z`;
  const yearSessions = await loadControlPlanningYearSessions(deps, year.id);
  const assigned = listAssignedStructuredPlanningClassrooms({
    teacherId,
    classrooms,
    classes,
    courses,
    assignments,
    years: yearList,
    contexts,
    branches,
    schoolYearId: year.id,
    at: assignmentAt,
  });

  const requestedIds = parseControlPlanningClassroomIds({
    classroomIds: query.classroomIds,
    classroomId: query.classroomId,
  });
  const selection = resolveAssignedClassroomSelection({
    requestedIds,
    assignedIds: assigned.map((entry) => entry.id),
  });
  if (!selection.ok) {
    return { ok: false, reason: selection.reason, status: 403 };
  }

  const selectedClassrooms = assigned.filter((entry) => selection.selectedIds.includes(entry.id));
  const items = (
    await Promise.all(assigned.map((classroom) => deps.agenda.listAgendaItems(classroom.id)))
  ).flat();

  const [subjects, teachers] = await Promise.all([deps.adapters.listSubjects(), deps.teachers.listAccounts()]);

  const classroomByClassId = new Map<string, { id: string; name: string }>();
  const selectedSchoolClassIds: string[] = [];
  for (const entry of selectedClassrooms) {
    const runtime = classrooms.find((classroom) => classroom.id === entry.id);
    const schoolClassId = runtime?.schoolClassId?.trim() || null;
    if (!schoolClassId) continue;
    selectedSchoolClassIds.push(schoolClassId);
    classroomByClassId.set(schoolClassId, { id: entry.id, name: entry.name });
  }

  const yearStatus = year.status === "archived" ? "archived" : "active";
  const layout = parseControlPlanningLayout(layoutValue) ?? "semester";
  const periodId = resolveControlPlanningPeriodId({
    weeks: year.weeks,
    yearStatus,
    todayIso,
    requested: query.period,
  });
  const targetWeek = resolvePlanningWeekNumber(year.weeks, query.week ?? null, todayIso);
  const teacherWeekClassroomIds = controlPlanningClassroomIdsCoveredInWeek({
    accessible: assigned,
    classrooms,
    sessions: yearSessions,
    assignments,
    teacherId,
    schoolWeekNumber: targetWeek,
  });

  let placementOptions: ControlPlacementOption[] = [];
  let canCreate = false;
  let guidedPlanningReason: string | null = null;
  const structuredSelected = selectedSchoolClassIds.length > 0;
  if (year.status === "archived") {
    canCreate = false;
  } else if (selectedClassrooms.length > 0 && !structuredSelected) {
    guidedPlanningReason =
      "La planification guidée est disponible pour les classes reliées à l’horaire structuré.";
  } else if (year.status === "active" && structuredSelected && deps.schedules) {
    canCreate = true;
    const sessions = yearSessions.filter((session) => selectedSchoolClassIds.includes(session.classId));
    const branchByCourseId = new Map<string, string>();
    for (const course of courses) {
      if (!selectedSchoolClassIds.includes(course.classId)) continue;
      const info = contextBranchForCourse({ course, contexts, branches });
      if (info) branchByCourseId.set(course.id, info.branch.label);
    }
    placementOptions = listControlPlacementOptions({
      sessions,
      assignments,
      teacherId,
      schoolWeekNumber: null,
      branchByCourseId,
      yearStatus: "active",
      classroomSelected: true,
      structured: true,
      classroomByClassId,
      selectedSchoolClassIds,
      schoolClasses: classes,
      planningSchoolYearId: year.id,
    });
  }

  const view = buildControlPlanningView({
    teacherId,
    items,
    catalog: {
      classrooms: assigned,
      subjects: subjects.map((subject) => ({ id: subject.id, name: subject.name })),
      teachers: teachers.map((teacher) => ({
        id: teacher.id,
        displayName: teacher.displayName,
        initials: teacher.initials,
      })),
    },
    accessibleClasses: assigned,
    weeks: year.weeks,
    schoolYearId: year.id,
    schoolYearLabel: year.label,
    yearStatus,
    years: consultableYears,
    classroomId: selection.allSelected ? null : selection.selectedIds.length === 1 ? selection.selectedIds[0]! : null,
    classroomIds: selection.selectedIds,
    requestedMode: query.mode ?? "mine",
    schoolWeekNumber: query.week ?? null,
    todayIso,
    includeUnscopedYearItems: year.id === active?.id,
    placementOptions,
    canCreate,
    guidedPlanningReason,
    teacherWeekClassroomIds,
    sessions: yearSessions,
    assignments,
    selectedSchoolClassId: selectedSchoolClassIds.length === 1 ? selectedSchoolClassIds[0]! : null,
    selectedSchoolClassIds,
    layout,
    periodId,
  });

  return { ok: true, view };
}
