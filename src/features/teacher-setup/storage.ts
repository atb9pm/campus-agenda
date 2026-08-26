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
