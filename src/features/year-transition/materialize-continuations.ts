import { randomUUID } from "node:crypto";

import { replaceAnnualCourseMeetingDays } from "../annual-courses/meeting-days.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { RuntimeAgendaAdapterStore } from "../../lib/persistence/runtime-agenda-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import {
  ensureRuntimeClassroomForSchoolClass,
  ensureRuntimeSubjectForAnnualCourse,
} from "../agenda-bridge/reconcile.ts";
import { buildClassCode, buildClassLabel } from "../school-catalog/class-codes.ts";
import { sameMeetingDayPlan } from "./course-import-state.ts";
import {
  classContinuationIdentity,
  resolveClassContinuations,
  type ContinuationResolution,
} from "./continuation-identity.ts";
import {
  continuationSourceCourses,
  requireTargetMeetingDayPlans,
  usesExplicitTargetMeetingDayPlans,
  type YearTransitionTargetMeetingDayPlan,
} from "./target-meeting-days.ts";
import type { YearTransitionClassMapping } from "./types.ts";

export interface MaterializeContinuationDeps {
  catalog: SchoolCatalogStore;
  years: SchoolYearStore;
  courses: AnnualCourseStore;
  schedules: CourseScheduleStore;
  adapters: RuntimeAgendaAdapterStore;
  now?: () => string;
}

function createSlotId(): string {
  return `slot-${randomUUID()}`;
}

function createAssignmentId(): string {
  return `asg-${randomUUID()}`;
}

function createAttendanceId(): string {
  return `att-${randomUUID()}`;
}

function createCourseId(): string {
  return `ac-${randomUUID()}`;
}

export async function loadContinuationResolution(
  deps: Pick<MaterializeContinuationDeps, "catalog">,
  options: {
    selectedSourceClassIds: readonly string[];
    sourceSchoolYearId: string;
    targetSchoolYearId: string;
  },
): Promise<ContinuationResolution> {
  const classes = await deps.catalog.listClasses();
  return resolveClassContinuations({
    ...options,
    sourceClasses: classes,
    targetClasses: classes,
  });
}

/**
 * Persiste les MeetingDays N+1 du PREVIEW sur les AnnualCourse cibles réels.
 * Indexés par cours source, remappés vers l’id cible. Aucun lien temporel vers N.
 */
export async function persistTargetMeetingDayPlans(
  deps: Pick<MaterializeContinuationDeps, "courses" | "schedules" | "now">,
  options: {
    mappings: readonly YearTransitionClassMapping[];
    plans: readonly YearTransitionTargetMeetingDayPlan[];
    sourceSchoolYearId: string;
    targetSchoolYearId: string;
    selectedSourceClassIds?: readonly string[];
    selectedSourceAnnualCourseIds?: readonly string[];
    /** Cours réimportés : leurs jours sont remplacés dans la transaction de l’APPLY. */
    deferredSourceAnnualCourseIds?: readonly string[];
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const courses = await deps.courses.listCourses();
  const sourceCourses = courses.filter((course) => course.schoolYearId === options.sourceSchoolYearId);
  const required = continuationSourceCourses(
    options.mappings,
    sourceCourses,
    options.selectedSourceClassIds,
    options.selectedSourceAnnualCourseIds,
  );
  let canonical;
  try {
    canonical = requireTargetMeetingDayPlans(options.plans, required);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Plan de jours N+1 invalide." };
  }
  const bySource = new Map(canonical.map((plan) => [plan.sourceAnnualCourseId, plan]));

  for (const sourceCourse of required) {
    const plan = bySource.get(sourceCourse.id);
    if (!plan) {
      return { ok: false, reason: "Chaque cours repris doit avoir un plan de jours N+1." };
    }
    const mapping = options.mappings.find((row) => row.sourceClassId === sourceCourse.classId);
    const targetClassId = mapping?.targetClassId?.trim() || "";
    if (!targetClassId) continue;
    const targetCourse = courses.find(
      (course) =>
        course.classId === targetClassId &&
        course.schoolYearId === options.targetSchoolYearId &&
        course.contextId === sourceCourse.contextId &&
        !course.isArchived,
    );
    if (!targetCourse) {
      return { ok: false, reason: "Cours cible introuvable pour persister les jours de séance." };
    }
    if (options.deferredSourceAnnualCourseIds?.includes(sourceCourse.id)) continue;
    if (sameMeetingDayPlan(await deps.schedules.listMeetingDaysByAnnualCourse(targetCourse.id), plan.days)) continue;
    const saved = await replaceAnnualCourseMeetingDays(deps, targetCourse.id, plan.days);
    if (!saved.ok) return { ok: false, reason: saved.reason };
  }
  return { ok: true };
}

export async function materializeSelectedContinuations(
  deps: MaterializeContinuationDeps,
  options: {
    selectedSourceClassIds: readonly string[];
    sourceSchoolYearId: string;
    targetSchoolYearId: string;
    /**
     * Présent = nouveau flux : pas de copie slots / enseignants / attendance.
     * MeetingDays du plan persistés sur chaque AnnualCourse cible.
     * Absent = legacy : copie encore l’organisation de N.
     */
    targetMeetingDayPlans?: readonly YearTransitionTargetMeetingDayPlan[];
    deferredSourceAnnualCourseIds?: readonly string[];
    selectedSourceAnnualCourseIds?: readonly string[];
  },
): Promise<{ ok: true; mappings: YearTransitionClassMapping[]; createdClassIds: string[] } | { ok: false; reason: string }> {
  const targetYear = await deps.years.getSchoolYearById(options.targetSchoolYearId);
  if (!targetYear || targetYear.status !== "draft") {
    return { ok: false, reason: "L’année cible doit rester en brouillon." };
  }

  let classes = await deps.catalog.listClasses();
  let resolution = resolveClassContinuations({
    selectedSourceClassIds: options.selectedSourceClassIds,
    sourceClasses: classes,
    targetClasses: classes,
    sourceSchoolYearId: options.sourceSchoolYearId,
    targetSchoolYearId: options.targetSchoolYearId,
  });
  if (resolution.blocking) {
    return { ok: false, reason: resolution.issues[0] ?? "Correspondances de classes bloquantes." };
  }

  const createdClassIds: string[] = [];
  const professions = await deps.catalog.listProfessions();
  const now = deps.now?.() ?? new Date().toISOString();

  for (const row of resolution.planned.filter((entry) => entry.action === "create")) {
    const source = classes.find((entry) => entry.id === row.sourceClassId);
    const identity = row.identity ?? (source ? classContinuationIdentity(source) : null);
    if (!source || !identity) {
      return { ok: false, reason: "Impossible de créer une classe sans identité complète." };
    }
    const profession = professions.find((entry) => entry.id === identity.professionId);
    const prefix = profession?.classCodePrefix?.trim() || source.code.replace(/\d+[A-Z]*$/i, "") || source.code;
    const code = buildClassCode({
      prefix,
      trainingYear: identity.trainingYear,
      parallelCode: identity.parallelCode,
    });
    try {
      const created = await deps.catalog.createClass({
        code,
        label: buildClassLabel({
          prefix,
          trainingYear: identity.trainingYear,
          parallelCode: identity.parallelCode,
        }),
        schoolYearId: options.targetSchoolYearId,
        schoolYearLabel: targetYear.label,
        professionId: identity.professionId,
        trainingYear: identity.trainingYear,
        parallelCode: identity.parallelCode,
        isActive: true,
        isArchived: false,
      });
      createdClassIds.push(created.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Création de classe impossible.";
      return { ok: false, reason };
    }
  }

  classes = await deps.catalog.listClasses();
  for (const schoolClass of classes.filter((entry) => entry.schoolYearId === options.targetSchoolYearId)) {
    const ensured = await ensureRuntimeClassroomForSchoolClass(deps.adapters, schoolClass, classes);
    if (!ensured.ok) return { ok: false, reason: ensured.reason };
  }

  resolution = resolveClassContinuations({
    selectedSourceClassIds: options.selectedSourceClassIds,
    sourceClasses: classes,
    targetClasses: classes,
    sourceSchoolYearId: options.sourceSchoolYearId,
    targetSchoolYearId: options.targetSchoolYearId,
  });
  if (resolution.blocking) {
    return { ok: false, reason: resolution.issues[0] ?? "Correspondances de classes bloquantes." };
  }

  const newFlow = usesExplicitTargetMeetingDayPlans(options.targetMeetingDayPlans);
  const [courses, contexts, branches, slots, attendance, assignments] = await Promise.all([
    deps.courses.listCourses(),
    deps.catalog.listContexts(),
    deps.catalog.listBranches(),
    deps.schedules.listSlots(),
    deps.schedules.listAttendanceDays(),
    deps.courses.listAssignments(),
  ]);

  for (const mapping of resolution.mappings) {
    const sourceClassId = mapping.sourceClassId?.trim() || "";
    const targetClassId = mapping.targetClassId?.trim() || "";
    if (!sourceClassId || !targetClassId) continue;
    const sourceClass = classes.find((entry) => entry.id === sourceClassId);
    const targetClass = classes.find((entry) => entry.id === targetClassId);
    if (!sourceClass || !targetClass) continue;

    if (!newFlow) {
      const sourceAttendance = attendance.filter((day) => day.classId === sourceClassId);
      if (sourceAttendance.length > 0) {
        const existingAttendance = attendance.filter((day) => day.classId === targetClassId);
        if (existingAttendance.length === 0) {
          await deps.schedules.replaceAttendanceDaysForClass(
            targetClassId,
            sourceAttendance.map((day) => ({
              ...day,
              id: createAttendanceId(),
              classId: targetClassId,
              createdAt: now,
              updatedAt: now,
            })),
          );
        }
      }
    }

    const selectedCourses = options.selectedSourceAnnualCourseIds === undefined
      ? null
      : new Set(options.selectedSourceAnnualCourseIds.map((id) => id.trim()).filter(Boolean));
    const sourceCourses = courses.filter(
      (course) =>
        course.classId === sourceClassId &&
        course.schoolYearId === options.sourceSchoolYearId &&
        !course.isArchived &&
        (!selectedCourses || selectedCourses.has(course.id)),
    );
    for (const sourceCourse of sourceCourses) {
      let targetCourse = courses.find(
        (course) =>
          course.classId === targetClassId &&
          course.schoolYearId === options.targetSchoolYearId &&
          course.contextId === sourceCourse.contextId &&
          !course.isArchived,
      );
      if (!targetCourse) {
        targetCourse = await deps.courses.createCourse({
          id: createCourseId(),
          schoolYearId: options.targetSchoolYearId,
          classId: targetClassId,
          contextId: sourceCourse.contextId,
          isArchived: false,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        courses.push(targetCourse);
      }

      const info = (() => {
        const context = contexts.find((entry) => entry.id === sourceCourse.contextId);
        const branch = context ? branches.find((entry) => entry.id === context.branchId) : null;
        return context && branch ? { context, branch } : null;
      })();
      if (info) {
        const subject = await ensureRuntimeSubjectForAnnualCourse(deps.adapters, {
          schoolClass: targetClass,
          course: targetCourse,
          branch: info.branch,
          allSchoolClasses: classes,
          courses,
          contexts,
          branches,
        });
        if (!subject.ok) return { ok: false, reason: subject.reason };
      }

      if (newFlow) continue;

      const sourceSlots = slots.filter((slot) => slot.annualCourseId === sourceCourse.id);
      const existingTargetSlots = slots.filter((slot) => slot.annualCourseId === targetCourse.id);
      if (existingTargetSlots.length === 0) {
        for (const slot of sourceSlots) {
          const copied = await deps.schedules.createSlot({
            ...slot,
            id: createSlotId(),
            annualCourseId: targetCourse.id,
            createdAt: now,
            updatedAt: now,
          });
          slots.push(copied);
        }
      }

      const sourceAssignments = assignments.filter(
        (assignment) => assignment.annualCourseId === sourceCourse.id && !assignment.endedAt,
      );
      const existingAssignments = assignments.filter((assignment) => assignment.annualCourseId === targetCourse.id);
      if (existingAssignments.length === 0) {
        for (const assignment of sourceAssignments) {
          const copied = await deps.courses.createAssignment({
            ...assignment,
            id: createAssignmentId(),
            annualCourseId: targetCourse.id,
            createdAt: now,
          });
          assignments.push(copied);
        }
      }
    }
  }

  if (usesExplicitTargetMeetingDayPlans(options.targetMeetingDayPlans)) {
    const persistedDays = await persistTargetMeetingDayPlans(deps, {
      mappings: resolution.mappings,
      plans: options.targetMeetingDayPlans,
      sourceSchoolYearId: options.sourceSchoolYearId,
      targetSchoolYearId: options.targetSchoolYearId,
      selectedSourceClassIds: options.selectedSourceClassIds,
      selectedSourceAnnualCourseIds: options.selectedSourceAnnualCourseIds,
      deferredSourceAnnualCourseIds: options.deferredSourceAnnualCourseIds,
    });
    if (!persistedDays.ok) return persistedDays;
  }

  return { ok: true, mappings: resolution.mappings, createdClassIds };
}
