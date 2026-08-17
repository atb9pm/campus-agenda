import type { Classroom, Subject } from "../../types/classroom.ts";
import type { Membership } from "../../types/membership.ts";
import type { StudentAccess } from "../../types/student-access.ts";
import type { Teacher } from "../../types/teacher.ts";

/** Enseignant connecté dans la démonstration. */
export const DEMO_CURRENT_TEACHER_ID = "teacher-demo-current";

export const DEMO_TEACHERS: Teacher[] = [
  { id: DEMO_CURRENT_TEACHER_ID, displayName: "Professeur démo", initials: "FC" },
  { id: "teacher-demo-dupont", displayName: "Mme Dupont · démo", initials: "MD" },
  { id: "teacher-demo-martin", displayName: "M. Martin · démo", initials: "MM" },
  { id: "teacher-demo-bernard", displayName: "Mme Bernard · démo", initials: "MB" },
  { id: "teacher-demo-robert", displayName: "M. Robert · démo", initials: "MR" },
];

export const DEMO_CLASSROOMS: Classroom[] = [
  {
    id: "classe-demo-tma-2a",
    name: "2e TMA",
    programLabel: "Technique Mécanique Automobile",
    accessCodeHint: "TMA 2A78",
  },
  {
    id: "classe-demo-tma-1a",
    name: "1re TMA",
    programLabel: "Technique Mécanique Automobile",
    accessCodeHint: "TMA 1B42",
  },
];

export const DEMO_SUBJECTS: Subject[] = [
  { id: "subject-demo-moteur-2a", classroomId: "classe-demo-tma-2a", name: "Moteur" },
  { id: "subject-demo-electricite-2a", classroomId: "classe-demo-tma-2a", name: "Électricité" },
  { id: "subject-demo-chassis-2a", classroomId: "classe-demo-tma-2a", name: "Châssis" },
  { id: "subject-demo-maths-2a", classroomId: "classe-demo-tma-2a", name: "Mathématiques" },
  { id: "subject-demo-atelier-2a", classroomId: "classe-demo-tma-2a", name: "Atelier" },
  { id: "subject-demo-moteur-1a", classroomId: "classe-demo-tma-1a", name: "Moteur" },
  { id: "subject-demo-electricite-1a", classroomId: "classe-demo-tma-1a", name: "Électricité" },
  { id: "subject-demo-chassis-1a", classroomId: "classe-demo-tma-1a", name: "Châssis" },
];

export const DEMO_MEMBERSHIPS: Membership[] = [
  {
    id: "membership-demo-current-2a",
    teacherId: DEMO_CURRENT_TEACHER_ID,
    classroomId: "classe-demo-tma-2a",
    subjectIds: ["subject-demo-moteur-2a", "subject-demo-electricite-2a"],
  },
  {
    id: "membership-demo-dupont-2a",
    teacherId: "teacher-demo-dupont",
    classroomId: "classe-demo-tma-2a",
    subjectIds: ["subject-demo-chassis-2a", "subject-demo-atelier-2a"],
  },
  {
    id: "membership-demo-martin-2a",
    teacherId: "teacher-demo-martin",
    classroomId: "classe-demo-tma-2a",
    subjectIds: ["subject-demo-moteur-2a", "subject-demo-maths-2a"],
  },
  {
    id: "membership-demo-bernard-2a",
    teacherId: "teacher-demo-bernard",
    classroomId: "classe-demo-tma-2a",
    subjectIds: ["subject-demo-electricite-2a"],
  },
  {
    id: "membership-demo-robert-2a",
    teacherId: "teacher-demo-robert",
    classroomId: "classe-demo-tma-2a",
    subjectIds: ["subject-demo-moteur-2a", "subject-demo-chassis-2a"],
  },
  {
    id: "membership-demo-current-1a",
    teacherId: DEMO_CURRENT_TEACHER_ID,
    classroomId: "classe-demo-tma-1a",
    subjectIds: ["subject-demo-moteur-1a", "subject-demo-chassis-1a"],
  },
  {
    id: "membership-demo-martin-1a",
    teacherId: "teacher-demo-martin",
    classroomId: "classe-demo-tma-1a",
    subjectIds: ["subject-demo-electricite-1a"],
  },
];

export const DEMO_STUDENT_ACCESSES: StudentAccess[] = [
  { id: "student-access-demo-2a", classroomId: "classe-demo-tma-2a", label: "eleve-test-001" },
  { id: "student-access-demo-1a", classroomId: "classe-demo-tma-1a", label: "eleve-test-002" },
];

export interface DemoCatalog {
  teachers: Teacher[];
  classrooms: Classroom[];
  subjects: Subject[];
  memberships: Membership[];
  studentAccesses: StudentAccess[];
}

export const DEMO_CATALOG: DemoCatalog = {
  teachers: DEMO_TEACHERS,
  classrooms: DEMO_CLASSROOMS,
  subjects: DEMO_SUBJECTS,
  memberships: DEMO_MEMBERSHIPS,
  studentAccesses: DEMO_STUDENT_ACCESSES,
};
