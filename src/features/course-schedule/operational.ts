import type { AnnualCourse } from "../annual-courses/types.ts";
import type { CourseScheduleSlot } from "./types.ts";

/**
 * Un AnnualCourse archivé est historique : il ne participe jamais
 * à l’horaire opérationnel (conflits, aperçu, vue globale d’une année active/draft).
 */
export function isOperationalAnnualCourse(course: Pick<AnnualCourse, "isArchived">): boolean {
  return !course.isArchived;
}

/**
 * Année archivée : consultation historique, y compris les cours archivés.
 * Année active/draft : uniquement les cours opérationnels.
 */
export function includeArchivedCoursesInScheduleView(yearStatus: string | null | undefined): boolean {
  return yearStatus === "archived";
}

export function filterSlotsForScheduleView(options: {
  slots: CourseScheduleSlot[];
  courses: Array<Pick<AnnualCourse, "id" | "isArchived">>;
  yearStatus?: string | null;
}): CourseScheduleSlot[] {
  const byId = new Map(options.courses.map((course) => [course.id, course]));
  const includeArchived = includeArchivedCoursesInScheduleView(options.yearStatus);
  return options.slots.filter((slot) => {
    const course = byId.get(slot.annualCourseId);
    if (!course) return false;
    if (includeArchived) return true;
    return isOperationalAnnualCourse(course);
  });
}
