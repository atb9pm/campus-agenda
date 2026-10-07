import { randomUUID } from "node:crypto";

import { SCHOOL_WEEK_MONDAYS } from "../../features/calendar/school-week-dates.ts";
import { setActiveSchoolWeekEntries } from "../../features/calendar/active-calendar.ts";
import type { ParsedWeekPlan, SchoolWeekEntry, SchoolYearRecord, SchoolYearWithWeeks } from "../../features/school-year/types.ts";
import type { SchoolYearStore } from "./school-year-types.ts";
import { schoolYearBoundsFromLabel } from "../../features/school-year/week-plan-logic.ts";

let memorySchoolYears: SchoolYearWithWeeks[] = [];

export class MemorySchoolYearStore implements SchoolYearStore {
  async listSchoolYears(): Promise<SchoolYearRecord[]> {
    return memorySchoolYears.map(({ weeks: _weeks, ...record }) => record);
  }

  async getActiveSchoolYear(): Promise<SchoolYearWithWeeks | null> {
    return memorySchoolYears.find((year) => year.status === "active") ?? null;
  }

  async getSchoolYearById(id: string): Promise<SchoolYearWithWeeks | null> {
    return memorySchoolYears.find((year) => year.id === id) ?? null;
  }

  async importDraftFromPlan(plan: ParsedWeekPlan, sourceFilename?: string): Promise<SchoolYearWithWeeks> {
    const now = new Date().toISOString();
    const bounds = schoolYearBoundsFromLabel(plan.label);
    const record: SchoolYearWithWeeks = {
      id: randomUUID(),
      label: plan.label,
      status: "draft",
      startsOn: bounds.startsOn,
      endsOn: bounds.endsOn,
      sourceFilename: sourceFilename ?? null,
      importedAt: now,
      activatedAt: null,
      createdAt: now,
      weeks: plan.weeks,
    };
    memorySchoolYears = [record, ...memorySchoolYears];
    return record;
  }

  async activateSchoolYear(id: string): Promise<SchoolYearWithWeeks> {
    const target = memorySchoolYears.find((year) => year.id === id);
    if (!target) throw new Error("Année scolaire introuvable.");
    if (target.weeks.length !== 38) {
      throw new Error("Impossible d'activer une année incomplète (38 semaines requises).");
    }

    const now = new Date().toISOString();
    memorySchoolYears = memorySchoolYears.map((year) => {
      if (year.status === "active") {
        return { ...year, status: "archived" as const };
      }
      if (year.id === id) {
        return { ...year, status: "active" as const, activatedAt: now };
      }
      return year;
    });

    const active = await this.getActiveSchoolYear();
    if (!active) throw new Error("Activation échouée.");
    setActiveSchoolWeekEntries(active.weeks);
    return active;
  }

  async seedDefaultActiveYearIfEmpty(): Promise<SchoolYearWithWeeks | null> {
    if (memorySchoolYears.length > 0) {
      return this.getActiveSchoolYear();
    }

    const now = new Date().toISOString();
    const bounds = schoolYearBoundsFromLabel("2026-2027");
    const weeks: SchoolWeekEntry[] = SCHOOL_WEEK_MONDAYS.map((entry) => ({
      number: entry.number,
      kind: entry.kind,
      monday: entry.monday,
    }));

    const record: SchoolYearWithWeeks = {
      id: randomUUID(),
      label: "2026-2027",
      status: "active",
      startsOn: bounds.startsOn,
      endsOn: bounds.endsOn,
      sourceFilename: "seed",
      importedAt: now,
      activatedAt: now,
      createdAt: now,
      weeks,
    };
    memorySchoolYears = [record];
    setActiveSchoolWeekEntries(weeks);
    return record;
  }
}

export function resetMemorySchoolYearStore(): void {
  memorySchoolYears = [];
}

export async function hydrateMemorySchoolCalendar(): Promise<SchoolWeekEntry[]> {
  const store = new MemorySchoolYearStore();
  await store.seedDefaultActiveYearIfEmpty();
  const active = await store.getActiveSchoolYear();
  return active?.weeks ?? SCHOOL_WEEK_MONDAYS.map((entry) => ({
    number: entry.number,
    kind: entry.kind,
    monday: entry.monday,
  }));
}
