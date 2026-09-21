export type CredentialTimestampKind = "absent" | "valid" | "invalid";

export interface CredentialTimestampClassification {
  kind: CredentialTimestampKind;
  ts: number | null;
}

/**
 * Distingue :
 * A. valeur absente légitime (null, undefined, chaîne vide) ;
 * B. valeur présente et interprétable comme date ;
 * C. valeur présente mais invalide / corrompue.
 */
export function classifyCredentialTimestamp(value: string | null | undefined): CredentialTimestampClassification {
  if (value == null) return { kind: "absent", ts: null };
  if (typeof value !== "string") return { kind: "invalid", ts: null };
  const trimmed = value.trim();
  if (!trimmed) return { kind: "absent", ts: null };

  const normalized = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  const ts = Date.parse(normalized);
  if (!Number.isFinite(ts)) return { kind: "invalid", ts: null };
  return { kind: "valid", ts };
}

/** Accepte un ISO ou un `YYYY-MM-DD HH:MM:SS` UTC SQLite. Invalide → null. */
export function parseCredentialTimestamp(value: string | null | undefined): number | null {
  const parsed = classifyCredentialTimestamp(value);
  return parsed.kind === "valid" ? parsed.ts : null;
}

/**
 * Vrai si la session doit être refusée :
 * - date valide postérieure au cookie ;
 * - date présente mais invalide (fail closed).
 */
export function isSessionOlderThanCredential(
  issuedAt: number,
  updatedAt: string | null | undefined,
): boolean {
  const parsed = classifyCredentialTimestamp(updatedAt);
  if (parsed.kind === "absent") return false;
  if (parsed.kind === "invalid") return true;
  return issuedAt < parsed.ts!;
}
