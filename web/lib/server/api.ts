import {
  buildSessionCookie,
  canMutateAgenda,
  canReadClassroomAgenda,
  clearSessionCookie,
  createSessionToken,
  forbiddenResponse,
  parseSessionToken,
  readSessionTokenFromRequest,
  unauthorizedResponse,
} from "@campus/lib/auth/index.ts";
import { classroomExists, getMemoryAgendaStore } from "@campus/lib/persistence/index.ts";
import type { AppSession } from "@campus/lib/persistence/types.ts";

export async function getRequestSession(request: Request): Promise<AppSession | null> {
  return parseSessionToken(readSessionTokenFromRequest(request));
}

export async function jsonWithSession(session: AppSession, body: unknown, init: ResponseInit = {}): Promise<Response> {
  const token = await createSessionToken(session);
  const headers = new Headers(init.headers);
  headers.append("Set-Cookie", buildSessionCookie(token));
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function logoutResponse(): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", clearSessionCookie());
  return new Response(JSON.stringify({ ok: true }), { headers });
}

export function getStore() {
  return getMemoryAgendaStore();
}

export async function requireClassroomReadAccess(request: Request, classroomId: string) {
  const session = await getRequestSession(request);
  const store = getStore();
  if (!classroomExists(classroomId)) {
    return { error: jsonResponse({ ok: false, reason: "Classe introuvable." }, { status: 404 }) };
  }
  if (!canReadClassroomAgenda(session, classroomId, store)) {
    return { error: unauthorizedResponse("Accès à cette classe non autorisé.") };
  }
  return { session, store };
}

export async function requireTeacherSession(request: Request) {
  const session = await getRequestSession(request);
  if (!canMutateAgenda(session)) {
    return { error: unauthorizedResponse() };
  }
  return { session, store: getStore() };
}

export { forbiddenResponse, unauthorizedResponse };
