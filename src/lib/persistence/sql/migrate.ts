import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SqlDatabase } from "./types.ts";

async function resolveMigrationsRoot(): Promise<string> {
  if (process.env.CAMPUS_MIGRATIONS_PATH) {
    return path.resolve(process.env.CAMPUS_MIGRATIONS_PATH);
  }

  const candidates = [
    path.resolve(process.cwd(), "../migrations"),
    path.resolve(process.cwd(), "migrations"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../migrations"),
  ];

  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "0001_initial.sql"));
      return candidate;
    } catch {
      // essai suivant
    }
  }

  throw new Error(
    "Migrations SQL introuvables. Définissez CAMPUS_MIGRATIONS_PATH ou déployez le dossier migrations/ à la racine du dépôt.",
  );
}

export const SQL_MIGRATION_FILES = [
  "0001_initial.sql",
  "0002_school_week.sql",
  "0003_school_year.sql",
  "0004_teacher_admin.sql",
  "0005_publication_templates.sql",
  "0006_timetable.sql",
  "0007_membership_validity.sql",
  "0008_school_catalog.sql",
  "0009_school_day_exceptions.sql",
  "0010_teacher_accounts.sql",
  "0011_teacher_setups.sql",
  "0012_teacher_notes.sql",
  "0013_teacher_access_meta.sql",
  "0014_school_branch_archive.sql",
  "0015_professions_pedagogy.sql",
  "0016_class_school_year_id.sql",
  "0017_pedagogical_path.sql",
  "0018_admin_referential_coherence.sql",
  "0019_annual_courses_teacher_assignments.sql",
  "0020_school_class_structure.sql",
  "0021_school_class_lifecycle.sql",
  "0022_course_schedule_slots.sql",
  "0023_class_attendance_days.sql",
] as const;

const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`;

const ONCE_BEGIN = /CAMPUS:BEGIN ONCE\s+(\S+)/;
const ONCE_END = /CAMPUS:END ONCE\s+(\S+)/;

async function ensureSchemaMigrations(db: SqlDatabase): Promise<void> {
  await db.exec(`${SCHEMA_MIGRATIONS_DDL};`);
}

async function markMigrationApplied(db: SqlDatabase, filename: string): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO schema_migrations (filename, applied_at)
       VALUES (?, datetime('now'))`,
    )
    .bind(filename)
    .run();
}

async function isMigrationApplied(db: SqlDatabase, filename: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT filename FROM schema_migrations WHERE filename = ?")
    .bind(filename)
    .first<{ filename: string }>();
  return Boolean(row?.filename);
}

/**
 * Bases déjà migrées avant schema_migrations : si l'index annuel existe,
 * le rebuild destructif de 0020 a déjà été joué.
 */
async function backfillDestructiveMigrations(db: SqlDatabase): Promise<void> {
  const index = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND name = 'idx_school_classes_year_code'`,
    )
    .bind()
    .first<{ name: string }>();
  if (index?.name) {
    await markMigrationApplied(db, "0020_school_class_structure.sql");
  }
}

function stripOnceMarkers(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !/^\s*--\s*CAMPUS:(BEGIN|END) ONCE\b/.test(line))
    .join("\n")
    .trim();
}

export async function applyMigrations(
  db: SqlDatabase,
  options?: { until?: (typeof SQL_MIGRATION_FILES)[number] },
): Promise<void> {
  const migrationsRoot = await resolveMigrationsRoot();
  const untilIndex = options?.until ? SQL_MIGRATION_FILES.indexOf(options.until) : -1;
  if (options?.until && untilIndex === -1) {
    throw new Error(`Migration inconnue : ${options.until}`);
  }
  await ensureSchemaMigrations(db);
  await backfillDestructiveMigrations(db);

  const migrationFiles = options?.until
    ? SQL_MIGRATION_FILES.slice(0, untilIndex + 1)
    : SQL_MIGRATION_FILES;
  for (const fileName of migrationFiles) {
    const migrationPath = path.join(migrationsRoot, fileName);
    const sql = await readFile(migrationPath, "utf8");
    const statements = splitSqlStatements(sql);
    let skipOnceKey: string | null = null;
    let ranOnceKey: string | null = null;

    for (const statement of statements) {
      const begin = statement.match(ONCE_BEGIN);
      const end = statement.match(ONCE_END);
      if (begin && (await isMigrationApplied(db, begin[1]!))) {
        skipOnceKey = begin[1]!;
      } else if (begin) {
        ranOnceKey = begin[1]!;
      }

      if (skipOnceKey) {
        if (end) skipOnceKey = null;
        if (begin || !end) continue;
      }

      const cleaned = stripOnceMarkers(statement);
      if (!cleaned) {
        if (end && ranOnceKey) {
          await markMigrationApplied(db, ranOnceKey);
          ranOnceKey = null;
        }
        continue;
      }

      try {
        await db.exec(`${cleaned};`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // `ALTER TABLE ... ADD COLUMN` est rejoué à chaque démarrage : la colonne
        // déjà présente n'est pas une erreur de migration.
        if (message.includes("duplicate column name")) {
          if (end && ranOnceKey) {
            await markMigrationApplied(db, ranOnceKey);
            ranOnceKey = null;
          }
          continue;
        }
        throw error;
      }

      if (end && ranOnceKey) {
        await markMigrationApplied(db, ranOnceKey);
        ranOnceKey = null;
      }
    }
  }
}

/** Découpe les instructions SQL sans casser un bloc CREATE TRIGGER … BEGIN … END. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let inTrigger = false;
  for (const part of sql.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (!inTrigger && /CREATE\s+TRIGGER/i.test(trimmed)) {
      inTrigger = true;
      buffer = trimmed;
      if (/\bEND\s*$/i.test(trimmed)) {
        statements.push(buffer);
        buffer = "";
        inTrigger = false;
      }
      continue;
    }
    if (inTrigger) {
      buffer += `; ${trimmed}`;
      if (/\bEND\s*$/i.test(trimmed)) {
        statements.push(buffer);
        buffer = "";
        inTrigger = false;
      }
      continue;
    }
    statements.push(trimmed);
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

export async function isDatabaseSeeded(db: SqlDatabase): Promise<boolean> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM teachers").bind().first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}
