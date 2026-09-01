import type {
  AnnualCourse,
  TeacherCourseAssignment,
  TeacherCourseAssignmentEvent,
} from "../../features/annual-courses/types.ts";
import type { AnnualCourseStore } from "./annual-course-types.ts";

export class MemoryAnnualCourseStore implements AnnualCourseStore {
  private readonly courses = new Map<string, AnnualCourse>();
  private readonly assignments = new Map<string, TeacherCourseAssignment>();
  private readonly events: TeacherCourseAssignmentEvent[] = [];

  async listCourses(): Promise<AnnualCourse[]> {
    return [...this.courses.values()]
      .map((entry) => ({ ...entry }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getCourse(id: string): Promise<AnnualCourse | null> {
    const course = this.courses.get(id);
    return course ? { ...course } : null;
  }

  async findCourse(key: {
    schoolYearId: string;
    classId: string;
    contextId: string;
  }): Promise<AnnualCourse | null> {
    const found = [...this.courses.values()].find(
      (entry) =>
        entry.schoolYearId === key.schoolYearId &&
        entry.classId === key.classId &&
        entry.contextId === key.contextId,
    );
    return found ? { ...found } : null;
  }

  async listCoursesByContextId(contextId: string): Promise<AnnualCourse[]> {
    return [...this.courses.values()]
      .filter((entry) => entry.contextId === contextId)
      .map((entry) => ({ ...entry }));
  }

  async createCourse(course: AnnualCourse): Promise<AnnualCourse> {
    const duplicate = await this.findCourse(course);
    if (duplicate) {
      throw new Error("Un cours annuel existe déjà pour cette classe, cette année et ce CTX.");
    }
    this.courses.set(course.id, { ...course });
    return { ...course };
  }

  async archiveCourse(id: string): Promise<AnnualCourse | null> {
    const current = this.courses.get(id);
    if (!current) return null;
    const next: AnnualCourse = {
      ...current,
      isArchived: true,
      archivedAt: current.archivedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.courses.set(id, next);
    return { ...next };
  }

  async deleteCourse(id: string): Promise<boolean> {
    return this.courses.delete(id);
  }

  async listAssignments(annualCourseId?: string): Promise<TeacherCourseAssignment[]> {
    return [...this.assignments.values()]
      .filter((entry) => (annualCourseId ? entry.annualCourseId === annualCourseId : true))
      .map((entry) => ({ ...entry }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listAssignmentsForTeacher(teacherId: string): Promise<TeacherCourseAssignment[]> {
    return [...this.assignments.values()]
      .filter((entry) => entry.teacherId === teacherId)
      .map((entry) => ({ ...entry }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getAssignment(id: string): Promise<TeacherCourseAssignment | null> {
    const assignment = this.assignments.get(id);
    return assignment ? { ...assignment } : null;
  }

  async createAssignment(assignment: TeacherCourseAssignment): Promise<TeacherCourseAssignment> {
    this.assignments.set(assignment.id, { ...assignment });
    return { ...assignment };
  }

  async updateAssignment(assignment: TeacherCourseAssignment): Promise<TeacherCourseAssignment> {
    this.assignments.set(assignment.id, { ...assignment });
    return { ...assignment };
  }

  async listEvents(annualCourseId?: string): Promise<TeacherCourseAssignmentEvent[]> {
    return this.events
      .filter((entry) => (annualCourseId ? entry.annualCourseId === annualCourseId : true))
      .map((entry) => ({ ...entry }));
  }

  async appendEvent(event: TeacherCourseAssignmentEvent): Promise<void> {
    this.events.push({ ...event });
  }

  replaceSnapshot(options: {
    courses: AnnualCourse[];
    assignments: TeacherCourseAssignment[];
    events: TeacherCourseAssignmentEvent[];
  }): void {
    this.courses.clear();
    this.assignments.clear();
    this.events.length = 0;
    for (const course of options.courses) this.courses.set(course.id, { ...course });
    for (const assignment of options.assignments) this.assignments.set(assignment.id, { ...assignment });
    this.events.push(...options.events.map((entry) => ({ ...entry })));
  }
}

let memoryAnnualCourseStore: MemoryAnnualCourseStore | null = null;

export function getMemoryAnnualCourseStore(): MemoryAnnualCourseStore {
  memoryAnnualCourseStore ??= new MemoryAnnualCourseStore();
  return memoryAnnualCourseStore;
}

export function resetMemoryAnnualCourseStore(): void {
  memoryAnnualCourseStore = null;
}
