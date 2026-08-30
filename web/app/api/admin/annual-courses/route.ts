import {
  archiveAnnualCourse,
  assignTeacherToCourse,
  assignTemporaryReplacement,
  createAnnualCourse,
  deleteAnnualCourse,
  endTeacherAssignment,
  ensureAnnualCourse,
  isAssignmentRole,
  replaceTeacherDefinitively,
} from "@campus/features/annual-courses/index.ts";
import {
  getAnnualCourseServiceDeps,
  jsonResponse,
  requireAdminSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const deps = await getAnnualCourseServiceDeps();
  const [courses, assignments, events, classes, branches, professions, contexts, teachers] =
    await Promise.all([
      deps.courses.listCourses(),
      deps.courses.listAssignments(),
      deps.courses.listEvents(),
      deps.catalog.listClasses(),
      deps.catalog.listBranches(),
      deps.catalog.listProfessions(),
      deps.catalog.listContexts(),
      deps.teachers.listAccounts(),
    ]);

  return jsonResponse({
    ok: true,
    courses,
    assignments,
    events,
    classes,
    branches,
    professions,
    contexts,
    teachers: teachers.map((teacher) => ({
      id: teacher.id,
      displayName: teacher.displayName,
      initials: teacher.initials,
      isActive: teacher.isActive,
      isArchived: teacher.isArchived,
      teachingType: teacher.teachingType,
    })),
  });
}

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const adminId = auth.session!.teacherId;
  const deps = await getAnnualCourseServiceDeps();
  const body = (await request.json()) as {
    action?: string;
    schoolYearId?: string;
    classId?: string;
    contextId?: string;
    annualCourseId?: string;
    teacherId?: string;
    outgoingTeacherId?: string;
    incomingTeacherId?: string;
    role?: string;
    validFrom?: string;
    validTo?: string | null;
    effectiveAt?: string;
    forceIncompatible?: boolean;
    overrideReason?: string | null;
    assignmentId?: string;
    ensure?: boolean;
  };

  const action = body.action ?? "create";

  if (action === "create") {
    const input = {
      schoolYearId: String(body.schoolYearId ?? ""),
      classId: String(body.classId ?? ""),
      contextId: String(body.contextId ?? ""),
    };
    const result = body.ensure
      ? await ensureAnnualCourse(deps, input)
      : await createAnnualCourse(deps, input);
    if (!result.ok) return jsonResponse({ ok: false, reason: result.reason, code: result.code }, { status: result.status ?? 400 });
    return jsonResponse({ ok: true, course: result.value }, { status: 201 });
  }

  if (action === "archive") {
    const result = await archiveAnnualCourse(deps, String(body.annualCourseId ?? ""));
    if (!result.ok) return jsonResponse({ ok: false, reason: result.reason }, { status: result.status ?? 400 });
    return jsonResponse({ ok: true, course: result.value });
  }

  if (action === "delete") {
    const result = await deleteAnnualCourse(deps, String(body.annualCourseId ?? ""));
    if (!result.ok) {
      return jsonResponse({ ok: false, reason: result.reason, code: result.code }, { status: result.status ?? 400 });
    }
    return jsonResponse({ ok: true, id: result.value.id });
  }

  if (action === "assign") {
    if (!isAssignmentRole(body.role)) {
      return jsonResponse({ ok: false, reason: "Rôle invalide." }, { status: 400 });
    }
    const result = await assignTeacherToCourse(deps, {
      annualCourseId: String(body.annualCourseId ?? ""),
      teacherId: String(body.teacherId ?? ""),
      role: body.role,
      validFrom: body.validFrom,
      validTo: body.validTo,
      createdByAdminId: adminId,
      forceIncompatible: Boolean(body.forceIncompatible),
      overrideReason: body.overrideReason,
    });
    if (!result.ok) {
      return jsonResponse(
        { ok: false, reason: result.reason, code: result.code, existing: result.existing },
        { status: result.status ?? 400 },
      );
    }
    return jsonResponse({ ok: true, assignment: result.value, warning: result.warning }, { status: 201 });
  }

  if (action === "replace") {
    const result = await replaceTeacherDefinitively(deps, {
      annualCourseId: String(body.annualCourseId ?? ""),
      outgoingTeacherId: String(body.outgoingTeacherId ?? ""),
      incomingTeacherId: String(body.incomingTeacherId ?? ""),
      createdByAdminId: adminId,
      effectiveAt: body.effectiveAt,
      incomingRole: isAssignmentRole(body.role) ? body.role : "PRIMARY",
      forceIncompatible: Boolean(body.forceIncompatible),
      overrideReason: body.overrideReason,
    });
    if (!result.ok) {
      return jsonResponse({ ok: false, reason: result.reason, code: result.code }, { status: result.status ?? 400 });
    }
    return jsonResponse({ ok: true, created: result.value.created, closed: result.value.closed, warning: result.warning }, { status: 201 });
  }

  if (action === "temporary") {
    const result = await assignTemporaryReplacement(deps, {
      annualCourseId: String(body.annualCourseId ?? ""),
      teacherId: String(body.teacherId ?? ""),
      createdByAdminId: adminId,
      validFrom: String(body.validFrom ?? ""),
      validTo: String(body.validTo ?? ""),
      forceIncompatible: Boolean(body.forceIncompatible),
      overrideReason: body.overrideReason,
    });
    if (!result.ok) {
      return jsonResponse({ ok: false, reason: result.reason, code: result.code }, { status: result.status ?? 400 });
    }
    return jsonResponse({ ok: true, assignment: result.value, warning: result.warning }, { status: 201 });
  }

  if (action === "end") {
    const result = await endTeacherAssignment(
      deps,
      String(body.assignmentId ?? ""),
      adminId,
      body.effectiveAt,
    );
    if (!result.ok) return jsonResponse({ ok: false, reason: result.reason }, { status: result.status ?? 400 });
    return jsonResponse({ ok: true, assignment: result.value });
  }

  return jsonResponse({ ok: false, reason: "Action inconnue." }, { status: 400 });
}

export const GET = withApiObservability("/api/admin/annual-courses", handleGet);
export const POST = withApiObservability("/api/admin/annual-courses", handlePost);
