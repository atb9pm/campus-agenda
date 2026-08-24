import type { Classroom, Subject } from "../../types/classroom.ts";
import type { Membership } from "../../types/membership.ts";
import type { StudentAccess } from "../../types/student-access.ts";
import type { Teacher } from "../../types/teacher.ts";
import {
  CHF_CLASSROOMS,
  CHF_MEMBERSHIPS,
  CHF_STUDENT_ACCESSES,
  CHF_SUBJECTS,
  CHF_TEACHER,
  TEACHER_CHF_ID,
} from "./chf-catalog.ts";

/** Enseignant démo historique (tests automatisés). */
export const TEACHER_DEMO_ID = "teacher-demo-current";

/** Enseignant connecté par défaut dans l'application. */
export const DEMO_CURRENT_TEACHER_ID = TEACHER_CHF_ID;

export const DEMO_TEACHERS: Teacher[] = [
  CHF_TEACHER,
  { id: TEACHER_DEMO_ID, displayName: "Professeur démo", initials: "FC" },
  { id: "teacher-demo-dupont", displayName: "Mme Dupont · démo", initials: "MD" },
  { id: "teacher-demo-martin", displayName: "M. Martin · démo", initials: "MM" },
  { id: "teacher-demo-bernard", displayName: "Mme Bernard · démo", initials: "MB" },
  { id: "teacher-demo-robert", displayName: "M. Robert · démo", initials: "MR" },
];

export const DEMO_CLASSROOMS: Classroom[] = [
  ...CHF_CLASSROOMS,
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
  ...CHF_SUBJECTS,
  { id: "subject-demo-moteur-2a", classroomId: "classe-demo-tma-2a", name: "Moteur" },
  { id: "subject-demo-electricite-2a", classroomId: "classe-demo-tma-2a", name: "Électricité" },
  { id: "subject-demo-chassis-2a", classroomId: "classe-demo-tma-2a", name: "Châssis" },
  { id: "subject-demo-maths-2a", classroomId: "classe-demo-tma-2a", name: "Mathématiques" },
  { id: "subject-demo-atelier-2a", classroomId: "classe-demo-tma-2a", name: "Atelier" },
  { id: "subject-demo-moteur-1a", classroomId: "classe-demo-tma-1a", name: "Moteur" },
  { id: "subject-demo-electricite-1a", classroomId: "classe-demo-tma-1a", name: "Électricité" },
  { id: "subject-demo-chassis-1a", classroomId: "classe-demo-tma-1a", name: "Châssis" },
];

const DEMO_MEMBERSHIP_START = "2026-08-01T00:00:00.000Z";

export const DEMO_MEMBERSHIPS: Membership[] = [
  ...CHF_MEMBERSHIPS,
  {
    id: "membership-demo-current-2a",
    teacherId: TEACHER_DEMO_ID,
    classroomId: "classe-demo-tma-2a",
    subjectIds: ["subject-demo-moteur-2a", "subject-demo-electricite-2a"],
    validFrom: DEMO_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-demo-dupont-2a",
    teacherId: "teacher-demo-dupont",
    classroomId: "classe-demo-tma-2a",
    subjectIds: ["subject-demo-chassis-2a", "subject-demo-atelier-2a"],
    validFrom: DEMO_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-demo-martin-2a",
    teacherId: "teacher-demo-martin",
    classroomId: "classe-demo-tma-2a",
    subjectIds: ["subject-demo-moteur-2a", "subject-demo-maths-2a"],
    validFrom: DEMO_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-demo-bernard-2a",
    teacherId: "teacher-demo-bernard",
    classroomId: "classe-demo-tma-2a",
    subjectIds: ["subject-demo-electricite-2a"],
    validFrom: DEMO_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-demo-robert-2a",
    teacherId: "teacher-demo-robert",
    classroomId: "classe-demo-tma-2a",
    subjectIds: ["subject-demo-moteur-2a", "subject-demo-chassis-2a"],
    validFrom: DEMO_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-demo-current-1a",
    teacherId: TEACHER_DEMO_ID,
    classroomId: "classe-demo-tma-1a",
    subjectIds: ["subject-demo-moteur-1a", "subject-demo-chassis-1a"],
    validFrom: DEMO_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-demo-martin-1a",
    teacherId: "teacher-demo-martin",
    classroomId: "classe-demo-tma-1a",
    subjectIds: ["subject-demo-electricite-1a"],
    validFrom: DEMO_MEMBERSHIP_START,
    validTo: null,
  },
];

export const DEMO_STUDENT_ACCESSES: StudentAccess[] = [
  ...CHF_STUDENT_ACCESSES,
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

export { TEACHER_CHF_ID } from "./chf-catalog.ts";
