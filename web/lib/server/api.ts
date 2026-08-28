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
import { checkClassroomExists, getAgendaStore, getMembershipStore, getSchoolCatalogStore, getSchoolYearStore, getTeacherAccountStore, getTeacherSetupStore, getTemplateStore } from "@campus/lib/persistence/store-factory.ts";
import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items.ts";
import { ARCHIVED_YEAR_READONLY_REASON, getArchivedYearIds, isArchivedYearItem } from "@campus/features/school-year/archived-readonly.ts";
import type { AppSession } from "@campus/lib/persistence/types.ts";

export async function getRequestSession(request: Request): Promise<AppSession | null> {
  return parseSessionToken(readSessionTokenFromRequest(request));
}

export async function jsonWithSession(
  session: AppSession,
  body: unknown,
  init: ResponseInit = {},
  remember = false,
): Promise<Response> {
  const token = await createSessionToken(session, remember);
  const headers = new Headers(init.headers);
  headers.append("Set-Cookie", buildSessionCookie(token, remember));
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

export async function getCatalogStore() {
  return getSchoolCatalogStore();
}

export async function getTeacherAccountsStore() {
  return getTeacherAccountStore();
}

export async function getTeacherSetupsStore() {
  return getTeacherSetupStore();
}

/** Message unique côté client pour déclencher l'écran de changement obligatoire. */
export const PASSWORD_CHANGE_REQUIRED_REASON =
  "Changement de mot de passe requis avant d'utiliser Campus Agenda.";

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

/** Session enseignant sans contrôle du mot de passe provisoire. */
async function requireTeacherIdentity(request: Request) {
  const session = await getRequestSession(request);
  if (!canMutateAgenda(session)) {
    return { error: unauthorizedResponse() };
  }
  return { session, store: await getStore() };
}

export async function requireTeacherSession(request: Request) {
  const auth = await requireTeacherIdentity(request);
  if ("error" in auth && auth.error) return auth;

  // Un mot de passe provisoire ne donne accès qu'à son propre changement.
  const accounts = await getTeacherAccountsStore();
  if (await accounts.mustChangePassword(auth.session!.teacherId)) {
    return {
      error: jsonResponse(
        { ok: false, reason: PASSWORD_CHANGE_REQUIRED_REASON, passwordChangeRequired: true },
        { status: 403 },
      ),
    };
  }
  return auth;
}

/** Utilisée par la route de changement de mot de passe uniquement. */
export async function requireTeacherSessionAllowingPasswordChange(request: Request) {
  return requireTeacherIdentity(request);
}

export async function requireAdminSession(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth;
  const isAdmin = await auth.store!.teacherIsAdmin(auth.session!.teacherId);
  if (!isAdmin) {
    return { error: forbiddenResponse("Accès administrateur requis.") };
  }
  return auth;
}

export { forbiddenResponse, unauthorizedResponse };
