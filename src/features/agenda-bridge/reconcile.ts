import type { AnnualCourse } from "../annual-courses/types.ts";
import type { PedagogicalContextRecord } from "../school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../school-catalog/types.ts";
import type {
  RuntimeAgendaAdapterStore,
  RuntimeClassroom,
  RuntimeSubject,
} from "../../lib/persistence/runtime-agenda-types.ts";
import { runtimeClassroomIdForSchoolClass, runtimeSubjectIdForAnnualCourse } from "./ids.ts";
import { findUniqueAdoptableClassroom, findUniqueAdoptableSubject } from "./match.ts";

export const UNSAFE_AGENDA_BRIDGE_REASON =
  "Impossible d'établir le pont Agenda de manière sûre.";

export type AgendaBridgeOk<T> = { ok: true; value: T };
export type AgendaBridgeErr = { ok: false; reason: string };
export type AgendaBridgeResult<T> = AgendaBridgeOk<T> | AgendaBridgeErr;

export interface StructuredAgendaTarget {
  classroom: RuntimeClassroom;
  subject: RuntimeSubject;
  schoolClass: SchoolClassRecord;
  course: AnnualCourse;
}

function linked(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

async function catchUnsafe<T>(work: () => Promise<T>): Promise<AgendaBridgeResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const message = error instanceof Error ? error.message : UNSAFE_AGENDA_BRIDGE_REASON;
    return { ok: false, reason: message || UNSAFE_AGENDA_BRIDGE_REASON };
  }
}

export async function ensureRuntimeClassroomForSchoolClass(
  adapters: RuntimeAgendaAdapterStore,
  schoolClass: SchoolClassRecord,
): Promise<AgendaBridgeResult<RuntimeClassroom>> {
  return catchUnsafe(async () => {
    const already = await adapters.findClassroomBySchoolClassId(schoolClass.id);
    if (already) return already;

    const classrooms = await adapters.listClassrooms();
    const adoptable = findUniqueAdoptableClassroom(classrooms, schoolClass);
    if (adoptable) {
      return adapters.upsertClassroom({
        ...adoptable,
        schoolClassId: schoolClass.id,
      });
    }

    const deterministicId = runtimeClassroomIdForSchoolClass(schoolClass.id);
    const existingId = await adapters.findClassroomById(deterministicId);
    if (existingId) {
      const existingLink = linked(existingId.schoolClassId);
      if (existingLink && existingLink !== schoolClass.id) {
        throw new Error(UNSAFE_AGENDA_BRIDGE_REASON);
      }
      return adapters.upsertClassroom({
        ...existingId,
        schoolClassId: schoolClass.id,
      });
    }

    return adapters.upsertClassroom({
      id: deterministicId,
      name: schoolClass.code.trim() || schoolClass.label,
      programLabel: schoolClass.schoolYearLabel?.trim() || schoolClass.label,
      accessCodeHint: schoolClass.code,
      schoolClassId: schoolClass.id,
    });
  });
}

export async function ensureRuntimeSubjectForAnnualCourse(
  adapters: RuntimeAgendaAdapterStore,
  options: {
    schoolClass: SchoolClassRecord;
    course: AnnualCourse;
    branch: SchoolBranchRecord;
  },
): Promise<AgendaBridgeResult<{ classroom: RuntimeClassroom; subject: RuntimeSubject }>> {
  const classroomResult = await ensureRuntimeClassroomForSchoolClass(adapters, options.schoolClass);
  if (!classroomResult.ok) return classroomResult;

  return catchUnsafe(async () => {
    const classroom = classroomResult.value;
    const already = await adapters.findSubjectByAnnualCourseId(options.course.id);
    if (already) {
      if (already.classroomId !== classroom.id) {
        throw new Error(UNSAFE_AGENDA_BRIDGE_REASON);
      }
      return { classroom, subject: already };
    }

    const subjects = await adapters.listSubjects();
    const adoptable = findUniqueAdoptableSubject(subjects, classroom.id, options.branch.label);
    if (adoptable) {
      const subject = await adapters.upsertSubject({
        ...adoptable,
        annualCourseId: options.course.id,
      });
      return { classroom, subject };
    }

    const deterministicId = runtimeSubjectIdForAnnualCourse(options.course.id);
    const existingId = await adapters.findSubjectById(deterministicId);
    if (existingId) {
      if (existingId.classroomId !== classroom.id) {
        throw new Error(UNSAFE_AGENDA_BRIDGE_REASON);
      }
      const existingLink = linked(existingId.annualCourseId);
      if (existingLink && existingLink !== options.course.id) {
        throw new Error(UNSAFE_AGENDA_BRIDGE_REASON);
      }
      const subject = await adapters.upsertSubject({
        ...existingId,
        annualCourseId: options.course.id,
        name: options.branch.label,
      });
      return { classroom, subject };
    }

    const subject = await adapters.upsertSubject({
      id: deterministicId,
      classroomId: classroom.id,
      name: options.branch.label,
      annualCourseId: options.course.id,
    });
    return { classroom, subject };
  });
}

export async function resolveStructuredSchoolClassForClassroom(
  adapters: RuntimeAgendaAdapterStore,
  classroomId: string,
  classes: SchoolClassRecord[],
): Promise<SchoolClassRecord | null> {
  const classroom = await adapters.findClassroomById(classroomId);
  const schoolClassId = linked(classroom?.schoolClassId);
  if (!schoolClassId) return null;
  return classes.find((entry) => entry.id === schoolClassId) ?? null;
}

export async function resolveStructuredAgendaTarget(
  adapters: RuntimeAgendaAdapterStore,
  options: {
    classroomId: string;
    subjectId: string;
    classes: SchoolClassRecord[];
    courses: AnnualCourse[];
  },
): Promise<StructuredAgendaTarget | null> {
  const classroom = await adapters.findClassroomById(options.classroomId);
  const subject = await adapters.findSubjectById(options.subjectId);
  const schoolClassId = linked(classroom?.schoolClassId);
  const annualCourseId = linked(subject?.annualCourseId);
  if (!classroom || !subject || !schoolClassId || !annualCourseId) return null;
  if (subject.classroomId !== classroom.id) return null;

  const schoolClass = options.classes.find((entry) => entry.id === schoolClassId) ?? null;
  const course = options.courses.find((entry) => entry.id === annualCourseId) ?? null;
  if (!schoolClass || !course) return null;
  if (course.classId !== schoolClass.id) return null;

  return { classroom, subject, schoolClass, course };
}

export async function reconcileStructuredClassrooms(
  adapters: RuntimeAgendaAdapterStore,
  classes: SchoolClassRecord[],
): Promise<void> {
  const sorted = [...classes].sort((left, right) => left.id.localeCompare(right.id));
  for (const schoolClass of sorted) {
    await ensureRuntimeClassroomForSchoolClass(adapters, schoolClass);
  }
}

export function contextBranchForCourse(options: {
  course: AnnualCourse;
  contexts: PedagogicalContextRecord[];
  branches: SchoolBranchRecord[];
}): { context: PedagogicalContextRecord; branch: SchoolBranchRecord } | null {
  const context = options.contexts.find((entry) => entry.id === options.course.contextId) ?? null;
  if (!context) return null;
  const branch = options.branches.find((entry) => entry.id === context.branchId) ?? null;
  if (!branch) return null;
  return { context, branch };
}
