import { filterSlotsForCourseDay, groupSlotsByBranch, normalizeBranchLabel } from "@campus/features/timetable";
import { resolveClassroomIdForClassCode, resolveDemoTeacherCode } from "@campus/features/timetable/demo-mappings.ts";
import { getTimetableStore } from "@campus/lib/persistence/store-factory.ts";
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

  const teacherCode = resolveDemoTeacherCode(auth.session!.teacherId);
  let slots = classCodes.flatMap((classCode) =>
    filterSlotsForCourseDay(allSlots, classCode, dayOfWeek, weekKind),
  );

  if (teacherCode) {
    slots = slots.filter((slot) => !slot.teacherCode || slot.teacherCode.toLowerCase() === teacherCode.toLowerCase());
  }

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
