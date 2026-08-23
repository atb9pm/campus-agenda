import { isReceivableWeekPlan, parseWeekPlanPdf } from "@campus/features/school-year";
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
    const plan = await parseWeekPlanPdf(bytes);
    return jsonResponse({
      ok: true,
      receivable: isReceivableWeekPlan(plan),
      preview: {
        label: plan.label,
        weekCount: plan.weeks.length,
        warnings: plan.warnings,
        weeks: plan.weeks,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Analyse PDF impossible.";
    return jsonResponse({ ok: false, reason }, { status: 422 });
  }
}

export const POST = withApiObservability("/api/admin/school-year/parse", handlePost);
