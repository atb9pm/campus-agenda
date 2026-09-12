import { isMfaEncryptionReady, isMfaKeyRequired } from "../../lib/auth/mfa-crypto.ts";
import type { AdminMfaStatus } from "./types.ts";
import {
  MFA_PENDING_REASON,
  MFA_SETUP_REQUIRED_REASON,
  MFA_UNAVAILABLE_REASON,
} from "./types.ts";

export type AdminMfaGateResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      status: number;
      mfaPending?: boolean;
      mfaSetupRequired?: boolean;
    };

export function evaluateAdminMfaKeyGate(): AdminMfaGateResult {
  if (isMfaKeyRequired() && !isMfaEncryptionReady()) {
    return { ok: false, reason: MFA_UNAVAILABLE_REASON, status: 503 };
  }
  return { ok: true };
}

export function evaluateAdminMfaAccess(options: {
  isAdmin: boolean;
  mfaPending: boolean;
  status: AdminMfaStatus | null | undefined;
}): AdminMfaGateResult {
  const keyGate = evaluateAdminMfaKeyGate();
  if (!keyGate.ok) return keyGate;
  if (!options.isAdmin) {
    return { ok: false, reason: "Accès administrateur requis.", status: 403 };
  }
  if (options.mfaPending) {
    return { ok: false, reason: MFA_PENDING_REASON, status: 403, mfaPending: true };
  }
  if (options.status !== "enabled") {
    return { ok: false, reason: MFA_SETUP_REQUIRED_REASON, status: 403, mfaSetupRequired: true };
  }
  return { ok: true };
}
