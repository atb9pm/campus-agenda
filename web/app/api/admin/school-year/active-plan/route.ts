import {
  buildSchoolDayPlan,
  checkWeekPlanConsistency,
  countClassDays,
  listHolidayDays,
  valaisHolidaysForSchoolYear,
} from "@campus/features/school-days/index.ts";
import type { SchoolWeekEntry } from "@campus/features/school-year/types.ts";
import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function buildPayload() {
  const store = await getSchoolYearStore();
  const active = await store.getActiveSchoolYear();
  if (!active) return null;

  const exceptions = await store.listDayExceptions(active.id);
  const holidays = valaisHolidaysForSchoolYear(active.label);
  const rows = buildSchoolDayPlan(active.weeks, holidays, exceptions);

  return {
    year: { id: active.id, label: active.label, status: active.status },
    weeks: active.weeks,
    rows,
    warnings: checkWeekPlanConsistency(active.weeks),
    classDayCount: countClassDays(rows),
    holidays: listHolidayDays(rows),
  };
}

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const payload = await buildPayload();
  if (!payload) {
    return jsonResponse({ ok: false, reason: "Aucune année scolaire active." }, { status: 404 });
  }
  return jsonResponse({ ok: true, ...payload });
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

async function handlePatch(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = (await request.json()) as { weeks?: unknown };
  const weeks = readWeeks(body.weeks);
  if (!weeks) {
    return jsonResponse({ ok: false, reason: "Plan des semaines invalide." }, { status: 400 });
  }

  const store = await getSchoolYearStore();
  const active = await store.getActiveSchoolYear();
  if (!active) {
    return jsonResponse({ ok: false, reason: "Aucune année scolaire active." }, { status: 404 });
  }

  try {
    await store.replaceSchoolYearWeeks(active.id, weeks);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Enregistrement impossible.";
    return jsonResponse({ ok: false, reason }, { status: 400 });
  }

  const payload = await buildPayload();
  return jsonResponse({ ok: true, ...payload });
}

export const GET = withApiObservability("/api/admin/school-year/active-plan", handleGet);
export const PATCH = withApiObservability("/api/admin/school-year/active-plan", handlePatch);
