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

function selectedAnnualCourseIdSet(ids?: readonly string[]): Set<string> | null {
  if (ids === undefined) return null;
  return new Set(ids.map((id) => id.trim()).filter(Boolean));
}

/** Notes du cours, tous propriétaires. Le propriétaire de session n’est requis qu’en legacy. */
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
    selectedSourceAnnualCourseIds?: readonly string[];
    /**
     * Présent = nouveau PREVIEW : plans N+1 obligatoires, pas de clone des slots source.
     * Absent = repli legacy (tests / APPLY déjà persistés sans plan).
     */
    targetMeetingDayPlans?: readonly YearTransitionTargetMeetingDayPlan[];
    /** Cours source déjà importés dont le contenu hérité N+1 est remplacé (nouveau flux uniquement). */
    reimportSourceAnnualCourseIds?: readonly string[];
  },
  deps: AssembleLiveYearTransitionPreviewInputDeps,
): Promise<YearTransitionPreviewInput> {
  const newFlow = usesExplicitTargetMeetingDayPlans(options.targetMeetingDayPlans);
  const includePrivateNotes = Boolean(options.includePrivateNotes) || newFlow;
  if (includePrivateNotes && !deps.notes) {
    throw new Error("Le stockage des notes privées est obligatoire.");
  }
  if (includePrivateNotes && !newFlow && !options.privateNotesOwnerTeacherId?.trim()) {
    throw new Error("Le propriétaire des notes privées est obligatoire.");
  }
  const allCourses = await deps.courses.listCourses();
  const sourceCourses = coursesForYear(allCourses, options.sourceSchoolYearId);
  const targetCourses = coursesForYear(allCourses, options.targetSchoolYearId);
  const selectedClassIds = new Set(
    (options.selectedSourceClassIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const selectedCourseIds = selectedAnnualCourseIdSet(options.selectedSourceAnnualCourseIds);

  const items = await deps.agenda.exportAllItems();
  const sourceItems = items.filter((item) => {
    if ((item.schoolYearId ?? null) !== options.sourceSchoolYearId) return false;
    const course = sourceCourses.find((entry) => entry.id === item.annualCourseId);
    if (selectedCourseIds) {
      return Boolean(course && selectedCourseIds.has(course.id)
        && (selectedClassIds.size === 0 || selectedClassIds.has(course.classId)));
    }
    if (selectedClassIds.size === 0) return true;
    return Boolean(course && selectedClassIds.has(course.classId));
  });
  const allTargetItems = items.filter((item) => (item.schoolYearId ?? null) === options.targetSchoolYearId);

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
        continuationSourceCourses(
          options.classMappings,
          sourceCourses,
          options.selectedSourceClassIds,
          options.selectedSourceAnnualCourseIds,
        ),
      )
    : undefined;
  const projected = projectPendingTargetStructure({
    mappings: options.classMappings,
    sourceCourses,
    targetCourses,
    slots: allSlots,
    targetSchoolYearId: options.targetSchoolYearId,
    cloneSourceSlots: explicitPlans === undefined,
    selectedSourceAnnualCourseIds: options.selectedSourceAnnualCourseIds,
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

  const reimportCourses = resolveReimportCourses({
    reimportSourceAnnualCourseIds: options.reimportSourceAnnualCourseIds,
    explicitPlans,
    continuedSourceCourseIds: explicitPlans
      ? continuationSourceCourses(
          options.classMappings,
          sourceCourses,
          options.selectedSourceClassIds,
          options.selectedSourceAnnualCourseIds,
        ).map((course) => course.id)
      : [],
    sourceToTargetCourseId: projected.sourceToTargetCourseId,
  });
  const reimportTargetIds = new Set(reimportCourses.map((entry) => entry.targetAnnualCourseId));
  const isReplacedItem = (item: (typeof allTargetItems)[number]) =>
    reimportTargetIds.has(item.annualCourseId?.trim() ?? "") && Boolean(item.sourceTransitionId?.trim());
  const isReplacedNote = (note: AnnualCourseNote) =>
    reimportTargetIds.has(note.annualCourseId?.trim() ?? "") &&
    Boolean(note.sourceNoteId?.trim() || note.inheritedAt?.trim());
  const targetItems = allTargetItems.filter((item) => !isReplacedItem(item));

  const sourceCoursesForNotes = selectedCourseIds
    ? sourceCourses.filter((course) => selectedCourseIds.has(course.id))
    : sourceCourses;
  const privateNotes = includePrivateNotes
    ? [
        ...(await notesForAnnualCourses(deps.notes!, sourceCoursesForNotes)),
        ...(await notesForAnnualCourses(deps.notes!, projected.targetCourses.filter((course) => !isPendingTargetCourseId(course.id)))),
      ]
    : [];
  const scopedNotes = (notes: AnnualCourseNote[]) =>
    notes.filter((note) => {
      if (note.schoolYearId !== options.sourceSchoolYearId && note.schoolYearId !== options.targetSchoolYearId) {
        return false;
      }
      if (note.schoolYearId === options.targetSchoolYearId) {
        if (!selectedCourseIds) return true;
        return projected.targetCourses.some((course) => course.id === note.annualCourseId);
      }
      if (selectedCourseIds) {
        return Boolean(note.annualCourseId && selectedCourseIds.has(note.annualCourseId)
          && (selectedClassIds.size === 0 || selectedClassIds.has(note.classId)));
      }
      if (selectedClassIds.size === 0) return true;
      return selectedClassIds.has(note.classId);
    });
  const allTargetNotes = scopedNotes(privateNotes).filter((n) => n.schoolYearId === options.targetSchoolYearId);

  return {
    ...(includePrivateNotes ? {
      includePrivateNotes: true,
      ...(newFlow
        ? {}
        : { privateNotesOwnerTeacherId: options.privateNotesOwnerTeacherId!.trim() }),
      sourceNotes: scopedNotes(privateNotes).filter(n => n.schoolYearId === options.sourceSchoolYearId),
      targetNotes: allTargetNotes.filter((note) => !isReplacedNote(note)),
    } : {}),
    ...(reimportCourses.length > 0
      ? {
          reimport: {
            courses: reimportCourses,
            replacedItems: allTargetItems.filter(isReplacedItem).map((item) => ({ ...item })),
            replacedNotes: allTargetNotes.filter(isReplacedNote).map((note) => ({ ...note })),
            targetSlots: allSlots
              .filter((slot) => reimportTargetIds.has(slot.annualCourseId))
              .map((slot) => ({ ...slot })),
          },
        }
      : {}),
    sourceSchoolYearId: options.sourceSchoolYearId,
    targetSchoolYearId: options.targetSchoolYearId,
    classMappings: options.classMappings.map((mapping) => ({ ...mapping })),
    selectedSourceClassIds: options.selectedSourceClassIds?.map((id) => id.trim()).filter(Boolean),
    ...(options.selectedSourceAnnualCourseIds
      ? {
          selectedSourceAnnualCourseIds: options.selectedSourceAnnualCourseIds
            .map((id) => id.trim())
            .filter(Boolean),
        }
      : {}),
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

export const YEAR_TRANSITION_REIMPORT_REQUIRES_PLAN =
  "La réimportation d’un cours exige un plan de jours N+1 explicite.";
export const YEAR_TRANSITION_REIMPORT_NOT_SELECTED =
  "Un cours à réimporter doit faire partie des cours repris.";
export const YEAR_TRANSITION_REIMPORT_NOT_IMPORTED =
  "Ce cours n’a pas encore été importé : il se reprend normalement, sans réimportation.";

function resolveReimportCourses(options: {
  reimportSourceAnnualCourseIds?: readonly string[];
  explicitPlans: readonly CanonicalTargetMeetingDayPlan[] | undefined;
  continuedSourceCourseIds: readonly string[];
  sourceToTargetCourseId: ReadonlyMap<string, string>;
}): Array<{ sourceAnnualCourseId: string; targetAnnualCourseId: string }> {
  const ids = [...new Set((options.reimportSourceAnnualCourseIds ?? []).map((id) => id.trim()).filter(Boolean))].sort();
  if (ids.length === 0) return [];
  if (!options.explicitPlans) throw new Error(YEAR_TRANSITION_REIMPORT_REQUIRES_PLAN);
  const continued = new Set(options.continuedSourceCourseIds);
  return ids.map((sourceAnnualCourseId) => {
    if (!continued.has(sourceAnnualCourseId)) throw new Error(YEAR_TRANSITION_REIMPORT_NOT_SELECTED);
    const targetAnnualCourseId = options.sourceToTargetCourseId.get(sourceAnnualCourseId) ?? "";
    if (!targetAnnualCourseId || isPendingTargetCourseId(targetAnnualCourseId)) {
      throw new Error(YEAR_TRANSITION_REIMPORT_NOT_IMPORTED);
    }
    return { sourceAnnualCourseId, targetAnnualCourseId };
  });
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
  selectedSourceAnnualCourseIds?: readonly string[];
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
  const selectedCourses = options.selectedSourceAnnualCourseIds === undefined
    ? null
    : new Set(options.selectedSourceAnnualCourseIds.map((id) => id.trim()).filter(Boolean));

  for (const mapping of options.mappings) {
    const sourceClassId = mapping.sourceClassId?.trim() || "";
    const targetClassId = mapping.targetClassId?.trim() || "";
    if (!sourceClassId || !targetClassId) continue;
    const sourceOfClass = options.sourceCourses.filter(
      (course) =>
        course.classId === sourceClassId &&
        !course.isArchived &&
        (!selectedCourses || selectedCourses.has(course.id)),
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
