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
import { checkClassroomExists, getAgendaStore, getMembershipStore, getSchoolYearStore, getTemplateStore } from "@campus/lib/persistence/store-factory.ts";
import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items.ts";
import { ARCHIVED_YEAR_READONLY_REASON, getArchivedYearIds, isArchivedYearItem } from "@campus/features/school-year/archived-readonly.ts";
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

export async function getStore() {
  return getAgendaStore();
}

export async function getTemplatesStore() {
  return getTemplateStore();
}

export async function getMembershipsStore() {
  return getMembershipStore();
}

export async function getActiveSchoolYearId(): Promise<string | null> {
  const schoolYearStore = await getSchoolYearStore();
  const active = await schoolYearStore.getActiveSchoolYear();
  return active?.id ?? null;
}

export async function getArchivedSchoolYearIds(): Promise<Set<string>> {
  const schoolYearStore = await getSchoolYearStore();
  const years = await schoolYearStore.listSchoolYears();
  return getArchivedYearIds(years);
}

export async function assertAgendaItemMutable(item: PrototypeAgendaItem | undefined): Promise<Response | null> {
  if (!item?.schoolYearId) return null;
  const archivedIds = await getArchivedSchoolYearIds();
  if (isArchivedYearItem(item, archivedIds)) {
    return jsonResponse({ ok: false, reason: ARCHIVED_YEAR_READONLY_REASON }, { status: 403 });
  }
  return null;
}

export async function requireClassroomReadAccess(request: Request, classroomId: string) {
  const session = await getRequestSession(request);
  const store = await getStore();
  if (!(await checkClassroomExists(classroomId))) {
    return { error: jsonResponse({ ok: false, reason: "Classe introuvable." }, { status: 404 }) };
  }
  if (!(await canReadClassroomAgenda(session, classroomId, store))) {
    return { error: unauthorizedResponse("Accès à cette classe non autorisé.") };
  }
  return { session, store };
}

export async function requireTeacherSession(request: Request) {
  const session = await getRequestSession(request);
  if (!canMutateAgenda(session)) {
    return { error: unauthorizedResponse() };
  }
  return { session, store: await getStore() };
}

export { forbiddenResponse, unauthorizedResponse };
