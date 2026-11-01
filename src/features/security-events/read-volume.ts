import { HIGH_READ_VOLUME_THRESHOLD, HIGH_READ_VOLUME_WINDOW_MINUTES } from "./detection.ts";

/**
 * Compteur mémoire des lectures API (GET) par compte enseignant authentifié.
 * Volontairement conservateur : 600 lectures en 5 minutes pour un même compte
 * (≈ 2 requêtes/s soutenues) dépasse largement un usage normal.
 * Par compte et non par source : une école partage souvent une IP (NAT).
 * Mono-instance : le compteur repart de zéro au redémarrage du processus.
 */
const WINDOW_MS = HIGH_READ_VOLUME_WINDOW_MINUTES * 60_000;
export const READ_VOLUME_MAX_TRACKED_ACTORS = 2_000;

interface ReadVolumeBucket {
  windowStart: number;
  count: number;
  alerted: boolean;
}

const buckets = new Map<string, ReadVolumeBucket>();

export interface ReadVolumeCrossing {
  actorId: string;
  observedCount: number;
  threshold: number;
  windowMinutes: number;
}

function evictExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(key);
  }
}

/** Retourne un franchissement de seuil une seule fois par fenêtre et par compte. */
export function trackApiRead(
  actorId: string,
  now = Date.now(),
  threshold = HIGH_READ_VOLUME_THRESHOLD,
): ReadVolumeCrossing | null {
  let bucket = buckets.get(actorId);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    if (!bucket && buckets.size >= READ_VOLUME_MAX_TRACKED_ACTORS) {
      evictExpired(now);
      if (buckets.size >= READ_VOLUME_MAX_TRACKED_ACTORS) return null;
    }
    bucket = { windowStart: now, count: 0, alerted: false };
    buckets.set(actorId, bucket);
  }
  bucket.count += 1;
  if (!bucket.alerted && bucket.count >= threshold) {
    bucket.alerted = true;
    return { actorId, observedCount: bucket.count, threshold, windowMinutes: HIGH_READ_VOLUME_WINDOW_MINUTES };
  }
  return null;
}

export function resetApiReadVolume(): void {
  buckets.clear();
}
