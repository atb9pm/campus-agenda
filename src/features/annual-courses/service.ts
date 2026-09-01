import type { AnnualCourseNotesStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import { teacherCanAccessAnnualCourse } from "./access.ts";
import {
  evaluateTeachingTypeGuard,
  findDuplicateAssignment,
  findOverlappingPrimary,
  isAssignmentActiveAt,
  isAssignmentRole,
  teacherIsAssignable,
} from "./assignments.ts";
import { annualCourseDeleteBlockers, contextDeleteBlockers } from "./ctx-guards.ts";
import { parseAssignmentDate, requireOverrideReason, validateAssignmentPeriod } from "./dates.ts";
import { buildTemporaryReplacement, replaceTeacherOnAnnualCourse } from "./replace.ts";
import type {
  AnnualCourse,
  AnnualCourseInput,
  AssignmentRole,
  CourseMutationResult,
  TeacherCourseAssignment,
  TeacherCourseAssignmentEvent,
  TeacherCourseAssignmentInput,
  TypeMismatchWarning,
} from "./types.ts";
import { validateAnnualCourseInput, validateAttributionReferential } from "./validation.ts";

export interface AnnualCourseServiceDeps {
  courses: AnnualCourseStore;
  catalog: SchoolCatalogStore;
  years: SchoolYearStore;
  teachers: TeacherAccountStore;
  notes: AnnualCourseNotesStore;
  /** Présent en production : les créneaux bloquent la suppression définitive. */
  schedules?: Pick<CourseScheduleStore, "listSlotsByAnnualCourse">;
  /** Publications Agenda structurées : bloquent la suppression définitive. */
  agenda?: Pick<AgendaStore, "countAgendaItemsByAnnualCourse">;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function appendEvent(
  deps: AnnualCourseServiceDeps,
  event: Omit<TeacherCourseAssignmentEvent, "id" | "createdAt">,
  createdAt = nowIso(),
): Promise<void> {
  await deps.courses.appendEvent({
    ...event,
    id: createId("tcae"),
    createdAt,
  });
}

async function appendOverrideEvent(
  deps: AnnualCourseServiceDeps,
  input: {
    annualCourseId: string;
    assignmentId: string;
    teacherId: string;
    adminId: string;
    role: AssignmentRole;
    reason: string;
  },
  createdAt: string,
): Promise<void> {
  await appendEvent(deps, {
    annualCourseId: input.annualCourseId,
    assignmentId: input.assignmentId,
    teacherId: input.teacherId,
    adminId: input.adminId,
    kind: "OVERRIDE",
    role: input.role,
    detail: input.reason,
  }, createdAt);
}

async function loadCourseReferential(deps: AnnualCourseServiceDeps, course: AnnualCourse) {
  const [years, classes, contexts, professions, branches] = await Promise.all([
    deps.years.listSchoolYears(),
    deps.catalog.listClasses(),
    deps.catalog.listContexts(),
    deps.catalog.listProfessions(),
    deps.catalog.listBranches(),
  ]);
  const schoolClass = classes.find((entry) => entry.id === course.classId) ?? null;
  const context = contexts.find((entry) => entry.id === course.contextId) ?? null;
  const profession = schoolClass?.professionId
    ? professions.find((entry) => entry.id === schoolClass.professionId) ?? null
    : null;
  const branch = context ? branches.find((entry) => entry.id === context.branchId) ?? null : null;
  const year = years.find((entry) => entry.id === course.schoolYearId) ?? null;
  return { years, schoolClass, context, profession, branch, year };
}

async function assertCourseAssignable(
  deps: AnnualCourseServiceDeps,
  course: AnnualCourse,
): Promise<CourseMutationResult<true>> {
  if (course.isArchived) {
    return { ok: false, reason: "Ce cours annuel est archivé.", status: 409 };
  }
  const ref = await loadCourseReferential(deps, course);
  return validateAttributionReferential({
    year: ref.year,
    schoolClass: ref.schoolClass,
    profession: ref.profession,
    context: ref.context,
    branch: ref.branch,
  });
}

async function applyTypeGuard(
  deps: AnnualCourseServiceDeps,
  course: AnnualCourse,
  teacherType: "TECHNICAL" | "GENERAL" | null,
  forceIncompatible?: boolean,
  overrideReason?: string | null,
): Promise<CourseMutationResult<{ warning: TypeMismatchWarning | null; overrideReason: string | null }>> {
  const ref = await loadCourseReferential(deps, course);
  const typeGuard = evaluateTeachingTypeGuard({
    branchType: ref.branch?.teachingType ?? null,
    teacherType,
    forceIncompatible,
  });
  if (!typeGuard.ok) return typeGuard;
  if (!typeGuard.value.warning) {
    return { ok: true, value: { warning: null, overrideReason: null } };
  }
  const required = requireOverrideReason(true, overrideReason);
  if (!required.ok) return required;
  return { ok: true, value: { warning: typeGuard.value.warning, overrideReason: required.value } };
}

export async function createAnnualCourse(
  deps: AnnualCourseServiceDeps,
  input: AnnualCourseInput,
): Promise<CourseMutationResult<AnnualCourse>> {
  const [years, classes, contexts, professions, branches] = await Promise.all([
    deps.years.listSchoolYears(),
    deps.catalog.listClasses(),
    deps.catalog.listContexts(),
    deps.catalog.listProfessions(),
    deps.catalog.listBranches(),
  ]);
  const schoolClass = classes.find((entry) => entry.id === input.classId) ?? null;
  const context = contexts.find((entry) => entry.id === input.contextId) ?? null;
  const profession = schoolClass?.professionId
    ? professions.find((entry) => entry.id === schoolClass.professionId) ?? null
    : null;
  const branch = context ? branches.find((entry) => entry.id === context.branchId) ?? null : null;
  const validated = validateAnnualCourseInput({ input, years, schoolClass, context, profession, branch });
  if (!validated.ok) return validated;

  const existing = await deps.courses.findCourse(validated.value);
  if (existing) {
    return { ok: false, reason: "Un cours annuel existe déjà pour cette classe, cette année et ce CTX.", status: 409 };
  }

  const timestamp = nowIso();
  const course: AnnualCourse = {
    id: createId("ac"),
    schoolYearId: validated.value.schoolYearId,
    classId: validated.value.classId,
    contextId: validated.value.contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const created = await deps.courses.createCourse(course);
  await deps.notes.attachAnnualCourseId?.(
    {
      schoolYearId: created.schoolYearId,
      classId: created.classId,
      contextId: created.contextId,
    },
    created.id,
  );
  return { ok: true, value: created };
}

export async function ensureAnnualCourse(
  deps: AnnualCourseServiceDeps,
  input: AnnualCourseInput,
): Promise<CourseMutationResult<AnnualCourse>> {
  const existing = await deps.courses.findCourse(input);
  if (existing && !existing.isArchived) return { ok: true, value: existing };
  if (existing?.isArchived) {
    return { ok: false, reason: "Ce cours annuel est archivé. Aucune nouvelle attribution n'est possible.", status: 409 };
  }
  return createAnnualCourse(deps, input);
}

export async function archiveAnnualCourse(
  deps: AnnualCourseServiceDeps,
  courseId: string,
): Promise<CourseMutationResult<AnnualCourse>> {
  const archived = await deps.courses.archiveCourse(courseId);
  if (!archived) return { ok: false, reason: "Cours annuel introuvable.", status: 404 };
  return { ok: true, value: archived };
}

export async function deleteAnnualCourse(
  deps: AnnualCourseServiceDeps,
  courseId: string,
): Promise<CourseMutationResult<{ id: string }>> {
  const course = await deps.courses.getCourse(courseId);
  if (!course) return { ok: false, reason: "Cours annuel introuvable.", status: 404 };
  const assignments = await deps.courses.listAssignments(courseId);
  const notes = await deps.notes.listNotes({
    schoolYearId: course.schoolYearId,
    classId: course.classId,
    contextId: course.contextId,
  });
  const scheduleSlots = deps.schedules
    ? await deps.schedules.listSlotsByAnnualCourse(courseId)
    : [];
  const publicationCount = deps.agenda
    ? await deps.agenda.countAgendaItemsByAnnualCourse(courseId)
    : 0;
  const blocker = annualCourseDeleteBlockers({
    assignmentCount: assignments.length,
    noteCount: notes.length,
    scheduleSlotCount: scheduleSlots.length,
    hasLinkedPublications: publicationCount > 0,
  });
  if (blocker) return { ok: false, reason: blocker, status: 409, code: "USED" };
  const deleted = await deps.courses.deleteCourse(courseId);
  if (!deleted) return { ok: false, reason: "Cours annuel introuvable.", status: 404 };
  return { ok: true, value: { id: courseId } };
}

export async function assignTeacherToCourse(
  deps: AnnualCourseServiceDeps,
  input: TeacherCourseAssignmentInput,
): Promise<CourseMutationResult<TeacherCourseAssignment>> {
  if (!isAssignmentRole(input.role)) {
    return { ok: false, reason: "Rôle invalide (PRIMARY ou CO_TEACHER).", status: 400 };
  }
  if (input.role === "REPLACEMENT") {
    return {
      ok: false,
      reason: "Un remplaçant temporaire doit utiliser l'action dédiée, avec validFrom et validTo obligatoires.",
      status: 400,
    };
  }

  const course = await deps.courses.getCourse(input.annualCourseId);
  if (!course) return { ok: false, reason: "Cours annuel introuvable.", status: 404 };
  const assignableCourse = await assertCourseAssignable(deps, course);
  if (!assignableCourse.ok) return assignableCourse;

  const teacher = await deps.teachers.findAccount(input.teacherId);
  const assignable = teacherIsAssignable(teacher);
  if (!assignable.ok) return assignable;

  const typeGuard = await applyTypeGuard(
    deps,
    course,
    teacher!.teachingType,
    input.forceIncompatible,
    input.overrideReason,
  );
  if (!typeGuard.ok) {
    return { ...typeGuard, code: typeGuard.status === 409 ? "TYPE_MISMATCH" : typeGuard.code };
  }

  const timestamp = nowIso();
  const from = parseAssignmentDate(input.validFrom ?? timestamp, "start");
  if (!from.ok || !from.value) return from.ok === false ? from : { ok: false, reason: "Date de début invalide.", status: 400 };
  const to = parseAssignmentDate(input.validTo ?? null, "end");
  if (!to.ok) return to;
  const period = validateAssignmentPeriod(from.value, to.value);
  if (!period.ok) return period;

  const assignment: TeacherCourseAssignment = {
    id: createId("tca"),
    annualCourseId: course.id,
    teacherId: input.teacherId,
    role: input.role,
    validFrom: from.value,
    validTo: to.value,
    createdByAdminId: input.createdByAdminId,
    createdAt: timestamp,
    endedAt: null,
    overrideReason: typeGuard.value.overrideReason,
    overrideByAdminId: typeGuard.value.overrideReason ? input.createdByAdminId : null,
  };

  const existing = await deps.courses.listAssignments(course.id);
  const duplicate = findDuplicateAssignment(existing, assignment);
  if (duplicate) {
    return { ok: false, reason: "Cet enseignant a déjà une attribution qui recouvre cette période.", status: 409 };
  }

  if (assignment.role === "PRIMARY") {
    const primary = findOverlappingPrimary(existing, assignment);
    if (primary) {
      return {
        ok: false,
        reason: "Ce cours a déjà un titulaire sur cette période. Utilisez le remplacement définitif pour changer de titulaire.",
        status: 409,
        code: "PRIMARY_TAKEN",
        existing: [primary],
      };
    }
  }

  const created = await deps.courses.createAssignment(assignment);
  await appendEvent(deps, {
    annualCourseId: course.id,
    assignmentId: created.id,
    teacherId: created.teacherId,
    adminId: input.createdByAdminId,
    kind: "ASSIGNED",
    role: created.role,
    detail: created.overrideReason
      ? `Attribution ${created.role} (override : ${created.overrideReason})`
      : `Attribution ${created.role}`,
  }, timestamp);
  if (created.overrideReason) {
    await appendOverrideEvent(deps, {
      annualCourseId: course.id,
      assignmentId: created.id,
      teacherId: created.teacherId,
      adminId: input.createdByAdminId,
      role: created.role,
      reason: created.overrideReason,
    }, timestamp);
  }

  return { ok: true, value: created, warning: typeGuard.value.warning };
}

export async function replaceTeacherDefinitively(
  deps: AnnualCourseServiceDeps,
  input: {
    annualCourseId: string;
    outgoingTeacherId: string;
    incomingTeacherId: string;
    createdByAdminId: string;
    effectiveAt?: string;
    incomingRole?: AssignmentRole;
    incomingValidTo?: string | null;
    forceIncompatible?: boolean;
    overrideReason?: string | null;
  },
): Promise<CourseMutationResult<{ closed: TeacherCourseAssignment[]; created: TeacherCourseAssignment }>> {
  const course = await deps.courses.getCourse(input.annualCourseId);
  if (!course) return { ok: false, reason: "Cours annuel introuvable.", status: 404 };
  const assignableCourse = await assertCourseAssignable(deps, course);
  if (!assignableCourse.ok) return assignableCourse;

  if (input.incomingRole === "REPLACEMENT") {
    return {
      ok: false,
      reason: "Un remplaçant temporaire doit utiliser l'action dédiée, avec validFrom et validTo obligatoires.",
      status: 400,
    };
  }

  const incoming = await deps.teachers.findAccount(input.incomingTeacherId);
  const assignable = teacherIsAssignable(incoming);
  if (!assignable.ok) return assignable;

  const typeGuard = await applyTypeGuard(
    deps,
    course,
    incoming!.teachingType,
    input.forceIncompatible,
    input.overrideReason,
  );
  if (!typeGuard.ok) {
    return { ...typeGuard, code: typeGuard.status === 409 ? "TYPE_MISMATCH" : typeGuard.code };
  }

  const createdAt = nowIso();
  const effective = parseAssignmentDate(input.effectiveAt ?? createdAt, "instant");
  if (!effective.ok || !effective.value) {
    return effective.ok === false ? effective : { ok: false, reason: "Date d'effet invalide.", status: 400 };
  }
  const incomingTo = parseAssignmentDate(input.incomingValidTo ?? null, "end");
  if (!incomingTo.ok) return incomingTo;
  const period = validateAssignmentPeriod(effective.value, incomingTo.value);
  if (!period.ok) return period;

  const existing = await deps.courses.listAssignments(course.id);
  const replaced = replaceTeacherOnAnnualCourse(existing, {
    annualCourseId: input.annualCourseId,
    outgoingTeacherId: input.outgoingTeacherId,
    incomingTeacherId: input.incomingTeacherId,
    createdByAdminId: input.createdByAdminId,
    createdAt,
    effectiveAt: effective.value,
    incomingRole: input.incomingRole ?? "PRIMARY",
    incomingValidTo: incomingTo.value,
    forceIncompatible: input.forceIncompatible,
    overrideReason: typeGuard.value.overrideReason,
  });
  if (!replaced.ok) return replaced;

  for (const closed of replaced.value.closed) {
    await deps.courses.updateAssignment(closed);
    await appendEvent(deps, {
      annualCourseId: course.id,
      assignmentId: closed.id,
      teacherId: closed.teacherId,
      adminId: input.createdByAdminId,
      kind: "REPLACED",
      role: closed.role,
      detail: `Remplacement définitif par ${input.incomingTeacherId}`,
    }, createdAt);
  }
  const created = await deps.courses.createAssignment(replaced.value.created);
  await appendEvent(deps, {
    annualCourseId: course.id,
    assignmentId: created.id,
    teacherId: created.teacherId,
    adminId: input.createdByAdminId,
    kind: "ASSIGNED",
    role: created.role,
    detail: "Titulaire après remplacement définitif",
  }, createdAt);
  if (created.overrideReason) {
    await appendOverrideEvent(deps, {
      annualCourseId: course.id,
      assignmentId: created.id,
      teacherId: created.teacherId,
      adminId: input.createdByAdminId,
      role: created.role,
      reason: created.overrideReason,
    }, createdAt);
  }
  return { ok: true, value: { closed: replaced.value.closed, created }, warning: typeGuard.value.warning };
}

export async function assignTemporaryReplacement(
  deps: AnnualCourseServiceDeps,
  input: {
    annualCourseId: string;
    teacherId: string;
    createdByAdminId: string;
    validFrom: string;
    validTo: string;
    forceIncompatible?: boolean;
    overrideReason?: string | null;
  },
): Promise<CourseMutationResult<TeacherCourseAssignment>> {
  const course = await deps.courses.getCourse(input.annualCourseId);
  if (!course) return { ok: false, reason: "Cours annuel introuvable.", status: 404 };
  const assignableCourse = await assertCourseAssignable(deps, course);
  if (!assignableCourse.ok) return assignableCourse;

  if (!input.validFrom?.trim() || !input.validTo?.trim()) {
    return { ok: false, reason: "Un remplacement temporaire exige validFrom et validTo.", status: 400 };
  }

  const teacher = await deps.teachers.findAccount(input.teacherId);
  const assignable = teacherIsAssignable(teacher);
  if (!assignable.ok) return assignable;

  const typeGuard = await applyTypeGuard(
    deps,
    course,
    teacher!.teachingType,
    input.forceIncompatible,
    input.overrideReason,
  );
  if (!typeGuard.ok) {
    return { ...typeGuard, code: typeGuard.status === 409 ? "TYPE_MISMATCH" : typeGuard.code };
  }

  const createdAt = nowIso();
  const from = parseAssignmentDate(input.validFrom, "start");
  if (!from.ok || !from.value) return from.ok === false ? from : { ok: false, reason: "Date de début invalide.", status: 400 };
  const to = parseAssignmentDate(input.validTo, "end");
  if (!to.ok || !to.value) return to.ok === false ? to : { ok: false, reason: "Date de fin invalide.", status: 400 };
  const period = validateAssignmentPeriod(from.value, to.value);
  if (!period.ok) return period;

  const existing = await deps.courses.listAssignments(course.id);
  const built = buildTemporaryReplacement(existing, {
    annualCourseId: input.annualCourseId,
    teacherId: input.teacherId,
    createdByAdminId: input.createdByAdminId,
    validFrom: from.value,
    validTo: to.value,
    forceIncompatible: input.forceIncompatible,
    overrideReason: typeGuard.value.overrideReason,
  }, createdAt);
  if (!built.ok) return built;
  const created = await deps.courses.createAssignment(built.value);
  await appendEvent(deps, {
    annualCourseId: course.id,
    assignmentId: created.id,
    teacherId: created.teacherId,
    adminId: input.createdByAdminId,
    kind: "TEMPORARY_REPLACEMENT",
    role: "REPLACEMENT",
    detail: `${created.validFrom} → ${created.validTo}`,
  }, createdAt);
  if (created.overrideReason) {
    await appendOverrideEvent(deps, {
      annualCourseId: course.id,
      assignmentId: created.id,
      teacherId: created.teacherId,
      adminId: input.createdByAdminId,
      role: created.role,
      reason: created.overrideReason,
    }, createdAt);
  }
  return { ok: true, value: created, warning: typeGuard.value.warning };
}

export async function endTeacherAssignment(
  deps: AnnualCourseServiceDeps,
  assignmentId: string,
  adminId: string,
  endedAt?: string,
): Promise<CourseMutationResult<TeacherCourseAssignment>> {
  const assignment = await deps.courses.getAssignment(assignmentId);
  if (!assignment) return { ok: false, reason: "Attribution introuvable.", status: 404 };
  if (assignment.endedAt) {
    return { ok: false, reason: "Cette attribution est déjà terminée.", status: 409 };
  }
  const parsed = parseAssignmentDate(endedAt ?? nowIso(), "instant");
  if (!parsed.ok || !parsed.value) {
    return parsed.ok === false ? parsed : { ok: false, reason: "Date de fin invalide.", status: 400 };
  }
  if (parsed.value < assignment.validFrom) {
    return { ok: false, reason: "La date de fin est antérieure au début de l'attribution.", status: 400 };
  }
  const next: TeacherCourseAssignment = {
    ...assignment,
    validTo: parsed.value,
    endedAt: parsed.value,
  };
  const updated = await deps.courses.updateAssignment(next);
  await appendEvent(deps, {
    annualCourseId: assignment.annualCourseId,
    assignmentId: assignment.id,
    teacherId: assignment.teacherId,
    adminId,
    kind: "ENDED",
    role: assignment.role,
    detail: "Fin d'attribution (correction ou clôture)",
  }, nowIso());
  return { ok: true, value: updated };
}

export async function teacherMayAccessCourse(
  deps: AnnualCourseServiceDeps,
  options: {
    teacherId: string;
    annualCourseId: string;
    isAdmin?: boolean;
    isStudent?: boolean;
    at?: string;
  },
): Promise<boolean> {
  if (options.isStudent) return false;
  const [teacher, course, assignments] = await Promise.all([
    deps.teachers.findAccount(options.teacherId),
    deps.courses.getCourse(options.annualCourseId),
    deps.courses.listAssignments(options.annualCourseId),
  ]);
  return teacherCanAccessAnnualCourse({
    teacher,
    course,
    assignments,
    isAdmin: options.isAdmin,
    isStudent: options.isStudent,
    at: options.at,
  });
}

export async function contextMayBeDeleted(
  deps: AnnualCourseServiceDeps & { hasPedagogicalPath: (contextId: string) => Promise<boolean> },
  contextId: string,
): Promise<CourseMutationResult<true>> {
  const [hasPath, noteCount, courses] = await Promise.all([
    deps.hasPedagogicalPath(contextId),
    deps.notes.countByContextId(contextId),
    deps.courses.listCoursesByContextId(contextId),
  ]);
  const reason = contextDeleteBlockers({
    hasPedagogicalPath: hasPath,
    hasAnnualNotes: noteCount > 0,
    hasAnnualCourse: courses.length > 0,
  });
  if (reason) return { ok: false, reason, status: 409, code: "USED" };
  return { ok: true, value: true };
}

export function activeAssignmentsAt(
  assignments: TeacherCourseAssignment[],
  at = nowIso(),
): TeacherCourseAssignment[] {
  return assignments.filter((entry) => isAssignmentActiveAt(entry, at));
}
