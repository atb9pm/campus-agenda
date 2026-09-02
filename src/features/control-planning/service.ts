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
  listAccessibleControlPlanningClassrooms,
} from "./classrooms.ts";
import { listControlPlacementOptions } from "./placements.ts";
import { loadControlPlanningYearSessions } from "./year-sessions.ts";
import {
  buildControlPlanningView,
  isConsultablePlanningYear,
  listConsultablePlanningYears,
  parseControlPlanningMode,
  resolvePlanningWeekNumber,
} from "./project.ts";
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
  mode?: string | null;
  week?: number | null;
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

  await deps.catalog.ensureSeeded();
  const [classrooms, classes, courses, assignments, yearList] = await Promise.all([
    deps.adapters.listClassrooms(),
    deps.catalog.listClasses(),
    deps.courses.listCourses(),
    deps.courses.listAssignments(),
    deps.years.listSchoolYears(),
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
  const yearSessions = await loadControlPlanningYearSessions(deps, year.id);
  const accessible = await listAccessibleControlPlanningClassrooms({
    teacherId,
    classrooms,
    classes,
    courses,
    assignments,
    years: yearList,
    sessions: yearSessions,
    schoolYearId: year.id,
    teacherCanAccessClassroom: (id, classroomId) => deps.agenda.teacherCanAccessClassroom(id, classroomId),
  });

  const requestedClassroom = query.classroomId?.trim() || null;
  if (requestedClassroom && !accessible.some((entry) => entry.id === requestedClassroom)) {
    return { ok: false, reason: "Cette classe ne vous est pas attribuée.", status: 403 };
  }

  const items = (
    await Promise.all(accessible.map((classroom) => deps.agenda.listAgendaItems(classroom.id)))
  ).flat();

  const [subjects, teachers] = await Promise.all([deps.adapters.listSubjects(), deps.teachers.listAccounts()]);

  let placementOptions: ControlPlacementOption[] = [];
  let canCreate = false;
  let guidedPlanningReason: string | null = null;
  const selectedClassroom = requestedClassroom
    ? classrooms.find((entry) => entry.id === requestedClassroom) ?? null
    : null;
  const linkedClassId = selectedClassroom?.schoolClassId?.trim() || null;
  const linkedClass = linkedClassId ? classes.find((entry) => entry.id === linkedClassId) ?? null : null;
  const todayIso = todayIsoDate(query.todayIso);
  const targetWeek = resolvePlanningWeekNumber(year.weeks, query.week ?? null, todayIso);
  const teacherWeekClassroomIds = controlPlanningClassroomIdsCoveredInWeek({
    accessible,
    classrooms,
    sessions: yearSessions,
    assignments,
    teacherId,
    schoolWeekNumber: targetWeek,
  });

  if (year.status === "archived") {
    canCreate = false;
  } else if (requestedClassroom && !linkedClass) {
    guidedPlanningReason =
      "La planification guidée est disponible pour les classes reliées à l’horaire structuré.";
  } else if (year.status === "active" && requestedClassroom && linkedClass && deps.schedules) {
    canCreate = true;
    const [contexts, branches] = await Promise.all([
      deps.catalog.listContexts(),
      deps.catalog.listBranches(),
    ]);
    const sessions = yearSessions.filter((session) => session.classId === linkedClass.id);
    const branchByCourseId = new Map<string, string>();
    for (const course of courses) {
      if (course.classId !== linkedClass.id) continue;
      const info = contextBranchForCourse({ course, contexts, branches });
      if (info) branchByCourseId.set(course.id, info.branch.label);
    }
    if (targetWeek !== null) {
      placementOptions = listControlPlacementOptions({
        sessions,
        assignments,
        teacherId,
        schoolWeekNumber: targetWeek,
        branchByCourseId,
        yearStatus: "active",
        classroomSelected: true,
        structured: true,
      });
    }
  }

  const view = buildControlPlanningView({
    teacherId,
    items,
    catalog: {
      classrooms: accessible,
      subjects: subjects.map((subject) => ({ id: subject.id, name: subject.name })),
      teachers: teachers.map((teacher) => ({
        id: teacher.id,
        displayName: teacher.displayName,
        initials: teacher.initials,
      })),
    },
    accessibleClasses: accessible,
    weeks: year.weeks,
    schoolYearId: year.id,
    schoolYearLabel: year.label,
    yearStatus: year.status === "archived" ? "archived" : "active",
    years: consultableYears,
    classroomId: requestedClassroom,
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
    selectedSchoolClassId: linkedClass?.id ?? null,
  });

  return { ok: true, view };
}
