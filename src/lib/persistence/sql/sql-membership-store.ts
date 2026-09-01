import { replaceTeacherMemberships } from "../../../features/memberships/replacement.ts";
import type { ReplaceTeacherInput } from "../../../features/memberships/replacement.ts";
import type { Membership } from "../../../types/membership.ts";
import type { MembershipStore } from "../membership-types.ts";
import type { SqlDatabase } from "./types.ts";

interface MembershipRow {
  id: string;
  teacher_id: string;
  classroom_id: string;
  valid_from: string;
  valid_to: string | null;
}

async function loadMembershipSubjects(db: SqlDatabase, membershipId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT subject_id FROM membership_subjects WHERE membership_id = ? ORDER BY subject_id")
    .bind(membershipId)
    .all<{ subject_id: string }>();
  return results.map((row) => row.subject_id);
}

async function rowToMembership(db: SqlDatabase, row: MembershipRow): Promise<Membership> {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    classroomId: row.classroom_id,
    subjectIds: await loadMembershipSubjects(db, row.id),
    validFrom: row.valid_from,
    validTo: row.valid_to,
  };
}

export class SqlMembershipStore implements MembershipStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async listMemberships(classroomId?: string): Promise<Membership[]> {
    const query = classroomId
      ? "SELECT id, teacher_id, classroom_id, valid_from, valid_to FROM memberships WHERE classroom_id = ? ORDER BY valid_from DESC"
      : "SELECT id, teacher_id, classroom_id, valid_from, valid_to FROM memberships ORDER BY classroom_id, valid_from DESC";
    const { results } = classroomId
      ? await this.db.prepare(query).bind(classroomId).all<MembershipRow>()
      : await this.db.prepare(query).bind().all<MembershipRow>();

    return Promise.all(results.map((row) => rowToMembership(this.db, row)));
  }

  async replaceTeacher(input: ReplaceTeacherInput): Promise<
    | { ok: true; result: ReturnType<typeof replaceTeacherMemberships> extends infer R ? (R extends { ok: false } ? never : R) : never }
    | { ok: false; reason: string }
  > {
    const current = await this.listMemberships(input.classroomId);
    const outcome = replaceTeacherMemberships(current, input);
    if ("ok" in outcome) {
      return outcome;
    }

    for (const membership of outcome.memberships) {
      const existing = current.find((candidate) => candidate.id === membership.id);
      if (existing) {
        if (existing.validTo !== membership.validTo) {
          await this.db
            .prepare("UPDATE memberships SET valid_to = ? WHERE id = ?")
            .bind(membership.validTo, membership.id)
            .run();
        }
        continue;
      }

      await this.db
        .prepare(
          "INSERT INTO memberships (id, teacher_id, classroom_id, valid_from, valid_to) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(membership.id, membership.teacherId, membership.classroomId, membership.validFrom, membership.validTo)
        .run();

      for (const subjectId of membership.subjectIds) {
        await this.db
          .prepare("INSERT INTO membership_subjects (membership_id, subject_id) VALUES (?, ?)")
          .bind(membership.id, subjectId)
          .run();
      }
    }

    return { ok: true, result: outcome };
  }
}

export async function seedMembershipValidityDefaults(db: SqlDatabase): Promise<void> {
  await db
    .prepare("UPDATE memberships SET valid_from = COALESCE(valid_from, datetime('now')) WHERE valid_from IS NULL OR valid_from = ''")
    .bind()
    .run();
}
