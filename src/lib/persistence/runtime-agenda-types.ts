import type { Classroom, Subject } from "../../types/classroom.ts";

/** Classroom runtime Agenda, éventuellement relié à une SchoolClass. */
export type RuntimeClassroom = Classroom;

/** Subject runtime Agenda, éventuellement relié à un AnnualCourse. */
export type RuntimeSubject = Subject;

export type RuntimeClassroomListItem = {
  id: string;
  name: string;
  schoolClassId?: string | null;
};

/**
 * Adaptateur runtime Agenda (classrooms / subjects).
 * Memory et SQLite exposent le même contrat.
 */
export interface RuntimeAgendaAdapterStore {
  listClassrooms(): Promise<RuntimeClassroom[]>;
  findClassroomById(id: string): Promise<RuntimeClassroom | null>;
  findClassroomBySchoolClassId(schoolClassId: string): Promise<RuntimeClassroom | null>;
  upsertClassroom(classroom: RuntimeClassroom): Promise<RuntimeClassroom>;

  listSubjects(): Promise<RuntimeSubject[]>;
  findSubjectById(id: string): Promise<RuntimeSubject | null>;
  findSubjectByAnnualCourseId(annualCourseId: string): Promise<RuntimeSubject | null>;
  upsertSubject(subject: RuntimeSubject): Promise<RuntimeSubject>;
}
