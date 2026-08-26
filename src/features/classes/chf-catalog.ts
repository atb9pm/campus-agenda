import type { Classroom, Subject } from "../../types/classroom.ts";
import type { Membership } from "../../types/membership.ts";
import type { StudentAccess } from "../../types/student-access.ts";
import type { Teacher } from "../../types/teacher.ts";

/** Compte enseignant François Cheseaux — code grille horaire : ChF */
export const TEACHER_CHF_ID = "teacher-chf";

export const CHF_TEACHER: Teacher = {
  id: TEACHER_CHF_ID,
  displayName: "François Cheseaux (ChF)",
  initials: "ChF",
};

const CHF_MEMBERSHIP_START = "2026-08-01T00:00:00.000Z";

/** Classes extraites du PDF Horaire_MA_2026_2027_Vdef.pdf (créneaux ChF). */
export const CHF_CLASSROOMS: Classroom[] = [
  { id: "classe-chf-ma2", name: "MA2", programLabel: "Mécanique automobile", accessCodeHint: "MA2" },
  { id: "classe-chf-ma3b", name: "MA3B", programLabel: "Mécanique automobile", accessCodeHint: "MA3B" },
  { id: "classe-chf-ma3ab", name: "MA3A-B", programLabel: "Mécanique automobile", accessCodeHint: "MA3A-B" },
  { id: "classe-chf-mma1c", name: "MMA1C", programLabel: "MMA", accessCodeHint: "MMA1C" },
  { id: "classe-chf-mma2c", name: "MMA2C", programLabel: "MMA", accessCodeHint: "MMA2C" },
  { id: "classe-chf-mma3a", name: "MMA3A", programLabel: "MMA", accessCodeHint: "MMA3A" },
  { id: "classe-chf-ama2a", name: "AMA2A", programLabel: "Apprentissage MA", accessCodeHint: "AMA2A" },
  { id: "classe-chf-pai", name: "PAI", programLabel: "Post-apprentissage", accessCodeHint: "PAI" },
];

export const CHF_SUBJECTS: Subject[] = [
  { id: "subject-chf-ma2-cp1", classroomId: "classe-chf-ma2", name: "Con. Prof I" },
  { id: "subject-chf-ma3b-cp1", classroomId: "classe-chf-ma3b", name: "Con. Prof I" },
  { id: "subject-chf-ma3ab-cpl", classroomId: "classe-chf-ma3ab", name: "Con. Prof L" },
  { id: "subject-chf-mma1c-cp1", classroomId: "classe-chf-mma1c", name: "Con. Prof I" },
  { id: "subject-chf-mma2c-cp1", classroomId: "classe-chf-mma2c", name: "Con. Prof I" },
  { id: "subject-chf-mma3a-cp1", classroomId: "classe-chf-mma3a", name: "Con. Prof I" },
  { id: "subject-chf-mma3a-bg", classroomId: "classe-chf-mma3a", name: "BG" },
  { id: "subject-chf-ama2a-cp1", classroomId: "classe-chf-ama2a", name: "Con. Prof I" },
  { id: "subject-chf-pai-bg", classroomId: "classe-chf-pai", name: "BG" },
];

export const CHF_MEMBERSHIPS: Membership[] = [
  {
    id: "membership-chf-ma2",
    teacherId: TEACHER_CHF_ID,
    classroomId: "classe-chf-ma2",
    subjectIds: ["subject-chf-ma2-cp1"],
    validFrom: CHF_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-chf-ma3b",
    teacherId: TEACHER_CHF_ID,
    classroomId: "classe-chf-ma3b",
    subjectIds: ["subject-chf-ma3b-cp1"],
    validFrom: CHF_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-chf-ma3ab",
    teacherId: TEACHER_CHF_ID,
    classroomId: "classe-chf-ma3ab",
    subjectIds: ["subject-chf-ma3ab-cpl"],
    validFrom: CHF_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-chf-mma1c",
    teacherId: TEACHER_CHF_ID,
    classroomId: "classe-chf-mma1c",
    subjectIds: ["subject-chf-mma1c-cp1"],
    validFrom: CHF_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-chf-mma2c",
    teacherId: TEACHER_CHF_ID,
    classroomId: "classe-chf-mma2c",
    subjectIds: ["subject-chf-mma2c-cp1"],
    validFrom: CHF_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-chf-mma3a",
    teacherId: TEACHER_CHF_ID,
    classroomId: "classe-chf-mma3a",
    subjectIds: ["subject-chf-mma3a-cp1", "subject-chf-mma3a-bg"],
    validFrom: CHF_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-chf-ama2a",
    teacherId: TEACHER_CHF_ID,
    classroomId: "classe-chf-ama2a",
    subjectIds: ["subject-chf-ama2a-cp1"],
    validFrom: CHF_MEMBERSHIP_START,
    validTo: null,
  },
  {
    id: "membership-chf-pai",
    teacherId: TEACHER_CHF_ID,
    classroomId: "classe-chf-pai",
    subjectIds: ["subject-chf-pai-bg"],
    validFrom: CHF_MEMBERSHIP_START,
    validTo: null,
  },
];

/** Codes élève de test — un par classe pour essayer la consultation. */
export const CHF_STUDENT_ACCESSES: StudentAccess[] = [
  { id: "student-chf-ma2", classroomId: "classe-chf-ma2", label: "eleve-ma2" },
  { id: "student-chf-ma3b", classroomId: "classe-chf-ma3b", label: "eleve-ma3b" },
  { id: "student-chf-ma3ab", classroomId: "classe-chf-ma3ab", label: "eleve-ma3ab" },
  { id: "student-chf-mma1c", classroomId: "classe-chf-mma1c", label: "eleve-mma1c" },
  { id: "student-chf-mma2c", classroomId: "classe-chf-mma2c", label: "eleve-mma2c" },
  { id: "student-chf-mma3a", classroomId: "classe-chf-mma3a", label: "eleve-mma3a" },
  { id: "student-chf-ama2a", classroomId: "classe-chf-ama2a", label: "eleve-ama2a" },
  { id: "student-chf-pai", classroomId: "classe-chf-pai", label: "eleve-pai" },
];

/** Correspondance code grille PDF → identifiant classe Campus Agenda. */
export const CHF_CLASS_CODE_MAP: Record<string, string> = {
  MA2: "classe-chf-ma2",
  MA3B: "classe-chf-ma3b",
  "MA3A-B": "classe-chf-ma3ab",
  MMA1C: "classe-chf-mma1c",
  MMA2C: "classe-chf-mma2c",
  MMA3A: "classe-chf-mma3a",
  AMA2A: "classe-chf-ama2a",
  PAI: "classe-chf-pai",
};
