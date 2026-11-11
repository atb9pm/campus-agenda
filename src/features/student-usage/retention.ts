import type { StudentUsageStore } from "./types.ts";
import { schoolCalendarDateIso, STUDENT_USAGE_TIME_ZONE } from "./time.ts";
import { studentUsageRetentionCutoff } from "./stats.ts";

export { STUDENT_USAGE_TIME_ZONE };

/** Au plus une purge par processus et par intervalle. Jamais de compteur récent supprimé. */
export const STUDENT_USAGE_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastPurgeAt: number | null = null;

export async function maybePurgeStudentUsage(store: StudentUsageStore, now: Date): Promise<number | null> {
  const nowMs = now.getTime();
  if (lastPurgeAt !== null && nowMs - lastPurgeAt < STUDENT_USAGE_PURGE_INTERVAL_MS) return null;
  lastPurgeAt = nowMs;
  return store.purgeBefore(studentUsageRetentionCutoff(schoolCalendarDateIso(now)));
}

export function resetStudentUsagePurgeClock(): void {
  lastPurgeAt = null;
}
