import type { AgendaStore } from "../../lib/persistence/types.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { RuntimeAgendaAdapterStore } from "../../lib/persistence/runtime-agenda-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import {
  evaluateControlCoordination,
  type ControlCoordinationCatalog,
  type ControlCoordinationSummary,
} from "../evaluations/coordination.ts";
import {
  controlPlanningClassroomIdsCoveredInWeek,
  listAccessibleControlPlanningClassrooms,
} from "./classrooms.ts";
import { loadControlPlanningYearSessions } from "./year-sessions.ts";

export interface LiveCoordinationDeps {
  agenda: AgendaStore;
  adapters: RuntimeAgendaAdapterStore;
  catalog: SchoolCatalogStore;
  courses: AnnualCourseStore;
  years: SchoolYearStore;
  teachers: TeacherAccountStore;
  schedules?: CourseScheduleStore;
}

export async function evaluateLiveControlCoordination(
  deps: LiveCoordinationDeps,
  options: {
    teacherId: string;
    classroomId: string;
    type: PrototypeAgendaItem["type"];
    schoolYearId: string;
    schoolWeekNumber: number;
    dayIndex: number;
    includeUnscopedYearItems: boolean;
    excludeItemId?: number;
  },
): Promise<ControlCoordinationSummary> {
  await deps.catalog.ensureSeeded();
  const [classrooms, classes, courses, assignments, yearList, subjects, teachers, contexts, branches] =
    await Promise.all([
      deps.adapters.listClassrooms(),
      deps.catalog.listClasses(),
      deps.courses.listCourses(),
      deps.courses.listAssignments(),
      deps.years.listSchoolYears(),
      deps.adapters.listSubjects(),
      deps.teachers.listAccounts(),
      deps.catalog.listContexts(),
      deps.catalog.listBranches(),
    ]);

  const sessions = await loadControlPlanningYearSessions(deps, options.schoolYearId);
  const accessible = await listAccessibleControlPlanningClassrooms({
    teacherId: options.teacherId,
    classrooms,
    classes,
    courses,
    assignments,
    years: yearList,
    contexts,
    branches,
    schoolYearId: options.schoolYearId,
  });

  const accessibleIds = accessible.map((entry) => entry.id);
  if (!accessibleIds.includes(options.classroomId)) {
    accessibleIds.push(options.classroomId);
  }

  const teacherWeekClassroomIds = controlPlanningClassroomIdsCoveredInWeek({
    accessible: accessibleIds.map((id) => ({
      id,
      name: accessible.find((entry) => entry.id === id)?.name ?? id,
    })),
    classrooms,
    sessions,
    assignments,
    teacherId: options.teacherId,
    schoolWeekNumber: options.schoolWeekNumber,
  });

  const items = (
    await Promise.all(accessibleIds.map((classroomId) => deps.agenda.listAgendaItems(classroomId)))
  ).flat();

  const catalog: ControlCoordinationCatalog = {
    classrooms: [...accessible, { id: options.classroomId, name: options.classroomId }].filter(
      (entry, index, list) => list.findIndex((item) => item.id === entry.id) === index,
    ),
    subjects: subjects.map((subject) => ({ id: subject.id, name: subject.name })),
    teachers: teachers.map((teacher) => ({
      id: teacher.id,
      displayName: teacher.displayName,
      initials: teacher.initials,
    })),
  };

  return evaluateControlCoordination({
    type: options.type,
    items,
    classroomId: options.classroomId,
    courseDay: { schoolWeekNumber: options.schoolWeekNumber, dayIndex: options.dayIndex },
    teacherId: options.teacherId,
    teacherWeekClassroomIds,
    schoolYearId: options.schoolYearId,
    includeUnscopedYearItems: options.includeUnscopedYearItems,
    catalog,
    excludeItemId: options.excludeItemId,
  });
}
