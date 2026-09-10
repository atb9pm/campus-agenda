import {
  getMemoryLegacySchool,
  replaceMemoryLegacySchool,
} from "../../lib/persistence/memory-legacy-school.ts";
import { setMemoryMemberships } from "../../lib/persistence/memory-membership-store.ts";
import { exportMemoryTemplates, replaceMemoryTemplates } from "../../lib/persistence/memory-template-store.ts";
import {
  exportMemoryTimetableTables,
  replaceMemoryTimetableTables,
} from "../../lib/persistence/memory-timetable-store.ts";
import type { AnnualCourseNote } from "../pedagogical-path/index.ts";
import type { CatalogDeleteSnapshotDeps } from "./snapshot.ts";
import type { CatalogDeletePlan } from "./types.ts";

interface AnnualNotesBulkStore {
  exportAllNotes(): AnnualCourseNote[];
  replaceAllNotes(notes: AnnualCourseNote[]): void;
}

function withoutIds<T extends { id: string | number }>(rows: T[], ids: Array<string | number>): T[] {
  const banned = new Set(ids.map(String));
  return rows.filter((row) => !banned.has(String(row.id)));
}

export async function applyCatalogDeleteInMemory(
  plan: CatalogDeletePlan,
  deps: CatalogDeleteSnapshotDeps,
): Promise<void> {
  const classroomIds = new Set(plan.classroomIds);
  const agendaItems = await deps.agenda.exportAllItems();
  await deps.agenda.replaceAllItems(withoutIds(agendaItems, plan.agendaItemIds));

  const subjectBanned = new Set(plan.subjectIds);
  const stripSubjects = <T extends { id: string; subjectIds: string[] }>(entry: T): T => ({
    ...entry,
    subjectIds: entry.subjectIds.filter((id) => !subjectBanned.has(id)),
  });

  const legacy = getMemoryLegacySchool();
  replaceMemoryLegacySchool({
    classrooms: legacy.classrooms.filter((entry) => !classroomIds.has(entry.id)),
    subjects: legacy.subjects.filter((entry) => !plan.subjectIds.includes(entry.id)),
    studentAccesses: legacy.studentAccesses.filter((entry) => !plan.studentAccessIds.includes(entry.id)),
    memberships: legacy.memberships
      .filter((entry) => !plan.membershipIds.includes(entry.id))
      .map(stripSubjects),
  });

  const memberships = await deps.memberships.listMemberships();
  setMemoryMemberships(
    memberships.filter((entry) => !plan.membershipIds.includes(entry.id)).map(stripSubjects),
  );

  const accesses = await deps.studentAccesses.listAll();
  await deps.studentAccesses.replaceAll(accesses.filter((entry) => !plan.studentAccessIds.includes(entry.id)));

  replaceMemoryTemplates(
    exportMemoryTemplates().filter((entry) => !plan.publicationTemplateIds.includes(entry.id)),
  );

  const courses = await deps.courses.listCourses();
  const assignments = await deps.courses.listAssignments();
  const events = await deps.courses.listEvents();
  if ("replaceSnapshot" in deps.courses && typeof deps.courses.replaceSnapshot === "function") {
    deps.courses.replaceSnapshot({
      courses: courses.filter((entry) => !plan.annualCourseIds.includes(entry.id)),
      assignments: assignments.filter((entry) => !plan.assignmentIds.includes(entry.id)),
      events: events.filter((entry) => !plan.assignmentEventIds.includes(entry.id)),
    });
  } else {
    for (const id of plan.annualCourseIds) await deps.courses.deleteCourse(id);
  }

  if ("replaceSnapshot" in deps.schedules && typeof deps.schedules.replaceSnapshot === "function") {
    const slots = await deps.schedules.listSlots();
    const days = await deps.schedules.listAttendanceDays();
    deps.schedules.replaceSnapshot(
      slots.filter((entry) => !plan.courseScheduleSlotIds.includes(entry.id)),
      days.filter((entry) => !plan.attendanceDayIds.includes(entry.id)),
    );
  } else {
    for (const id of plan.courseScheduleSlotIds) await deps.schedules.deleteSlot(id);
    for (const classId of plan.classIds) await deps.schedules.replaceAttendanceDaysForClass(classId, []);
  }

  const bulkNotes = deps.notes as Partial<AnnualNotesBulkStore>;
  if (typeof bulkNotes.exportAllNotes === "function" && typeof bulkNotes.replaceAllNotes === "function") {
    const exported = bulkNotes.exportAllNotes();
    bulkNotes.replaceAllNotes(exported.filter((note) => !plan.annualCourseNoteIds.includes(note.id)));
  } else {
    for (const id of plan.annualCourseNoteIds) await deps.notes.deleteNote(id);
  }

  for (const contextId of plan.contextIds) {
    await deps.paths.deletePathByContextId(contextId);
  }

  for (const id of plan.classIds) await deps.catalog.deleteClass(id);
  for (const id of plan.contextIds) {
    const result = await deps.catalog.deleteContext(id);
    if (!result.ok && !result.reason.includes("introuvable")) {
      throw new Error(result.reason);
    }
  }
  for (const id of plan.branchIds) {
    const result = await deps.catalog.deleteBranch(id);
    if (!result.ok && !result.reason.includes("introuvable")) {
      throw new Error(result.reason);
    }
  }
  for (const id of plan.professionIds) {
    const result = await deps.catalog.deleteProfession(id);
    if (!result.ok && !result.reason.includes("introuvable")) {
      throw new Error(result.reason);
    }
  }

  const setups = await deps.teacherSetups.exportAllSetups();
  await deps.teacherSetups.replaceAllSetups(
    setups.map((entry) => ({
      ...entry,
      config: {
        ...entry.config,
        classes: entry.config.classes.filter((item) => !classroomIds.has(item.id)),
      },
    })),
  );

  const teacherNotes = await deps.teacherNotes.exportAllNotes();
  await deps.teacherNotes.replaceAllNotes(
    teacherNotes.map((entry) => {
      const weeks = { ...entry.document.weeks };
      for (const key of Object.keys(weeks)) {
        if (plan.classroomIds.some((classroomId) => key.startsWith(`${classroomId}:`))) {
          delete weeks[key];
        }
      }
      return { ...entry, document: { ...entry.document, weeks } };
    }),
  );

  const tables = exportMemoryTimetableTables();
  const slotIds = new Set(plan.timetableSlotIds);
  const mappingKeys = new Set(
    plan.timetableMappingKeys.map((key) => `${key.importId}:${key.classCode.toUpperCase()}`),
  );
  replaceMemoryTimetableTables({
    ...tables,
    timetable_slots: tables.timetable_slots.filter((row) => !slotIds.has(String(row.id))),
    timetable_class_mappings: tables.timetable_class_mappings.filter(
      (row) => !mappingKeys.has(`${String(row.import_id)}:${String(row.class_code).toUpperCase()}`),
    ),
  });
}
