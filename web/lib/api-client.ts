import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items.ts";
import type { TeacherAccountRecord } from "@campus/features/teacher-accounts";
import type { TeacherSetupConfig } from "@campus/features/teacher-setup";
import type { TeacherCourseWorkspaceEntry } from "@campus/features/teacher-workspace";
import type {
  CourseTimelineProjection,
  TeacherCourseTimelineCourse,
} from "@campus/features/course-timeline";
import type { ClassNotesDocument } from "@campus/features/class-notebook";
import type { AgendaItemType } from "@campus/types/agenda";

export type { TeacherAccountRecord };

export interface ApiTeacherSession {
  kind: "teacher";
  teacherId: string;
  displayName: string;
  initials: string;
  isAdmin?: boolean;
  /** Mot de passe provisoire : l'enseignant doit en choisir un avant tout usage. */
  mustChangePassword?: boolean;
}

export interface ApiStudentSession {
  kind: "student";
  label: string;
  classroomId: string;
  classroomName?: string;
  accessId?: string;
}

export type ApiSession = ApiTeacherSession | ApiStudentSession | null;

export interface SchoolCalendarWeek {
  number: number;
  kind: "A" | "B";
  monday: string;
}

export interface SchoolCalendarPayload {
  label: string;
  status: string;
  weeks: SchoolCalendarWeek[];
}

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

export async function fetchApiSession(): Promise<ApiSession> {
  const response = await fetch("/api/auth/session", { credentials: "include" });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("application/json")) {
    return null;
  }
  const payload = await parseJson<{ ok: boolean; session: ApiSession }>(response);
  return payload.session ?? null;
}

export async function logoutApiSession(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
}

export async function loginTeacherApi(
  initials: string,
  password: string,
  remember = true,
): Promise<ApiTeacherSession> {
  const response = await fetch("/api/auth/teacher", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initials, password, remember }),
  });
  const payload = await parseJson<{ ok: boolean; reason?: string; session?: ApiTeacherSession }>(response);
  if (!response.ok || !payload.ok || !payload.session) {
    throw new Error(payload.reason ?? "Connexion enseignant impossible.");
  }
  return payload.session;
}

export async function changeTeacherPasswordApi(
  currentPassword: string,
  nextPassword: string,
): Promise<void> {
  const response = await fetch("/api/auth/teacher/password", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, nextPassword }),
  });
  const payload = await parseJson<{ ok: boolean; reason?: string }>(response);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Changement de mot de passe impossible.");
  }
}

export async function fetchTeacherClassroomsApi(): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch("/api/teacher/classrooms", { credentials: "include" });
  const payload = await parseJson<{ ok: boolean; classrooms?: Array<{ id: string; name: string }>; reason?: string }>(
    response,
  );
  if (!response.ok || !payload.ok || !payload.classrooms) {
    throw new Error(payload.reason ?? "Chargement des classes impossible.");
  }
  return payload.classrooms;
}

export async function fetchTeacherCoursesApi(schoolYearId?: string | null): Promise<{
  schoolYearId: string | null;
  courses: TeacherCourseWorkspaceEntry[];
}> {
  const params = schoolYearId ? `?schoolYearId=${encodeURIComponent(schoolYearId)}` : "";
  const response = await fetch(`/api/teacher/courses${params}`, { credentials: "include" });
  const payload = await parseJson<{
    ok: boolean;
    reason?: string;
    schoolYearId?: string | null;
    courses?: TeacherCourseWorkspaceEntry[];
  }>(response);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Chargement des cours impossible.");
  }
  return {
    schoolYearId: payload.schoolYearId ?? null,
    courses: payload.courses ?? [],
  };
}

export async function fetchTeacherCourseTimelineApi(
  annualCourseId: string,
  signal?: AbortSignal,
): Promise<{
  course: TeacherCourseTimelineCourse;
  timeline: CourseTimelineProjection;
}> {
  const params = `?annualCourseId=${encodeURIComponent(annualCourseId)}`;
  const response = await fetch(`/api/teacher/course-timeline${params}`, {
    credentials: "include",
    signal,
  });
  const payload = await parseJson<{
    ok: boolean;
    reason?: string;
    course?: TeacherCourseTimelineCourse;
    timeline?: CourseTimelineProjection;
  }>(response);
  if (!response.ok || !payload.ok || !payload.course || !payload.timeline) {
    throw new Error(payload.reason ?? "Chargement du déroulement impossible.");
  }
  return { course: payload.course, timeline: payload.timeline };
}

/** Null si aucune configuration n'a encore été enregistrée côté serveur. */
export async function fetchTeacherSetupApi(): Promise<TeacherSetupConfig | null> {
  const response = await fetch("/api/teacher/setup", { credentials: "include" });
  const payload = await parseJson<{ ok: boolean; reason?: string; setup?: TeacherSetupConfig | null }>(
    response,
  );
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Chargement de la configuration impossible.");
  }
  return payload.setup ?? null;
}

export async function saveTeacherSetupApi(setup: TeacherSetupConfig): Promise<TeacherSetupConfig> {
  const response = await fetch("/api/teacher/setup", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setup }),
  });
  const payload = await parseJson<{ ok: boolean; reason?: string; setup?: TeacherSetupConfig }>(response);
  if (!response.ok || !payload.ok || !payload.setup) {
    throw new Error(payload.reason ?? "Enregistrement de la configuration impossible.");
  }
  return payload.setup;
}

/** Null si aucun document de notes n'a encore été enregistré côté serveur. */
export async function fetchTeacherNotesApi(): Promise<ClassNotesDocument | null> {
  const response = await fetch("/api/teacher/notes", { credentials: "include" });
  const payload = await parseJson<{ ok: boolean; reason?: string; notes?: ClassNotesDocument | null }>(
    response,
  );
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Chargement des notes impossible.");
  }
  return payload.notes ?? null;
}

export async function saveTeacherNotesApi(notes: ClassNotesDocument): Promise<ClassNotesDocument> {
  const response = await fetch("/api/teacher/notes", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  const payload = await parseJson<{ ok: boolean; reason?: string; notes?: ClassNotesDocument }>(response);
  if (!response.ok || !payload.ok || !payload.notes) {
    throw new Error(payload.reason ?? "Enregistrement des notes impossible.");
  }
  return payload.notes;
}

export async function fetchTeacherAccounts(): Promise<TeacherAccountRecord[]> {
  const response = await fetch("/api/admin/teachers", { credentials: "include" });
  const payload = await parseJson<{ ok: boolean; reason?: string; teachers?: TeacherAccountRecord[] }>(response);
  if (!response.ok || !payload.ok || !payload.teachers) {
    throw new Error(payload.reason ?? "Chargement des comptes enseignant impossible.");
  }
  return payload.teachers;
}

export async function createTeacherAccountApi(input: {
  displayName: string;
  initials: string;
  isAdmin: boolean;
  teachingType: "TECHNICAL" | "GENERAL";
}): Promise<{ teacher: TeacherAccountRecord; temporaryPassword: string }> {
  const response = await fetch("/api/admin/teachers", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{
    ok: boolean;
    reason?: string;
    teacher?: TeacherAccountRecord;
    temporaryPassword?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.teacher || !payload.temporaryPassword) {
    throw new Error(payload.reason ?? "Création du compte impossible.");
  }
  return { teacher: payload.teacher, temporaryPassword: payload.temporaryPassword };
}

export async function updateTeacherAccountApi(
  teacherId: string,
  patch: {
    displayName?: string;
    initials?: string;
    isAdmin?: boolean;
    isActive?: boolean;
    isArchived?: boolean;
    teachingType?: "TECHNICAL" | "GENERAL" | null;
  },
): Promise<TeacherAccountRecord> {
  const response = await fetch(`/api/admin/teachers/${encodeURIComponent(teacherId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const payload = await parseJson<{ ok: boolean; reason?: string; teacher?: TeacherAccountRecord }>(response);
  if (!response.ok || !payload.ok || !payload.teacher) {
    throw new Error(payload.reason ?? "Mise à jour du compte impossible.");
  }
  return payload.teacher;
}

export async function resetTeacherPasswordApi(
  teacherId: string,
): Promise<{ teacher: TeacherAccountRecord; temporaryPassword: string }> {
  const response = await fetch(`/api/admin/teachers/${encodeURIComponent(teacherId)}/password`, {
    method: "POST",
    credentials: "include",
  });
  const payload = await parseJson<{
    ok: boolean;
    reason?: string;
    teacher?: TeacherAccountRecord;
    temporaryPassword?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.teacher || !payload.temporaryPassword) {
    throw new Error(payload.reason ?? "Réinitialisation impossible.");
  }
  return { teacher: payload.teacher, temporaryPassword: payload.temporaryPassword };
}

export async function loginStudentApi(code: string, remember = true): Promise<ApiStudentSession> {
  const response = await fetch("/api/auth/student", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, remember }),
  });
  const payload = await parseJson<{ ok: boolean; reason?: string; session?: ApiStudentSession }>(response);
  if (!response.ok || !payload.ok || !payload.session) {
    throw new Error(payload.reason ?? "Connexion élève impossible.");
  }
  return payload.session;
}

export async function fetchAgendaItems(classroomId: string): Promise<PrototypeAgendaItem[]> {
  const view = await fetchAgendaView(classroomId);
  return view.items;
}

export async function fetchAgendaView(classroomId: string): Promise<{
  items: PrototypeAgendaItem[];
  attendanceDays: Array<{ dayOfWeek: number; weekKind: "all" | "A" | "B"; role: string }>;
}> {
  const response = await fetch(`/api/agenda?classroomId=${encodeURIComponent(classroomId)}`, {
    credentials: "include",
  });
  const payload = await parseJson<{
    ok: boolean;
    items?: PrototypeAgendaItem[];
    attendanceDays?: Array<{ dayOfWeek: number; weekKind: "all" | "A" | "B"; role: string }>;
    reason?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.items) {
    throw new Error(payload.reason ?? "Impossible de charger l'agenda.");
  }
  return { items: payload.items, attendanceDays: payload.attendanceDays ?? [] };
}

export async function createAgendaItemApi(input: {
  classroomId: string;
  subjectId: string;
  day: number;
  hour: number;
  weekOffset: number;
  schoolWeekNumber: number;
  type: AgendaItemType;
  title: string;
  detail: string;
}): Promise<PrototypeAgendaItem> {
  const response = await fetch("/api/agenda", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{ ok: boolean; item?: PrototypeAgendaItem; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.item) {
    throw new Error(payload.reason ?? "Publication impossible.");
  }
  return payload.item;
}

export async function updateAgendaItemApi(
  itemId: number,
  patch: Partial<{ title: string; detail: string; day: number; hour: number; subjectId: string; schoolWeekNumber: number }>,
): Promise<PrototypeAgendaItem> {
  const response = await fetch(`/api/agenda/${itemId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const payload = await parseJson<{ ok: boolean; item?: PrototypeAgendaItem; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.item) {
    throw new Error(payload.reason ?? "Modification impossible.");
  }
  return payload.item;
}

export async function deleteAgendaItemApi(itemId: number): Promise<void> {
  const response = await fetch(`/api/agenda/${itemId}`, {
    method: "DELETE",
    credentials: "include",
  });
  const payload = await parseJson<{ ok: boolean; reason?: string }>(response);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Suppression impossible.");
  }
}

export async function fetchSchoolCalendar(): Promise<SchoolCalendarPayload> {
  const response = await fetch("/api/school-year/calendar", { credentials: "include" });
  const payload = await parseJson<{ ok: boolean; calendar?: SchoolCalendarPayload; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.calendar) {
    throw new Error(payload.reason ?? "Impossible de charger le calendrier scolaire.");
  }
  return payload.calendar;
}

export interface SchoolYearSummary {
  id: string;
  label: string;
  status: "draft" | "active" | "archived";
  startsOn: string;
  endsOn: string;
  sourceFilename: string | null;
  importedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
}

export interface SchoolYearPreview {
  label: string;
  weekCount: number;
  warnings: string[];
  weeks: SchoolCalendarWeek[];
}

export async function fetchSchoolYears(): Promise<SchoolYearSummary[]> {
  const response = await fetch("/api/admin/school-year", { credentials: "include" });
  const payload = await parseJson<{ ok: boolean; years?: SchoolYearSummary[]; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.years) {
    throw new Error(payload.reason ?? "Impossible de charger les années scolaires.");
  }
  return payload.years;
}

export interface SchoolDayCell {
  date: string;
  weekdayIndex: number;
  state: "class" | "holiday";
  label: string | null;
  isManual: boolean;
}

export type SchoolDayPlanRow =
  | { kind: "week"; number: number; weekKind: "A" | "B"; monday: string; days: SchoolDayCell[] }
  | { kind: "break"; fromMonday: string; weekCount: number; afterWeekNumber: number };

export interface ActiveSchoolPlan {
  year: { id: string; label: string; status: string };
  weeks: SchoolCalendarWeek[];
  rows: SchoolDayPlanRow[];
  warnings: string[];
  classDayCount: number;
  holidays: SchoolDayCell[];
}

export async function fetchActiveSchoolPlan(): Promise<ActiveSchoolPlan> {
  const response = await fetch("/api/admin/school-year/active-plan", { credentials: "include" });
  const payload = await parseJson<{ ok: boolean; reason?: string } & Partial<ActiveSchoolPlan>>(response);
  if (!response.ok || !payload.ok || !payload.year || !payload.rows || !payload.weeks) {
    throw new Error(payload.reason ?? "Impossible de charger le plan de l'année active.");
  }
  return {
    year: payload.year,
    weeks: payload.weeks,
    rows: payload.rows,
    warnings: payload.warnings ?? [],
    classDayCount: payload.classDayCount ?? 0,
    holidays: payload.holidays ?? [],
  };
}

export async function saveActiveSchoolWeeks(weeks: SchoolCalendarWeek[]): Promise<ActiveSchoolPlan> {
  const response = await fetch("/api/admin/school-year/active-plan", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weeks }),
  });
  const payload = await parseJson<{ ok: boolean; reason?: string } & Partial<ActiveSchoolPlan>>(response);
  if (!response.ok || !payload.ok || !payload.year || !payload.rows || !payload.weeks) {
    throw new Error(payload.reason ?? "Enregistrement du plan impossible.");
  }
  return {
    year: payload.year,
    weeks: payload.weeks,
    rows: payload.rows,
    warnings: payload.warnings ?? [],
    classDayCount: payload.classDayCount ?? 0,
    holidays: payload.holidays ?? [],
  };
}

export async function saveActiveSchoolDay(input: {
  date: string;
  state: "class" | "holiday" | null;
  label?: string | null;
}): Promise<{ rows: SchoolDayPlanRow[]; classDayCount: number; holidays: SchoolDayCell[] }> {
  const response = await fetch("/api/admin/school-year/active-plan/days", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{
    ok: boolean;
    reason?: string;
    rows?: SchoolDayPlanRow[];
    classDayCount?: number;
    holidays?: SchoolDayCell[];
  }>(response);
  if (!response.ok || !payload.ok || !payload.rows) {
    throw new Error(payload.reason ?? "Enregistrement du jour impossible.");
  }
  return {
    rows: payload.rows,
    classDayCount: payload.classDayCount ?? 0,
    holidays: payload.holidays ?? [],
  };
}

export async function parseSchoolYearPdf(file: File): Promise<{ receivable: boolean; preview: SchoolYearPreview }> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/admin/school-year/parse", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const payload = await parseJson<{
    ok: boolean;
    receivable?: boolean;
    preview?: SchoolYearPreview;
    reason?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.preview) {
    throw new Error(payload.reason ?? "Analyse du PDF impossible.");
  }
  return { receivable: payload.receivable ?? false, preview: payload.preview };
}

export async function importSchoolYearPdf(file: File): Promise<{
  receivable: boolean;
  preview: SchoolYearPreview;
  draft: { id: string; label: string; status: string };
}> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/admin/school-year/import", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const payload = await parseJson<{
    ok: boolean;
    receivable?: boolean;
    preview?: SchoolYearPreview;
    draft?: { id: string; label: string; status: string };
    reason?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.preview || !payload.draft) {
    throw new Error(payload.reason ?? "Import du PDF impossible.");
  }
  return {
    receivable: payload.receivable ?? false,
    preview: payload.preview,
    draft: payload.draft,
  };
}

export async function activateSchoolYear(schoolYearId: string): Promise<SchoolCalendarPayload> {
  const response = await fetch("/api/admin/school-year/activate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolYearId }),
  });
  const payload = await parseJson<{
    ok: boolean;
    active?: { label: string; status: string; weeks: SchoolCalendarWeek[] };
    reason?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.active) {
    throw new Error(payload.reason ?? "Activation impossible.");
  }
  return {
    label: payload.active.label,
    status: payload.active.status,
    weeks: payload.active.weeks,
  };
}

export interface PublicationTemplatePayload {
  id: string;
  ownerTeacherId: string;
  title: string;
  detail: string;
  type: AgendaItemType;
  subjectId: string | null;
  defaultSchoolWeekNumber: number | null;
  defaultDay: number | null;
  sourceSchoolYearId: string | null;
  sourceItemId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDeploymentPayload {
  templateId: string;
  classroomId: string;
  subjectId: string;
  schoolWeekNumber: number;
  day: number;
  hour?: number;
}

export async function fetchPublicationTemplates(): Promise<PublicationTemplatePayload[]> {
  const response = await fetch("/api/library/templates", { credentials: "include" });
  const payload = await parseJson<{ ok: boolean; templates?: PublicationTemplatePayload[]; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.templates) {
    throw new Error(payload.reason ?? "Impossible de charger la bibliothèque.");
  }
  return payload.templates;
}

export async function savePublicationToLibrary(itemId: number): Promise<{
  template: PublicationTemplatePayload;
  item: PrototypeAgendaItem;
}> {
  const response = await fetch("/api/library/templates", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId }),
  });
  const payload = await parseJson<{
    ok: boolean;
    template?: PublicationTemplatePayload;
    item?: PrototypeAgendaItem;
    reason?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.template || !payload.item) {
    throw new Error(payload.reason ?? "Enregistrement dans la bibliothèque impossible.");
  }
  return { template: payload.template, item: payload.item };
}

export async function syncTemplateFromPublication(itemId: number): Promise<PublicationTemplatePayload> {
  const response = await fetch("/api/library/templates/sync-from-item", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId }),
  });
  const payload = await parseJson<{ ok: boolean; template?: PublicationTemplatePayload; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.template) {
    throw new Error(payload.reason ?? "Mise à jour du modèle impossible.");
  }
  return payload.template;
}

export async function deletePublicationTemplate(templateId: string): Promise<void> {
  const response = await fetch(`/api/library/templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  const payload = await parseJson<{ ok: boolean; reason?: string }>(response);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Suppression du modèle impossible.");
  }
}

export async function deployPublicationTemplates(
  deployments: TemplateDeploymentPayload[],
): Promise<PrototypeAgendaItem[]> {
  const response = await fetch("/api/library/deploy", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deployments }),
  });
  const payload = await parseJson<{ ok: boolean; created?: PrototypeAgendaItem[]; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.created) {
    throw new Error(payload.reason ?? "Déploiement impossible.");
  }
  return payload.created;
}

export async function duplicateFromPreviousYear(input: {
  archivedSchoolYearId: string;
  classroomId: string;
  alsoCreateTemplates?: boolean;
}): Promise<{ created: PrototypeAgendaItem[]; createdCount: number }> {
  const response = await fetch("/api/library/duplicate-previous-year", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{
    ok: boolean;
    created?: PrototypeAgendaItem[];
    createdCount?: number;
    reason?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.created) {
    throw new Error(payload.reason ?? "Duplication depuis l'année précédente impossible.");
  }
  return { created: payload.created, createdCount: payload.createdCount ?? payload.created.length };
}

export interface TimetableImportSummary {
  id: string;
  schoolYearId: string | null;
  sourceFilename: string;
  schoolYearLabel: string;
  status: "draft" | "active" | "archived";
  importedAt: string;
  slotCount: number;
}

export interface TimetablePreviewPayload {
  schoolYearLabel: string;
  sourceVersion: string | null;
  slotCount: number;
  classCount: number;
  excludedSpsCount: number;
  warnings: string[];
  classes: Array<{ classCode: string; slotCount: number; branches: string[] }>;
  sampleSlots: Array<{
    classCode: string;
    dayOfWeek: number;
    period: number;
    branchLabel: string;
    teacherCode: string | null;
    weekKind: string;
  }>;
}

export async function fetchTimetableImports(): Promise<TimetableImportSummary[]> {
  const response = await fetch("/api/admin/timetable", { credentials: "include" });
  const payload = await parseJson<{ ok: boolean; imports?: TimetableImportSummary[]; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.imports) {
    throw new Error(payload.reason ?? "Impossible de charger les imports horaire.");
  }
  return payload.imports;
}

export async function parseTimetablePdf(file: File): Promise<{ receivable: boolean; preview: TimetablePreviewPayload }> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/admin/timetable/parse", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const payload = await parseJson<{ ok: boolean; receivable?: boolean; preview?: TimetablePreviewPayload; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.preview) {
    throw new Error(payload.reason ?? "Analyse du PDF horaire impossible.");
  }
  return { receivable: payload.receivable ?? false, preview: payload.preview };
}

export async function importTimetablePdf(file: File): Promise<{
  slotCount: number;
  classCount: number;
  excludedSpsCount: number;
  warnings: string[];
}> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/admin/timetable/import", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const payload = await parseJson<{
    ok: boolean;
    slotCount?: number;
    classCount?: number;
    excludedSpsCount?: number;
    warnings?: string[];
    reason?: string;
  }>(response);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Import horaire impossible.");
  }
  return {
    slotCount: payload.slotCount ?? 0,
    classCount: payload.classCount ?? 0,
    excludedSpsCount: payload.excludedSpsCount ?? 0,
    warnings: payload.warnings ?? [],
  };
}

export interface MembershipPayload {
  id: string;
  teacherId: string;
  classroomId: string;
  subjectIds: string[];
  validFrom: string;
  validTo: string | null;
}

export interface ClassYearStatsPayload {
  classroomId: string;
  schoolYearId: string;
  totalItems: number;
  byType: Record<AgendaItemType, number>;
  bySubject: { subjectId: string; count: number }[];
  testsByWeek: { schoolWeekNumber: number; count: number }[];
}

export async function fetchAgendaItemsForYear(
  classroomId: string,
  schoolYearId: string,
): Promise<{ items: PrototypeAgendaItem[]; readOnly: boolean }> {
  const response = await fetch(
    `/api/agenda?classroomId=${encodeURIComponent(classroomId)}&schoolYearId=${encodeURIComponent(schoolYearId)}`,
    { credentials: "include" },
  );
  const payload = await parseJson<{
    ok: boolean;
    items?: PrototypeAgendaItem[];
    readOnly?: boolean;
    reason?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.items) {
    throw new Error(payload.reason ?? "Impossible de charger l'agenda archivé.");
  }
  return { items: payload.items, readOnly: payload.readOnly ?? true };
}

export async function exportSchoolYear(
  schoolYearId: string,
  format: "json" | "csv" = "json",
): Promise<{ snapshot?: { itemCount: number; schoolYearLabel: string }; csvText?: string }> {
  const response = await fetch(
    `/api/admin/school-year/${encodeURIComponent(schoolYearId)}/export?format=${format}`,
    { credentials: "include" },
  );
  if (format === "csv") {
    if (!response.ok) {
      throw new Error("Export CSV impossible.");
    }
    return { csvText: await response.text() };
  }
  const payload = await parseJson<{
    ok: boolean;
    snapshot?: { itemCount: number; schoolYearLabel: string };
    reason?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.snapshot) {
    throw new Error(payload.reason ?? "Export impossible.");
  }
  return { snapshot: payload.snapshot };
}

export async function fetchClassYearStats(
  schoolYearId: string,
  classroomId: string,
): Promise<ClassYearStatsPayload> {
  const response = await fetch(
    `/api/admin/school-year/${encodeURIComponent(schoolYearId)}/stats?classroomId=${encodeURIComponent(classroomId)}`,
    { credentials: "include" },
  );
  const payload = await parseJson<{ ok: boolean; stats?: ClassYearStatsPayload; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.stats) {
    throw new Error(payload.reason ?? "Statistiques indisponibles.");
  }
  return payload.stats;
}

export async function fetchMemberships(classroomId: string): Promise<MembershipPayload[]> {
  const response = await fetch(
    `/api/admin/memberships?classroomId=${encodeURIComponent(classroomId)}`,
    { credentials: "include" },
  );
  const payload = await parseJson<{ ok: boolean; memberships?: MembershipPayload[]; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.memberships) {
    throw new Error(payload.reason ?? "Impossible de charger les affectations.");
  }
  return payload.memberships;
}

export async function replaceTeacherMembership(input: {
  classroomId: string;
  outgoingTeacherId: string;
  incomingTeacherId: string;
  subjectIds: string[];
  effectiveAt?: string;
}): Promise<{ created: MembershipPayload; closedMembershipIds: string[] }> {
  const response = await fetch("/api/admin/memberships/replace", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{
    ok: boolean;
    created?: MembershipPayload;
    closedMembershipIds?: string[];
    reason?: string;
  }>(response);
  if (!response.ok || !payload.ok || !payload.created) {
    throw new Error(payload.reason ?? "Remplacement impossible.");
  }
  return {
    created: payload.created,
    closedMembershipIds: payload.closedMembershipIds ?? [],
  };
}
