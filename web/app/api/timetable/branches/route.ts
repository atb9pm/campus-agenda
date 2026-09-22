import { listAccessibleRuntimeClassroomsForTeacher } from "@campus/features/control-planning/index.ts";
import { filterSlotsForCourseDay, groupSlotsByBranch, normalizeBranchLabel } from "@campus/features/timetable";
import { resolveClassroomIdForClassCode } from "@campus/features/timetable/demo-mappings.ts";
import {
  checkClassroomExists,
  getAnnualCourseStore,
  getSchoolCatalogStore,
  getSchoolYearStore,
  getTimetableStore,
  listRuntimeClassrooms,
} from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireTeacherSession } from "../../../../lib/server/api.ts";

export async function GET(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const url = new URL(request.url);
  const classroomId = url.searchParams.get("classroomId")?.trim();
  const dayOfWeek = Number(url.searchParams.get("dayOfWeek"));
  const weekKind = url.searchParams.get("weekKind")?.trim() as "A" | "B" | undefined;

  if (!classroomId || !Number.isFinite(dayOfWeek) || (weekKind !== "A" && weekKind !== "B")) {
    return jsonResponse({ ok: false, reason: "Paramètres classroomId, dayOfWeek et weekKind requis." }, { status: 400 });
  }

  const exists = await checkClassroomExists(classroomId);
  if (!exists) {
    return jsonResponse({ ok: false, reason: "Classe introuvable." }, { status: 404 });
  }

  const catalog = await getSchoolCatalogStore();
  await catalog.ensureSeeded();
  const [classrooms, classes, courses, assignments, years] = await Promise.all([
    listRuntimeClassrooms(),
    catalog.listClasses(),
    getAnnualCourseStore().then((entry) => entry.listCourses()),
    getAnnualCourseStore().then((entry) => entry.listAssignments()),
    getSchoolYearStore().then((entry) => entry.listSchoolYears()),
  ]);
  const accessible = await listAccessibleRuntimeClassroomsForTeacher({
    teacherId: auth.session!.teacherId,
    classrooms,
    classes,
    courses,
    assignments,
    years,
    teacherCanAccessClassroom: (id, targetId) => auth.store!.teacherCanAccessClassroom(id, targetId),
  });
  if (!accessible.some((entry) => entry.id === classroomId)) {
    return jsonResponse({ ok: false, reason: "Accès refusé." }, { status: 403 });
  }

  const timetableStore = await getTimetableStore();
  const active = await timetableStore.getActiveImport();
  if (!active) {
    return jsonResponse({ ok: true, branches: [], periods: [], source: null });
  }

  const allSlots = await timetableStore.listActiveSlots();
  const classCodes = [...new Set(allSlots.map((slot) => slot.classCode))]
    .filter((code) => resolveClassroomIdForClassCode(code) === classroomId);

  if (classCodes.length === 0) {
    return jsonResponse({ ok: true, branches: [], periods: [], source: active });
  }

  // Enseignant affecté : grille de la classe entière (pas un mapping démo teacherCode).
  const slots = classCodes.flatMap((classCode) =>
    filterSlotsForCourseDay(allSlots, classCode, dayOfWeek, weekKind),
  );

  const grouped = groupSlotsByBranch(slots);
  const branches = [...grouped.entries()].map(([branchLabel, branchSlots]) => ({
    branchLabel,
    displayName: normalizeBranchLabel(branchLabel),
    periods: branchSlots.map((slot) => slot.period).sort((left, right) => left - right),
    periodCount: branchSlots.length,
    teacherCode: branchSlots[0]?.teacherCode ?? null,
  }));

  return jsonResponse({
    ok: true,
    source: { id: active.id, schoolYearLabel: active.schoolYearLabel, importedAt: active.importedAt },
    branches,
    periods: slots.map((slot) => slot.period).sort((left, right) => left - right),
  });
}
