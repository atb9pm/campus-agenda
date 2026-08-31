import type { AnnualCourseNotesStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import type { MembershipStore } from "../../lib/persistence/membership-types.ts";
import type { TimetableStore } from "../../lib/persistence/timetable-types.ts";
import type { ClassDeleteUsage, RuntimeClassroomRef } from "./class-delete-blockers.ts";
import type { SchoolClassRecord } from "./types.ts";

export async function loadClassDeleteUsage(options: {
  schoolClass: SchoolClassRecord;
  courses: AnnualCourseStore;
  notes: AnnualCourseNotesStore;
  agenda: AgendaStore;
  timetable: TimetableStore;
  memberships: MembershipStore;
  classrooms: RuntimeClassroomRef[];
  studentAccesses: Array<{ classroomId: string }>;
}): Promise<ClassDeleteUsage> {
  const [courses, assignments, noteCount, agendaItems, memberships, timetableSlots] =
    await Promise.all([
      options.courses.listCourses(),
      options.courses.listAssignments(),
      options.notes.countByClassId(options.schoolClass.id),
      options.agenda.exportAllItems(),
      options.memberships.listMemberships(),
      options.timetable.listClassSlotsAcrossImports(options.schoolClass.code),
    ]);
  return {
    classrooms: options.classrooms,
    courses,
    assignments,
    notes: Array.from({ length: noteCount }, () => ({ classId: options.schoolClass.id })),
    agendaItems,
    timetableSlots,
    linkedClassroomIds: memberships.map((entry) => entry.classroomId),
    studentAccesses: options.studentAccesses,
  };
}
