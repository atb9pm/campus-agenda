import type { AnnualCourse } from "../annual-courses/types.ts";
import { computeCourseSessions } from "../course-sessions/compute.ts";
import type { CourseScheduleSlot } from "../course-schedule/types.ts";
import type { AnnualCourseNote } from "../pedagogical-path/annual-notes.ts";
import { valaisHolidaysForSchoolYear } from "../school-days/holidays-valais.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { AnnualCourseNotesStore, PedagogicalPathStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import {
  isPendingTargetClassId,
  isPendingTargetCourseId,
  pendingTargetCourseId,
} from "./continuation-identity.ts";
import {
  continuationSourceCourses,
  requireTargetMeetingDayPlans,
  usesExplicitTargetMeetingDayPlans,
  type CanonicalTargetMeetingDayPlan,
  type YearTransitionTargetMeetingDayPlan,
} from "./target-meeting-days.ts";
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

/** Notes du cours, tous propriétaires. APPLY reste cadré sur le propriétaire de session. */
async function notesForAnnualCourses(
  store: AnnualCourseNotesStore,
  courses: readonly AnnualCourse[],
): Promise<AnnualCourseNote[]> {
  const seen = new Set<string>();
  const notes: AnnualCourseNote[] = [];
  for (const course of courses) {
    for (const entry of await store.listNotesByAnnualCourse(course.id)) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      notes.push(entry);
    }
  }
  return notes.sort((left, right) => left.id.localeCompare(right.id));
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
    selectedSourceClassIds?: readonly string[];
    /**
     * Présent = nouveau PREVIEW : plans N+1 obligatoires, pas de clone des slots source.
     * Absent = repli legacy (tests / APPLY déjà persistés sans plan).
     */
    targetMeetingDayPlans?: readonly YearTransitionTargetMeetingDayPlan[];
  },
  deps: AssembleLiveYearTransitionPreviewInputDeps,
): Promise<YearTransitionPreviewInput> {
  if (options.includePrivateNotes && (!deps.notes || !options.privateNotesOwnerTeacherId?.trim())) {
    throw new Error("Le stockage et le propriétaire des notes privées sont obligatoires.");
  }
  const allCourses = await deps.courses.listCourses();
  const sourceCourses = coursesForYear(allCourses, options.sourceSchoolYearId);
  const targetCourses = coursesForYear(allCourses, options.targetSchoolYearId);
  const selectedClassIds = new Set(
    (options.selectedSourceClassIds ?? []).map((id) => id.trim()).filter(Boolean),
  );

  const items = await deps.agenda.exportAllItems();
  const sourceItems = items.filter((item) => {
    if ((item.schoolYearId ?? null) !== options.sourceSchoolYearId) return false;
    if (selectedClassIds.size === 0) return true;
    const course = sourceCourses.find((entry) => entry.id === item.annualCourseId);
    return Boolean(course && selectedClassIds.has(course.classId));
  });
  const targetItems = items.filter((item) => (item.schoolYearId ?? null) === options.targetSchoolYearId);

  const contextIds = new Set<string>();
  for (const course of [...sourceCourses, ...targetCourses]) {
    if (course.contextId.trim()) contextIds.add(course.contextId);
  }
  const pathSnapshots = (await deps.paths.listPaths())
    .filter((path) => contextIds.has(path.contextId))
    .sort((left, right) => left.contextId.localeCompare(right.contextId) || left.id.localeCompare(right.id));

  const targetYear = await deps.years.getSchoolYearById(options.targetSchoolYearId);
  const sourceYear = await deps.years.getSchoolYearById(options.sourceSchoolYearId);
  const allSlots = await deps.schedules.listSlots();
  const allMeetingDays = await deps.schedules.listMeetingDays();
  const explicitPlans = usesExplicitTargetMeetingDayPlans(options.targetMeetingDayPlans)
    ? requireTargetMeetingDayPlans(
        options.targetMeetingDayPlans,
        continuationSourceCourses(options.classMappings, sourceCourses, options.selectedSourceClassIds),
      )
    : undefined;
  const projected = projectPendingTargetStructure({
    mappings: options.classMappings,
    sourceCourses,
    targetCourses,
    slots: allSlots,
    targetSchoolYearId: options.targetSchoolYearId,
    cloneSourceSlots: explicitPlans === undefined,
  });
  const sourceSlots = allSlots.filter((slot) =>
    sourceCourses.some((course) => course.id === slot.annualCourseId),
  );
  const sourceMeetingDays = allMeetingDays.filter((day) =>
    sourceCourses.some((course) => course.id === day.annualCourseId),
  );
  const sourceExceptions = sourceYear ? await deps.years.listDayExceptions(options.sourceSchoolYearId) : [];
  const sourceCourseSessions = sourceYear
    ? computeCourseSessions({
        schoolYearId: sourceYear.id,
        courses: sourceCourses.map((course) => ({
          id: course.id,
          classId: course.classId,
          contextId: course.contextId,
        })),
        slots: sourceSlots,
        weeks: sourceYear.weeks,
        holidays: valaisHolidaysForSchoolYear(sourceYear.label),
        exceptions: sourceExceptions,
        meetingDays: sourceMeetingDays,
      })
    : [];
  const exceptions = targetYear ? await deps.years.listDayExceptions(options.targetSchoolYearId) : [];
  const targetMeetingDays = explicitPlans
    ? meetingDaysForProjectedCourses(explicitPlans, projected.sourceToTargetCourseId)
    : undefined;
  const targetCourseSessions = targetYear
    ? computeCourseSessions({
        schoolYearId: targetYear.id,
        courses: projected.targetCourses.map((course) => ({
          id: course.id,
          classId: course.classId,
          contextId: course.contextId,
        })),
        slots: projected.slots,
        weeks: targetYear.weeks,
        holidays: valaisHolidaysForSchoolYear(targetYear.label),
        exceptions,
        meetingDays: targetMeetingDays,
      })
    : [];

  const privateNotes = options.includePrivateNotes
    ? [
        ...(await notesForAnnualCourses(deps.notes!, sourceCourses)),
        ...(await notesForAnnualCourses(deps.notes!, projected.targetCourses.filter((course) => !isPendingTargetCourseId(course.id)))),
      ]
    : [];
  const scopedNotes = (notes: AnnualCourseNote[]) =>
    notes.filter((note) => {
      if (note.schoolYearId !== options.sourceSchoolYearId && note.schoolYearId !== options.targetSchoolYearId) {
        return false;
      }
      if (note.schoolYearId === options.targetSchoolYearId) return true;
      if (selectedClassIds.size === 0) return true;
      return selectedClassIds.has(note.classId);
    });

  return {
    ...(options.includePrivateNotes ? { includePrivateNotes: true,
      privateNotesOwnerTeacherId: options.privateNotesOwnerTeacherId!.trim(),
      sourceNotes: scopedNotes(privateNotes).filter(n => n.schoolYearId === options.sourceSchoolYearId),
      targetNotes: scopedNotes(privateNotes).filter(n => n.schoolYearId === options.targetSchoolYearId) } : {}),
    sourceSchoolYearId: options.sourceSchoolYearId,
    targetSchoolYearId: options.targetSchoolYearId,
    classMappings: options.classMappings.map((mapping) => ({ ...mapping })),
    selectedSourceClassIds: options.selectedSourceClassIds?.map((id) => id.trim()).filter(Boolean),
    sourceCourses,
    targetCourses: projected.targetCourses,
    sourceItems: sourceItems.map((item) => ({ ...item })),
    targetItems: targetItems.map((item) => ({ ...item })),
    pathSnapshots,
    sourceCourseSessions,
    targetCourseSessions,
    ...(explicitPlans ? { targetMeetingDayPlans: explicitPlans } : {}),
  };
}

function meetingDaysForProjectedCourses(
  plans: readonly CanonicalTargetMeetingDayPlan[],
  sourceToTargetCourseId: ReadonlyMap<string, string>,
) {
  return plans.flatMap((plan) => {
    const annualCourseId = sourceToTargetCourseId.get(plan.sourceAnnualCourseId);
    if (!annualCourseId) return [];
    return plan.days.map((day) => ({
      annualCourseId,
      dayOfWeek: day.dayOfWeek,
      weekKind: day.weekKind,
    }));
  });
}

/**
 * Cours cibles virtuels + slots.
 *
 * `cloneSourceSlots: true` (legacy, `targetMeetingDayPlans` absent) : recopie les
 * CourseScheduleSlot de N sur le cours virtuel N+1. Conservé pour les PREVIEW /
 * APPLY déjà en place qui n’ont pas encore de plan explicite.
 *
 * `cloneSourceSlots: false` (nouveau contrat) : aucun slot de N. Les dates N+1
 * viennent de `computeCourseSessions({ meetingDays })`. `segments` restent `[]`
 * tant que l’horaire N+1 n’existe pas.
 */
function projectPendingTargetStructure(options: {
  mappings: readonly YearTransitionClassMapping[];
  sourceCourses: readonly AnnualCourse[];
  targetCourses: readonly AnnualCourse[];
  slots: readonly CourseScheduleSlot[];
  targetSchoolYearId: string;
  cloneSourceSlots: boolean;
}): {
  targetCourses: AnnualCourse[];
  slots: CourseScheduleSlot[];
  sourceToTargetCourseId: Map<string, string>;
} {
  const targetCourses = options.targetCourses.map((course) => ({ ...course }));
  const slots = options.slots.filter((slot) =>
    targetCourses.some((course) => course.id === slot.annualCourseId),
  );
  const sourceToTargetCourseId = new Map<string, string>();

  for (const mapping of options.mappings) {
    const sourceClassId = mapping.sourceClassId?.trim() || "";
    const targetClassId = mapping.targetClassId?.trim() || "";
    if (!sourceClassId || !targetClassId) continue;
    const sourceOfClass = options.sourceCourses.filter(
      (course) => course.classId === sourceClassId && !course.isArchived,
    );
    for (const sourceCourse of sourceOfClass) {
      const existing = targetCourses.find(
        (course) =>
          course.classId === targetClassId &&
          course.contextId === sourceCourse.contextId &&
          !course.isArchived,
      );
      const virtual =
        existing ??
        (isPendingTargetClassId(targetClassId)
          ? (() => {
              const created: AnnualCourse = {
                ...sourceCourse,
                id: pendingTargetCourseId(sourceCourse.id),
                schoolYearId: options.targetSchoolYearId,
                classId: targetClassId,
                isArchived: false,
                archivedAt: null,
              };
              targetCourses.push(created);
              return created;
            })()
          : null);
      if (!virtual) continue;
      sourceToTargetCourseId.set(sourceCourse.id, virtual.id);
      if (!options.cloneSourceSlots || !isPendingTargetClassId(targetClassId)) continue;
      if (slots.some((slot) => slot.annualCourseId === virtual.id)) continue;
      for (const slot of options.slots.filter((entry) => entry.annualCourseId === sourceCourse.id)) {
        slots.push({
          ...slot,
          id: `pending-slot:${slot.id}`,
          annualCourseId: virtual.id,
        });
      }
    }
  }

  return { targetCourses, slots, sourceToTargetCourseId };
}
