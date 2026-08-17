import type { AgendaItemType } from "../../types/agenda.ts";
import type { PrototypeAgendaItem } from "../../features/agenda/demo-items.ts";

export type SessionKind = "teacher" | "student";

export interface TeacherSession {
  kind: "teacher";
  teacherId: string;
  issuedAt: number;
}

export interface StudentSession {
  kind: "student";
  accessId: string;
  classroomId: string;
  label: string;
  issuedAt: number;
}

export type AppSession = TeacherSession | StudentSession;

export type AuthResult =
  | { ok: true; session: AppSession; token: string }
  | { ok: false; reason: string };

export type AgendaMutationResult =
  | { ok: true; item: PrototypeAgendaItem }
  | { ok: false; reason: string; status: 401 | 403 | 404 | 400 };

export interface CreateAgendaInput {
  classroomId: string;
  subjectId: string;
  authorTeacherId: string;
  day: number;
  hour: number;
  weekOffset?: number;
  type: AgendaItemType;
  title: string;
  detail: string;
}

export interface AgendaStore {
  listAgendaItems(classroomId: string): PrototypeAgendaItem[];
  findAgendaItem(itemId: number): PrototypeAgendaItem | undefined;
  createAgendaItem(input: CreateAgendaInput): PrototypeAgendaItem;
  updateAgendaItem(
    itemId: number,
    actorTeacherId: string,
    patch: Partial<Pick<CreateAgendaInput, "title" | "detail" | "day" | "hour" | "subjectId">>,
  ): AgendaMutationResult;
  deleteAgendaItem(itemId: number, actorTeacherId: string): AgendaMutationResult;
  teacherCanAccessClassroom(teacherId: string, classroomId: string): boolean;
  teacherCanPublish(teacherId: string, classroomId: string, subjectId: string): boolean;
  resolveStudentAccess(label: string): { id: string; classroomId: string; label: string } | undefined;
  verifyTeacherCredentials(teacherId: string, password: string): boolean;
}
