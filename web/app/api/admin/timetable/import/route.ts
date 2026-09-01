import { parseTimetablePdf } from "@campus/features/timetable";
import { resolveClassroomIdForClassCode } from "@campus/features/timetable/demo-mappings.ts";
import { getTimetableStore } from "@campus/lib/persistence/store-factory.ts";
import { getActiveSchoolYearId, jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ ok: false, reason: "Fichier PDF requis (champ « file »)." }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseTimetablePdf(bytes);
    const timetableStore = await getTimetableStore();
    const schoolYearId = await getActiveSchoolYearId();
    const { importRecord } = await timetableStore.importTimetable(parsed, file.name, schoolYearId);

    for (const summary of parsed.classes) {
      const classroomId = resolveClassroomIdForClassCode(summary.classCode);
      if (classroomId) {
        await timetableStore.mapClassToClassroom(importRecord.id, summary.classCode, classroomId);
      }
    }

    const activated = await timetableStore.activateImport(importRecord.id);
    return jsonResponse({
      ok: true,
      import: activated,
      slotCount: parsed.slots.length,
      classCount: parsed.classes.length,
      excludedSpsCount: parsed.excludedSpsCount,
      warnings: parsed.warnings,
    }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Import impossible.";
    return jsonResponse({ ok: false, reason }, { status: 422 });
  }
}

export const POST = withApiObservability("/api/admin/timetable/import", handlePost);
