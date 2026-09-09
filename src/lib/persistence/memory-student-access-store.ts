import type { StudentAccessRecord, StudentAccessStore } from "./student-access-types.ts";
import {
  getMemoryLegacySchool,
  replaceMemoryLegacySchool,
  type LegacyStudentAccess,
} from "./memory-legacy-school.ts";
import {
  deterministicStudentAccessId,
  pickReusableStudentAccess,
} from "../../features/student-access/reuse.ts";

function nowIso(): string {
  return new Date().toISOString();
}

export function toStudentAccessRecord(entry: LegacyStudentAccess): StudentAccessRecord {
  return {
    id: entry.id,
    classroomId: entry.classroomId,
    schoolClassId: entry.schoolClassId ?? null,
    label: entry.label,
    accessCodeHash: entry.accessCodeHash ?? null,
    accessVersion: entry.accessVersion ?? 1,
    createdAt: entry.createdAt ?? null,
    updatedAt: entry.updatedAt ?? null,
    revokedAt: entry.revokedAt ?? null,
  };
}

function fromRecord(record: StudentAccessRecord): LegacyStudentAccess {
  return {
    id: record.id,
    classroomId: record.classroomId,
    schoolClassId: record.schoolClassId,
    label: record.label,
    accessCodeHash: record.accessCodeHash,
    accessVersion: record.accessVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  };
}

export class MemoryStudentAccessStore implements StudentAccessStore {
  async getById(id: string): Promise<StudentAccessRecord | null> {
    const entry = getMemoryLegacySchool().studentAccesses.find((access) => access.id === id);
    return entry ? toStudentAccessRecord(entry) : null;
  }

  async getBySchoolClassId(schoolClassId: string): Promise<StudentAccessRecord | null> {
    const entry = getMemoryLegacySchool().studentAccesses.find(
      (access) => access.schoolClassId === schoolClassId,
    );
    return entry ? toStudentAccessRecord(entry) : null;
  }

  async listAll(): Promise<StudentAccessRecord[]> {
    return getMemoryLegacySchool().studentAccesses.map(toStudentAccessRecord);
  }

  async saveGenerated(input: {
    schoolClassId: string;
    classroomId: string;
    label: string;
    accessCodeHash: string;
  }): Promise<StudentAccessRecord> {
    const stamp = nowIso();
    const existing = pickReusableStudentAccess(await this.listAll(), input);
    const record: StudentAccessRecord = existing
      ? {
          ...existing,
          classroomId: input.classroomId,
          schoolClassId: input.schoolClassId,
          label: input.label,
          accessCodeHash: input.accessCodeHash,
          accessVersion: existing.accessVersion + 1,
          updatedAt: stamp,
          revokedAt: null,
        }
      : {
          id: deterministicStudentAccessId(input.schoolClassId),
          classroomId: input.classroomId,
          schoolClassId: input.schoolClassId,
          label: input.label,
          accessCodeHash: input.accessCodeHash,
          accessVersion: 1,
          createdAt: stamp,
          updatedAt: stamp,
          revokedAt: null,
        };

    const current = getMemoryLegacySchool().studentAccesses;
    const next = existing
      ? current.map((entry) => (entry.id === record.id ? fromRecord(record) : entry))
      : [...current.filter((entry) => entry.schoolClassId !== input.schoolClassId), fromRecord(record)];
    replaceMemoryLegacySchool({ studentAccesses: next });
    return record;
  }

  async revokeBySchoolClassId(schoolClassId: string): Promise<StudentAccessRecord | null> {
    const existing = await this.getBySchoolClassId(schoolClassId);
    if (!existing) return null;
    const stamp = nowIso();
    const record: StudentAccessRecord = {
      ...existing,
      revokedAt: stamp,
      accessVersion: existing.accessVersion + 1,
      updatedAt: stamp,
    };
    replaceMemoryLegacySchool({
      studentAccesses: getMemoryLegacySchool().studentAccesses.map((entry) =>
        entry.id === record.id ? fromRecord(record) : entry,
      ),
    });
    return record;
  }

  async replaceAll(records: StudentAccessRecord[]): Promise<void> {
    replaceMemoryLegacySchool({ studentAccesses: records.map(fromRecord) });
  }
}

let singleton: MemoryStudentAccessStore | null = null;

export function getMemoryStudentAccessStore(): MemoryStudentAccessStore {
  singleton ??= new MemoryStudentAccessStore();
  return singleton;
}
