import { jsonResponse, requireAdminSession, getMembershipsStore } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const url = new URL(request.url);
  const classroomId = url.searchParams.get("classroomId")?.trim() || undefined;

  const membershipStore = await getMembershipsStore();
  const memberships = await membershipStore.listMemberships(classroomId);

  return jsonResponse({ ok: true, memberships });
}

export const GET = withApiObservability("/api/admin/memberships", handleGet);
