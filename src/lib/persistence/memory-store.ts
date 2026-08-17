import { DEMO_PROTOTYPE_ITEMS } from "../../features/agenda/demo-items.ts";
import { createPublication, deletePublication, updatePublication } from "../../features/agenda/publications.ts";
import { DEMO_CATALOG } from "../../features/classes/demo-data.ts";
import {
  getClassroomById,
  getMembershipsForTeacher,
  teacherTeachesSubject,
} from "../../features/classes/queries.ts";
import { resolveStudentAccess } from "../../features/student/access.ts";
import { isDemoTeacherPassword } from "../auth/config.ts";
import type { AgendaMutationResult, AgendaStore, CreateAgendaInput } from "./types.ts";
import type { PrototypeAgendaItem } from "../../features/agenda/demo-items.ts";

export class MemoryAgendaStore implements AgendaStore {
  private items: PrototypeAgendaItem[];

  constructor(seedItems: PrototypeAgendaItem[] = DEMO_PROTOTYPE_ITEMS) {
    this.items = seedItems.map((item) => ({ ...item }));
  }

  listAgendaItems(classroomId: string): PrototypeAgendaItem[] {
    return this.items.filter((item) => item.classroomId === classroomId);
  }

  findAgendaItem(itemId: number): PrototypeAgendaItem | undefined {
    return this.items.find((item) => item.id === itemId);
  }

  createAgendaItem(input: CreateAgendaInput): PrototypeAgendaItem {
    const id = Math.max(0, ...this.items.map((item) => item.id)) + 1;
    this.items = createPublication(this.items, {
      id,
      classroomId: input.classroomId,
      subjectId: input.subjectId,
      authorTeacherId: input.authorTeacherId,
      day: input.day,
      hour: input.hour,
      weekOffset: input.weekOffset ?? 0,
      type: input.type,
      title: input.title,
      detail: input.detail,
    });
    return this.findAgendaItem(id)!;
  }

  updateAgendaItem(
    itemId: number,
    actorTeacherId: string,
    patch: Partial<Pick<CreateAgendaInput, "title" | "detail" | "day" | "hour" | "subjectId">>,
  ): AgendaMutationResult {
    const result = updatePublication(this.items, itemId, actorTeacherId, patch);
    if (!result.ok) {
      return { ok: false, reason: result.reason, status: result.reason.includes("introuvable") ? 404 : 403 };
    }
    this.items = result.items;
    const item = this.findAgendaItem(itemId);
    if (!item) return { ok: false, reason: "Publication introuvable.", status: 404 };
    return { ok: true, item };
  }

  deleteAgendaItem(itemId: number, actorTeacherId: string): AgendaMutationResult {
    const result = deletePublication(this.items, itemId, actorTeacherId);
    if (!result.ok) {
      return { ok: false, reason: result.reason, status: result.reason.includes("introuvable") ? 404 : 403 };
    }
    const item = this.findAgendaItem(itemId);
    this.items = result.items;
    if (!item) return { ok: false, reason: "Publication introuvable.", status: 404 };
    return { ok: true, item };
  }

  teacherCanAccessClassroom(teacherId: string, classroomId: string): boolean {
    return getMembershipsForTeacher(DEMO_CATALOG, teacherId).some(
      (membership) => membership.classroomId === classroomId,
    );
  }

  teacherCanPublish(teacherId: string, classroomId: string, subjectId: string): boolean {
    return teacherTeachesSubject(DEMO_CATALOG, teacherId, classroomId, subjectId);
  }

  resolveStudentAccess(label: string) {
    return resolveStudentAccess(DEMO_CATALOG, label);
  }

  verifyTeacherCredentials(teacherId: string, password: string): boolean {
    if (!isDemoTeacherPassword(password)) return false;
    return Boolean(DEMO_CATALOG.teachers.find((teacher) => teacher.id === teacherId));
  }
}

let singletonStore: MemoryAgendaStore | null = null;

export function getMemoryAgendaStore(): MemoryAgendaStore {
  singletonStore ??= new MemoryAgendaStore();
  return singletonStore;
}

export function resetMemoryAgendaStore(seedItems?: PrototypeAgendaItem[]): void {
  singletonStore = new MemoryAgendaStore(seedItems);
}

export function classroomExists(classroomId: string): boolean {
  return Boolean(getClassroomById(DEMO_CATALOG, classroomId));
}
