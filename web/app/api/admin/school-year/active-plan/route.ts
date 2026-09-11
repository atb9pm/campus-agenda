import {
  assertCalendarYearWritable,
  buildSchoolYearCalendarPlan,
  resolveSchoolYearForPlan,
} from "@campus/features/school-year/working-year-plan.ts";
import type { SchoolWeekEntry } from "@campus/features/school-year/types.ts";
import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

function requestedSchoolYearId(request: Request, body?: { schoolYearId?: unknown }): string | null {
  if (typeof body?.schoolYearId === "string" && body.schoolYearId.trim()) {
    return body.schoolYearId.trim();
  }
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("schoolYearId")?.trim();
  return fromQuery || null;
}

function readWeeks(input: unknown): SchoolWeekEntry[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;

  const weeks: SchoolWeekEntry[] = [];
  for (const entry of input) {
    const week = entry as { number?: unknown; kind?: unknown; monday?: unknown };
    const number = Number(week.number);
    if (!Number.isInteger(number) || number < 1 || number > 60) return null;
    if (week.kind !== "A" && week.kind !== "B") return null;
    if (typeof week.monday !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(week.monday)) return null;
    weeks.push({ number, kind: week.kind, monday: week.monday });
  }
  return weeks;
}

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const store = await getSchoolYearStore();
  const year = await resolveSchoolYearForPlan(store, requestedSchoolYearId(request));
  if (!year) {
    return jsonResponse({ ok: false, reason: "Année scolaire introuvable." }, { status: 404 });
  }

  const payload = await buildSchoolYearCalendarPlan(store, year);
  return jsonResponse({ ok: true, ...payload });
}

async function handlePatch(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = (await request.json()) as { weeks?: unknown; schoolYearId?: unknown };
  const weeks = readWeeks(body.weeks);
  if (!weeks) {
    return jsonResponse({ ok: false, reason: "Plan des semaines invalide." }, { status: 400 });
  }

  const store = await getSchoolYearStore();
  const year = await resolveSchoolYearForPlan(store, requestedSchoolYearId(request, body));
  if (!year) {
    return jsonResponse({ ok: false, reason: "Année scolaire introuvable." }, { status: 404 });
  }

  const writable = assertCalendarYearWritable(year);
  if (!writable.ok) {
    return jsonResponse({ ok: false, reason: writable.reason }, { status: 400 });
  }

  try {
    await store.replaceSchoolYearWeeks(year.id, weeks);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Enregistrement impossible.";
    return jsonResponse({ ok: false, reason }, { status: 400 });
  }

  const updated = await store.getSchoolYearById(year.id);
  if (!updated) {
    return jsonResponse({ ok: false, reason: "Année scolaire introuvable." }, { status: 404 });
  }
  const payload = await buildSchoolYearCalendarPlan(store, updated);
  return jsonResponse({ ok: true, ...payload });
}

export const GET = withApiObservability("/api/admin/school-year/active-plan", handleGet);
export const PATCH = withApiObservability("/api/admin/school-year/active-plan", handlePatch);
