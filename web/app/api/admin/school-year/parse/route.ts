import {
  detectAndParseSchoolYearPdf,
  formatSchoolYearLabelFr,
  isReceivableWeekPlan,
} from "@campus/features/school-year";
import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
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
    const detected = await detectAndParseSchoolYearPdf(bytes);
    const store = await getSchoolYearStore();

    if (detected.sourceKind === "official-plan") {
      if (!detected.official.ok) {
        return jsonResponse(
          {
            ok: false,
            sourceKind: "official-plan",
            receivable: false,
            reason: detected.official.errors[0] ?? "Plan de scolarité illisible.",
            errors: detected.official.errors,
            warnings: detected.official.warnings,
            preview: detected.official.preview ?? null,
          },
          { status: 422 },
        );
      }

      const preview = detected.official.preview;
      const existing = await store.findSchoolYearByLabel(preview.label);
      return jsonResponse({
        ok: true,
        sourceKind: "official-plan",
        receivable: true,
        preview,
        existingYear: existing
          ? { id: existing.id, label: formatSchoolYearLabelFr(existing.label), status: existing.status }
          : null,
      });
    }

    const plan = detected.plan;
    return jsonResponse({
      ok: true,
      sourceKind: "week-plan",
      receivable: isReceivableWeekPlan(plan),
      preview: {
        sourceKind: "week-plan",
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
