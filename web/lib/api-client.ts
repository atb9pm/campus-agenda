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
  patch: Partial<{ title: string; detail: string; day: number; hour: number; subjectId: string }>,
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
