import { jsonResponse, requireAdminSession, getMembershipsStore } from "../../../../../lib/server/api.ts";

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = await request.json() as {
    classroomId?: string;
    outgoingTeacherId?: string;
    incomingTeacherId?: string;
    subjectIds?: string[];
    effectiveAt?: string;
  };

  const classroomId = String(body.classroomId ?? "").trim();
  const outgoingTeacherId = String(body.outgoingTeacherId ?? "").trim();
  const incomingTeacherId = String(body.incomingTeacherId ?? "").trim();
  const subjectIds = Array.isArray(body.subjectIds) ? body.subjectIds.map(String) : [];

  if (!classroomId || !outgoingTeacherId || !incomingTeacherId || subjectIds.length === 0) {
    return jsonResponse({ ok: false, reason: "Classe, enseignants et branches requis." }, { status: 400 });
  }

  const membershipStore = await getMembershipsStore();
  const result = await membershipStore.replaceTeacher({
    classroomId,
    outgoingTeacherId,
    incomingTeacherId,
    subjectIds,
    effectiveAt: body.effectiveAt,
  });

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: 400 });
  }

  return jsonResponse({
    ok: true,
    created: result.result.created,
    closedMembershipIds: result.result.closedIds,
  }, { status: 201 });
}
