/**
 * LEGACY ADAPTER — catalogue agenda (classrooms / subjects / accès élèves / memberships).
 * Seedé depuis DEMO_CATALOG, mais mutable (restore, révocation, classes hors démo).
 * Ce n'est PAS la source de vérité des SchoolClass / AnnualCourse.
 */
import { DEMO_CATALOG } from "../../features/classes/demo-data.ts";
import { shouldSeedDemoData } from "./demo-seed-policy.ts";
import type { Classroom, Subject } from "../../types/classroom.ts";
import type { Membership } from "../../types/membership.ts";
import type { StudentAccess } from "../../types/student-access.ts";

export interface LegacyStudentAccess extends StudentAccess {
  schoolClassId?: string | null;
  accessCodeHash?: string | null;
  accessCodeCiphertext?: string | null;
  accessVersion?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  revokedAt?: string | null;
}

interface LegacySchoolState {
  classrooms: Classroom[];
  subjects: Subject[];
  studentAccesses: LegacyStudentAccess[];
  memberships: Membership[];
}

function cloneDemo(): LegacySchoolState {
  return {
    classrooms: DEMO_CATALOG.classrooms.map((entry) => ({ ...entry })),
    subjects: DEMO_CATALOG.subjects.map((entry) => ({ ...entry })),
    studentAccesses: DEMO_CATALOG.studentAccesses.map((entry) => ({ ...entry })),
    memberships: DEMO_CATALOG.memberships.map((entry) => ({
      ...entry,
      subjectIds: [...entry.subjectIds],
    })),
  };
}

function initialLegacyState(): LegacySchoolState {
  return shouldSeedDemoData() ? cloneDemo() : {
    classrooms: [],
    subjects: [],
    studentAccesses: [],
    memberships: [],
  };
}

let state: LegacySchoolState = initialLegacyState();

export function resetMemoryLegacySchool(): void {
  state = initialLegacyState();
}

export function getMemoryLegacySchool(): LegacySchoolState {
  return state;
}

export function replaceMemoryLegacySchool(next: Partial<LegacySchoolState>): void {
  if (next.classrooms) state.classrooms = next.classrooms.map((entry) => ({ ...entry }));
  if (next.subjects) state.subjects = next.subjects.map((entry) => ({ ...entry }));
  if (next.studentAccesses) state.studentAccesses = next.studentAccesses.map((entry) => ({ ...entry }));
  if (next.memberships) {
    state.memberships = next.memberships.map((entry) => ({
      ...entry,
      subjectIds: [...entry.subjectIds],
    }));
  }
}

export function removeMemoryStudentAccess(accessId: string): boolean {
  const before = state.studentAccesses.length;
  state.studentAccesses = state.studentAccesses.filter((entry) => entry.id !== accessId);
  return state.studentAccesses.length < before;
}
