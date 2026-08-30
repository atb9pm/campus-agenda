import type { AnnualCourseNotesStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
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
import { buildTemporaryReplacement, replaceTeacherOnAnnualCourse } from "./replace.ts";
import type {
  AnnualCourse,
  AnnualCourseInput,
  AssignmentRole,
  CourseMutationResult,
  TeacherCourseAssignment,
  TeacherCourseAssignmentEvent,
  TeacherCourseAssignmentInput,
} from "./types.ts";
import { validateAnnualCourseInput } from "./validation.ts";

export interface AnnualCourseServiceDeps {
  courses: AnnualCourseStore;
  catalog: SchoolCatalogStore;
  years: SchoolYearStore;
  teachers: TeacherAccountStore;
  notes: AnnualCourseNotesStore;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeInstant(value: string | undefined, fallback: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  return raw;
}

function normalizeInclusiveEnd(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T23:59:59.999Z`;
  return raw;
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

async function branchTypeForCourse(
  deps: AnnualCourseServiceDeps,
  course: AnnualCourse,
): Promise<"TECHNICAL" | "GENERAL" | null> {
  const [contexts, branches] = await Promise.all([deps.catalog.listContexts(), deps.catalog.listBranches()]);
  const context = contexts.find((entry) => entry.id === course.contextId);
  if (!context) return null;
  return branches.find((entry) => entry.id === context.branchId)?.teachingType ?? null;
}

export async function createAnnualCourse(
  deps: AnnualCourseServiceDeps,
  input: AnnualCourseInput,
): Promise<CourseMutationResult<AnnualCourse>> {
  const years = await deps.years.listSchoolYears();
  const classes = await deps.catalog.listClasses();
  const contexts = await deps.catalog.listContexts();
  const schoolClass = classes.find((entry) => entry.id === input.classId) ?? null;
  const context = contexts.find((entry) => entry.id === input.contextId) ?? null;
  const validated = validateAnnualCourseInput({ input, years, schoolClass, context });
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
    return { ok: false, reason: "Ce cours annuel est archivé.", status: 409 };
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
  const blocker = annualCourseDeleteBlockers({
    assignmentCount: assignments.length,
    noteCount: notes.length,
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
    return { ok: false, reason: "Rôle invalide (PRIMARY, CO_TEACHER ou REPLACEMENT).", status: 400 };
  }

  const course = await deps.courses.getCourse(input.annualCourseId);
  if (!course) return { ok: false, reason: "Cours annuel introuvable.", status: 404 };
  if (course.isArchived) return { ok: false, reason: "Ce cours annuel est archivé.", status: 409 };

  const teacher = await deps.teachers.findAccount(input.teacherId);
  const assignable = teacherIsAssignable(teacher);
  if (!assignable.ok) return assignable;

  const branchType = await branchTypeForCourse(deps, course);
  const typeGuard = evaluateTeachingTypeGuard({
    branchType,
    teacherType: teacher!.teachingType,
    forceIncompatible: input.forceIncompatible,
  });
  if (!typeGuard.ok) {
    return { ...typeGuard, code: "TYPE_MISMATCH" };
  }

  const timestamp = nowIso();
  const validFrom = normalizeInstant(input.validFrom, timestamp);
  const validTo = normalizeInclusiveEnd(input.validTo);
  const assignment: TeacherCourseAssignment = {
    id: createId("tca"),
    annualCourseId: course.id,
    teacherId: input.teacherId,
    role: input.role,
    validFrom,
    validTo,
    createdByAdminId: input.createdByAdminId,
    createdAt: timestamp,
    endedAt: null,
    overrideReason: input.forceIncompatible ? (input.overrideReason?.trim() || "Forçage administrateur") : null,
    overrideByAdminId: input.forceIncompatible ? input.createdByAdminId : null,
  };

  const existing = await deps.courses.listAssignments(course.id);
  const duplicate = findDuplicateAssignment(existing, assignment);
  if (duplicate) {
    return { ok: false, reason: "Cet enseignant a déjà une attribution active sur ce cours.", status: 409 };
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
    kind: created.role === "REPLACEMENT" ? "TEMPORARY_REPLACEMENT" : "ASSIGNED",
    role: created.role,
    detail: created.overrideReason
      ? `Attribution ${created.role} (override : ${created.overrideReason})`
      : `Attribution ${created.role}`,
  }, timestamp);
  if (created.overrideReason) {
    await appendEvent(deps, {
      annualCourseId: course.id,
      assignmentId: created.id,
      teacherId: created.teacherId,
      adminId: input.createdByAdminId,
      kind: "OVERRIDE",
      role: created.role,
      detail: created.overrideReason,
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
    forceIncompatible?: boolean;
    overrideReason?: string | null;
  },
): Promise<CourseMutationResult<{ closed: TeacherCourseAssignment[]; created: TeacherCourseAssignment }>> {
  const course = await deps.courses.getCourse(input.annualCourseId);
  if (!course) return { ok: false, reason: "Cours annuel introuvable.", status: 404 };
  if (course.isArchived) return { ok: false, reason: "Ce cours annuel est archivé.", status: 409 };

  const incoming = await deps.teachers.findAccount(input.incomingTeacherId);
  const assignable = teacherIsAssignable(incoming);
  if (!assignable.ok) return assignable;

  const branchType = await branchTypeForCourse(deps, course);
  const typeGuard = evaluateTeachingTypeGuard({
    branchType,
    teacherType: incoming!.teachingType,
    forceIncompatible: input.forceIncompatible,
  });
  if (!typeGuard.ok) return { ...typeGuard, code: "TYPE_MISMATCH" };

  const existing = await deps.courses.listAssignments(course.id);
  const replaced = replaceTeacherOnAnnualCourse(existing, {
    ...input,
    incomingRole: input.incomingRole ?? "PRIMARY",
    overrideReason: input.forceIncompatible
      ? (input.overrideReason?.trim() || "Forçage administrateur")
      : null,
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
    });
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
  });
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
  if (course.isArchived) {
    return { ok: false, reason: "Ce cours annuel est archivé.", status: 409 };
  }

  const teacher = await deps.teachers.findAccount(input.teacherId);
  const assignable = teacherIsAssignable(teacher);
  if (!assignable.ok) return assignable;

  const branchType = await branchTypeForCourse(deps, course);
  const typeGuard = evaluateTeachingTypeGuard({
    branchType,
    teacherType: teacher!.teachingType,
    forceIncompatible: input.forceIncompatible,
  });
  if (!typeGuard.ok) return { ...typeGuard, code: "TYPE_MISMATCH" };

  const existing = await deps.courses.listAssignments(course.id);
  const built = buildTemporaryReplacement(existing, {
    ...input,
    validFrom: normalizeInstant(input.validFrom, nowIso()),
    validTo: normalizeInclusiveEnd(input.validTo) ?? input.validTo,
    overrideReason: input.forceIncompatible
      ? (input.overrideReason?.trim() || "Forçage administrateur")
      : null,
  });
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
  });
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
  const at = normalizeInclusiveEnd(endedAt) ?? nowIso();
  const next: TeacherCourseAssignment = {
    ...assignment,
    validTo: at,
    endedAt: at,
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
  }, at);
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
