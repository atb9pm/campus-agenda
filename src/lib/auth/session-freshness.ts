/** Accepte un ISO ou un `YYYY-MM-DD HH:MM:SS` UTC SQLite. */
export function parseCredentialTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : null;
}

/** Vrai si le cookie a été émis avant un changement de mot de passe ou de MFA. */
export function isSessionOlderThanCredential(
  issuedAt: number,
  updatedAt: string | null | undefined,
): boolean {
  const ts = parseCredentialTimestamp(updatedAt);
  if (ts === null) return false;
  return issuedAt < ts;
}
