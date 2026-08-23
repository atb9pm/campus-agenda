import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SqlDatabase } from "./types.ts";

const migrationsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../migrations");

export async function applyMigrations(db: SqlDatabase): Promise<void> {
  const migrationFiles = ["0001_initial.sql", "0002_school_week.sql", "0003_school_year.sql", "0004_teacher_admin.sql", "0005_publication_templates.sql"];
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
        if (fileName === "0002_school_week.sql" && message.includes("duplicate column name")) {
          continue;
        }
        if (fileName === "0004_teacher_admin.sql" && message.includes("duplicate column name")) {
          continue;
        }
        if (fileName === "0005_publication_templates.sql" && message.includes("duplicate column name")) {
          continue;
        }
        throw error;
      }
    }
  }
}

export async function isDatabaseSeeded(db: SqlDatabase): Promise<boolean> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM teachers").bind().first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}
