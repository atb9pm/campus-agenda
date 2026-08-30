import {
  getTeacherAccountsStore,
  jsonResponse,
  requireAdminSession,
} from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function handlePatch(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await context.params;
  const body = (await request.json()) as {
    displayName?: string;
    initials?: string;
    isAdmin?: boolean;
    isActive?: boolean;
    isArchived?: boolean;
    teachingType?: "TECHNICAL" | "GENERAL" | null;
  };

  // Se retirer soi-même l'administration, se désactiver ou s'archiver couperait l'accès.
  const selfId = auth.session!.teacherId;
  if (
    id === selfId
    && (body.isAdmin === false || body.isActive === false || body.isArchived === true)
  ) {
    return jsonResponse(
      { ok: false, reason: "Vous ne pouvez pas retirer votre propre accès administrateur." },
      { status: 400 },
    );
  }

  const accounts = await getTeacherAccountsStore();
  const result = await accounts.updateAccount(id, {
    displayName: body.displayName,
    initials: body.initials,
    isAdmin: body.isAdmin,
    isActive: body.isActive,
    isArchived: body.isArchived,
    teachingType: body.teachingType,
  });
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }
  return jsonResponse({ ok: true, teacher: result.account });
}

export const PATCH = withApiObservability("/api/admin/teachers/[id]", handlePatch);
