import { normalizeClassCode } from "./queries.ts";
import type { SchoolClassRecord } from "./types.ts";

export interface RuntimeClassroomRef {
  id: string;
  name: string;
}

export interface ClassDeleteUsage {
  classrooms: RuntimeClassroomRef[];
  courses: Array<{ id: string; classId: string }>;
  assignments: Array<{ annualCourseId: string }>;
  notes: Array<{ classId: string }>;
  agendaItems: Array<{ classroomId: string; schoolYearId?: string | null }>;
  timetableSlots: Array<{ classCode: string; schoolYearId?: string | null }>;
  linkedClassroomIds: string[];
  studentAccesses: Array<{ classroomId: string }>;
  attendanceDays: Array<{ classId: string }>;
}

export interface ClassDeleteBlockerCounts {
  courses: number;
  assignments: number;
  notes: number;
  publications: number;
  timetableSlots: number;
  memberships: number;
  studentAccesses: number;
  attendanceDays: number;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count > 1 ? plural : singular}`;
}

export function formatClassDeleteBlockerReason(counts: ClassDeleteBlockerCounts): string {
  const parts: string[] = [];
  if (counts.courses > 0) parts.push(countLabel(counts.courses, "cours annuel", "cours annuels"));
  if (counts.assignments > 0) {
    parts.push(countLabel(counts.assignments, "attribution", "attributions"));
  }
  if (counts.notes > 0) parts.push(countLabel(counts.notes, "note annuelle", "notes annuelles"));
  if (counts.publications > 0) {
    parts.push(countLabel(counts.publications, "publication", "publications"));
  }
  if (counts.timetableSlots > 0) {
    parts.push(countLabel(counts.timetableSlots, "horaire", "horaires"));
  }
  if (counts.memberships > 0) {
    parts.push(countLabel(counts.memberships, "accès / membership", "accès / memberships"));
  }
  if (counts.studentAccesses > 0) {
    parts.push(countLabel(counts.studentAccesses, "accès élève", "accès élèves"));
  }
  if (counts.attendanceDays > 0) {
    parts.push(countLabel(counts.attendanceDays, "jour de cours configuré", "jours de cours configurés"));
  }
  const detail = parts.length > 0 ? `\n- ${parts.join("\n- ")}` : "";
  return (
    "Impossible de supprimer cette classe car elle a déjà été utilisée. Archivez-la à la place." +
    detail
  );
}

/**
 * Nom réel de la classroom runtime. Jamais dérivé en découpant un ID opaque.
 */
export function resolveRuntimeClassroomName(
  classroomId: string,
  classrooms: RuntimeClassroomRef[],
): string | null {
  const found = classrooms.find((entry) => entry.id === classroomId);
  const name = found?.name.trim() ?? "";
  return name || null;
}

function schoolClassMatchesDisplayName(schoolClass: SchoolClassRecord, displayName: string): boolean {
  const normalized = normalizeClassCode(displayName);
  if (!normalized) return false;
  return (
    normalized === normalizeClassCode(schoolClass.code) ||
    normalized === normalizeClassCode(schoolClass.label)
  );
}

/**
 * Relie un `classroomId` runtime (Agenda / Membership / StudentAccess) à une SchoolClass.
 * 1. id catalogue identique (rare) ;
 * 2. résolution id → name, puis name ↔ code/libellé ;
 * 3. repli uniquement si l’identifiant stocké EST déjà le code/libellé (données synthétiques).
 */
export function runtimeClassroomRefersToSchoolClass(
  classroomId: string,
  schoolClass: SchoolClassRecord,
  classrooms: RuntimeClassroomRef[],
): boolean {
  if (!classroomId) return false;
  if (classroomId === schoolClass.id) return true;
  const name = resolveRuntimeClassroomName(classroomId, classrooms);
  if (name) return schoolClassMatchesDisplayName(schoolClass, name);
  return schoolClassMatchesDisplayName(schoolClass, classroomId);
}

function sameCodeClasses(schoolClass: SchoolClassRecord, allClasses: SchoolClassRecord[]): SchoolClassRecord[] {
  const code = normalizeClassCode(schoolClass.code);
  return allClasses.filter((entry) => normalizeClassCode(entry.code) === code);
}

/**
 * Usage sans année (Membership, StudentAccess) : si le nom correspond,
 * bloquer — y compris quand le même code existe sur plusieurs années.
 */
function yearlessRuntimeBlocksClass(
  classroomId: string,
  schoolClass: SchoolClassRecord,
  classrooms: RuntimeClassroomRef[],
): boolean {
  return runtimeClassroomRefersToSchoolClass(classroomId, schoolClass, classrooms);
}

/**
 * Publications Agenda : jamais uniquement `classroomId = code`.
 * Structuré : nom runtime + schoolYearId.
 * Sans année : conservateur.
 */
export function agendaItemBlocksClassDeletion(
  item: { classroomId: string; schoolYearId?: string | null },
  schoolClass: SchoolClassRecord,
  allClasses: SchoolClassRecord[],
  classrooms: RuntimeClassroomRef[],
): boolean {
  if (!runtimeClassroomRefersToSchoolClass(item.classroomId, schoolClass, classrooms)) return false;
  if (schoolClass.schoolYearId && item.schoolYearId) {
    return item.schoolYearId === schoolClass.schoolYearId;
  }
  return true;
}

function timetableSlotBlocksClassDeletion(
  slot: { classCode: string; schoolYearId?: string | null },
  schoolClass: SchoolClassRecord,
  allClasses: SchoolClassRecord[],
): boolean {
  if (normalizeClassCode(slot.classCode) !== normalizeClassCode(schoolClass.code)) return false;
  if (schoolClass.schoolYearId) {
    if (slot.schoolYearId == null) return true;
    return slot.schoolYearId === schoolClass.schoolYearId;
  }
  const twins = sameCodeClasses(schoolClass, allClasses);
  if (twins.length > 1) return true;
  return true;
}

export function classDeleteBlockerCounts(
  schoolClass: SchoolClassRecord,
  allClasses: SchoolClassRecord[],
  usage: ClassDeleteUsage,
): ClassDeleteBlockerCounts {
  const classrooms = usage.classrooms ?? [];
  const courses = usage.courses.filter((entry) => entry.classId === schoolClass.id);
  const courseIds = new Set(courses.map((entry) => entry.id));
  const assignments = usage.assignments.filter((entry) => courseIds.has(entry.annualCourseId));
  const notes = usage.notes.filter((entry) => entry.classId === schoolClass.id);
  const publications = usage.agendaItems.filter((item) =>
    agendaItemBlocksClassDeletion(item, schoolClass, allClasses, classrooms),
  );
  const timetableSlots = usage.timetableSlots.filter((slot) =>
    timetableSlotBlocksClassDeletion(slot, schoolClass, allClasses),
  );
  const memberships = usage.linkedClassroomIds.filter((classroomId) =>
    yearlessRuntimeBlocksClass(classroomId, schoolClass, classrooms),
  );
  const studentAccesses = (usage.studentAccesses ?? []).filter((entry) =>
    yearlessRuntimeBlocksClass(entry.classroomId, schoolClass, classrooms),
  );
  const attendanceDays = (usage.attendanceDays ?? []).filter((entry) => entry.classId === schoolClass.id);
  return {
    courses: courses.length,
    assignments: assignments.length,
    notes: notes.length,
    publications: publications.length,
    timetableSlots: timetableSlots.length,
    memberships: memberships.length,
    studentAccesses: studentAccesses.length,
    attendanceDays: attendanceDays.length,
  };
}

export function classDeleteBlockers(
  schoolClass: SchoolClassRecord,
  allClasses: SchoolClassRecord[],
  usage: ClassDeleteUsage,
): { ok: true } | { ok: false; reason: string } {
  const counts = classDeleteBlockerCounts(schoolClass, allClasses, usage);
  const blocked =
    counts.courses +
      counts.assignments +
      counts.notes +
      counts.publications +
      counts.timetableSlots +
      counts.memberships +
      counts.studentAccesses +
      counts.attendanceDays >
    0;
  if (!blocked) return { ok: true };
  return { ok: false, reason: formatClassDeleteBlockerReason(counts) };
}
