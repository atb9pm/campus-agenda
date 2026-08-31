import { resolveSchoolClass } from "./class-resolve.ts";
import type { PedagogyMutationResult } from "./profession-types.ts";
import type { SchoolClassRecord } from "./types.ts";

const ARCHIVED_CLASS_AGENDA_READONLY_REASON =
  "Cette classe est archivée. Les publications existantes restent consultables mais ne peuvent plus être modifiées.";

/**
 * Garde-fou cycle de vie pour une publication Agenda déjà existante.
 * Résout classroomId (via le nom runtime) + schoolYearId → SchoolClass,
 * puis refuse les mutations si la classe est archivée.
 */
export function assertAgendaClassMutable(options: {
  classroomName: string | null | undefined;
  schoolYearId?: string | null;
  classes: SchoolClassRecord[];
}): PedagogyMutationResult<true> {
  const classroomName = options.classroomName?.trim();
  if (!classroomName) return { ok: true, value: true };

  const schoolClass = resolveSchoolClass({
    classroomName,
    classes: options.classes,
    schoolYearId: options.schoolYearId,
  });
  if (!schoolClass) return { ok: true, value: true };
  if (schoolClass.isArchived) {
    return { ok: false, reason: ARCHIVED_CLASS_AGENDA_READONLY_REASON };
  }
  return { ok: true, value: true };
}
