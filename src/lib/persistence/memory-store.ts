import { DEMO_PROTOTYPE_ITEMS } from "../../features/agenda/demo-items.ts";
import { createPublication, deletePublication, updatePublication } from "../../features/agenda/publications.ts";
import {
  getMembershipsForTeacher,
  teacherTeachesSubject,
} from "../../features/classes/queries.ts";
import { getMemoryMembershipsSnapshot } from "./memory-membership-store.ts";
import { getMemoryLegacySchool } from "./memory-legacy-school.ts";
import { getMemoryTeacherAccountStore } from "./memory-teacher-account-store.ts";
import type { AgendaMutationResult, AgendaStore, CreateAgendaInput, StructuredControlPlacement } from "./types.ts";
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
    const annualCourseId = input.annualCourseId?.trim() || null;
    const referenceItemId = input.referenceItemId?.trim() || null;
    if (annualCourseId && referenceItemId) {
      const duplicate = this.items.find(
        (item) => item.annualCourseId === annualCourseId && item.referenceItemId === referenceItemId,
      );
      if (duplicate) {
        throw new Error("Cet élément de référence a déjà été publié dans l’Agenda pour ce cours.");
      }
    }
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
      annualCourseId: input.annualCourseId ?? null,
      courseSessionKey: input.courseSessionKey ?? null,
      courseSessionDate: input.courseSessionDate ?? null,
      referenceSessionId: input.referenceSessionId ?? null,
      referenceItemId: input.referenceItemId ?? null,
    });
    return (await this.findAgendaItem(id))!;
  }

  async updateAgendaItem(
    itemId: number,
    actorTeacherId: string,
    patch: Partial<Pick<CreateAgendaInput, "title" | "detail" | "day" | "hour" | "subjectId" | "schoolWeekNumber">>,
  ): Promise<AgendaMutationResult> {
    const actorIsAdmin = await this.teacherIsAdmin(actorTeacherId);
    const result = updatePublication(this.items, itemId, actorTeacherId, patch, actorIsAdmin);
    if (!result.ok) {
      return { ok: false, reason: result.reason, status: result.reason.includes("introuvable") ? 404 : 403 };
    }
    this.items = result.items;
    const item = await this.findAgendaItem(itemId);
    if (!item) return { ok: false, reason: "Publication introuvable.", status: 404 };
    return { ok: true, item };
  }

  async moveStructuredControlPlacement(
    itemId: number,
    actorTeacherId: string,
    placement: StructuredControlPlacement,
  ): Promise<AgendaMutationResult> {
    const existing = await this.findAgendaItem(itemId);
    if (!existing) return { ok: false, reason: "Publication introuvable.", status: 404 };
    if (existing.type !== "TEST") {
      return { ok: false, reason: "Seul un contrôle peut être déplacé vers une autre séance.", status: 400 };
    }
    if (existing.authorTeacherId !== actorTeacherId) {
      return { ok: false, reason: "Seul l'auteur peut déplacer ce contrôle.", status: 403 };
    }
    if (!existing.annualCourseId?.trim() || !existing.courseSessionKey?.trim()) {
      return { ok: false, reason: "Ce contrôle n'est pas rattaché à une séance de cours réelle.", status: 400 };
    }
    const item = {
      ...existing,
      classroomId: placement.classroomId,
      subjectId: placement.subjectId,
      schoolYearId: placement.schoolYearId,
      annualCourseId: placement.annualCourseId,
      courseSessionKey: placement.courseSessionKey,
      courseSessionDate: placement.courseSessionDate,
      schoolWeekNumber: placement.schoolWeekNumber,
      day: placement.day,
      hour: placement.hour,
    };
    this.items = this.items.map((entry) => (entry.id === itemId ? item : entry));
    return { ok: true, item };
  }

  async deleteAgendaItem(itemId: number, actorTeacherId: string): Promise<AgendaMutationResult> {
    const existing = await this.findAgendaItem(itemId);
    const actorIsAdmin = await this.teacherIsAdmin(actorTeacherId);
    const result = deletePublication(this.items, itemId, actorTeacherId, actorIsAdmin);
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
    const account = await getMemoryTeacherAccountStore().findAccount(teacherId);
    return Boolean(account?.isAdmin && account.isActive && !account.isArchived);
  }

  async resolveStudentAccess(label: string) {
    const needle = label.trim().toLowerCase();
    const access = getMemoryLegacySchool().studentAccesses.find(
      (entry) => entry.label.trim().toLowerCase() === needle,
    );
    if (!access) return undefined;
    return { id: access.id, classroomId: access.classroomId, label: access.label };
  }

  async findStudentAccessById(accessId: string) {
    const access = getMemoryLegacySchool().studentAccesses.find((entry) => entry.id === accessId);
    if (!access) return undefined;
    return { id: access.id, classroomId: access.classroomId, label: access.label };
  }

  async findTeacherIdByInitials(initials: string): Promise<string | undefined> {
    const account = await getMemoryTeacherAccountStore().findAccountByInitials(initials);
    return account?.id;
  }

  async verifyTeacherCredentials(teacherId: string, password: string): Promise<boolean> {
    return getMemoryTeacherAccountStore().verifyCredentials(teacherId, password);
  }

  async listAgendaItemsByAnnualCourse(annualCourseId: string): Promise<PrototypeAgendaItem[]> {
    return this.items.filter((item) => item.annualCourseId === annualCourseId);
  }

  async findAgendaItemByReferenceItem(
    annualCourseId: string,
    referenceItemId: string,
  ): Promise<PrototypeAgendaItem | undefined> {
    return this.items.find(
      (item) => item.annualCourseId === annualCourseId && item.referenceItemId === referenceItemId,
    );
  }

  async countAgendaItemsByAnnualCourse(annualCourseId: string): Promise<number> {
    return this.items.filter((item) => item.annualCourseId === annualCourseId).length;
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
  const legacy = getMemoryLegacySchool();
  return {
    classrooms: legacy.classrooms,
    subjects: legacy.subjects,
    teachers: [],
    memberships: getMemoryMembershipsSnapshot(),
    studentAccesses: legacy.studentAccesses,
  };
}

export function getMemoryAgendaStore(): MemoryAgendaStore {
  singletonStore ??= new MemoryAgendaStore();
  return singletonStore;
}

export function resetMemoryAgendaStore(seedItems?: PrototypeAgendaItem[]): void {
  singletonStore = new MemoryAgendaStore(seedItems);
}

export async function classroomExists(classroomId: string): Promise<boolean> {
  return getMemoryLegacySchool().classrooms.some((entry) => entry.id === classroomId);
}

export async function listRuntimeClassrooms(): Promise<Array<{ id: string; name: string }>> {
  return getMemoryLegacySchool().classrooms.map((entry) => ({
    id: entry.id,
    name: entry.name,
    schoolClassId: entry.schoolClassId ?? null,
  }));
}

export async function listStudentAccesses(): Promise<Array<{ classroomId: string }>> {
  return getMemoryLegacySchool().studentAccesses.map((entry) => ({ classroomId: entry.classroomId }));
}

export async function resolveClassroomSubjectNames(
  classroomId: string,
  subjectId: string,
): Promise<{ classroomName: string | null; subjectName: string | null }> {
  const legacy = getMemoryLegacySchool();
  const classroom = legacy.classrooms.find((entry) => entry.id === classroomId);
  const subject = legacy.subjects.find((entry) => entry.id === subjectId);
  return {
    classroomName: classroom?.name ?? null,
    subjectName: subject?.name ?? null,
  };
}
