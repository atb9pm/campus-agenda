import type { SqlDatabase } from "./types.ts";
import type {
  RuntimeAgendaAdapterStore,
  RuntimeClassroom,
  RuntimeSubject,
} from "../runtime-agenda-types.ts";

interface ClassroomRow {
  id: string;
  name: string;
  program_label: string | null;
  access_code_hint: string | null;
  school_class_id: string | null;
}

interface SubjectRow {
  id: string;
  classroom_id: string;
  name: string;
  annual_course_id: string | null;
}

function rowToClassroom(row: ClassroomRow): RuntimeClassroom {
  return {
    id: row.id,
    name: row.name,
    programLabel: row.program_label ?? "",
    accessCodeHint: row.access_code_hint ?? "",
    schoolClassId: row.school_class_id,
  };
}

function rowToSubject(row: SubjectRow): RuntimeSubject {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    name: row.name,
    annualCourseId: row.annual_course_id,
  };
}

export class SqlRuntimeAgendaAdapterStore implements RuntimeAgendaAdapterStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async listClassrooms(): Promise<RuntimeClassroom[]> {
    const { results } = await this.db
      .prepare(
        "SELECT id, name, program_label, access_code_hint, school_class_id FROM classrooms ORDER BY id",
      )
      .bind()
      .all<ClassroomRow>();
    return (results ?? []).map(rowToClassroom);
  }

  async findClassroomById(id: string): Promise<RuntimeClassroom | null> {
    const row = await this.db
      .prepare(
        "SELECT id, name, program_label, access_code_hint, school_class_id FROM classrooms WHERE id = ? LIMIT 1",
      )
      .bind(id)
      .first<ClassroomRow>();
    return row ? rowToClassroom(row) : null;
  }

  async findClassroomBySchoolClassId(schoolClassId: string): Promise<RuntimeClassroom | null> {
    const row = await this.db
      .prepare(
        "SELECT id, name, program_label, access_code_hint, school_class_id FROM classrooms WHERE school_class_id = ? LIMIT 1",
      )
      .bind(schoolClassId)
      .first<ClassroomRow>();
    return row ? rowToClassroom(row) : null;
  }

  async upsertClassroom(classroom: RuntimeClassroom): Promise<RuntimeClassroom> {
    const schoolClassId = classroom.schoolClassId?.trim() || null;
    const existing = await this.findClassroomById(classroom.id);
    if (existing) {
      await this.db
        .prepare(
          "UPDATE classrooms SET name = ?, program_label = ?, access_code_hint = ?, school_class_id = ? WHERE id = ?",
        )
        .bind(
          classroom.name,
          classroom.programLabel,
          classroom.accessCodeHint,
          schoolClassId,
          classroom.id,
        )
        .run();
    } else {
      await this.db
        .prepare(
          "INSERT INTO classrooms (id, name, program_label, access_code_hint, school_class_id) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(
          classroom.id,
          classroom.name,
          classroom.programLabel,
          classroom.accessCodeHint,
          schoolClassId,
        )
        .run();
    }
    const saved = await this.findClassroomById(classroom.id);
    if (!saved) throw new Error("Classroom runtime introuvable après écriture.");
    return saved;
  }

  async listSubjects(): Promise<RuntimeSubject[]> {
    const { results } = await this.db
      .prepare("SELECT id, classroom_id, name, annual_course_id FROM subjects ORDER BY id")
      .bind()
      .all<SubjectRow>();
    return (results ?? []).map(rowToSubject);
  }

  async findSubjectById(id: string): Promise<RuntimeSubject | null> {
    const row = await this.db
      .prepare("SELECT id, classroom_id, name, annual_course_id FROM subjects WHERE id = ? LIMIT 1")
      .bind(id)
      .first<SubjectRow>();
    return row ? rowToSubject(row) : null;
  }

  async findSubjectByAnnualCourseId(annualCourseId: string): Promise<RuntimeSubject | null> {
    const row = await this.db
      .prepare(
        "SELECT id, classroom_id, name, annual_course_id FROM subjects WHERE annual_course_id = ? LIMIT 1",
      )
      .bind(annualCourseId)
      .first<SubjectRow>();
    return row ? rowToSubject(row) : null;
  }

  async upsertSubject(subject: RuntimeSubject): Promise<RuntimeSubject> {
    const annualCourseId = subject.annualCourseId?.trim() || null;
    const existing = await this.findSubjectById(subject.id);
    if (existing) {
      await this.db
        .prepare(
          "UPDATE subjects SET classroom_id = ?, name = ?, annual_course_id = ? WHERE id = ?",
        )
        .bind(subject.classroomId, subject.name, annualCourseId, subject.id)
        .run();
    } else {
      await this.db
        .prepare("INSERT INTO subjects (id, classroom_id, name, annual_course_id) VALUES (?, ?, ?, ?)")
        .bind(subject.id, subject.classroomId, subject.name, annualCourseId)
        .run();
    }
    const saved = await this.findSubjectById(subject.id);
    if (!saved) throw new Error("Subject runtime introuvable après écriture.");
    return saved;
  }
}
