import { hashPassword } from "../../lib/auth/password.ts";
import type { StudentAccessRecord, StudentAccessStore } from "../../lib/persistence/student-access-types.ts";
import type { RuntimeAgendaAdapterStore } from "../../lib/persistence/runtime-agenda-types.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord, SchoolYearStatus } from "../school-year/types.ts";
import { runtimeClassroomIdForSchoolClass } from "../agenda-bridge/ids.ts";
import type { StudentAccessMetadata } from "../../types/student-access.ts";
import { generateStudentAccessCode } from "./code.ts";
import { studentAccessAllowsAdminWrite, studentAccessMetadataFromRecord } from "./status.ts";

export interface StudentAccessAdminDeps {
  accesses: StudentAccessStore;
  adapters: RuntimeAgendaAdapterStore;
  getSchoolClassById(id: string): Promise<SchoolClassRecord | null>;
  getSchoolYearById(id: string): Promise<SchoolYearRecord | null>;
  listClasses(): Promise<SchoolClassRecord[]>;
  listYears(): Promise<SchoolYearRecord[]>;
}

function yearStatusForClass(
  schoolClass: SchoolClassRecord,
  years: readonly SchoolYearRecord[],
): SchoolYearStatus | null {
  if (!schoolClass.schoolYearId) return null;
  return years.find((year) => year.id === schoolClass.schoolYearId)?.status ?? null;
}

async function metadataFor(
  record: StudentAccessRecord,
  schoolClass: SchoolClassRecord,
  years: readonly SchoolYearRecord[],
): Promise<StudentAccessMetadata> {
  return studentAccessMetadataFromRecord(record, schoolClass, yearStatusForClass(schoolClass, years));
}

export async function listStudentAccessMetadata(
  deps: StudentAccessAdminDeps,
  schoolClassId?: string,
): Promise<StudentAccessMetadata[]> {
  const [classes, years, records] = await Promise.all([
    deps.listClasses(),
    deps.listYears(),
    schoolClassId
      ? deps.accesses.getBySchoolClassId(schoolClassId).then((entry) => (entry ? [entry] : []))
      : deps.accesses.listAll(),
  ]);
  const classById = new Map(classes.map((entry) => [entry.id, entry]));
  const result: StudentAccessMetadata[] = [];
  for (const record of records) {
    const schoolClass = record.schoolClassId ? classById.get(record.schoolClassId) : undefined;
    if (!schoolClass) continue;
    if (schoolClassId && schoolClass.id !== schoolClassId) continue;
    result.push(await metadataFor(record, schoolClass, years));
  }
  return result;
}

async function ensureClassroomForSchoolClass(
  adapters: RuntimeAgendaAdapterStore,
  schoolClass: SchoolClassRecord,
): Promise<{ id: string; name: string }> {
  const existing = await adapters.findClassroomBySchoolClassId(schoolClass.id);
  if (existing) return { id: existing.id, name: existing.name };
  const created = await adapters.upsertClassroom({
    id: runtimeClassroomIdForSchoolClass(schoolClass.id),
    name: schoolClass.code,
    programLabel: schoolClass.label,
    accessCodeHint: "",
    schoolClassId: schoolClass.id,
  });
  return { id: created.id, name: created.name };
}

export type GenerateStudentAccessResult =
  | { ok: true; access: StudentAccessMetadata; code: string }
  | { ok: false; reason: string; status: 400 | 404 };

/** Sérialise génération/révocation d'une même classe dans le process (anti double-clic). */
const classAccessLocks = new Map<string, Promise<unknown>>();

async function withSchoolClassAccessLock<T>(schoolClassId: string, work: () => Promise<T>): Promise<T> {
  const previous = classAccessLocks.get(schoolClassId) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  classAccessLocks.set(schoolClassId, current);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (classAccessLocks.get(schoolClassId) === current) {
      classAccessLocks.delete(schoolClassId);
    }
  }
}

export async function generateStudentAccess(
  deps: StudentAccessAdminDeps,
  schoolClassId: string,
): Promise<GenerateStudentAccessResult> {
  return withSchoolClassAccessLock(schoolClassId, () => generateStudentAccessUnlocked(deps, schoolClassId));
}

async function generateStudentAccessUnlocked(
  deps: StudentAccessAdminDeps,
  schoolClassId: string,
): Promise<GenerateStudentAccessResult> {
  const schoolClass = await deps.getSchoolClassById(schoolClassId);
  if (!schoolClass) return { ok: false, reason: "Classe introuvable.", status: 404 };
  const year = schoolClass.schoolYearId ? await deps.getSchoolYearById(schoolClass.schoolYearId) : null;
  const allowed = studentAccessAllowsAdminWrite({
    schoolClass,
    yearStatus: year?.status ?? null,
  });
  if (!allowed.ok) return { ok: false, reason: allowed.reason, status: 400 };

  const classroom = await ensureClassroomForSchoolClass(deps.adapters, schoolClass);
  const code = generateStudentAccessCode(schoolClass.code);
  const accessCodeHash = await hashPassword(code);
  const record = await deps.accesses.saveGenerated({
    schoolClassId: schoolClass.id,
    classroomId: classroom.id,
    label: schoolClass.code,
    accessCodeHash,
  });
  const years = year ? [year] : [];
  return {
    ok: true,
    access: await metadataFor(record, schoolClass, years),
    code,
  };
}

export type RevokeStudentAccessResult =
  | { ok: true; access: StudentAccessMetadata }
  | { ok: false; reason: string; status: 400 | 404 };

export async function revokeStudentAccess(
  deps: StudentAccessAdminDeps,
  schoolClassId: string,
): Promise<RevokeStudentAccessResult> {
  return withSchoolClassAccessLock(schoolClassId, () => revokeStudentAccessUnlocked(deps, schoolClassId));
}

async function revokeStudentAccessUnlocked(
  deps: StudentAccessAdminDeps,
  schoolClassId: string,
): Promise<RevokeStudentAccessResult> {
  const schoolClass = await deps.getSchoolClassById(schoolClassId);
  if (!schoolClass) return { ok: false, reason: "Classe introuvable.", status: 404 };
  const year = schoolClass.schoolYearId ? await deps.getSchoolYearById(schoolClass.schoolYearId) : null;
  const allowed = studentAccessAllowsAdminWrite({
    schoolClass,
    yearStatus: year?.status ?? null,
  });
  if (!allowed.ok) return { ok: false, reason: allowed.reason, status: 400 };

  const record = await deps.accesses.revokeBySchoolClassId(schoolClass.id);
  if (!record) return { ok: false, reason: "Aucun accès apprentis à désactiver.", status: 404 };
  const years = year ? [year] : [];
  return { ok: true, access: await metadataFor(record, schoolClass, years) };
}
