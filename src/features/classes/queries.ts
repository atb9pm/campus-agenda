import { filterActiveMemberships } from "../memberships/validity.ts";
import type { Classroom, Subject } from "../../types/classroom.ts";
import type { Membership } from "../../types/membership.ts";
import type { Teacher } from "../../types/teacher.ts";

export interface ClassroomCatalog {
  classrooms: Classroom[];
  subjects: Subject[];
  memberships: Membership[];
  teachers: Teacher[];
}

export function getClassroomById(catalog: ClassroomCatalog, classroomId: string): Classroom | undefined {
  return catalog.classrooms.find((classroom) => classroom.id === classroomId);
}

export function getSubjectsForClassroom(catalog: ClassroomCatalog, classroomId: string): Subject[] {
  return catalog.subjects
    .filter((subject) => subject.classroomId === classroomId)
    .sort((left, right) => left.name.localeCompare(right.name, "fr"));
}

export function getSubjectById(catalog: ClassroomCatalog, subjectId: string): Subject | undefined {
  return catalog.subjects.find((subject) => subject.id === subjectId);
}

export function getMembershipsForClassroom(
  catalog: ClassroomCatalog,
  classroomId: string,
  at?: string | Date,
): Membership[] {
  return filterActiveMemberships(
    catalog.memberships.filter((membership) => membership.classroomId === classroomId),
    at,
  );
}

export function getMembershipsForTeacher(
  catalog: ClassroomCatalog,
  teacherId: string,
  at?: string | Date,
): Membership[] {
  return filterActiveMemberships(
    catalog.memberships.filter((membership) => membership.teacherId === teacherId),
    at,
  );
}

export function getClassroomsForTeacher(catalog: ClassroomCatalog, teacherId: string): Classroom[] {
  const classroomIds = new Set(
    getMembershipsForTeacher(catalog, teacherId).map((membership) => membership.classroomId),
  );

  return catalog.classrooms.filter((classroom) => classroomIds.has(classroom.id));
}

export function getTeachersInClassroom(catalog: ClassroomCatalog, classroomId: string): Teacher[] {
  const teacherIds = new Set(
    getMembershipsForClassroom(catalog, classroomId).map((membership) => membership.teacherId),
  );

  return catalog.teachers.filter((teacher) => teacherIds.has(teacher.id));
}

export function getTeacherById(catalog: ClassroomCatalog, teacherId: string): Teacher | undefined {
  return catalog.teachers.find((teacher) => teacher.id === teacherId);
}

export function teacherTeachesSubject(
  catalog: ClassroomCatalog,
  teacherId: string,
  classroomId: string,
  subjectId: string,
  at?: string | Date,
): boolean {
  return getMembershipsForTeacher(catalog, teacherId, at).some(
    (membership) =>
      membership.classroomId === classroomId && membership.subjectIds.includes(subjectId),
  );
}

export function getSubjectsForTeacherInClassroom(
  catalog: ClassroomCatalog,
  teacherId: string,
  classroomId: string,
): Subject[] {
  const subjectIds = new Set<string>();

  for (const membership of getMembershipsForTeacher(catalog, teacherId)) {
    if (membership.classroomId !== classroomId) continue;
    for (const subjectId of membership.subjectIds) {
      subjectIds.add(subjectId);
    }
  }

  return getSubjectsForClassroom(catalog, classroomId).filter((subject) => subjectIds.has(subject.id));
}

export function countTeachersInClassroom(catalog: ClassroomCatalog, classroomId: string): number {
  return getTeachersInClassroom(catalog, classroomId).length;
}

export function countBranchesInClassroom(catalog: ClassroomCatalog, classroomId: string): number {
  return getSubjectsForClassroom(catalog, classroomId).length;
}
