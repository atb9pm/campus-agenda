import { normalizeClassCode } from "./queries.ts";
import type { SchoolClassRecord } from "./types.ts";

export interface ClassDeleteUsage {
  courses: Array<{ id: string; classId: string }>;
  assignments: Array<{ annualCourseId: string }>;
  notes: Array<{ classId: string }>;
  agendaItems: Array<{ classroomId: string; schoolYearId?: string | null }>;
  timetableSlots: Array<{ classCode: string; schoolYearId?: string | null }>;
  linkedClassroomIds: string[];
}

export interface ClassDeleteBlockerCounts {
  courses: number;
  assignments: number;
  notes: number;
  publications: number;
  timetableSlots: number;
  memberships: number;
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
  const detail = parts.length > 0 ? `\n- ${parts.join("\n- ")}` : "";
  return (
    "Impossible de supprimer cette classe car elle a déjà été utilisée. Archivez-la à la place." +
    detail
  );
}

function classroomMatchesClass(
  classroomId: string,
  schoolClass: SchoolClassRecord,
): boolean {
  const classroom = normalizeClassCode(classroomId);
  if (!classroom) return false;
  if (classroomId === schoolClass.id) return true;
  if (classroom === normalizeClassCode(schoolClass.code)) return true;
  if (classroom === normalizeClassCode(schoolClass.label)) return true;
  return false;
}

function sameCodeClasses(schoolClass: SchoolClassRecord, allClasses: SchoolClassRecord[]): SchoolClassRecord[] {
  const code = normalizeClassCode(schoolClass.code);
  return allClasses.filter((entry) => normalizeClassCode(entry.code) === code);
}

/**
 * Publications Agenda : jamais uniquement `classroomId = code`.
 * Structuré : code (ou id/libellé) ET schoolYearId.
 * Legacy sans année : conservateur — toute utilisation du code, ou ambiguïté, bloque.
 */
export function agendaItemBlocksClassDeletion(
  item: { classroomId: string; schoolYearId?: string | null },
  schoolClass: SchoolClassRecord,
  allClasses: SchoolClassRecord[],
): boolean {
  if (!classroomMatchesClass(item.classroomId, schoolClass)) return false;
  if (schoolClass.schoolYearId) {
    return item.schoolYearId === schoolClass.schoolYearId;
  }
  const twins = sameCodeClasses(schoolClass, allClasses);
  if (twins.length > 1) return true;
  return true;
}

function timetableSlotBlocksClassDeletion(
  slot: { classCode: string; schoolYearId?: string | null },
  schoolClass: SchoolClassRecord,
  allClasses: SchoolClassRecord[],
): boolean {
  if (normalizeClassCode(slot.classCode) !== normalizeClassCode(schoolClass.code)) return false;
  if (schoolClass.schoolYearId) {
    return slot.schoolYearId === schoolClass.schoolYearId || slot.schoolYearId == null;
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
  const courses = usage.courses.filter((entry) => entry.classId === schoolClass.id);
  const courseIds = new Set(courses.map((entry) => entry.id));
  const assignments = usage.assignments.filter((entry) => courseIds.has(entry.annualCourseId));
  const notes = usage.notes.filter((entry) => entry.classId === schoolClass.id);
  const publications = usage.agendaItems.filter((item) =>
    agendaItemBlocksClassDeletion(item, schoolClass, allClasses),
  );
  const timetableSlots = usage.timetableSlots.filter((slot) =>
    timetableSlotBlocksClassDeletion(slot, schoolClass, allClasses),
  );
  const memberships = usage.linkedClassroomIds.filter((classroomId) =>
    classroomMatchesClass(classroomId, schoolClass),
  );
  return {
    courses: courses.length,
    assignments: assignments.length,
    notes: notes.length,
    publications: publications.length,
    timetableSlots: timetableSlots.length,
    memberships: memberships.length,
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
      counts.memberships >
    0;
  if (!blocked) return { ok: true };
  return { ok: false, reason: formatClassDeleteBlockerReason(counts) };
}
