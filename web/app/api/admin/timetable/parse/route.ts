import { isReceivableTimetable, parseTimetablePdf } from "@campus/features/timetable";
import { jsonResponse, requireTeacherSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function handlePost(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ ok: false, reason: "Fichier PDF requis (champ « file »)." }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseTimetablePdf(bytes);
    return jsonResponse({
      ok: true,
      receivable: isReceivableTimetable(parsed),
      preview: {
        schoolYearLabel: parsed.schoolYearLabel,
        sourceVersion: parsed.sourceVersion,
        slotCount: parsed.slots.length,
        classCount: parsed.classes.length,
        excludedSpsCount: parsed.excludedSpsCount,
        warnings: parsed.warnings,
        classes: parsed.classes.slice(0, 30),
        sampleSlots: parsed.slots.filter((slot) => slot.classCode === "COND1" || slot.classCode === "MMA1A").slice(0, 20),
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Analyse PDF impossible.";
    return jsonResponse({ ok: false, reason }, { status: 422 });
  }
}

export const POST = withApiObservability("/api/admin/timetable/parse", handlePost);
