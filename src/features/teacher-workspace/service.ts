import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import { buildTeacherCourseWorkspace } from "./queries.ts";
import type { TeacherCourseWorkspaceResult } from "./types.ts";

export interface TeacherCourseWorkspaceDeps {
  courses: AnnualCourseStore;
  catalog: SchoolCatalogStore;
  years: SchoolYearStore;
  teachers?: TeacherAccountStore;
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

  return buildTeacherCourseWorkspace({
    teacherId: options.teacherId,
    at: options.at,
    schoolYearId: options.schoolYearId,
    assignments,
    courses,
    classes,
    contexts,
    branches,
    years,
    professions,
  });
}

/** Le paramètre client `teacherId` est ignoré : seule la session compte. */
export function sessionTeacherIdForCoursesApi(sessionTeacherId: string): string {
  return sessionTeacherId;
}

export function schoolYearIdFromSearchParams(searchParams: URLSearchParams): string | undefined {
  const raw = searchParams.get("schoolYearId")?.trim();
  return raw ? raw : undefined;
}
