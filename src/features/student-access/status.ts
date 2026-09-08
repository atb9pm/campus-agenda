import type { StudentAccessMetadata, StudentAccessUiStatus } from "../../types/student-access.ts";
import type { StudentAccessRecord } from "../../lib/persistence/student-access-types.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearStatus } from "../school-year/types.ts";

export function studentAccessMetadataFromRecord(
  record: StudentAccessRecord,
  schoolClass: Pick<SchoolClassRecord, "id" | "isArchived">,
  yearStatus: SchoolYearStatus | null,
): StudentAccessMetadata {
  return {
    accessId: record.id,
    schoolClassId: record.schoolClassId ?? schoolClass.id,
    classroomId: record.classroomId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
    status: resolveStudentAccessUiStatus(record, schoolClass, yearStatus),
  };
}

export function resolveStudentAccessUiStatus(
  record: StudentAccessRecord | null | undefined,
  schoolClass: Pick<SchoolClassRecord, "isArchived"> | null | undefined,
  yearStatus: SchoolYearStatus | null,
): StudentAccessUiStatus {
  if (!record) return "none";
  if (yearStatus === "archived" || schoolClass?.isArchived) return "historical";
  if (record.revokedAt) return "revoked";
  if (yearStatus === "draft") return "prepared";
  if (yearStatus === "active") return "active";
  return "none";
}

export function studentAccessAllowsAdminWrite(options: {
  schoolClass: Pick<SchoolClassRecord, "isArchived">;
  yearStatus: SchoolYearStatus | null;
}): { ok: true } | { ok: false; reason: string } {
  if (options.schoolClass.isArchived) {
    return { ok: false, reason: "Cette classe est archivée. Les accès apprentis sont en lecture seule." };
  }
  if (options.yearStatus === "archived") {
    return {
      ok: false,
      reason: "Cette année scolaire est archivée. Les accès historiques sont en lecture seule.",
    };
  }
  if (options.yearStatus !== "active" && options.yearStatus !== "draft") {
    return { ok: false, reason: "Cette classe n'est pas rattachée à une année scolaire active ou brouillon." };
  }
  return { ok: true };
}
