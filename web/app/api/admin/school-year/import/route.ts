import { isReceivableWeekPlan, parseWeekPlanPdf } from "@campus/features/school-year";
import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
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

  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return jsonResponse({ ok: false, reason: "Le plan des semaines doit être un fichier PDF." }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const plan = await parseWeekPlanPdf(bytes);
    const receivable = isReceivableWeekPlan(plan);
    const store = await getSchoolYearStore();
    const draft = await store.importDraftFromPlan(plan, file.name);

    return jsonResponse({
      ok: true,
      receivable,
      preview: {
        label: plan.label,
        weekCount: plan.weeks.length,
        warnings: plan.warnings,
        weeks: plan.weeks,
      },
      draft: {
        id: draft.id,
        label: draft.label,
        status: draft.status,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Import PDF impossible.";
    return jsonResponse({ ok: false, reason }, { status: 422 });
  }
}

export const POST = withApiObservability("/api/admin/school-year/import", handlePost);
