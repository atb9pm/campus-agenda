/**
 * Typecheck CI 2.26.0 : `tsc --noEmit` sur le projet web, puis échec
 * uniquement si une erreur touche la surface stabilisée.
 * Les erreurs historiques hors surface sont consignées (P2) et n'échouent pas la CI.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "web");

/** Chemins tels qu'affichés par tsc depuis `web/` (fichiers 2.26.0). */
const SURFACE = [
  "../src/lib/auth/session.ts",
  "../src/lib/auth/session-live.ts",
  "../src/features/agenda/schedule-target.ts",
  "../src/features/agenda/index.ts",
  "../src/features/calendar/attendance-course-days.ts",
  "../src/features/calendar/course-days.ts",
  "../src/features/evaluations/coordination.ts",
  "../src/features/student/access.ts",
  "../src/features/student/course-day-view.ts",
  "../src/lib/persistence/campus-backup.ts",
  "../src/lib/persistence/campus-backup-tables.ts",
  "../src/lib/persistence/memory-legacy-school.ts",
  "../src/lib/persistence/memory-store.ts",
  "../src/lib/persistence/sql/sql-agenda-store.ts",
  "../src/lib/persistence/sql/sql-campus-backup.ts",
  "../src/lib/persistence/sql/sql-template-store.ts",
  "app/api/teacher/classrooms/route.ts",
  "app/api/admin/backup/route.ts",
  "app/api/admin/restore/route.ts",
  "app/api/agenda/route.ts",
  "app/api/agenda/[id]/route.ts",
  "app/api/auth/session/route.ts",
  "app/api/auth/student/route.ts",
  "app/api/auth/teacher/route.ts",
  "lib/server/api.ts",
  "lib/api-client.ts",
];

const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false", "--incremental", "false"], {
  cwd: webDir,
  encoding: "utf8",
});

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const errorLines = output.split("\n").filter((line) => /error TS\d+/.test(line));
const surfaceErrors = errorLines.filter((line) =>
  SURFACE.some((file) => line.includes(`${file}(`) || line.includes(`${file}:`)),
);

if (surfaceErrors.length > 0) {
  console.error("Typecheck 2.26.0 — erreurs sur la surface stabilisée :");
  for (const line of surfaceErrors) console.error(line);
  process.exit(1);
}

console.log(
  `Typecheck 2.26.0 : surface propre (${errorLines.length} erreur(s) historique(s) hors surface, documentées P2).`,
);
process.exit(0);
