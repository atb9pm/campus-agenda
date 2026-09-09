import { hashPassword } from "../../lib/auth/password.ts";
import type { StudentAccessRecord, StudentAccessStore } from "../../lib/persistence/student-access-types.ts";
import type { RuntimeAgendaAdapterStore } from "../../lib/persistence/runtime-agenda-types.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord, SchoolYearStatus } from "../school-year/types.ts";
import { runtimeClassroomIdForSchoolClass } from "../agenda-bridge/ids.ts";
import type { StudentAccessMetadata } from "../../types/student-access.ts";
import { generateStudentAccessCode } from "./code.ts";
import { isPersistenceConstraintError, pickReusableStudentAccess } from "./reuse.ts";
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
    deps.accesses.listAll(),
  ]);
  const classById = new Map(classes.map((entry) => [entry.id, entry]));
  const classrooms = await deps.adapters.listClassrooms();
  const classroomById = new Map(classrooms.map((entry) => [entry.id, entry]));
  const result: StudentAccessMetadata[] = [];
  for (const record of records) {
    const classroomClassId = classroomById.get(record.classroomId)?.schoolClassId ?? null;
    const fromRecord = record.schoolClassId ? classById.get(record.schoolClassId) : undefined;
    const fromClassroom = classroomClassId ? classById.get(classroomClassId) : undefined;
    const schoolClass = fromRecord ?? fromClassroom;
    if (!schoolClass) continue;
    if (schoolClassId && schoolClass.id !== schoolClassId) continue;
    result.push(await metadataFor(record, schoolClass, years));
  }
  return result;
}

async function linkClassroomToSchoolClass(
  adapters: RuntimeAgendaAdapterStore,
  classroom: { id: string; name: string; programLabel?: string; accessCodeHint?: string; schoolClassId?: string | null },
  schoolClass: SchoolClassRecord,
): Promise<{ id: string; name: string }> {
  if (classroom.schoolClassId === schoolClass.id) {
    return { id: classroom.id, name: classroom.name };
  }
  try {
    const updated = await adapters.upsertClassroom({
      id: classroom.id,
      name: classroom.name || schoolClass.code,
      programLabel: classroom.programLabel || schoolClass.label,
      accessCodeHint: classroom.accessCodeHint || schoolClass.code,
      schoolClassId: schoolClass.id,
    });
    return { id: updated.id, name: updated.name };
  } catch (error) {
    const retry = await adapters.findClassroomBySchoolClassId(schoolClass.id);
    if (retry) return { id: retry.id, name: retry.name };
    if (isPersistenceConstraintError(error)) {
      return { id: classroom.id, name: classroom.name };
    }
    throw error;
  }
}

async function ensureClassroomForSchoolClass(
  deps: StudentAccessAdminDeps,
  schoolClass: SchoolClassRecord,
): Promise<{ id: string; name: string }> {
  const existing = await deps.adapters.findClassroomBySchoolClassId(schoolClass.id);
  if (existing) return { id: existing.id, name: existing.name };

  const deterministicId = runtimeClassroomIdForSchoolClass(schoolClass.id);
  const orphanAccess = pickReusableStudentAccess(await deps.accesses.listAll(), {
    schoolClassId: schoolClass.id,
    classroomId: deterministicId,
    label: schoolClass.code,
  });
  const candidateIds = [orphanAccess?.classroomId, deterministicId].filter(
    (id, index, all): id is string => Boolean(id) && all.indexOf(id) === index,
  );
  for (const classroomId of candidateIds) {
    const found = await deps.adapters.findClassroomById(classroomId);
    if (found) return linkClassroomToSchoolClass(deps.adapters, found, schoolClass);
  }

  const classrooms = await deps.adapters.listClassrooms();
  const wanted = schoolClass.code.trim().toLowerCase();
  const byName = classrooms.filter(
    (row) => !row.schoolClassId && row.name.trim().toLowerCase() === wanted,
  );
  if (byName.length === 1) {
    return linkClassroomToSchoolClass(deps.adapters, byName[0]!, schoolClass);
  }

  try {
    const created = await deps.adapters.upsertClassroom({
      id: deterministicId,
      name: schoolClass.code,
      programLabel: schoolClass.label,
      accessCodeHint: schoolClass.code,
      schoolClassId: schoolClass.id,
    });
    return { id: created.id, name: created.name };
  } catch (error) {
    const retry = await deps.adapters.findClassroomBySchoolClassId(schoolClass.id);
    if (retry) return { id: retry.id, name: retry.name };
    const byId = await deps.adapters.findClassroomById(deterministicId);
    if (byId) return { id: byId.id, name: byId.name };
    if (isPersistenceConstraintError(error)) {
      throw new Error("Cette classe est déjà liée à un agenda. Réessayez dans un instant.");
    }
    throw error;
  }
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
  try {
    const schoolClass = await deps.getSchoolClassById(schoolClassId);
    if (!schoolClass) return { ok: false, reason: "Classe introuvable.", status: 404 };
    const year = schoolClass.schoolYearId ? await deps.getSchoolYearById(schoolClass.schoolYearId) : null;
    const allowed = studentAccessAllowsAdminWrite({
      schoolClass,
      yearStatus: year?.status ?? null,
    });
    if (!allowed.ok) return { ok: false, reason: allowed.reason, status: 400 };

    const classroom = await ensureClassroomForSchoolClass(deps, schoolClass);
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
  } catch {
    return { ok: false, reason: "Génération impossible. Réessayez.", status: 400 };
  }
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
