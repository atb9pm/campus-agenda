import type { AppSession } from "../persistence/types.ts";
import type { AgendaStore } from "../persistence/types.ts";

export function canReadClassroomAgenda(session: AppSession | null, classroomId: string, store: AgendaStore): boolean {
  if (!session) return false;
  if (session.kind === "student") return session.classroomId === classroomId;
  return store.teacherCanAccessClassroom(session.teacherId, classroomId);
}

export function canMutateAgenda(session: AppSession | null): session is Extract<AppSession, { kind: "teacher" }> {
  return session?.kind === "teacher";
}

export function unauthorizedResponse(reason = "Authentification requise."): Response {
  return Response.json({ ok: false, reason }, { status: 401 });
}

export function forbiddenResponse(reason = "Accès refusé."): Response {
  return Response.json({ ok: false, reason }, { status: 403 });
}
