export interface Classroom {
  id: string;
  name: string;
  programLabel: string;
  accessCodeHint: string;
  /** Pont structuré → SchoolClass. NULL = classroom legacy. */
  schoolClassId?: string | null;
}

export interface Subject {
  id: string;
  classroomId: string;
  name: string;
  /** Pont structuré → AnnualCourse. NULL = subject legacy. */
  annualCourseId?: string | null;
}
