import type { AnnualCourse } from "../annual-courses/types.ts";
import { computeCourseSessions } from "../course-sessions/compute.ts";
import { valaisHolidaysForSchoolYear } from "../school-days/holidays-valais.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { AnnualCourseNotesStore, PedagogicalPathStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import type { YearTransitionClassMapping, YearTransitionPreviewInput } from "./types.ts";

export interface AssembleLiveYearTransitionPreviewInputDeps {
  notes?: AnnualCourseNotesStore;
  courses: AnnualCourseStore;
  agenda: AgendaStore;
  paths: PedagogicalPathStore;
  years: SchoolYearStore;
  schedules: CourseScheduleStore;
}

function coursesForYear(all: readonly AnnualCourse[], schoolYearId: string): AnnualCourse[] {
  return all.filter((course) => course.schoolYearId === schoolYearId).map((course) => ({ ...course }));
}

/**
 * Assembleur live canonique N→N+1.
 * Inclut les cours archivés (isArchived) pour que le moteur puisse retourner TARGET_COURSE_ARCHIVED.
 * CourseSession cibles recalculées, jamais persistées.
 */
export async function assembleLiveYearTransitionPreviewInput(
  options: {
    includePrivateNotes?: boolean;
    privateNotesOwnerTeacherId?: string;
    sourceSchoolYearId: string;
    targetSchoolYearId: string;
    classMappings: readonly YearTransitionClassMapping[];
  },
  deps: AssembleLiveYearTransitionPreviewInputDeps,
): Promise<YearTransitionPreviewInput> {
  if (options.includePrivateNotes && (!deps.notes || !options.privateNotesOwnerTeacherId?.trim())) {
    throw new Error("Le stockage et le propriétaire des notes privées sont obligatoires.");
  }
  const privateNotes = options.includePrivateNotes
    ? await deps.notes!.listNotesByOwner(options.privateNotesOwnerTeacherId!.trim()) : [];
  const allCourses = await deps.courses.listCourses();
  const sourceCourses = coursesForYear(allCourses, options.sourceSchoolYearId);
  const targetCourses = coursesForYear(allCourses, options.targetSchoolYearId);

  const items = await deps.agenda.exportAllItems();
  const sourceItems = items.filter((item) => (item.schoolYearId ?? null) === options.sourceSchoolYearId);
  const targetItems = items.filter((item) => (item.schoolYearId ?? null) === options.targetSchoolYearId);

  const contextIds = new Set<string>();
  for (const course of [...sourceCourses, ...targetCourses]) {
    if (course.contextId.trim()) contextIds.add(course.contextId);
  }
  const pathSnapshots = (await deps.paths.listPaths())
    .filter((path) => contextIds.has(path.contextId))
    .sort((left, right) => left.contextId.localeCompare(right.contextId) || left.id.localeCompare(right.id));

  const targetYear = await deps.years.getSchoolYearById(options.targetSchoolYearId);
  const slots = (await deps.schedules.listSlots()).filter((slot) =>
    targetCourses.some((course) => course.id === slot.annualCourseId),
  );
  const exceptions = targetYear ? await deps.years.listDayExceptions(options.targetSchoolYearId) : [];
  const targetCourseSessions = targetYear
    ? computeCourseSessions({
        schoolYearId: targetYear.id,
        courses: targetCourses.map((course) => ({
          id: course.id,
          classId: course.classId,
          contextId: course.contextId,
        })),
        slots,
        weeks: targetYear.weeks,
        holidays: valaisHolidaysForSchoolYear(targetYear.label),
        exceptions,
      })
    : [];

  return {
    ...(options.includePrivateNotes ? { includePrivateNotes: true,
      privateNotesOwnerTeacherId: options.privateNotesOwnerTeacherId!.trim(),
      sourceNotes: privateNotes.filter(n => n.schoolYearId === options.sourceSchoolYearId),
      targetNotes: privateNotes.filter(n => n.schoolYearId === options.targetSchoolYearId) } : {}),
    sourceSchoolYearId: options.sourceSchoolYearId,
    targetSchoolYearId: options.targetSchoolYearId,
    classMappings: options.classMappings.map((mapping) => ({ ...mapping })),
    sourceCourses,
    targetCourses,
    sourceItems: sourceItems.map((item) => ({ ...item })),
    targetItems: targetItems.map((item) => ({ ...item })),
    pathSnapshots,
    targetCourseSessions,
  };
}
