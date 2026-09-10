export type CatalogDeleteKind = "class" | "profession" | "branch" | "context";

export interface CatalogDeleteTarget {
  id: string;
  kind: CatalogDeleteKind;
  code: string;
  label: string;
}

export interface CatalogDeleteCounts {
  classes: number;
  professions: number;
  branches: number;
  contexts: number;
  pedagogicalPaths: number;
  annualCourses: number;
  assignments: number;
  assignmentEvents: number;
  annualCourseNotes: number;
  courseScheduleSlots: number;
  attendanceDays: number;
  publications: number;
  memberships: number;
  studentAccesses: number;
  classrooms: number;
  subjects: number;
  timetableSlots: number;
  timetableClassMappings: number;
  publicationTemplates: number;
  teacherSetups: number;
  teacherNotes: number;
}

export interface CatalogDeletePlan {
  kind: CatalogDeleteKind;
  target: CatalogDeleteTarget;
  confirmationText: string;
  counts: CatalogDeleteCounts;
  classIds: string[];
  professionIds: string[];
  branchIds: string[];
  contextIds: string[];
  annualCourseIds: string[];
  assignmentIds: string[];
  assignmentEventIds: string[];
  annualCourseNoteIds: string[];
  courseScheduleSlotIds: string[];
  attendanceDayIds: string[];
  agendaItemIds: number[];
  classroomIds: string[];
  subjectIds: string[];
  membershipIds: string[];
  studentAccessIds: string[];
  publicationTemplateIds: string[];
  timetableSlotIds: string[];
  timetableMappingKeys: Array<{ importId: string; classCode: string }>;
}

export interface CatalogDeletePreview {
  ok: true;
  kind: CatalogDeleteKind;
  target: CatalogDeleteTarget;
  confirmationText: string;
  warning: string;
  irreversible: string;
  counts: CatalogDeleteCounts;
  lines: string[];
}

export const CATALOG_DELETE_IRREVERSIBLE = "Cette action ne peut pas être annulée.";
export const CATALOG_DELETE_WARNING =
  "Cette suppression effacera définitivement toutes les données liées à cet élément.";

export function emptyCatalogDeleteCounts(): CatalogDeleteCounts {
  return {
    classes: 0,
    professions: 0,
    branches: 0,
    contexts: 0,
    pedagogicalPaths: 0,
    annualCourses: 0,
    assignments: 0,
    assignmentEvents: 0,
    annualCourseNotes: 0,
    courseScheduleSlots: 0,
    attendanceDays: 0,
    publications: 0,
    memberships: 0,
    studentAccesses: 0,
    classrooms: 0,
    subjects: 0,
    timetableSlots: 0,
    timetableClassMappings: 0,
    publicationTemplates: 0,
    teacherSetups: 0,
    teacherNotes: 0,
  };
}

export function confirmationMatches(expected: string, received: string | null | undefined): boolean {
  return (received ?? "").trim() === expected;
}

export function hasDestructiveDependencies(plan: CatalogDeletePlan): boolean {
  const { counts, kind } = plan;
  const total =
    counts.classes +
    counts.professions +
    counts.branches +
    counts.contexts +
    counts.pedagogicalPaths +
    counts.annualCourses +
    counts.assignments +
    counts.assignmentEvents +
    counts.annualCourseNotes +
    counts.courseScheduleSlots +
    counts.attendanceDays +
    counts.publications +
    counts.memberships +
    counts.studentAccesses +
    counts.classrooms +
    counts.subjects +
    counts.timetableSlots +
    counts.timetableClassMappings +
    counts.publicationTemplates +
    counts.teacherSetups +
    counts.teacherNotes;
  const self =
    kind === "class"
      ? counts.classes
      : kind === "profession"
        ? counts.professions
        : kind === "branch"
          ? counts.branches
          : counts.contexts;
  return total > self;
}

export function missingConfirmationReason(confirmationText: string): string {
  return `Cette suppression est définitive et nécessite une confirmation. Tapez « ${confirmationText} » pour confirmer.`;
}

export function wrongConfirmationReason(confirmationText: string): string {
  return `Saisissez exactement « ${confirmationText} » pour confirmer.`;
}
