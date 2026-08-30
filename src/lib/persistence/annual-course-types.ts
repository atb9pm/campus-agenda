import type {
  AnnualCourse,
  TeacherCourseAssignment,
  TeacherCourseAssignmentEvent,
} from "../../features/annual-courses/types.ts";

export interface AnnualCourseStore {
  listCourses(): Promise<AnnualCourse[]>;
  getCourse(id: string): Promise<AnnualCourse | null>;
  findCourse(key: {
    schoolYearId: string;
    classId: string;
    contextId: string;
  }): Promise<AnnualCourse | null>;
  listCoursesByContextId(contextId: string): Promise<AnnualCourse[]>;
  createCourse(course: AnnualCourse): Promise<AnnualCourse>;
  archiveCourse(id: string): Promise<AnnualCourse | null>;
  deleteCourse(id: string): Promise<boolean>;

  listAssignments(annualCourseId?: string): Promise<TeacherCourseAssignment[]>;
  listAssignmentsForTeacher(teacherId: string): Promise<TeacherCourseAssignment[]>;
  getAssignment(id: string): Promise<TeacherCourseAssignment | null>;
  createAssignment(assignment: TeacherCourseAssignment): Promise<TeacherCourseAssignment>;
  updateAssignment(assignment: TeacherCourseAssignment): Promise<TeacherCourseAssignment>;

  listEvents(annualCourseId?: string): Promise<TeacherCourseAssignmentEvent[]>;
  appendEvent(event: TeacherCourseAssignmentEvent): Promise<void>;
}
