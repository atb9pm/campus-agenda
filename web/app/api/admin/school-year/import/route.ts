import {
  detectAndParseSchoolYearPdf,
  isReceivableWeekPlan,
  schoolYearAlreadyExistsMessage,
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

  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return jsonResponse({ ok: false, reason: "Le plan de scolarité doit être un fichier PDF." }, { status: 400 });
  }

  const replaceDraft = String(formData.get("replaceDraft") ?? "") === "true";

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
          },
          { status: 422 },
        );
      }

      const preview = detected.official.preview;
      const imported = await store.importOfficialCalendarDraft(preview, file.name, { replaceDraft });
      return jsonResponse({
        ok: true,
        sourceKind: "official-plan",
        receivable: true,
        preview,
        draft: {
          id: imported.year.id,
          label: imported.year.label,
          status: imported.year.status,
          startsOn: imported.year.startsOn,
          endsOn: imported.year.endsOn,
          weekCount: imported.year.weeks.length,
        },
        eventCount: imported.eventCount,
        exceptionDayCount: imported.exceptionDayCount,
        replaced: imported.replaced,
      });
    }

    const plan = detected.plan;
    const existing = await store.findSchoolYearByLabel(plan.label);
    if (existing) {
      return jsonResponse(
        { ok: false, reason: schoolYearAlreadyExistsMessage(plan.label) },
        { status: 409 },
      );
    }

    const receivable = isReceivableWeekPlan(plan);
    const draft = await store.importDraftFromPlan(plan, file.name);
    return jsonResponse({
      ok: true,
      sourceKind: "week-plan",
      receivable,
      preview: {
        sourceKind: "week-plan",
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
    const status = reason.includes("existe déjà") ? 409 : 422;
    return jsonResponse({ ok: false, reason }, { status });
  }
}

export const POST = withApiObservability("/api/admin/school-year/import", handlePost);
