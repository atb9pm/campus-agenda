import type { SecurityEventStore } from "./types.ts";

/**
 * Durée de conservation du journal de sécurité.
 * Purge contrôlée : au plus une fois par `SECURITY_EVENT_PURGE_INTERVAL_MS`
 * et par processus, déclenchée par une écriture ou une consultation admin.
 * Jamais d'événement plus récent que la rétention n'est supprimé.
 */
export const SECURITY_EVENT_RETENTION_DAYS = 180;
export const SECURITY_EVENT_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

let lastPurgeAt: number | null = null;

export function securityEventRetentionCutoff(now: Date): string {
  return new Date(now.getTime() - SECURITY_EVENT_RETENTION_DAYS * DAY_MS).toISOString();
}

/** Retourne le nombre de lignes purgées, ou `null` si la purge n'était pas due. */
export async function maybePurgeSecurityEvents(store: SecurityEventStore, now: Date): Promise<number | null> {
  const nowMs = now.getTime();
  if (lastPurgeAt !== null && nowMs - lastPurgeAt < SECURITY_EVENT_PURGE_INTERVAL_MS) return null;
  lastPurgeAt = nowMs;
  return store.purgeOlderThan(securityEventRetentionCutoff(now));
}

export function resetSecurityEventPurgeClock(): void {
  lastPurgeAt = null;
}
