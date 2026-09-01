import type { AnnualCourse } from "../annual-courses/types.ts";
import { includeArchivedCoursesInScheduleView } from "../course-schedule/operational.ts";
import type { CourseScheduleServiceDeps } from "../course-schedule/service.ts";
import type { ScheduleMutationResult } from "../course-schedule/types.ts";
import { valaisHolidaysForSchoolYear } from "../school-days/holidays-valais.ts";
import { computeCourseSessions } from "./compute.ts";
import type { CourseSession } from "./types.ts";

export interface ListCourseSessionsQuery {
  schoolYearId: string;
  classId?: string | null;
  annualCourseId?: string | null;
}

function optionalId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : undefined;
}

/**
 * Charge l’année, les cours, les créneaux, les fériés et les exceptions,
 * puis calcule les séances. Lecture seule : aucune écriture CourseSession.
 */
export async function listComputedCourseSessions(
  deps: CourseScheduleServiceDeps,
  query: ListCourseSessionsQuery,
): Promise<ScheduleMutationResult<CourseSession[]>> {
  const schoolYearId = query.schoolYearId.trim();
  if (!schoolYearId) {
    return { ok: false, reason: "L’année scolaire est obligatoire.", status: 400 };
  }

  const year = await deps.years.getSchoolYearById(schoolYearId);
  if (!year) {
    return { ok: false, reason: "Année scolaire introuvable.", status: 404 };
  }

  const classId = optionalId(query.classId);
  const annualCourseId = optionalId(query.annualCourseId);

  if (classId) {
    const schoolClass = (await deps.catalog.listClasses()).find((entry) => entry.id === classId);
    if (!schoolClass) {
      return { ok: false, reason: "Classe introuvable.", status: 404 };
    }
    if (schoolClass.schoolYearId && schoolClass.schoolYearId !== schoolYearId) {
      return { ok: false, reason: "Cette classe n’appartient pas à l’année scolaire demandée.", status: 400 };
    }
  }

  const allCourses = await deps.courses.listCourses();
  if (annualCourseId) {
    const course =
      allCourses.find((entry) => entry.id === annualCourseId) ?? (await deps.courses.getCourse(annualCourseId));
    if (!course) {
      return { ok: false, reason: "Cours annuel introuvable.", status: 404 };
    }
    if (course.schoolYearId !== schoolYearId) {
      return { ok: false, reason: "Ce cours annuel n’appartient pas à l’année scolaire demandée.", status: 400 };
    }
    if (classId && course.classId !== classId) {
      return { ok: false, reason: "Ce cours annuel n’appartient pas à la classe demandée.", status: 400 };
    }
  }

  const includeArchived = includeArchivedCoursesInScheduleView(year.status);
  const courses = allCourses.filter((course: AnnualCourse) => {
    if (course.schoolYearId !== schoolYearId) return false;
    if (classId && course.classId !== classId) return false;
    if (annualCourseId && course.id !== annualCourseId) return false;
    if (!includeArchived && course.isArchived) return false;
    return true;
  });

  const courseIds = new Set(courses.map((course) => course.id));
  const slots = (await deps.schedules.listSlots()).filter((slot) => courseIds.has(slot.annualCourseId));
  const exceptions = await deps.years.listDayExceptions(schoolYearId);

  return {
    ok: true,
    value: computeCourseSessions({
      schoolYearId: year.id,
      courses,
      slots,
      weeks: year.weeks,
      holidays: valaisHolidaysForSchoolYear(year.label),
      exceptions,
    }),
  };
}
