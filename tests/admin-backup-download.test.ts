import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BACKUP_ERROR_MESSAGE,
  BACKUP_PENDING_MESSAGE,
  BACKUP_SUCCESS_MESSAGE,
  createBackupDownload,
  exportedAtFromSnapshot,
  isUsableBackupPayload,
} from "../src/features/admin-backup/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { backupDownloadFilename } from "../src/lib/persistence/backup.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

test("version 2.44.0 — sauvegarde admin manuelle", async () => {
  assert.equal(APP_VERSION, "2.50.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0028_school_week_kind_nullable.sql");

  const panel = await readFile(new URL("../web/app/components/admin-backup-panel.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../web/app/components/administration-panel.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../web/app/api/admin/backup/route.ts", import.meta.url), "utf8");
  const restore = await readFile(new URL("../web/app/api/admin/restore/route.ts", import.meta.url), "utf8");

  assert.match(page, /activeSection === "administration" && teacherIsAdmin/);
  assert.match(route, /requireAdminSession/);
  assert.match(route, /exportStoreSnapshot/);
  assert.match(route, /method: "GET"|export const GET/);
  assert.match(restore, /requireAdminSession/);
  assert.match(admin, /<AdminBackupPanel mode="download"/);
  assert.match(admin, /<AdminBackupPanel mode="restore"/);
  assert.match(admin, /backup: "Sauvegarde des données"/);
  assert.match(admin, /restore: "Restaurer une sauvegarde"/);
  assert.doesNotMatch(admin, /Référentiel pédagogique/);
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.admin-workspace \.admin-tabs \{[^}]*flex-wrap: nowrap/);
  assert.match(panel, /Sauvegarde des données/);
  assert.match(panel, /Télécharge une copie complète des données actuelles de Campus Agenda/);
  assert.match(panel, /Télécharger une sauvegarde/);
  assert.match(panel, /fetch\("\/api\/admin\/backup"/);
  assert.match(panel, /disabled=\{phase === "pending"\}/);
  assert.match(panel, /BACKUP_PENDING_MESSAGE/);
  assert.match(panel, /BACKUP_SUCCESS_MESSAGE/);
  assert.match(panel, /BACKUP_ERROR_MESSAGE/);
  assert.doesNotMatch(panel, /localStorage/);
  assert.doesNotMatch(panel, /sessionStorage/);
  assert.doesNotMatch(panel, /console\.log/);
  assert.doesNotMatch(panel, /Reset usine/);
  assert.doesNotMatch(panel, /Vider la base/);
  assert.doesNotMatch(panel, /Réinitialiser Campus Agenda/);
  assert.doesNotMatch(admin, /href="\/api\/admin\/backup"/);
  assert.doesNotMatch(admin, /Reset usine|Vider la base|Réinitialiser Campus Agenda/);
});

test("nom de fichier — date et heure UTC depuis exportedAt", () => {
  assert.equal(
    backupDownloadFilename("2026-09-08T09:15:53.133Z"),
    "campus-agenda-backup-2026-09-08-0915.json",
  );
  assert.equal(
    backupDownloadFilename("invalide", new Date("2026-09-08T09:15:00.000Z")),
    "campus-agenda-backup-2026-09-08-0915.json",
  );
  assert.equal(exportedAtFromSnapshot({ exportedAt: "2026-09-08T09:15:53.133Z" }), "2026-09-08T09:15:53.133Z");
  assert.equal(exportedAtFromSnapshot({}), "");
});

test("téléchargement seulement si ok === true et snapshot présent", async () => {
  const saved: string[] = [];
  const ok = await createBackupDownload({
    fetchBackup: async () => ({
      httpOk: true,
      payload: { ok: true, snapshot: { exportedAt: "2026-09-08T09:15:53.133Z", items: [] } },
    }),
    saveFile: (filename, jsonText) => {
      saved.push(filename);
      const parsed = JSON.parse(jsonText) as { ok: boolean; snapshot: { exportedAt: string } };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.snapshot.exportedAt, "2026-09-08T09:15:53.133Z");
    },
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.filename, "campus-agenda-backup-2026-09-08-0915.json");
  assert.deepEqual(saved, ["campus-agenda-backup-2026-09-08-0915.json"]);

  const skipped: string[] = [];
  const refused = await createBackupDownload({
    fetchBackup: async () => ({ httpOk: true, payload: { ok: false, snapshot: { items: [1] } } }),
    saveFile: (filename) => skipped.push(filename),
  });
  assert.equal(refused.ok, false);
  assert.deepEqual(skipped, []);

  const missing = await createBackupDownload({
    fetchBackup: async () => ({ httpOk: true, payload: { ok: true } }),
    saveFile: (filename) => skipped.push(filename),
  });
  assert.equal(missing.ok, false);

  const httpError = await createBackupDownload({
    fetchBackup: async () => ({ httpOk: false, payload: { ok: true, snapshot: {} } }),
    saveFile: (filename) => skipped.push(filename),
  });
  assert.equal(httpError.ok, false);

  const thrown = await createBackupDownload({
    fetchBackup: async () => {
      throw new Error("réseau");
    },
    saveFile: (filename) => skipped.push(filename),
  });
  assert.equal(thrown.ok, false);
  assert.deepEqual(skipped, []);
  assert.equal(isUsableBackupPayload({ ok: true, snapshot: {} }), true);
  assert.equal(isUsableBackupPayload({ ok: true }), false);
  assert.equal(BACKUP_PENDING_MESSAGE, "Création de la sauvegarde…");
  assert.equal(BACKUP_SUCCESS_MESSAGE, "✓ Sauvegarde téléchargée avec succès");
  assert.match(BACKUP_ERROR_MESSAGE, /Aucune donnée n’a été modifiée/);
});

test("sauvegarde GET — lecture seule, pas de restauration dans /api/admin/backup", async () => {
  const route = await readFile(new URL("../web/app/api/admin/backup/route.ts", import.meta.url), "utf8");
  assert.match(route, /export const GET/);
  assert.doesNotMatch(route, /export const POST/);
  assert.doesNotMatch(route, /restoreStoreSnapshot/);
});
