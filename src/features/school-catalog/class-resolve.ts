import { normalizeClassCode } from "./queries.ts";
import type { SchoolClassRecord } from "./types.ts";

function uniqueMatch<T>(items: T[], predicate: (entry: T) => boolean): T | null {
  const hits = items.filter(predicate);
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Résout une classe par code ou libellé.
 * Si `schoolYearId` est fourni : cherche d'abord uniquement dans cette année
 * (correspondance unique obligatoire), puis repli legacy (schoolYearId null)
 * uniquement s'il n'existe aucune classe structurée correspondante et qu'une
 * seule classe legacy non ambiguë correspond.
 * Sans année : correspondance unique globale ; jamais le premier arbitraire.
 */
export function resolveSchoolClass(options: {
  classroomName: string;
  classes: SchoolClassRecord[];
  schoolYearId?: string | null;
}): SchoolClassRecord | null {
  const normalized = normalizeClassCode(options.classroomName);
  if (!normalized) return null;

  const matchesCode = (entry: SchoolClassRecord) => normalizeClassCode(entry.code) === normalized;
  const matchesLabel = (entry: SchoolClassRecord) => normalizeClassCode(entry.label) === normalized;
  const pickUnique = (items: SchoolClassRecord[]): SchoolClassRecord | null =>
    uniqueMatch(items, matchesCode) ?? uniqueMatch(items, matchesLabel);

  const yearId = options.schoolYearId?.trim() || null;
  if (yearId) {
    const inYear = options.classes.filter((entry) => entry.schoolYearId === yearId);
    const structured = pickUnique(inYear);
    if (structured) return structured;
    const anyStructured = inYear.some((entry) => matchesCode(entry) || matchesLabel(entry));
    if (anyStructured) return null;
    const legacy = options.classes.filter((entry) => entry.schoolYearId === null);
    return pickUnique(legacy);
  }

  return pickUnique(options.classes);
}
