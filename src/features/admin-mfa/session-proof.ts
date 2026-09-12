/** Preuve recovery récente dans la session signée — 10 minutes maximum. */
export const MFA_RECOVERY_PROOF_TTL_MS = 10 * 60 * 1000;

export function hasRecentMfaRecoveryProof(
  session: { mfaRecoveryVerifiedAt?: number },
  now = Date.now(),
): boolean {
  const at = session.mfaRecoveryVerifiedAt;
  if (typeof at !== "number" || !Number.isFinite(at)) return false;
  const age = now - at;
  return age >= 0 && age <= MFA_RECOVERY_PROOF_TTL_MS;
}
