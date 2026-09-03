import {
  classLifecycleLabel,
  classLifecycleStatus,
  isOperationalSchoolClass,
} from "../school-catalog/class-lifecycle.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";

export const DEFAULT_SHOW_INACTIVE_OR_ARCHIVED_CLASSES = false;

export const CLASS_SCHEDULE_HISTORY_CHECKBOX_LABEL = "Afficher les classes inactives / archivées";

export const CLASS_SCHEDULE_EMPTY_ACTIVE_MESSAGE = "Aucune classe active pour cette année scolaire.";
export const CLASS_SCHEDULE_EMPTY_YEAR_MESSAGE = "Aucune classe pour cette année scolaire.";

export const CLASS_SCHEDULE_ARCHIVED_READ_ONLY_BANNER = "Classe archivée — lecture seule.";
export const CLASS_SCHEDULE_INACTIVE_READ_ONLY_BANNER = "Classe désactivée — lecture seule.";
export const CLASS_SCHEDULE_YEAR_ARCHIVED_READ_ONLY_BANNER = "Année scolaire archivée — lecture seule.";

export const CLASS_SCHEDULE_ARCHIVED_MUTATION_REASON = "Cette classe est archivée (lecture seule).";
export const CLASS_SCHEDULE_INACTIVE_MUTATION_REASON =
  "Cette classe est désactivée. Aucun nouveau créneau opérationnel.";

export type ScheduleEditorClass = Pick<
  SchoolClassRecord,
  "id" | "code" | "sortOrder" | "isActive" | "isArchived" | "schoolYearId"
>;

function sameSchoolYearId(schoolYearId: string | null | undefined, expected: string): boolean {
  return (schoolYearId?.trim() || null) === expected;
}

/**
 * Classes proposées dans Horaire des classes pour l’année sélectionnée.
 * Par défaut : uniquement les classes opérationnelles (`isOperationalSchoolClass`).
 * Avec historique : ajoute désactivées et archivées de la même année, jamais d’une autre.
 */
export function listScheduleEditorClasses<T extends ScheduleEditorClass>(options: {
  classes: readonly T[];
  schoolYearId: string;
  includeInactiveOrArchived: boolean;
}): T[] {
  const yearId = options.schoolYearId.trim();
  if (!yearId) return [];

  return options.classes
    .filter((entry) => {
      if (!sameSchoolYearId(entry.schoolYearId, yearId)) return false;
      if (isOperationalSchoolClass(entry, yearId)) return true;
      return options.includeInactiveOrArchived;
    })
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.code.localeCompare(right.code, "fr-CH"),
    );
}

/**
 * Libellé du menu Classe : code seul si opérationnelle,
 * sinon `MA2 · archivée` / `MA3B · désactivée` (sans « inactive »).
 * Archivée n’ajoute pas « désactivée ».
 */
export function classScheduleOptionLabel(
  schoolClass: Pick<SchoolClassRecord, "code" | "isActive" | "isArchived">,
): string {
  const status = classLifecycleStatus(schoolClass);
  if (status === "active") return schoolClass.code;
  return `${schoolClass.code} · ${classLifecycleLabel(status).toLowerCase()}`;
}

export function classScheduleEmptyClassesMessage(includeInactiveOrArchived: boolean): string {
  return includeInactiveOrArchived
    ? CLASS_SCHEDULE_EMPTY_YEAR_MESSAGE
    : CLASS_SCHEDULE_EMPTY_ACTIVE_MESSAGE;
}

export function classScheduleReadOnlyBanner(options: {
  yearStatus?: string | null;
  schoolClass?: Pick<SchoolClassRecord, "isActive" | "isArchived"> | null;
}): string | null {
  if (options.yearStatus === "archived") return CLASS_SCHEDULE_YEAR_ARCHIVED_READ_ONLY_BANNER;
  if (!options.schoolClass) return null;
  const status = classLifecycleStatus(options.schoolClass);
  if (status === "archived") return CLASS_SCHEDULE_ARCHIVED_READ_ONLY_BANNER;
  if (status === "inactive") return CLASS_SCHEDULE_INACTIVE_READ_ONLY_BANNER;
  return null;
}

/**
 * Après changement d’année ou masquage de l’historique : conserver la sélection
 * seulement si elle est encore visible, sinon une classe opérationnelle de l’année,
 * sinon la première classe historique visible, sinon vide.
 */
export function resolveScheduleEditorClassId(options: {
  visibleClasses: readonly Pick<SchoolClassRecord, "id" | "isActive" | "isArchived" | "schoolYearId">[];
  selectedClassId: string;
  schoolYearId: string;
}): string {
  if (options.visibleClasses.some((entry) => entry.id === options.selectedClassId)) {
    return options.selectedClassId;
  }
  const operational = options.visibleClasses.find((entry) =>
    isOperationalSchoolClass(entry, options.schoolYearId),
  );
  if (operational) return operational.id;
  return options.visibleClasses[0]?.id ?? "";
}

export function scheduleEditorClassIdAfterYearChange(options: {
  classes: readonly ScheduleEditorClass[];
  nextYearId: string;
  includeInactiveOrArchived: boolean;
}): string {
  const visible = listScheduleEditorClasses({
    classes: options.classes,
    schoolYearId: options.nextYearId,
    includeInactiveOrArchived: options.includeInactiveOrArchived,
  });
  return resolveScheduleEditorClassId({
    visibleClasses: visible,
    selectedClassId: "",
    schoolYearId: options.nextYearId,
  });
}
