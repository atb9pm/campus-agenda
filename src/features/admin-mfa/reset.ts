import { logOperationalEvent } from "../../lib/observability/index.ts";
import type { AdminMfaStore, TeacherMfaRecord } from "./types.ts";
import { RESET_2FA_CONFIRM_TOKEN, isReset2faConfirmToken } from "./types.ts";

export { RESET_2FA_CONFIRM_TOKEN, isReset2faConfirmToken };

function nowIso(): string {
  return new Date().toISOString();
}

export async function resetAdminMfa(
  store: AdminMfaStore,
  teacherId: string,
): Promise<{ ok: true }> {
  const existing = (await store.get(teacherId)) ?? {
    teacherId,
    status: "disabled" as const,
    secretEncrypted: null,
    pendingSecretEncrypted: null,
    recoveryHashes: [],
    confirmedAt: null,
    updatedAt: nowIso(),
  } satisfies TeacherMfaRecord;
  await store.upsert({
    ...existing,
    status: "reset_required",
    secretEncrypted: null,
    pendingSecretEncrypted: null,
    recoveryHashes: [],
    confirmedAt: null,
    updatedAt: nowIso(),
  });
  logOperationalEvent("admin_mfa_server_reset", { teacherId });
  return { ok: true };
}
