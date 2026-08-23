import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items.ts";
import type { AgendaItemType } from "@campus/types/agenda";

export interface ApiTeacherSession {
  kind: "teacher";
  teacherId: string;
  displayName: string;
  initials: string;
}

export interface ApiStudentSession {
  kind: "student";
  label: string;
  classroomId: string;
  classroomName?: string;
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
  const payload = await parseJson<{ ok: boolean; session: ApiSession }>(response);
  return payload.session ?? null;
}

export async function logoutApiSession(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
}

export async function loginTeacherApi(teacherId: string, password: string): Promise<ApiTeacherSession> {
  const response = await fetch("/api/auth/teacher", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacherId, password }),
  });
  const payload = await parseJson<{ ok: boolean; reason?: string; session?: ApiTeacherSession }>(response);
  if (!response.ok || !payload.ok || !payload.session) {
    throw new Error(payload.reason ?? "Connexion enseignant impossible.");
  }
  return payload.session;
}

export async function loginStudentApi(code: string): Promise<ApiStudentSession> {
  const response = await fetch("/api/auth/student", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const payload = await parseJson<{ ok: boolean; reason?: string; session?: ApiStudentSession }>(response);
  if (!response.ok || !payload.ok || !payload.session) {
    throw new Error(payload.reason ?? "Connexion élève impossible.");
  }
  return payload.session;
}

export async function fetchAgendaItems(classroomId: string): Promise<PrototypeAgendaItem[]> {
  const response = await fetch(`/api/agenda?classroomId=${encodeURIComponent(classroomId)}`, {
    credentials: "include",
  });
  const payload = await parseJson<{ ok: boolean; items?: PrototypeAgendaItem[]; reason?: string }>(response);
  if (!response.ok || !payload.ok || !payload.items) {
    throw new Error(payload.reason ?? "Impossible de charger l'agenda.");
  }
  return payload.items;
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
