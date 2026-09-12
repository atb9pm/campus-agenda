import {
  startAdminMfaLostPhoneReconfigure,
  startAdminMfaReconfigureWithPassword,
} from "@campus/features/admin-mfa/index.ts";
import { getAdminMfaStore } from "@campus/lib/persistence/store-factory.ts";

import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { getTeacherAccountsStore } from "../../../../../../lib/server/api.ts";
import { enforceAuthRateLimit } from "../../../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const limited = await enforceAuthRateLimit(request, "teacher-mfa", auth.session!.teacherId);
  if (limited) return limited;

  const body = await request.json() as {
    password?: string;
    totp?: string;
    recoveryCode?: string;
  };
  const password = String(body.password ?? "");
  const totp = String(body.totp ?? "").trim();
  const recoveryCode = String(body.recoveryCode ?? "").trim();
  if (totp && recoveryCode) {
    return jsonResponse({ ok: false, reason: "Indiquez soit un code TOTP, soit un code de récupération." }, { status: 400 });
  }

  const accounts = await getTeacherAccountsStore();
  const account = await accounts.findAccount(auth.session!.teacherId);
  const label = account?.initials ?? account?.displayName ?? "admin";
  const store = await getAdminMfaStore();

  const result = recoveryCode
    ? await startAdminMfaLostPhoneReconfigure(store, accounts, auth.session!.teacherId, label, password, recoveryCode)
    : await startAdminMfaReconfigureWithPassword(store, accounts, auth.session!.teacherId, label, password, totp);

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }
  return jsonResponse({
    ok: true,
    qrDataUrl: result.qrDataUrl,
    manualKey: result.manualKey,
  });
}
