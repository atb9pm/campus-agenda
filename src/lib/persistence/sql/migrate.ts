import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SqlDatabase } from "./types.ts";

const migrationsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../migrations");

export async function applyMigrations(db: SqlDatabase): Promise<void> {
  const migrationPath = path.join(migrationsRoot, "0001_initial.sql");
  const sql = await readFile(migrationPath, "utf8");
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.exec(`${statement};`);
  }
}

export async function isDatabaseSeeded(db: SqlDatabase): Promise<boolean> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM teachers").bind().first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}
