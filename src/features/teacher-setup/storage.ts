import type { TeacherSetupConfig } from "./types.ts";

export const TEACHER_SETUP_STORAGE_PREFIX = "campus-agenda-teacher-setup";

export function teacherSetupStorageKey(teacherId: string): string {
  return `${TEACHER_SETUP_STORAGE_PREFIX}:${teacherId}`;
}

export function parseStoredTeacherSetup(raw: string | null): TeacherSetupConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TeacherSetupConfig;
    if (parsed?.version !== 1 || !Array.isArray(parsed.classes)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function serializeTeacherSetup(config: TeacherSetupConfig): string {
  return JSON.stringify(config);
}

/** Charge la configuration depuis localStorage (navigateur uniquement). */
export function loadTeacherSetupFromBrowser(teacherId: string): TeacherSetupConfig | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredTeacherSetup(localStorage.getItem(teacherSetupStorageKey(teacherId)));
  } catch {
    return null;
  }
}

/** Enregistre la configuration dans localStorage (navigateur uniquement). */
export function saveTeacherSetupToBrowser(teacherId: string, config: TeacherSetupConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(teacherSetupStorageKey(teacherId), serializeTeacherSetup(config));
  } catch {
    // localStorage indisponible
  }
}

/** Efface la copie locale après migration réussie vers le serveur. */
export function clearTeacherSetupFromBrowser(teacherId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(teacherSetupStorageKey(teacherId));
  } catch {
    // localStorage indisponible
  }
}

/** Vérifie qu'un payload HTTP ressemble à une configuration enseignant. */
export function isTeacherSetupPayload(value: unknown): value is TeacherSetupConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as TeacherSetupConfig;
  if (candidate.version !== 1 || !Array.isArray(candidate.classes)) return false;
  return candidate.classes.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      typeof entry.name === "string" &&
      typeof entry.programLabel === "string" &&
      typeof entry.dayOfWeek === "number" &&
      Array.isArray(entry.branchNames) &&
      typeof entry.icon === "string",
  );
}
