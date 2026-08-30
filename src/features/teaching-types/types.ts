export const TEACHING_TYPES = ["TECHNICAL", "GENERAL"] as const;

export type TeachingType = (typeof TEACHING_TYPES)[number];

/** null = non configuré (legacy / migration). Ce n'est PAS un troisième type. */
export type TeachingTypeOrUnset = TeachingType | null;

export const BRANCH_TEACHING_TYPE_LABELS: Record<TeachingType, string> = {
  TECHNICAL: "Technique",
  GENERAL: "Branche générale",
};

export const TEACHER_TEACHING_TYPE_LABELS: Record<TeachingType, string> = {
  TECHNICAL: "Professeur technique",
  GENERAL: "Professeur de branche générale",
};

export function isTeachingType(value: unknown): value is TeachingType {
  return value === "TECHNICAL" || value === "GENERAL";
}

export function parseTeachingType(value: unknown): TeachingType | null {
  if (value === null || value === undefined || value === "") return null;
  return isTeachingType(value) ? value : null;
}

export function requireTeachingType(value: unknown): { ok: true; value: TeachingType } | { ok: false; reason: string } {
  if (isTeachingType(value)) return { ok: true, value };
  return {
    ok: false,
    reason: "Le type d'enseignement doit être Technique ou Branche générale (pas « les deux »).",
  };
}
