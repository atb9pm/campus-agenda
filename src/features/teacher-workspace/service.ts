import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import { buildTeacherCourseWorkspace, resolveTeacherWorkspaceYearRequest } from "./queries.ts";
import type { TeacherCourseMeetingDay, TeacherCourseWorkspaceResult } from "./types.ts";

export interface TeacherCourseWorkspaceDeps {
  courses: AnnualCourseStore;
  catalog: SchoolCatalogStore;
  years: SchoolYearStore;
  teachers?: TeacherAccountStore;
  schedules?: Pick<CourseScheduleStore, "listMeetingDays"> &
    Partial<Pick<CourseScheduleStore, "listAttendanceDays">>;
}

/**
 * « Mes cours » pour un enseignant et une date.
 * Charge les référentiels en parallèle, joint en mémoire (pas de N+1).
 * L’identifiant enseignant doit venir de la session, jamais du client.
 */
export async function listTeacherCourses(
  deps: TeacherCourseWorkspaceDeps,
  options: {
    teacherId: string;
    schoolYearId?: string | null;
    at?: string;
    isAdmin?: boolean;
    adminConsult?: boolean;
  },
): Promise<TeacherCourseWorkspaceResult> {
  const [assignments, courses, classes, contexts, branches, professions, years] = await Promise.all([
    deps.courses.listAssignmentsForTeacher(options.teacherId),
    deps.courses.listCourses(),
    deps.catalog.listClasses(),
    deps.catalog.listContexts(),
    deps.catalog.listBranches(),
    deps.catalog.listProfessions(),
    deps.years.listSchoolYears(),
  ]);

  const schoolYearId = resolveTeacherWorkspaceYearRequest({
    years,
    requestedSchoolYearId: options.schoolYearId,
    isAdmin: options.isAdmin,
    adminConsult: options.adminConsult,
  });

  const [workspace, meetingDays, attendanceDays] = await Promise.all([
    Promise.resolve(
      buildTeacherCourseWorkspace({
        teacherId: options.teacherId,
        at: options.at,
        schoolYearId,
        isAdmin: options.isAdmin,
        adminConsult: options.adminConsult,
        assignments,
        courses,
        classes,
        contexts,
        branches,
        years,
        professions,
      }),
    ),
    deps.schedules ? deps.schedules.listMeetingDays() : Promise.resolve([]),
    deps.schedules?.listAttendanceDays ? deps.schedules.listAttendanceDays() : Promise.resolve([]),
  ]);
  if (meetingDays.length === 0 && attendanceDays.length === 0) return workspace;

  const daysByCourse = new Map<string, TeacherCourseMeetingDay[]>();
  for (const day of meetingDays) {
    const list = daysByCourse.get(day.annualCourseId) ?? [];
    list.push({ dayOfWeek: day.dayOfWeek, weekKind: day.weekKind, role: day.role });
    daysByCourse.set(day.annualCourseId, list);
  }
  const attendanceByClass = new Map<string, TeacherCourseMeetingDay[]>();
  for (const day of attendanceDays) {
    const list = attendanceByClass.get(day.classId) ?? [];
    list.push({ dayOfWeek: day.dayOfWeek, weekKind: day.weekKind, role: day.role });
    attendanceByClass.set(day.classId, list);
  }
  return {
    ...workspace,
    courses: workspace.courses.map((course) => ({
      ...course,
      meetingDays: daysByCourse.get(course.annualCourseId) ?? [],
      classAttendanceDays: attendanceByClass.get(course.classId) ?? [],
    })),
  };
}

/** Le paramètre client `teacherId` est ignoré : seule la session compte. */
export function sessionTeacherIdForCoursesApi(sessionTeacherId: string): string {
  return sessionTeacherId;
}

export function schoolYearIdFromSearchParams(searchParams: URLSearchParams): string | undefined {
  const raw = searchParams.get("schoolYearId")?.trim();
  return raw ? raw : undefined;
}
