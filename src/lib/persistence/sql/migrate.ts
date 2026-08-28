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

export async function applyMigrations(db: SqlDatabase): Promise<void> {
  const migrationsRoot = await resolveMigrationsRoot();
  const migrationFiles = [
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
  ];
  for (const fileName of migrationFiles) {
    const migrationPath = path.join(migrationsRoot, fileName);
    const sql = await readFile(migrationPath, "utf8");
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      try {
        await db.exec(`${statement};`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // `ALTER TABLE ... ADD COLUMN` est rejoué à chaque démarrage : la colonne
        // déjà présente n'est pas une erreur de migration.
        if (message.includes("duplicate column name")) continue;
        throw error;
      }
    }
  }
}

export async function isDatabaseSeeded(db: SqlDatabase): Promise<boolean> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM teachers").bind().first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}
