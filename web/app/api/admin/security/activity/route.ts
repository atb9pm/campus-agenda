import {
  SECURITY_EVENT_RETENTION_DAYS,
  buildSecuritySummary,
  isSecuritySeverity,
  maybePurgeSecurityEvents,
  parseSecurityPeriod,
  presentSecurityEvent,
  securityPeriodSince,
} from "@campus/features/security-events/index.ts";
import { logOperationalEvent } from "@campus/lib/observability/index.ts";
import { getSecurityEventStore } from "@campus/lib/persistence/store-factory.ts";

import { getTeacherAccountsStore, jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

export const SECURITY_ACTIVITY_DEFAULT_PAGE_SIZE = 25;
export const SECURITY_ACTIVITY_MAX_PAGE_SIZE = 100;

function readPositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const url = new URL(request.url);
  const period = parseSecurityPeriod(url.searchParams.get("period"));
  const severityParam = url.searchParams.get("severity");
  const severity = isSecuritySeverity(severityParam) ? severityParam : undefined;
  const pageSize = readPositiveInt(
    url.searchParams.get("pageSize"),
    SECURITY_ACTIVITY_DEFAULT_PAGE_SIZE,
    SECURITY_ACTIVITY_MAX_PAGE_SIZE,
  );
  const page = readPositiveInt(url.searchParams.get("page"), 1, 100_000);

  const now = new Date();
  const store = await getSecurityEventStore();
  const purged = await maybePurgeSecurityEvents(store, now);
  if (purged) logOperationalEvent("security_event_retention_purge", { purged });

  const [summaryRows, listed, teachers] = await Promise.all([
    store.summarize(securityPeriodSince("24h", now)),
    store.list({
      since: securityPeriodSince(period, now),
      severity,
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }),
    (await getTeacherAccountsStore()).listAccounts(),
  ]);
  const initialsById = new Map(teachers.map((teacher) => [teacher.id, teacher.initials]));
  const lookup = { teacherLabel: (teacherId: string) => initialsById.get(teacherId) ?? null };

  return jsonResponse(
    {
      ok: true,
      generatedAt: now.toISOString(),
      period,
      severity: severity ?? "ALL",
      retentionDays: SECURITY_EVENT_RETENTION_DAYS,
      summary: { periodHours: 24, ...buildSecuritySummary(summaryRows) },
      events: listed.events.map((event) => presentSecurityEvent(event, lookup)),
      pagination: {
        page,
        pageSize,
        total: listed.total,
        totalPages: Math.max(1, Math.ceil(listed.total / pageSize)),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = withApiObservability("/api/admin/security/activity", handleGet);
