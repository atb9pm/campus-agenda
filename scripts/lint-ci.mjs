/**
 * Lint CI 2.26.0 : `eslint` sur le dossier web, puis échec uniquement
 * si une erreur touche la surface stabilisée.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "web");

const SURFACE = [
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
  "app/page.tsx",
];

const result = spawnSync(
  "npx",
  ["eslint", ".", "--ignore-pattern", "dist", "--ignore-pattern", ".next", "--format", "unix"],
  { cwd: webDir, encoding: "utf8" },
);

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const errorLines = output.split("\n").filter((line) => /:\d+:\d+:/.test(line) && /\[Error|error\//i.test(line));
const surfaceErrors = errorLines.filter((line) =>
  SURFACE.some((file) => line.includes(`/${file}:`) || line.includes(`${file}:`)),
);

if (surfaceErrors.length > 0) {
  console.error("Lint 2.26.0 — erreurs sur la surface stabilisée :");
  for (const line of surfaceErrors) console.error(line);
  process.exit(1);
}

console.log(
  `Lint 2.26.0 : surface propre (${errorLines.length} erreur(s) historique(s) hors surface, documentées P2).`,
);
process.exit(0);
