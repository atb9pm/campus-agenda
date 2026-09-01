import type { SqlDatabase } from "./types.ts";
import {
  CAMPUS_BACKUP_COLUMNS,
  CAMPUS_BACKUP_DELETE_ORDER,
  CAMPUS_BACKUP_FOREIGN_KEYS,
  CAMPUS_BACKUP_INSERT_ORDER,
  type BackupColumnSpec,
  type CampusBackupTableName,
} from "../campus-backup-tables.ts";

export type CampusTableDump = Record<string, Array<Record<string, unknown>>>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function asId(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function idSet(rows: Array<Record<string, unknown>>, ...keys: string[]): Set<string> {
  return new Set(rows.map((row) => asId(row, ...keys)).filter(Boolean));
}

function isDateOnly(value: unknown): boolean {
  return typeof value === "string" && DATE_ONLY.test(value);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** 0 / 1, et booléens JS si le dump mémoire les produit. Jamais Boolean("0"). */
export function parseBackupFlag(value: unknown): { ok: true; value: 0 | 1 } | { ok: false } {
  if (value === 0 || value === 1) return { ok: true, value };
  if (value === true) return { ok: true, value: 1 };
  if (value === false) return { ok: true, value: 0 };
  return { ok: false };
}

function parseColumnValue(
  spec: BackupColumnSpec,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (isBlank(value)) {
    if (spec.required) return { ok: false, reason: `Colonne ${spec.name} obligatoire.` };
    return { ok: true, value: null };
  }
  if (spec.type === "flag") {
    const flag = parseBackupFlag(value);
    if (!flag.ok) return { ok: false, reason: `Colonne ${spec.name} : booléen invalide (0 ou 1 attendu).` };
    return { ok: true, value: flag.value };
  }
  if (spec.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, reason: `Colonne ${spec.name} : entier invalide.` };
    }
    return { ok: true, value };
  }
  if (typeof value !== "string") {
    return { ok: false, reason: `Colonne ${spec.name} : texte invalide.` };
  }
  return { ok: true, value };
}

export function projectBackupRow(
  table: CampusBackupTableName,
  row: Record<string, unknown>,
): { ok: true; columns: string[]; values: unknown[] } | { ok: false; reason: string } {
  const specs = CAMPUS_BACKUP_COLUMNS[table];
  const allowed = new Set(specs.map((spec) => spec.name));
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) {
      return { ok: false, reason: `Colonne inconnue ${table}.${key}.` };
    }
  }
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const spec of specs) {
    if (!(spec.name in row) && spec.required) {
      return { ok: false, reason: `Colonne ${table}.${spec.name} obligatoire.` };
    }
    if (!(spec.name in row)) continue;
    const parsed = parseColumnValue(spec, row[spec.name]);
    if (!parsed.ok) return { ok: false, reason: `${table} : ${parsed.reason}` };
    columns.push(spec.name);
    values.push(parsed.value);
  }
  return { ok: true, columns, values };
}

export async function dumpCampusTables(db: SqlDatabase): Promise<CampusTableDump> {
  const tables: CampusTableDump = {};
  for (const table of CAMPUS_BACKUP_INSERT_ORDER) {
    const { results } = await db.prepare(`SELECT * FROM ${table}`).bind().all<Record<string, unknown>>();
    tables[table] = (results ?? []).map((row) => ({ ...row }));
  }
  return tables;
}

function requireTableArray(
  dump: Record<string, unknown>,
  table: CampusBackupTableName,
): { ok: true; rows: Array<Record<string, unknown>> } | { ok: false; reason: string } {
  if (!(table in dump)) {
    return { ok: false, reason: `Table ${table} absente de la sauvegarde v4.` };
  }
  const rows = dump[table];
  if (!Array.isArray(rows)) {
    return { ok: false, reason: `Table ${table} invalide.` };
  }
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, reason: `Table ${table} : ligne invalide.` };
    }
  }
  return { ok: true, rows: rows as Array<Record<string, unknown>> };
}

export function validateCampusTables(tables: unknown): { ok: true; tables: CampusTableDump } | { ok: false; reason: string } {
  if (!tables || typeof tables !== "object") {
    return { ok: false, reason: "Tables de sauvegarde manquantes." };
  }
  const raw = tables as Record<string, unknown>;
  const dump: CampusTableDump = {};

  for (const table of CAMPUS_BACKUP_INSERT_ORDER) {
    const present = requireTableArray(raw, table);
    if (!present.ok) return present;
    for (const row of present.rows) {
      const projected = projectBackupRow(table, row);
      if (!projected.ok) return projected;
    }
    dump[table] = present.rows;
  }

  const teachers = dump.teachers ?? [];
  const hasActiveAdmin = teachers.some((row) => {
    const admin = parseBackupFlag(row.is_admin);
    const active = parseBackupFlag(row.is_active);
    if (!admin.ok || !active.ok) return false;
    const archived = row.archived_at;
    return admin.value === 1 && active.value === 1 && isBlank(archived);
  });
  if (!hasActiveAdmin) {
    return { ok: false, reason: "La sauvegarde ne contient aucun administrateur actif." };
  }

  for (const fk of CAMPUS_BACKUP_FOREIGN_KEYS) {
    const parents = idSet(dump[fk.parent] ?? [], fk.parentColumn);
    for (const row of dump[fk.table] ?? []) {
      const childId = asId(row, fk.column);
      if (!childId) continue;
      if (!parents.has(childId)) {
        return {
          ok: false,
          reason: `Référence ${fk.table}.${fk.column} → ${fk.parent} incohérente.`,
        };
      }
    }
  }

  const agendaIds = (dump.agenda_items ?? []).map((row) => asId(row, "id"));
  if (new Set(agendaIds).size !== agendaIds.length) {
    return { ok: false, reason: "Identifiants de publication en double." };
  }

  for (const week of dump.school_weeks ?? []) {
    if (!isDateOnly(week.monday)) {
      return { ok: false, reason: "Date de lundi de semaine invalide." };
    }
  }

  for (const year of dump.school_years ?? []) {
    if (!isDateOnly(year.starts_on) || !isDateOnly(year.ends_on)) {
      return { ok: false, reason: "Date d'année scolaire invalide." };
    }
  }

  for (const exception of dump.school_day_exceptions ?? []) {
    if (!isDateOnly(exception.day_date)) {
      return { ok: false, reason: "Date d'exception scolaire invalide." };
    }
  }

  return { ok: true, tables: dump };
}

export async function restoreCampusTables(db: SqlDatabase, dump: CampusTableDump): Promise<void> {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  for (const table of CAMPUS_BACKUP_DELETE_ORDER) {
    statements.push({ sql: `DELETE FROM ${table}`, values: [] });
  }
  for (const table of CAMPUS_BACKUP_INSERT_ORDER) {
    const rows = dump[table];
    if (!rows) {
      throw new Error(`Table ${table} absente au restore.`);
    }
    for (const row of rows) {
      const projected = projectBackupRow(table, row);
      if (!projected.ok) throw new Error(projected.reason);
      if (projected.columns.length === 0) continue;
      const placeholders = projected.columns.map(() => "?").join(", ");
      statements.push({
        sql: `INSERT INTO ${table} (${projected.columns.join(", ")}) VALUES (${placeholders})`,
        values: projected.values,
      });
    }
  }
  await db.batch(statements);
}

export function isCampusBackupTableName(value: string): value is CampusBackupTableName {
  return (CAMPUS_BACKUP_INSERT_ORDER as readonly string[]).includes(value);
}

export function canonicalizeCampusDump(dump: CampusTableDump): CampusTableDump {
  const canon: CampusTableDump = {};
  for (const table of CAMPUS_BACKUP_INSERT_ORDER) {
    const rows = (dump[table] ?? []).map((row) => {
      const specs = CAMPUS_BACKUP_COLUMNS[table];
      const next: Record<string, unknown> = {};
      for (const spec of specs) {
        if (!(spec.name in row)) continue;
        const value = row[spec.name];
        if (spec.type === "flag") {
          const flag = parseBackupFlag(value);
          next[spec.name] = flag.ok ? flag.value : value;
        } else {
          next[spec.name] = value ?? null;
        }
      }
      return next;
    });
    rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    canon[table] = rows;
  }
  return canon;
}
