import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import { listComputedCourseSessions } from "../course-sessions/index.ts";
import type { CourseSession } from "../course-sessions/types.ts";

export async function loadControlPlanningYearSessions(
  deps: {
    schedules?: CourseScheduleStore;
    courses: AnnualCourseStore;
    catalog: SchoolCatalogStore;
    years: SchoolYearStore;
  },
  schoolYearId: string,
): Promise<CourseSession[]> {
  if (!deps.schedules || !schoolYearId.trim()) return [];
  const result = await listComputedCourseSessions(
    {
      schedules: deps.schedules,
      courses: deps.courses,
      catalog: deps.catalog,
      years: deps.years,
    },
    { schoolYearId },
  );
  return result.ok ? result.value : [];
}
