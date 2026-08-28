import { DEMO_PROTOTYPE_ITEMS } from "../../features/agenda/demo-items.ts";
import { createPublication, deletePublication, updatePublication } from "../../features/agenda/publications.ts";
import { DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID } from "../../features/classes/demo-data.ts";
import {
  getClassroomById,
  getMembershipsForTeacher,
  teacherTeachesSubject,
} from "../../features/classes/queries.ts";
import { getMemoryMembershipsSnapshot } from "./memory-membership-store.ts";
import { resolveStudentAccess } from "../../features/student/access.ts";
import { isDemoTeacherPassword } from "../auth/config.ts";
import type { AgendaMutationResult, AgendaStore, CreateAgendaInput } from "./types.ts";
import type { PrototypeAgendaItem } from "../../features/agenda/demo-items.ts";

export class MemoryAgendaStore implements AgendaStore {
  private items: PrototypeAgendaItem[];

  constructor(seedItems: PrototypeAgendaItem[] = DEMO_PROTOTYPE_ITEMS) {
    this.items = seedItems.map((item) => ({ ...item }));
  }

  async listAgendaItems(classroomId: string): Promise<PrototypeAgendaItem[]> {
    return this.items.filter((item) => item.classroomId === classroomId);
  }

  async findAgendaItem(itemId: number): Promise<PrototypeAgendaItem | undefined> {
    return this.items.find((item) => item.id === itemId);
  }

  async createAgendaItem(input: CreateAgendaInput): Promise<PrototypeAgendaItem> {
    const id = Math.max(0, ...this.items.map((item) => item.id)) + 1;
    this.items = createPublication(this.items, {
      id,
      classroomId: input.classroomId,
      subjectId: input.subjectId,
      authorTeacherId: input.authorTeacherId,
      day: input.day,
      hour: input.hour,
      weekOffset: input.weekOffset ?? 0,
      schoolWeekNumber: input.schoolWeekNumber,
      type: input.type,
      title: input.title,
      detail: input.detail,
      templateId: input.templateId ?? null,
      schoolYearId: input.schoolYearId ?? null,
    });
    return (await this.findAgendaItem(id))!;
  }

  async updateAgendaItem(
    itemId: number,
    actorTeacherId: string,
    patch: Partial<Pick<CreateAgendaInput, "title" | "detail" | "day" | "hour" | "subjectId" | "schoolWeekNumber">>,
  ): Promise<AgendaMutationResult> {
    const result = updatePublication(this.items, itemId, actorTeacherId, patch, false);
    if (!result.ok) {
      return { ok: false, reason: result.reason, status: result.reason.includes("introuvable") ? 404 : 403 };
    }
    this.items = result.items;
    const item = await this.findAgendaItem(itemId);
    if (!item) return { ok: false, reason: "Publication introuvable.", status: 404 };
    return { ok: true, item };
  }

  async deleteAgendaItem(itemId: number, actorTeacherId: string): Promise<AgendaMutationResult> {
    const existing = await this.findAgendaItem(itemId);
    const result = deletePublication(this.items, itemId, actorTeacherId, false);
    if (!result.ok) {
      return { ok: false, reason: result.reason, status: result.reason.includes("introuvable") ? 404 : 403 };
    }
    this.items = result.items;
    if (!existing) return { ok: false, reason: "Publication introuvable.", status: 404 };
    return { ok: true, item: existing };
  }

  async teacherCanAccessClassroom(teacherId: string, classroomId: string): Promise<boolean> {
    return getMembershipsForTeacher(getRuntimeCatalog(), teacherId).some(
      (membership) => membership.classroomId === classroomId,
    );
  }

  async teacherCanPublish(teacherId: string, classroomId: string, subjectId: string): Promise<boolean> {
    return teacherTeachesSubject(getRuntimeCatalog(), teacherId, classroomId, subjectId);
  }

  async teacherIsAdmin(teacherId: string): Promise<boolean> {
    return teacherId === DEMO_CURRENT_TEACHER_ID;
  }

  async resolveStudentAccess(label: string) {
    const access = resolveStudentAccess(DEMO_CATALOG, label);
    if (!access) return undefined;
    return { id: access.id, classroomId: access.classroomId, label: access.label };
  }

  async findTeacherIdByInitials(initials: string): Promise<string | undefined> {
    const normalized = initials.trim().toLowerCase();
    if (!normalized) return undefined;
    return DEMO_CATALOG.teachers.find((teacher) => teacher.initials.toLowerCase() === normalized)?.id;
  }

  async verifyTeacherCredentials(teacherId: string, password: string): Promise<boolean> {
    if (!isDemoTeacherPassword(password)) return false;
    return Boolean(DEMO_CATALOG.teachers.find((teacher) => teacher.id === teacherId));
  }

  async exportAllItems(): Promise<PrototypeAgendaItem[]> {
    return this.items.map((item) => ({ ...item }));
  }

  async replaceAllItems(items: PrototypeAgendaItem[]): Promise<void> {
    this.items = items.map((item) => ({ ...item }));
  }
}

let singletonStore: MemoryAgendaStore | null = null;

function getRuntimeCatalog() {
  return { ...DEMO_CATALOG, memberships: getMemoryMembershipsSnapshot() };
}

export function getMemoryAgendaStore(): MemoryAgendaStore {
  singletonStore ??= new MemoryAgendaStore();
  return singletonStore;
}

export function resetMemoryAgendaStore(seedItems?: PrototypeAgendaItem[]): void {
  singletonStore = new MemoryAgendaStore(seedItems);
}

export async function classroomExists(classroomId: string): Promise<boolean> {
  return Boolean(getClassroomById(DEMO_CATALOG, classroomId));
}
