import {
  agendaItemBlocksClassDeletion,
  normalizeClassCode,
  runtimeClassroomRefersToSchoolClass,
  type SchoolClassRecord,
} from "../school-catalog/index.ts";
import type { CatalogDeleteSnapshot } from "./snapshot.ts";
import {
  emptyCatalogDeleteCounts,
  type CatalogDeleteKind,
  type CatalogDeletePlan,
} from "./types.ts";

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function mergePlans(kind: CatalogDeleteKind, target: CatalogDeletePlan["target"], confirmationText: string, parts: CatalogDeletePlan[]): CatalogDeletePlan {
  const plan: CatalogDeletePlan = {
    kind,
    target,
    confirmationText,
    counts: emptyCatalogDeleteCounts(),
    classIds: unique(parts.flatMap((part) => part.classIds)),
    professionIds: unique(parts.flatMap((part) => part.professionIds)),
    branchIds: unique(parts.flatMap((part) => part.branchIds)),
    contextIds: unique(parts.flatMap((part) => part.contextIds)),
    annualCourseIds: unique(parts.flatMap((part) => part.annualCourseIds)),
    assignmentIds: unique(parts.flatMap((part) => part.assignmentIds)),
    assignmentEventIds: unique(parts.flatMap((part) => part.assignmentEventIds)),
    annualCourseNoteIds: unique(parts.flatMap((part) => part.annualCourseNoteIds)),
    courseScheduleSlotIds: unique(parts.flatMap((part) => part.courseScheduleSlotIds)),
    attendanceDayIds: unique(parts.flatMap((part) => part.attendanceDayIds)),
    agendaItemIds: unique(parts.flatMap((part) => part.agendaItemIds)),
    classroomIds: unique(parts.flatMap((part) => part.classroomIds)),
    subjectIds: unique(parts.flatMap((part) => part.subjectIds)),
    membershipIds: unique(parts.flatMap((part) => part.membershipIds)),
    studentAccessIds: unique(parts.flatMap((part) => part.studentAccessIds)),
    publicationTemplateIds: unique(parts.flatMap((part) => part.publicationTemplateIds)),
    timetableSlotIds: unique(parts.flatMap((part) => part.timetableSlotIds)),
    timetableMappingKeys: uniqueMappings(parts.flatMap((part) => part.timetableMappingKeys)),
  };
  return plan;
}

function uniqueMappings(
  keys: Array<{ importId: string; classCode: string }>,
): Array<{ importId: string; classCode: string }> {
  const seen = new Set<string>();
  const next: Array<{ importId: string; classCode: string }> = [];
  for (const key of keys) {
    const stamp = `${key.importId}:${normalizeClassCode(key.classCode)}`;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    next.push(key);
  }
  return next;
}

function emptyPlan(
  kind: CatalogDeleteKind,
  target: CatalogDeletePlan["target"],
  confirmationText: string,
): CatalogDeletePlan {
  return {
    kind,
    target,
    confirmationText,
    counts: emptyCatalogDeleteCounts(),
    classIds: [],
    professionIds: [],
    branchIds: [],
    contextIds: [],
    annualCourseIds: [],
    assignmentIds: [],
    assignmentEventIds: [],
    annualCourseNoteIds: [],
    courseScheduleSlotIds: [],
    attendanceDayIds: [],
    agendaItemIds: [],
    classroomIds: [],
    subjectIds: [],
    membershipIds: [],
    studentAccessIds: [],
    publicationTemplateIds: [],
    timetableSlotIds: [],
    timetableMappingKeys: [],
  };
}

function finalizeCounts(plan: CatalogDeletePlan, snapshot: CatalogDeleteSnapshot): CatalogDeletePlan {
  const pathIds = new Set(snapshot.paths.filter((path) => plan.contextIds.includes(path.contextId)).map((path) => path.contextId));
  const setupCount = snapshot.teacherSetups.filter((entry) =>
    entry.config.classes.some((item) => plan.classroomIds.includes(item.id)),
  ).length;
  const noteCount = snapshot.teacherNotes.filter((entry) =>
    Object.keys(entry.document.weeks).some((key) =>
      plan.classroomIds.some((classroomId) => key.startsWith(`${classroomId}:`)),
    ),
  ).length;
  plan.counts = {
    classes: plan.classIds.length,
    professions: plan.professionIds.length,
    branches: plan.branchIds.length,
    contexts: plan.contextIds.length,
    pedagogicalPaths: pathIds.size,
    annualCourses: plan.annualCourseIds.length,
    assignments: plan.assignmentIds.length,
    assignmentEvents: plan.assignmentEventIds.length,
    annualCourseNotes: plan.annualCourseNoteIds.length,
    courseScheduleSlots: plan.courseScheduleSlotIds.length,
    attendanceDays: plan.attendanceDayIds.length,
    publications: plan.agendaItemIds.length,
    memberships: plan.membershipIds.length,
    studentAccesses: plan.studentAccessIds.length,
    classrooms: plan.classroomIds.length,
    subjects: plan.subjectIds.length,
    timetableSlots: plan.timetableSlotIds.length,
    timetableClassMappings: plan.timetableMappingKeys.length,
    publicationTemplates: plan.publicationTemplateIds.length,
    teacherSetups: setupCount,
    teacherNotes: noteCount,
  };
  return plan;
}

export function exclusiveClassroomIds(
  schoolClass: SchoolClassRecord,
  snapshot: CatalogDeleteSnapshot,
): string[] {
  const ids: string[] = [];
  for (const classroom of snapshot.classrooms) {
    if (classroom.schoolClassId && classroom.schoolClassId !== schoolClass.id) continue;
    if (classroom.schoolClassId === schoolClass.id || classroom.id === schoolClass.id) {
      ids.push(classroom.id);
      continue;
    }
    if (!runtimeClassroomRefersToSchoolClass(classroom.id, schoolClass, snapshot.classrooms)) {
      continue;
    }
    const claimedByOther = snapshot.classes.some(
      (other) =>
        other.id !== schoolClass.id &&
        runtimeClassroomRefersToSchoolClass(classroom.id, other, snapshot.classrooms),
    );
    if (!claimedByOther) ids.push(classroom.id);
  }
  return unique(ids);
}

function timetableBelongsToClass(
  slot: { classCode: string; schoolYearId: string | null },
  schoolClass: SchoolClassRecord,
  snapshot: CatalogDeleteSnapshot,
): boolean {
  if (normalizeClassCode(slot.classCode) !== normalizeClassCode(schoolClass.code)) return false;
  if (schoolClass.schoolYearId) {
    if (slot.schoolYearId == null) return true;
    return slot.schoolYearId === schoolClass.schoolYearId;
  }
  const twins = snapshot.classes.filter(
    (entry) => normalizeClassCode(entry.code) === normalizeClassCode(schoolClass.code),
  );
  return twins.length <= 1;
}

function attachCourseGraph(plan: CatalogDeletePlan, courseIds: string[], snapshot: CatalogDeleteSnapshot): void {
  plan.annualCourseIds = unique([...plan.annualCourseIds, ...courseIds]);
  plan.assignmentIds = unique([
    ...plan.assignmentIds,
    ...snapshot.assignments.filter((entry) => courseIds.includes(entry.annualCourseId)).map((entry) => entry.id),
  ]);
  plan.assignmentEventIds = unique([
    ...plan.assignmentEventIds,
    ...snapshot.events.filter((entry) => courseIds.includes(entry.annualCourseId)).map((entry) => entry.id),
  ]);
  plan.courseScheduleSlotIds = unique([
    ...plan.courseScheduleSlotIds,
    ...snapshot.scheduleSlots.filter((entry) => courseIds.includes(entry.annualCourseId)).map((entry) => entry.id),
  ]);
  plan.annualCourseNoteIds = unique([
    ...plan.annualCourseNoteIds,
    ...snapshot.notes
      .filter(
        (note) =>
          (note.annualCourseId && courseIds.includes(note.annualCourseId)) ||
          plan.classIds.includes(note.classId) ||
          plan.contextIds.includes(note.contextId),
      )
      .map((note) => note.id),
  ]);
  plan.subjectIds = unique([
    ...plan.subjectIds,
    ...snapshot.subjects
      .filter((subject) => subject.annualCourseId && courseIds.includes(subject.annualCourseId))
      .map((subject) => subject.id),
  ]);
  plan.agendaItemIds = unique([
    ...plan.agendaItemIds,
    ...snapshot.agendaItems
      .filter((item) => item.annualCourseId && courseIds.includes(item.annualCourseId))
      .map((item) => item.id),
  ]);
}

function attachTemplates(plan: CatalogDeletePlan, snapshot: CatalogDeleteSnapshot): void {
  const agendaIds = new Set(plan.agendaItemIds);
  plan.publicationTemplateIds = unique([
    ...plan.publicationTemplateIds,
    ...snapshot.templates
      .filter((template) => template.sourceItemId != null && agendaIds.has(template.sourceItemId))
      .map((template) => template.id),
  ]);
}

export function planSchoolClassDelete(
  schoolClass: SchoolClassRecord,
  snapshot: CatalogDeleteSnapshot,
): CatalogDeletePlan {
  const plan = emptyPlan(
    "class",
    { id: schoolClass.id, kind: "class", code: schoolClass.code, label: schoolClass.label },
    schoolClass.code,
  );
  plan.classIds = [schoolClass.id];

  const courseIds = snapshot.courses.filter((course) => course.classId === schoolClass.id).map((course) => course.id);
  attachCourseGraph(plan, courseIds, snapshot);

  plan.annualCourseNoteIds = unique([
    ...plan.annualCourseNoteIds,
    ...snapshot.notes.filter((note) => note.classId === schoolClass.id).map((note) => note.id),
  ]);
  plan.attendanceDayIds = snapshot.attendanceDays
    .filter((day) => day.classId === schoolClass.id)
    .map((day) => day.id);

  const classroomIds = exclusiveClassroomIds(schoolClass, snapshot);
  plan.classroomIds = classroomIds;
  plan.subjectIds = unique([
    ...plan.subjectIds,
    ...snapshot.subjects.filter((subject) => classroomIds.includes(subject.classroomId)).map((subject) => subject.id),
  ]);
  plan.membershipIds = snapshot.memberships
    .filter((membership) => classroomIds.includes(membership.classroomId))
    .map((membership) => membership.id);
  plan.studentAccessIds = snapshot.studentAccesses
    .filter(
      (access) =>
        access.schoolClassId === schoolClass.id || classroomIds.includes(access.classroomId),
    )
    .map((access) => access.id);

  plan.agendaItemIds = unique([
    ...plan.agendaItemIds,
    ...snapshot.agendaItems
      .filter((item) => agendaItemBlocksClassDeletion(item, schoolClass, snapshot.classes, snapshot.classrooms))
      .map((item) => item.id),
  ]);

  plan.timetableSlotIds = snapshot.timetableSlots
    .filter((slot) => timetableBelongsToClass(slot, schoolClass, snapshot))
    .map((slot) => slot.id);
  plan.timetableMappingKeys = snapshot.timetableMappings
    .filter((mapping) =>
      timetableBelongsToClass(
        {
          classCode: mapping.classCode,
          schoolYearId:
            snapshot.timetableSlots.find(
              (slot) => slot.importId === mapping.importId && normalizeClassCode(slot.classCode) === normalizeClassCode(mapping.classCode),
            )?.schoolYearId ?? null,
        },
        schoolClass,
        snapshot,
      ),
    )
    .map((mapping) => ({ importId: mapping.importId, classCode: mapping.classCode }));

  attachTemplates(plan, snapshot);
  return finalizeCounts(plan, snapshot);
}

export function planContextDelete(
  contextId: string,
  snapshot: CatalogDeleteSnapshot,
): CatalogDeletePlan | null {
  const context = snapshot.contexts.find((entry) => entry.id === contextId);
  if (!context) return null;
  const plan = emptyPlan(
    "context",
    { id: context.id, kind: "context", code: context.adminCode, label: context.adminCode },
    context.adminCode,
  );
  plan.contextIds = [context.id];
  const courseIds = snapshot.courses.filter((course) => course.contextId === context.id).map((course) => course.id);
  attachCourseGraph(plan, courseIds, snapshot);
  plan.annualCourseNoteIds = unique([
    ...plan.annualCourseNoteIds,
    ...snapshot.notes.filter((note) => note.contextId === context.id).map((note) => note.id),
  ]);
  attachTemplates(plan, snapshot);
  return finalizeCounts(plan, snapshot);
}

export function planBranchDelete(
  branchId: string,
  snapshot: CatalogDeleteSnapshot,
): CatalogDeletePlan | null {
  const branch = snapshot.branches.find((entry) => entry.id === branchId);
  if (!branch) return null;
  const contexts = snapshot.contexts.filter((entry) => entry.branchId === branch.id);
  const parts = contexts
    .map((context) => planContextDelete(context.id, snapshot))
    .filter((plan): plan is CatalogDeletePlan => Boolean(plan));
  const plan = mergePlans(
    "branch",
    { id: branch.id, kind: "branch", code: branch.code, label: branch.label },
    branch.label,
    parts,
  );
  plan.branchIds = [branch.id];
  return finalizeCounts(plan, snapshot);
}

export function planProfessionDelete(
  professionId: string,
  snapshot: CatalogDeleteSnapshot,
): CatalogDeletePlan | null {
  const profession = snapshot.professions.find((entry) => entry.id === professionId);
  if (!profession) return null;
  const classPlans = snapshot.classes
    .filter((entry) => entry.professionId === profession.id)
    .map((entry) => planSchoolClassDelete(entry, snapshot));
  const contextPlans = snapshot.contexts
    .filter((entry) => entry.professionId === profession.id)
    .map((entry) => planContextDelete(entry.id, snapshot))
    .filter((plan): plan is CatalogDeletePlan => Boolean(plan));
  const plan = mergePlans(
    "profession",
    { id: profession.id, kind: "profession", code: profession.adminCode, label: profession.label },
    profession.adminCode,
    [...classPlans, ...contextPlans],
  );
  plan.professionIds = [profession.id];
  return finalizeCounts(plan, snapshot);
}

export function buildCatalogDeletePlan(
  kind: CatalogDeleteKind,
  id: string,
  snapshot: CatalogDeleteSnapshot,
): CatalogDeletePlan | null {
  if (kind === "class") {
    const schoolClass = snapshot.classes.find((entry) => entry.id === id);
    return schoolClass ? planSchoolClassDelete(schoolClass, snapshot) : null;
  }
  if (kind === "profession") return planProfessionDelete(id, snapshot);
  if (kind === "branch") return planBranchDelete(id, snapshot);
  return planContextDelete(id, snapshot);
}
