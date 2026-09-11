import { setMemoryMemberships } from "../../lib/persistence/memory-membership-store.ts";
import { exportMemoryTemplates, replaceMemoryTemplates } from "../../lib/persistence/memory-template-store.ts";
import {
  exportMemoryTimetableTables,
  replaceMemoryTimetableTables,
} from "../../lib/persistence/memory-timetable-store.ts";
import type { AnnualCourseNote } from "../pedagogical-path/index.ts";
import type { TeacherDeletePlan } from "./types.ts";
import type { TeacherDeleteSnapshotDeps } from "./snapshot.ts";

interface AnnualNotesBulkStore {
  exportAllNotes(): AnnualCourseNote[];
  replaceAllNotes(notes: AnnualCourseNote[]): void;
}

export async function applyTeacherDeleteInMemory(
  plan: TeacherDeletePlan,
  deps: TeacherDeleteSnapshotDeps,
): Promise<void> {
  const teacherId = plan.target.id;
  const templateIds = new Set(plan.templateIds);

  const agendaItems = await deps.agenda.exportAllItems();
  await deps.agenda.replaceAllItems(
    agendaItems.map((item) => ({
      ...item,
      authorTeacherId: item.authorTeacherId === teacherId ? "" : item.authorTeacherId,
      templateId: item.templateId && templateIds.has(item.templateId) ? null : item.templateId,
    })),
  );

  replaceMemoryTemplates(exportMemoryTemplates().filter((entry) => entry.ownerTeacherId !== teacherId));

  const memberships = await deps.memberships.listMemberships();
  setMemoryMemberships(memberships.filter((entry) => entry.teacherId !== teacherId));

  const courses = await deps.courses.listCourses();
  const assignments = await deps.courses.listAssignments();
  const events = await deps.courses.listEvents();
  if ("replaceSnapshot" in deps.courses && typeof deps.courses.replaceSnapshot === "function") {
    deps.courses.replaceSnapshot({
      courses,
      assignments: assignments.filter((entry) => entry.teacherId !== teacherId),
      events: events.filter((entry) => entry.teacherId !== teacherId),
    });
  }

  const setups = await deps.teacherSetups.exportAllSetups();
  await deps.teacherSetups.replaceAllSetups(setups.filter((entry) => entry.teacherId !== teacherId));

  const notes = await deps.teacherNotes.exportAllNotes();
  await deps.teacherNotes.replaceAllNotes(notes.filter((entry) => entry.teacherId !== teacherId));

  if (deps.notes && "exportAllNotes" in deps.notes && "replaceAllNotes" in deps.notes) {
    const annual = deps.notes as unknown as AnnualNotesBulkStore;
    annual.replaceAllNotes(
      annual.exportAllNotes().map((note) =>
        note.authorTeacherId === teacherId ? { ...note, authorTeacherId: "" } : note,
      ),
    );
  }

  const timetable = exportMemoryTimetableTables();
  replaceMemoryTimetableTables({
    ...timetable,
    timetable_teacher_codes: timetable.timetable_teacher_codes.map((row) =>
      row.teacher_id === teacherId ? { ...row, teacher_id: null } : row,
    ),
  });

  await deps.accounts.deleteAccount(teacherId);
}
