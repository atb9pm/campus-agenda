import { randomUUID } from "node:crypto";

import { SCHOOL_WEEK_MONDAYS } from "../../../features/calendar/school-week-dates.ts";
import type { ParsedWeekPlan, SchoolWeekEntry, SchoolYearRecord, SchoolYearWithWeeks } from "../../../features/school-year/types.ts";
import { schoolYearBoundsFromLabel } from "../../../features/school-year/week-plan-logic.ts";
import type { SchoolYearStore } from "../school-year-types.ts";
import type { SqlDatabase } from "./types.ts";

export interface SchoolYearRow {
  id: string;
  label: string;
  status: string;
  starts_on: string;
  ends_on: string;
  source_filename: string | null;
  imported_at: string | null;
  activated_at: string | null;
  created_at: string;
}

export interface SchoolWeekRow {
  school_year_id: string;
  week_number: number;
  week_kind: string;
  monday: string;
}

function rowToRecord(row: SchoolYearRow): SchoolYearRecord {
  return {
    id: row.id,
    label: row.label,
    status: row.status as SchoolYearRecord["status"],
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    sourceFilename: row.source_filename,
    importedAt: row.imported_at,
    activatedAt: row.activated_at,
    createdAt: row.created_at,
  };
}

function rowToWeekEntry(row: SchoolWeekRow): SchoolWeekEntry {
  return {
    number: row.week_number,
    kind: row.week_kind as SchoolWeekEntry["kind"],
    monday: row.monday,
  };
}

export class SqlSchoolYearStore implements SchoolYearStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async hasAnySchoolYear(): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM school_years")
      .bind()
      .first<{ count: number }>();
    return Number(row?.count ?? 0) > 0;
  }

  async listSchoolYears(): Promise<SchoolYearRecord[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM school_years ORDER BY created_at DESC")
      .bind()
      .all<SchoolYearRow>();
    return results.map(rowToRecord);
  }

  async getSchoolYearById(id: string): Promise<SchoolYearWithWeeks | null> {
    const row = await this.db.prepare("SELECT * FROM school_years WHERE id = ?").bind(id).first<SchoolYearRow>();
    if (!row) return null;
    const weeks = await this.loadWeeks(id);
    return { ...rowToRecord(row), weeks };
  }

  async getActiveSchoolYear(): Promise<SchoolYearWithWeeks | null> {
    const row = await this.db
      .prepare("SELECT * FROM school_years WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1")
      .bind()
      .first<SchoolYearRow>();
    if (!row) return null;
    const weeks = await this.loadWeeks(row.id);
    return { ...rowToRecord(row), weeks };
  }

  async importDraftFromPlan(plan: ParsedWeekPlan, sourceFilename?: string): Promise<SchoolYearWithWeeks> {
    const id = randomUUID();
    const bounds = schoolYearBoundsFromLabel(plan.label);
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO school_years
          (id, label, status, starts_on, ends_on, source_filename, imported_at, created_at)
         VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`,
      )
      .bind(id, plan.label, bounds.startsOn, bounds.endsOn, sourceFilename ?? null, now, now)
      .run();

    await this.insertWeeks(id, plan.weeks);
    return (await this.getSchoolYearById(id))!;
  }

  async activateSchoolYear(id: string): Promise<SchoolYearWithWeeks> {
    const target = await this.getSchoolYearById(id);
    if (!target) {
      throw new Error("Année scolaire introuvable.");
    }
    if (target.weeks.length !== 38) {
      throw new Error("Impossible d'activer une année incomplète (38 semaines requises).");
    }

    const now = new Date().toISOString();
    await this.db.prepare("UPDATE school_years SET status = 'archived' WHERE status = 'active'").bind().run();
    await this.db
      .prepare("UPDATE school_years SET status = 'active', activated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();

    return (await this.getSchoolYearById(id))!;
  }

  async seedDefaultActiveYearIfEmpty(): Promise<SchoolYearWithWeeks | null> {
    if (await this.hasAnySchoolYear()) {
      return this.getActiveSchoolYear();
    }

    const label = "2026-2027";
    const bounds = schoolYearBoundsFromLabel(label);
    const id = randomUUID();
    const now = new Date().toISOString();
    const weeks: SchoolWeekEntry[] = SCHOOL_WEEK_MONDAYS.map((entry) => ({
      number: entry.number,
      kind: entry.kind,
      monday: entry.monday,
    }));

    await this.db
      .prepare(
        `INSERT INTO school_years
          (id, label, status, starts_on, ends_on, source_filename, imported_at, activated_at, created_at)
         VALUES (?, ?, 'active', ?, ?, 'seed', ?, ?, ?)`,
      )
      .bind(id, label, bounds.startsOn, bounds.endsOn, now, now, now)
      .run();

    await this.insertWeeks(id, weeks);
    return this.getSchoolYearById(id);
  }

  private async loadWeeks(schoolYearId: string): Promise<SchoolWeekEntry[]> {
    const { results } = await this.db
      .prepare(
        "SELECT school_year_id, week_number, week_kind, monday FROM school_weeks WHERE school_year_id = ? ORDER BY week_number",
      )
      .bind(schoolYearId)
      .all<SchoolWeekRow>();
    return results.map(rowToWeekEntry);
  }

  private async insertWeeks(schoolYearId: string, weeks: SchoolWeekEntry[]): Promise<void> {
    for (const week of weeks) {
      await this.db
        .prepare(
          "INSERT INTO school_weeks (school_year_id, week_number, week_kind, monday) VALUES (?, ?, ?, ?)",
        )
        .bind(schoolYearId, week.number, week.kind, week.monday)
        .run();
    }
  }
}

export async function hydrateActiveSchoolCalendar(db: SqlDatabase): Promise<SchoolWeekEntry[]> {
  const store = new SqlSchoolYearStore(db);
  await store.seedDefaultActiveYearIfEmpty();
  const active = await store.getActiveSchoolYear();
  return active?.weeks ?? SCHOOL_WEEK_MONDAYS.map((entry) => ({
    number: entry.number,
    kind: entry.kind,
    monday: entry.monday,
  }));
}
