import type {
  AnnualCourse,
  AssignmentEventKind,
  AssignmentRole,
  TeacherCourseAssignment,
  TeacherCourseAssignmentEvent,
} from "../../../features/annual-courses/types.ts";
import type { AnnualCourseStore } from "../annual-course-types.ts";
import type { SqlDatabase } from "./types.ts";

type CourseRow = {
  id: string;
  school_year_id: string;
  class_id: string;
  context_id: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type AssignmentRow = {
  id: string;
  annual_course_id: string;
  teacher_id: string;
  role: string;
  valid_from: string;
  valid_to: string | null;
  created_by_admin_id: string;
  created_at: string;
  ended_at: string | null;
  override_reason: string | null;
  override_by_admin_id: string | null;
};

type EventRow = {
  id: string;
  annual_course_id: string;
  assignment_id: string | null;
  teacher_id: string;
  admin_id: string;
  kind: string;
  role: string | null;
  detail: string;
  created_at: string;
};

function mapCourse(row: CourseRow): AnnualCourse {
  return {
    id: row.id,
    schoolYearId: row.school_year_id,
    classId: row.class_id,
    contextId: row.context_id,
    isArchived: row.archived_at !== null,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssignment(row: AssignmentRow): TeacherCourseAssignment {
  return {
    id: row.id,
    annualCourseId: row.annual_course_id,
    teacherId: row.teacher_id,
    role: row.role as AssignmentRole,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    createdByAdminId: row.created_by_admin_id,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    overrideReason: row.override_reason,
    overrideByAdminId: row.override_by_admin_id,
  };
}

function mapEvent(row: EventRow): TeacherCourseAssignmentEvent {
  return {
    id: row.id,
    annualCourseId: row.annual_course_id,
    assignmentId: row.assignment_id,
    teacherId: row.teacher_id,
    adminId: row.admin_id,
    kind: row.kind as AssignmentEventKind,
    role: (row.role as AssignmentRole | null) ?? null,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

export class SqlAnnualCourseStore implements AnnualCourseStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async listCourses(): Promise<AnnualCourse[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM annual_courses ORDER BY created_at")
      .bind()
      .all<CourseRow>();
    return results.map(mapCourse);
  }

  async getCourse(id: string): Promise<AnnualCourse | null> {
    const row = await this.db
      .prepare("SELECT * FROM annual_courses WHERE id = ? LIMIT 1")
      .bind(id)
      .first<CourseRow>();
    return row ? mapCourse(row) : null;
  }

  async findCourse(key: {
    schoolYearId: string;
    classId: string;
    contextId: string;
  }): Promise<AnnualCourse | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM annual_courses
         WHERE school_year_id = ? AND class_id = ? AND context_id = ?
         LIMIT 1`,
      )
      .bind(key.schoolYearId, key.classId, key.contextId)
      .first<CourseRow>();
    return row ? mapCourse(row) : null;
  }

  async listCoursesByContextId(contextId: string): Promise<AnnualCourse[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM annual_courses WHERE context_id = ?")
      .bind(contextId)
      .all<CourseRow>();
    return results.map(mapCourse);
  }

  async createCourse(course: AnnualCourse): Promise<AnnualCourse> {
    await this.db
      .prepare(
        `INSERT INTO annual_courses
           (id, school_year_id, class_id, context_id, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        course.id,
        course.schoolYearId,
        course.classId,
        course.contextId,
        course.archivedAt,
        course.createdAt,
        course.updatedAt,
      )
      .run();
    return course;
  }

  async archiveCourse(id: string): Promise<AnnualCourse | null> {
    const current = await this.getCourse(id);
    if (!current) return null;
    const archivedAt = current.archivedAt ?? new Date().toISOString();
    const updatedAt = new Date().toISOString();
    await this.db
      .prepare("UPDATE annual_courses SET archived_at = ?, updated_at = ? WHERE id = ?")
      .bind(archivedAt, updatedAt, id)
      .run();
    return { ...current, isArchived: true, archivedAt, updatedAt };
  }

  async deleteCourse(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM annual_courses WHERE id = ?").bind(id).run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async listAssignments(annualCourseId?: string): Promise<TeacherCourseAssignment[]> {
    if (annualCourseId) {
      const { results } = await this.db
        .prepare(
          "SELECT * FROM teacher_course_assignments WHERE annual_course_id = ? ORDER BY created_at",
        )
        .bind(annualCourseId)
        .all<AssignmentRow>();
      return results.map(mapAssignment);
    }
    const { results } = await this.db
      .prepare("SELECT * FROM teacher_course_assignments ORDER BY created_at")
      .bind()
      .all<AssignmentRow>();
    return results.map(mapAssignment);
  }

  async listAssignmentsForTeacher(teacherId: string): Promise<TeacherCourseAssignment[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM teacher_course_assignments WHERE teacher_id = ? ORDER BY created_at")
      .bind(teacherId)
      .all<AssignmentRow>();
    return results.map(mapAssignment);
  }

  async getAssignment(id: string): Promise<TeacherCourseAssignment | null> {
    const row = await this.db
      .prepare("SELECT * FROM teacher_course_assignments WHERE id = ? LIMIT 1")
      .bind(id)
      .first<AssignmentRow>();
    return row ? mapAssignment(row) : null;
  }

  async createAssignment(assignment: TeacherCourseAssignment): Promise<TeacherCourseAssignment> {
    await this.db
      .prepare(
        `INSERT INTO teacher_course_assignments (
           id, annual_course_id, teacher_id, role, valid_from, valid_to,
           created_by_admin_id, created_at, ended_at, override_reason, override_by_admin_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        assignment.id,
        assignment.annualCourseId,
        assignment.teacherId,
        assignment.role,
        assignment.validFrom,
        assignment.validTo,
        assignment.createdByAdminId,
        assignment.createdAt,
        assignment.endedAt,
        assignment.overrideReason,
        assignment.overrideByAdminId,
      )
      .run();
    return assignment;
  }

  async updateAssignment(assignment: TeacherCourseAssignment): Promise<TeacherCourseAssignment> {
    await this.db
      .prepare(
        `UPDATE teacher_course_assignments
         SET role = ?, valid_from = ?, valid_to = ?, ended_at = ?,
             override_reason = ?, override_by_admin_id = ?
         WHERE id = ?`,
      )
      .bind(
        assignment.role,
        assignment.validFrom,
        assignment.validTo,
        assignment.endedAt,
        assignment.overrideReason,
        assignment.overrideByAdminId,
        assignment.id,
      )
      .run();
    return assignment;
  }

  async listEvents(annualCourseId?: string): Promise<TeacherCourseAssignmentEvent[]> {
    if (annualCourseId) {
      const { results } = await this.db
        .prepare(
          "SELECT * FROM teacher_course_assignment_events WHERE annual_course_id = ? ORDER BY created_at",
        )
        .bind(annualCourseId)
        .all<EventRow>();
      return results.map(mapEvent);
    }
    const { results } = await this.db
      .prepare("SELECT * FROM teacher_course_assignment_events ORDER BY created_at")
      .bind()
      .all<EventRow>();
    return results.map(mapEvent);
  }

  async appendEvent(event: TeacherCourseAssignmentEvent): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO teacher_course_assignment_events (
           id, annual_course_id, assignment_id, teacher_id, admin_id, kind, role, detail, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.annualCourseId,
        event.assignmentId,
        event.teacherId,
        event.adminId,
        event.kind,
        event.role,
        event.detail,
        event.createdAt,
      )
      .run();
  }
}
