import type { PublicationTemplate, TemplateDeploymentInput, DuplicatePreviousYearOptions } from "../../features/library/types.ts";
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
  schoolWeekNumber: number;
  type: AgendaItemType;
  title: string;
  detail: string;
  templateId?: string | null;
  schoolYearId?: string | null;
  annualCourseId?: string | null;
  courseSessionKey?: string | null;
  courseSessionDate?: string | null;
  referenceSessionId?: string | null;
  referenceItemId?: string | null;
}

export interface AgendaStore {
  listAgendaItems(classroomId: string): Promise<PrototypeAgendaItem[]>;
  findAgendaItem(itemId: number): Promise<PrototypeAgendaItem | undefined>;
  createAgendaItem(input: CreateAgendaInput): Promise<PrototypeAgendaItem>;
  updateAgendaItem(
    itemId: number,
    actorTeacherId: string,
    patch: Partial<Pick<CreateAgendaInput, "title" | "detail" | "day" | "hour" | "subjectId" | "schoolWeekNumber">>,
  ): Promise<AgendaMutationResult>;
  deleteAgendaItem(itemId: number, actorTeacherId: string): Promise<AgendaMutationResult>;
  teacherCanAccessClassroom(teacherId: string, classroomId: string): Promise<boolean>;
  teacherCanPublish(teacherId: string, classroomId: string, subjectId: string): Promise<boolean>;
  teacherIsAdmin(teacherId: string): Promise<boolean>;
  resolveStudentAccess(label: string): Promise<{ id: string; classroomId: string; label: string } | undefined>;
  /** Revalidation de session élève : l'accès doit encore exister et coller au classroomId du jeton. */
  findStudentAccessById(accessId: string): Promise<{ id: string; classroomId: string; label: string } | undefined>;
  /** Connexion enseignant par initiales (ChF) : renvoie l'identifiant interne. */
  findTeacherIdByInitials(initials: string): Promise<string | undefined>;
  verifyTeacherCredentials(teacherId: string, password: string): Promise<boolean>;
  listAgendaItemsByAnnualCourse(annualCourseId: string): Promise<PrototypeAgendaItem[]>;
  findAgendaItemByReferenceItem(
    annualCourseId: string,
    referenceItemId: string,
  ): Promise<PrototypeAgendaItem | undefined>;
  countAgendaItemsByAnnualCourse(annualCourseId: string): Promise<number>;
  exportAllItems(): Promise<PrototypeAgendaItem[]>;
  replaceAllItems(items: PrototypeAgendaItem[]): Promise<void>;
}

export interface TemplateStore {
  listTemplatesForTeacher(teacherId: string): Promise<PublicationTemplate[]>;
  createTemplateFromItem(itemId: number, teacherId: string, activeSchoolYearId: string | null): Promise<
    | { ok: true; template: PublicationTemplate; item: PrototypeAgendaItem }
    | { ok: false; reason: string; status: 403 | 404 | 400 }
  >;
  updateTemplate(
    templateId: string,
    teacherId: string,
    patch: Partial<Pick<PublicationTemplate, "title" | "detail" | "subjectId" | "defaultSchoolWeekNumber" | "defaultDay">>,
  ): Promise<
    | { ok: true; template: PublicationTemplate }
    | { ok: false; reason: string; status: 403 | 404 | 400 }
  >;
  syncTemplateFromItem(itemId: number, teacherId: string): Promise<
    | { ok: true; template: PublicationTemplate }
    | { ok: false; reason: string; status: 403 | 404 | 400 }
  >;
  deleteTemplate(templateId: string, teacherId: string): Promise<
    | { ok: true }
    | { ok: false; reason: string; status: 403 | 404 }
  >;
  deployTemplates(
    teacherId: string,
    deployments: TemplateDeploymentInput[],
    activeSchoolYearId: string | null,
  ): Promise<
    | { ok: true; created: PrototypeAgendaItem[] }
    | { ok: false; reason: string; status: 403 | 404 | 400 }
  >;
  duplicateFromArchivedYear(
    teacherId: string,
    options: DuplicatePreviousYearOptions,
    activeSchoolYearId: string | null,
  ): Promise<
    | { ok: true; created: PrototypeAgendaItem[]; templatesCreated: PublicationTemplate[] }
    | { ok: false; reason: string; status: 403 | 404 | 400 }
  >;
}

export type StoreKind = "memory" | "d1" | "sqlite";
