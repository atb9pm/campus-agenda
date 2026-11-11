import { checkInMemoryRateLimit } from "@campus/lib/security/rate-limit.ts";
import { UNTRUSTED_ORIGIN_REASON, isTrustedWriteOrigin } from "@campus/lib/security/csrf.ts";
import { readSessionTokenFromRequest } from "@campus/lib/auth/session.ts";
import { maybePurgeStudentUsage, schoolCalendarDateIso } from "@campus/features/student-usage/index.ts";
import { getStudentUsageStore } from "@campus/lib/persistence/store-factory.ts";

import { getRequestSession, jsonResponse } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

/** Par cookie de session, pas par IP : une classe sur le réseau de l'école ne se bloque pas. */
const USAGE_VISIT_LIMIT = 20;
const USAGE_VISIT_WINDOW_MS = 60_000;

async function sessionRateKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `student-usage:${hex}`;
}

/**
 * Une consultation du jour, pour la classe et l'année de la session.
 * Le corps de la requête est ignoré : ni classe, ni compteur, ni identité.
 */
async function handlePost(request: Request) {
  if (!isTrustedWriteOrigin(request)) {
    return jsonResponse({ ok: false, reason: UNTRUSTED_ORIGIN_REASON }, { status: 403 });
  }

  const session = await getRequestSession(request);
  if (!session) return jsonResponse({ ok: false, reason: "Session requise." }, { status: 401 });
  if (session.kind !== "student") {
    return jsonResponse({ ok: false, reason: "Réservé à l’espace élève." }, { status: 403 });
  }

  const token = readSessionTokenFromRequest(request);
  if (!token || !checkInMemoryRateLimit(await sessionRateKey(token), USAGE_VISIT_LIMIT, USAGE_VISIT_WINDOW_MS)) {
    return jsonResponse({ ok: false, reason: "Trop de requêtes." }, { status: 429 });
  }

  const date = schoolCalendarDateIso(new Date());
  try {
    const store = await getStudentUsageStore();
    await store.increment({
      date,
      schoolYearId: session.schoolYearId,
      schoolClassId: session.schoolClassId,
    });
    await maybePurgeStudentUsage(store, new Date());
  } catch {
    return jsonResponse({ ok: false, reason: "Comptabilisation indisponible." }, { status: 503 });
  }

  return jsonResponse({
    ok: true,
    date,
    schoolYearId: session.schoolYearId,
    schoolClassId: session.schoolClassId,
  });
}

export const POST = withApiObservability("/api/student/usage-visit", handlePost);
