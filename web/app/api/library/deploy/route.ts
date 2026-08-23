import type { TemplateDeploymentInput } from "@campus/features/library/types.ts";
import { jsonResponse, requireTeacherSession, getActiveSchoolYearId, getTemplatesStore } from "../../../../lib/server/api.ts";

export async function POST(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = await request.json() as { deployments?: TemplateDeploymentInput[] };
  const deployments = body.deployments;
  if (!Array.isArray(deployments) || deployments.length === 0) {
    return jsonResponse({ ok: false, reason: "Aucun modèle à déployer." }, { status: 400 });
  }

  const activeSchoolYearId = await getActiveSchoolYearId();
  const templateStore = await getTemplatesStore();
  const result = await templateStore.deployTemplates(auth.session!.teacherId, deployments, activeSchoolYearId);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true, created: result.created }, { status: 201 });
}
