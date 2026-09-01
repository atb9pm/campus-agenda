import {
  buildSessionCookie,
  canMutateAgenda,
  canReadClassroomAgenda,
  clearSessionCookie,
  createSessionToken,
  forbiddenResponse,
  parseSessionToken,
  readSessionTokenFromRequest,
  revalidateLiveSession,
  unauthorizedResponse,
} from "@campus/lib/auth/index.ts";
import { checkClassroomExists, getAgendaStore, getAnnualCourseNotesStore, getAnnualCourseStore, getCourseScheduleStore, getMembershipStore, getPedagogicalPathStore, getSchoolCatalogStore, getSchoolYearStore, getTeacherAccountStore, getTeacherNotesStore as resolveTeacherNotesStore, getTeacherSetupStore, getTemplateStore, resolveClassroomSubjectNames } from "@campus/lib/persistence/store-factory.ts";
import { decideAgendaPublishAccess, resolveAnnualCourseForPublication } from "@campus/features/annual-courses/index.ts";
import { validateAgendaScheduleTarget } from "@campus/features/agenda/schedule-target.ts";
import type { AnnualCourseServiceDeps } from "@campus/features/annual-courses/index.ts";
import type { CourseScheduleServiceDeps } from "@campus/features/course-schedule/index.ts";
import type { CourseTimelineServiceDeps } from "@campus/features/course-timeline/index.ts";
import { evaluateAgendaBranchForClass, assertAgendaClassMutable } from "@campus/features/school-catalog/index.ts";
import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items.ts";
import { ARCHIVED_YEAR_READONLY_REASON, getArchivedYearIds, isArchivedYearItem } from "@campus/features/school-year/archived-readonly.ts";
import type { AppSession } from "@campus/lib/persistence/types.ts";

export async function getRequestSession(request: Request): Promise<AppSession | null> {
  const parsed = await parseSessionToken(readSessionTokenFromRequest(request));
  if (!parsed) return null;
  const accounts = await getTeacherAccountStore();
  const store = await getAgendaStore();
  return revalidateLiveSession(parsed, {
    findAccount: (teacherId) => accounts.findAccount(teacherId),
    findStudentAccessById: (accessId) => store.findStudentAccessById(accessId),
  });
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

export async function getTeacherNotesStore() {
  return resolveTeacherNotesStore();
}

export async function getPathStore() {
  return getPedagogicalPathStore();
}

export async function getCourseNotesStore() {
  return getAnnualCourseNotesStore();
}

export async function getCourseStore() {
  return getAnnualCourseStore();
}

export async function getAnnualCourseServiceDeps(): Promise<AnnualCourseServiceDeps> {
  const [courses, catalog, years, teachers, notes, schedules] = await Promise.all([
    getAnnualCourseStore(),
    getSchoolCatalogStore(),
    getSchoolYearStore(),
    getTeacherAccountStore(),
    getAnnualCourseNotesStore(),
    getCourseScheduleStore(),
  ]);
  return { courses, catalog, years, teachers, notes, schedules };
}

export async function getCourseScheduleServiceDeps(): Promise<CourseScheduleServiceDeps> {
  const [schedules, courses, catalog, years, teachers] = await Promise.all([
    getCourseScheduleStore(),
    getAnnualCourseStore(),
    getSchoolCatalogStore(),
    getSchoolYearStore(),
    getTeacherAccountStore(),
  ]);
  return { schedules, courses, catalog, years, teachers };
}

export async function getCourseTimelineServiceDeps(): Promise<CourseTimelineServiceDeps> {
  const [schedules, courses, catalog, years, teachers, paths] = await Promise.all([
    getCourseScheduleStore(),
    getAnnualCourseStore(),
    getSchoolCatalogStore(),
    getSchoolYearStore(),
    getTeacherAccountStore(),
    getPedagogicalPathStore(),
  ]);
  return { schedules, courses, catalog, years, teachers, paths };
}

export async function authorizeTeacherAgendaPublish(
  teacherId: string,
  classroomId: string,
  subjectId: string,
  store: { teacherCanPublish(teacherId: string, classroomId: string, subjectId: string): Promise<boolean> },
  schoolYearId?: string | null,
): Promise<boolean> {
  const names = await resolveClassroomSubjectNames(classroomId, subjectId);
  const catalog = await getSchoolCatalogStore();
  await catalog.ensureSeeded();
  const [classes, branches, contexts, courses, assignments, teacher] = await Promise.all([
    catalog.listClasses(),
    catalog.listBranches(),
    catalog.listContexts(),
    getAnnualCourseStore().then((entry) => entry.listCourses()),
    getAnnualCourseStore().then((entry) => entry.listAssignments()),
    getTeacherAccountStore().then((entry) => entry.findAccount(teacherId)),
  ]);
  const resolved = resolveAnnualCourseForPublication({
    classroomName: names.classroomName,
    subjectName: names.subjectName,
    classes,
    branches,
    contexts,
    courses,
    schoolYearId,
  });
  const legacyMembershipAllows = resolved
    ? false
    : await store.teacherCanPublish(teacherId, classroomId, subjectId);
  return decideAgendaPublishAccess({
    resolved,
    teacher,
    assignments,
    legacyMembershipAllows,
  });
}

/** Message unique côté client pour déclencher l'écran de changement obligatoire. */
export const PASSWORD_CHANGE_REQUIRED_REASON =
  "Changement de mot de passe requis avant d'utiliser Campus Agenda.";

export async function getActiveSchoolYear() {
  const schoolYearStore = await getSchoolYearStore();
  return schoolYearStore.getActiveSchoolYear();
}

export async function getActiveSchoolYearId(): Promise<string | null> {
  const active = await getActiveSchoolYear();
  return active?.id ?? null;
}

/**
 * Semaine + jour d'une publication : année scolaire réelle, puis
 * CourseScheduleSlot / ClassAttendanceDay si résolus, sinon fallback TMA isolé.
 */
export async function assertValidAgendaScheduleTarget(options: {
  classroomId: string;
  subjectId: string;
  schoolWeekNumber: number;
  dayIndex: number;
  schoolYearId?: string | null;
}): Promise<Response | null> {
  const yearStore = await getSchoolYearStore();
  const year = options.schoolYearId
    ? await yearStore.getSchoolYearById(options.schoolYearId)
    : await yearStore.getActiveSchoolYear();
  if (!year) {
    return jsonResponse({ ok: false, reason: "Aucune année scolaire active." }, { status: 400 });
  }

  const names = await resolveClassroomSubjectNames(options.classroomId, options.subjectId);
  const catalog = await getSchoolCatalogStore();
  await catalog.ensureSeeded();
  const [classes, branches, contexts, courses, scheduleStore] = await Promise.all([
    catalog.listClasses(),
    catalog.listBranches(),
    catalog.listContexts(),
    getAnnualCourseStore().then((entry) => entry.listCourses()),
    getCourseScheduleStore(),
  ]);
  const resolved = resolveAnnualCourseForPublication({
    classroomName: names.classroomName,
    subjectName: names.subjectName,
    classes,
    branches,
    contexts,
    courses,
    schoolYearId: year.id,
  });

  let attendanceDays = null;
  let slots = null;
  if (resolved) {
    attendanceDays = await scheduleStore.listAttendanceDaysByClass(resolved.schoolClass.id);
    slots = await scheduleStore.listSlotsByAnnualCourse(resolved.course.id);
  }

  const result = validateAgendaScheduleTarget({
    schoolWeekNumber: options.schoolWeekNumber,
    dayIndex: options.dayIndex,
    weeks: year.weeks,
    attendanceDays,
    slots,
    resolvedStructuredCourse: Boolean(resolved),
  });
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: 400 });
  }
  return null;
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

export async function assertAgendaClassMutableForItem(
  item: PrototypeAgendaItem | undefined,
): Promise<Response | null> {
  if (!item) return null;
  const names = await resolveClassroomSubjectNames(item.classroomId, item.subjectId);
  const catalog = await getSchoolCatalogStore();
  await catalog.ensureSeeded();
  const result = assertAgendaClassMutable({
    classroomName: names.classroomName,
    schoolYearId: item.schoolYearId,
    classes: await catalog.listClasses(),
  });
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: 403 });
  }
  return null;
}


export async function assertAgendaPublicationBranchAllowed(
  classroomId: string,
  subjectId: string,
  schoolYearId?: string | null,
  purpose: "create" | "update" = "create",
): Promise<Response | null> {
  const names = await resolveClassroomSubjectNames(classroomId, subjectId);
  const catalog = await getSchoolCatalogStore();
  await catalog.ensureSeeded();
  const [classes, branches, contexts] = await Promise.all([
    catalog.listClasses(),
    catalog.listBranches(),
    catalog.listContexts(),
  ]);
  const result = evaluateAgendaBranchForClass({
    classroomName: names.classroomName,
    subjectName: names.subjectName,
    classes,
    branches,
    contexts,
    schoolYearId,
    purpose,
  });
  if (!result.ok) {
    return forbiddenResponse(result.reason);
  }
  return null;
}

export async function listAttendanceDaysForLegacyClassroom(classroomId: string) {
  const names = await resolveClassroomSubjectNames(classroomId, "");
  const catalog = await getSchoolCatalogStore();
  await catalog.ensureSeeded();
  const classes = await catalog.listClasses();
  const name = names.classroomName;
  const schoolClass = name
    ? classes.find((entry) => entry.label === name || entry.code === name) ?? null
    : null;
  if (!schoolClass) return [];
  const schedules = await getCourseScheduleStore();
  return schedules.listAttendanceDaysByClass(schoolClass.id);
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
