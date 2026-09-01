import type { Classroom, Subject } from "../../types/classroom.ts";
import { getMemoryLegacySchool } from "./memory-legacy-school.ts";
import type { RuntimeAgendaAdapterStore, RuntimeClassroom, RuntimeSubject } from "./runtime-agenda-types.ts";

const UNSAFE_BRIDGE = "Impossible d'établir le pont Agenda de manière sûre.";

function cloneClassroom(entry: Classroom): RuntimeClassroom {
  return { ...entry, schoolClassId: entry.schoolClassId ?? null };
}

function cloneSubject(entry: Subject): RuntimeSubject {
  return { ...entry, annualCourseId: entry.annualCourseId ?? null };
}

export class MemoryRuntimeAgendaAdapterStore implements RuntimeAgendaAdapterStore {
  async listClassrooms(): Promise<RuntimeClassroom[]> {
    return getMemoryLegacySchool().classrooms.map(cloneClassroom);
  }

  async findClassroomById(id: string): Promise<RuntimeClassroom | null> {
    const found = getMemoryLegacySchool().classrooms.find((entry) => entry.id === id);
    return found ? cloneClassroom(found) : null;
  }

  async findClassroomBySchoolClassId(schoolClassId: string): Promise<RuntimeClassroom | null> {
    const found = getMemoryLegacySchool().classrooms.find(
      (entry) => entry.schoolClassId === schoolClassId,
    );
    return found ? cloneClassroom(found) : null;
  }

  async upsertClassroom(classroom: RuntimeClassroom): Promise<RuntimeClassroom> {
    const state = getMemoryLegacySchool();
    const schoolClassId = classroom.schoolClassId?.trim() || null;
    if (schoolClassId) {
      const other = state.classrooms.find(
        (entry) => entry.schoolClassId === schoolClassId && entry.id !== classroom.id,
      );
      if (other) throw new Error(UNSAFE_BRIDGE);
    }

    const next: Classroom = {
      id: classroom.id,
      name: classroom.name,
      programLabel: classroom.programLabel,
      accessCodeHint: classroom.accessCodeHint,
      schoolClassId,
    };
    const index = state.classrooms.findIndex((entry) => entry.id === classroom.id);
    if (index >= 0) {
      state.classrooms[index] = next;
    } else {
      state.classrooms.push(next);
    }
    return cloneClassroom(next);
  }

  async listSubjects(): Promise<RuntimeSubject[]> {
    return getMemoryLegacySchool().subjects.map(cloneSubject);
  }

  async findSubjectById(id: string): Promise<RuntimeSubject | null> {
    const found = getMemoryLegacySchool().subjects.find((entry) => entry.id === id);
    return found ? cloneSubject(found) : null;
  }

  async findSubjectByAnnualCourseId(annualCourseId: string): Promise<RuntimeSubject | null> {
    const found = getMemoryLegacySchool().subjects.find(
      (entry) => entry.annualCourseId === annualCourseId,
    );
    return found ? cloneSubject(found) : null;
  }

  async upsertSubject(subject: RuntimeSubject): Promise<RuntimeSubject> {
    const state = getMemoryLegacySchool();
    const annualCourseId = subject.annualCourseId?.trim() || null;
    if (annualCourseId) {
      const other = state.subjects.find(
        (entry) => entry.annualCourseId === annualCourseId && entry.id !== subject.id,
      );
      if (other) throw new Error(UNSAFE_BRIDGE);
    }

    const next: Subject = {
      id: subject.id,
      classroomId: subject.classroomId,
      name: subject.name,
      annualCourseId,
    };
    const index = state.subjects.findIndex((entry) => entry.id === subject.id);
    if (index >= 0) {
      state.subjects[index] = next;
    } else {
      state.subjects.push(next);
    }
    return cloneSubject(next);
  }
}

let singleton: MemoryRuntimeAgendaAdapterStore | null = null;

export function getMemoryRuntimeAgendaAdapterStore(): MemoryRuntimeAgendaAdapterStore {
  singleton ??= new MemoryRuntimeAgendaAdapterStore();
  return singleton;
}

export function resetMemoryRuntimeAgendaAdapterStore(): void {
  singleton = new MemoryRuntimeAgendaAdapterStore();
}
