import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMPATIBLE_BACKUP_VERSIONS,
  CURRENT_BACKUP_FORMAT_VERSION,
  INVALID_BACKUP_FILE_MESSAGE,
  LEGACY_BACKUP_FILE_NOTICE,
  RESTORE_CONFIRM_TOKEN,
  RESTORE_FAILED_MESSAGE,
  RESTORE_LOSS_WARNING,
  RESTORE_SAFETY_BACKUP_FAILED_MESSAGE,
  RESTORE_SUCCESS_TITLE,
  backupFormatVersionLabel,
  countSnapshotElements,
  extractBackupSnapshot,
  isLegacyBackupVersion,
  isRestoreConfirmToken,
  parseBackupFile,
  restoreReplaceWarning,
  restoreRequestBody,
  restoreSuccessDetail,
  runSecureRestore,
} from "../src/features/admin-backup/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { beforeRestoreDownloadFilename } from "../src/lib/persistence/backup.ts";
import { CAMPUS_BACKUP_INSERT_ORDER } from "../src/lib/persistence/campus-backup-tables.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

const WRAPPED_V4 = {
  ok: true,
  snapshot: {
    version: 4,
    exportedAt: "2026-09-08T08:26:00.000Z",
    itemCount: 12,
    tables: { teachers: [{ id: "t1" }], classrooms: [{ id: "c1" }] },
  },
};

const RAW_V3 = {
  version: 3,
  exportedAt: "2026-09-01T10:00:00.000Z",
  itemCount: 4,
  items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
};

test("version 2.44.0 — restauration admin sécurisée", async () => {
  assert.equal(APP_VERSION, "2.44.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0026_student_access_ciphertext.sql");
  assert.deepEqual([...COMPATIBLE_BACKUP_VERSIONS], [1, 2, 3, 4]);

  const panel = await readFile(new URL("../web/app/components/admin-backup-panel.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../web/app/components/administration-panel.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const restoreRoute = await readFile(new URL("../web/app/api/admin/restore/route.ts", import.meta.url), "utf8");
  const backupRoute = await readFile(new URL("../web/app/api/admin/backup/route.ts", import.meta.url), "utf8");
  const e2e = await readFile(new URL("../web/tests/e2e-api.test.mjs", import.meta.url), "utf8");
  const parseSource = await readFile(new URL("../src/features/admin-backup/parse-backup-file.ts", import.meta.url), "utf8");
  const restoreSource = await readFile(new URL("../src/features/admin-backup/secure-restore.ts", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../src/lib/persistence/sql/adapters.ts", import.meta.url), "utf8");
  const restoreSql = await readFile(new URL("../src/lib/persistence/sql/sql-campus-backup.ts", import.meta.url), "utf8");
  const operations = await readFile(new URL("../docs/OPERATIONS.md", import.meta.url), "utf8");

  assert.match(page, /activeSection === "administration" && teacherIsAdmin/);
  assert.match(admin, /<AdminBackupPanel mode="download"/);
  assert.match(admin, /<AdminBackupPanel mode="restore"/);
  assert.match(admin, /backup: "Sauvegarde des données"/);
  assert.match(admin, /restore: "Restaurer une sauvegarde"/);
  assert.doesNotMatch(admin, /Référentiel pédagogique/);
  assert.match(backupRoute, /requireAdminSession/);
  assert.match(restoreRoute, /requireAdminSession/);
  assert.match(restoreRoute, /restoreStoreSnapshot/);
  assert.match(restoreRoute, /export const POST/);
  assert.match(e2e, /restoreAnon[\s\S]*401/);
  assert.match(e2e, /restoreStaff[\s\S]*403/);
  assert.match(e2e, /\/api\/admin\/restore[\s\S]*adminCookie[\s\S]*200/);

  assert.match(panel, /Télécharger une sauvegarde/);
  assert.match(panel, /Restaurer une sauvegarde/);
  assert.match(panel, /Restaure les données de Campus Agenda à l’état contenu dans une sauvegarde précédente/);
  assert.match(panel, /Choisir un fichier de sauvegarde/);
  assert.match(panel, /data-admin-restore-pick/);
  assert.match(panel, /fileInputRef\.current\?\.click/);
  assert.match(panel, /admin-restore-file-input/);
  assert.match(panel, /accept="\.json,application\/json"/);
  assert.match(panel, /type="file"/);
  assert.match(panel, /Restaurer cette sauvegarde/);
  assert.match(panel, /disabled=\{!canRestore\}/);
  assert.match(panel, /Restaurer Campus Agenda \?/);
  assert.match(panel, /RESTORE_CONFIRM_TOKEN/);
  assert.match(panel, /disabled=\{!canConfirm\}/);
  assert.match(panel, /Restaurer maintenant/);
  assert.match(panel, /Annuler/);
  assert.match(panel, /\/api\/admin\/restore/);
  assert.match(panel, /method: "POST"/);
  assert.match(panel, /window\.location\.reload/);
  assert.match(panel, /RESTORE_SUCCESS_TITLE/);
  assert.match(panel, /restoreSuccessDetail/);
  assert.match(panel, /LEGACY_BACKUP_FILE_NOTICE/);
  assert.match(panel, /meta\.isLegacy/);
  assert.match(panel, /window\.location\.reload/);
  const afterSuccess = panel.slice(panel.indexOf('setRestorePhase("success")'));
  assert.match(afterSuccess, /window\.location\.reload/);
  const afterFailure = panel.slice(panel.indexOf("if (!outcome.ok)"), panel.indexOf('setRestorePhase("success")'));
  assert.doesNotMatch(afterFailure, /location\.reload/);
  assert.doesNotMatch(panel, /localStorage/);
  assert.doesNotMatch(panel, /sessionStorage/);
  assert.doesNotMatch(panel, /console\.log/);
  assert.doesNotMatch(parseSource, /localStorage|sessionStorage|console\.log/);
  assert.doesNotMatch(restoreSource, /localStorage|sessionStorage|console\.log/);
  assert.match(adapter, /this\.db\.exec\("BEGIN"\)/);
  assert.match(adapter, /this\.db\.exec\("COMMIT"\)/);
  assert.match(adapter, /this\.db\.exec\("ROLLBACK"\)/);
  assert.match(restoreSql, /await db\.batch\(statements\)/);
  assert.match(restoreSql, /CAMPUS_BACKUP_INSERT_ORDER/);
  assert.match(operations, /Infomaniak Node\.js/);
  assert.match(operations, /SQLite/);
  assert.match(operations, /format courant \*\*complet\*\*|Format courant : \*\*v4\*\*/);
  assert.match(operations, /CAMPUS_BACKUP_INSERT_ORDER/);
  assert.match(operations, /nouvelle table = dump \+ restore \+ validation \+ tests/);
  assert.match(operations, /ne déploie \*\*plus\*\* par SSH/);
  assert.match(operations, /onglet \*\*Sauvegarde des données\*\*/);
  assert.match(operations, /onglet \*\*Restaurer une sauvegarde\*\*/);
  assert.doesNotMatch(panel, /Reset usine/);
  assert.doesNotMatch(panel, /Vider la base/);
  assert.doesNotMatch(panel, /Réinitialiser Campus Agenda/);
  assert.doesNotMatch(admin, /Reset usine|Vider la base|Réinitialiser Campus Agenda/);
});

test("fichier JSON — enveloppé, brut, invalide et version incompatible", () => {
  const wrapped = parseBackupFile("campus-agenda-backup-2026-09-08-0826.json", JSON.stringify(WRAPPED_V4));
  assert.equal(wrapped.ok, true);
  if (!wrapped.ok) return;
  assert.equal(wrapped.meta.fileName, "campus-agenda-backup-2026-09-08-0826.json");
  assert.equal(wrapped.meta.version, 4);
  assert.equal(wrapped.meta.isLegacy, false);
  assert.equal(wrapped.meta.versionLabel, "4 — format courant");
  assert.equal(CURRENT_BACKUP_FORMAT_VERSION, 4);
  assert.equal(CAMPUS_BACKUP_INSERT_ORDER.length, 29);
  assert.equal(wrapped.meta.exportedAt, "2026-09-08T08:26:00.000Z");
  assert.equal(wrapped.meta.exportedAtLabel, "08/09/2026 08:26 UTC");
  assert.equal(wrapped.meta.itemCount, 12);
  assert.equal(wrapped.snapshot.version, 4);
  assert.equal("ok" in wrapped.snapshot, false);

  const raw = parseBackupFile("snapshot.json", JSON.stringify(RAW_V3));
  assert.equal(raw.ok, true);
  if (!raw.ok) return;
  assert.equal(raw.meta.version, 3);
  assert.equal(raw.meta.isLegacy, true);
  assert.equal(raw.meta.versionLabel, "3 — ancienne sauvegarde");
  assert.equal(raw.meta.itemCount, 4);
  assert.deepEqual(extractBackupSnapshot(RAW_V3), RAW_V3);

  const rawV1 = parseBackupFile("v1.json", JSON.stringify({ version: 1, exportedAt: "2026-01-01T00:00:00.000Z", items: [] }));
  assert.equal(rawV1.ok, true);
  if (rawV1.ok) {
    assert.equal(rawV1.meta.isLegacy, true);
    assert.equal(isLegacyBackupVersion(1), true);
  }
  const rawV2 = parseBackupFile("v2.json", JSON.stringify({ version: 2, exportedAt: "2026-01-01T00:00:00.000Z", items: [] }));
  assert.equal(rawV2.ok, true);
  if (rawV2.ok) {
    assert.equal(rawV2.meta.isLegacy, true);
    assert.match(LEGACY_BACKUP_FILE_NOTICE, /Ancienne sauvegarde/);
    assert.equal(backupFormatVersionLabel(2), "2 — ancienne sauvegarde");
  }
  assert.equal(isLegacyBackupVersion(4), false);

  const invalidJson = parseBackupFile("x.json", "{not json");
  assert.equal(invalidJson.ok, false);
  if (!invalidJson.ok) assert.equal(invalidJson.message, INVALID_BACKUP_FILE_MESSAGE);

  const notJsonExt = parseBackupFile("backup.txt", JSON.stringify(WRAPPED_V4));
  assert.equal(notJsonExt.ok, false);

  const missingVersion = parseBackupFile("x.json", JSON.stringify({ ok: true, snapshot: { exportedAt: "2026-09-08T08:26:00.000Z" } }));
  assert.equal(missingVersion.ok, false);

  const incompatible = parseBackupFile("x.json", JSON.stringify({ version: 5, exportedAt: "2026-09-08T08:26:00.000Z" }));
  assert.equal(incompatible.ok, false);
  if (!incompatible.ok) assert.equal(incompatible.message, INVALID_BACKUP_FILE_MESSAGE);

  const badDate = parseBackupFile("x.json", JSON.stringify({ version: 4, exportedAt: "pas-une-date" }));
  assert.equal(badDate.ok, false);

  const noDate = parseBackupFile("x.json", JSON.stringify({ version: 1, items: [] }));
  assert.equal(noDate.ok, true);
  if (noDate.ok) {
    assert.equal(noDate.meta.exportedAt, null);
    assert.equal(noDate.meta.itemCount, 0);
  }

  assert.equal(countSnapshotElements({ tables: { teachers: [1, 2], classrooms: [3] } }), 3);
});

test("confirmation RESTAURER obligatoire", () => {
  assert.equal(RESTORE_CONFIRM_TOKEN, "RESTAURER");
  assert.equal(isRestoreConfirmToken("RESTAURER"), true);
  assert.equal(isRestoreConfirmToken("restaurer"), false);
  assert.equal(isRestoreConfirmToken("RESTAURER "), false);
  assert.equal(isRestoreConfirmToken(" RESTAURER"), false);
  assert.equal(isRestoreConfirmToken(""), false);
  assert.match(restoreReplaceWarning("08/09/2026 08:26 UTC"), /sauvegarde du 08\/09\/2026 08:26 UTC/);
  assert.match(RESTORE_LOSS_WARNING, /perdues/);
  assert.equal(RESTORE_SUCCESS_TITLE, "✓ Sauvegarde restaurée avec succès");
  assert.match(restoreSuccessDetail("08/09/2026 08:26 UTC"), /sauvegarde du 08\/09\/2026 08:26 UTC/);
});

test("backup automatique avant restore — POST seulement après succès", async () => {
  const now = new Date("2026-09-08T09:15:00.000Z");
  assert.equal(
    beforeRestoreDownloadFilename("2026-09-08T09:15:53.133Z"),
    "campus-agenda-before-restore-2026-09-08-0915.json",
  );
  assert.equal(
    beforeRestoreDownloadFilename("invalide", now),
    "campus-agenda-before-restore-2026-09-08-0915.json",
  );

  const snapshot = WRAPPED_V4.snapshot;
  const posts: unknown[] = [];
  const saved: string[] = [];

  const ok = await runSecureRestore({
    snapshot,
    now,
    fetchBackup: async () => ({
      httpOk: true,
      payload: { ok: true, snapshot: { exportedAt: "2026-09-08T09:15:53.133Z", version: 4 } },
    }),
    saveSafetyBackup: (filename, jsonText) => {
      saved.push(filename);
      const parsed = JSON.parse(jsonText) as { ok: boolean; snapshot: { version: number } };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.snapshot.version, 4);
    },
    postRestore: async (body) => {
      posts.push(body);
      return { httpOk: true, payload: { ok: true } };
    },
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.safetyFilename, "campus-agenda-before-restore-2026-09-08-0915.json");
  assert.deepEqual(saved, ["campus-agenda-before-restore-2026-09-08-0915.json"]);
  assert.deepEqual(posts, [restoreRequestBody(snapshot)]);
  assert.equal(Object.keys(posts[0] as object).join(), "snapshot");
});

test("restauration impossible si le backup préalable échoue", async () => {
  const posts: unknown[] = [];
  const failedFetch = await runSecureRestore({
    snapshot: WRAPPED_V4.snapshot,
    fetchBackup: async () => ({ httpOk: false, payload: { ok: false } }),
    saveSafetyBackup: () => {
      throw new Error("ne doit pas télécharger");
    },
    postRestore: async (body) => {
      posts.push(body);
      return { httpOk: true, payload: { ok: true } };
    },
  });
  assert.deepEqual(failedFetch, { ok: false, kind: "safety_backup" });

  const invalidPayload = await runSecureRestore({
    snapshot: WRAPPED_V4.snapshot,
    fetchBackup: async () => ({ httpOk: true, payload: { ok: true } }),
    saveSafetyBackup: () => {
      throw new Error("ne doit pas télécharger");
    },
    postRestore: async (body) => {
      posts.push(body);
      return { httpOk: true, payload: { ok: true } };
    },
  });
  assert.deepEqual(invalidPayload, { ok: false, kind: "safety_backup" });

  const downloadThrow = await runSecureRestore({
    snapshot: WRAPPED_V4.snapshot,
    fetchBackup: async () => ({
      httpOk: true,
      payload: { ok: true, snapshot: { version: 4, exportedAt: "2026-09-08T09:15:00.000Z" } },
    }),
    saveSafetyBackup: () => {
      throw new Error("disque");
    },
    postRestore: async (body) => {
      posts.push(body);
      return { httpOk: true, payload: { ok: true } };
    },
  });
  assert.deepEqual(downloadThrow, { ok: false, kind: "safety_backup" });
  assert.deepEqual(posts, []);
  assert.match(RESTORE_SAFETY_BACKUP_FAILED_MESSAGE, /sauvegarde de sécurité/);
  assert.match(RESTORE_SAFETY_BACKUP_FAILED_MESSAGE, /annulée/);
});

test("POST restore — refus backend et erreurs réseau sans faux succès", async () => {
  const refused = await runSecureRestore({
    snapshot: RAW_V3,
    fetchBackup: async () => ({
      httpOk: true,
      payload: { ok: true, snapshot: { version: 4, exportedAt: "2026-09-08T09:15:00.000Z" } },
    }),
    saveSafetyBackup: () => undefined,
    postRestore: async () => ({ httpOk: false, payload: { ok: false, reason: "sqlite boom" } }),
  });
  assert.deepEqual(refused, { ok: false, kind: "restore" });

  const notOkBody = await runSecureRestore({
    snapshot: RAW_V3,
    fetchBackup: async () => ({
      httpOk: true,
      payload: { ok: true, snapshot: { version: 4, exportedAt: "2026-09-08T09:15:00.000Z" } },
    }),
    saveSafetyBackup: () => undefined,
    postRestore: async () => ({ httpOk: true, payload: { ok: false } }),
  });
  assert.deepEqual(notOkBody, { ok: false, kind: "restore" });

  const network = await runSecureRestore({
    snapshot: RAW_V3,
    fetchBackup: async () => ({
      httpOk: true,
      payload: { ok: true, snapshot: { version: 4, exportedAt: "2026-09-08T09:15:00.000Z" } },
    }),
    saveSafetyBackup: () => undefined,
    postRestore: async () => {
      throw new Error("réseau");
    },
  });
  assert.deepEqual(network, { ok: false, kind: "restore" });
  assert.match(RESTORE_FAILED_MESSAGE, /données actuelles ont été conservées/);
  assert.doesNotMatch(RESTORE_FAILED_MESSAGE, /sqlite/i);
});

test("aucun snapshot persisté dans localStorage ou sessionStorage", async () => {
  const writes: string[] = [];
  const fakeStorage = {
    setItem(key: string, value: string) {
      writes.push(`${key}:${value}`);
    },
    getItem() {
      return null;
    },
  };
  const previousLocal = (globalThis as { localStorage?: unknown }).localStorage;
  const previousSession = (globalThis as { sessionStorage?: unknown }).sessionStorage;
  (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
  (globalThis as { sessionStorage?: unknown }).sessionStorage = fakeStorage;
  try {
    parseBackupFile("x.json", JSON.stringify(WRAPPED_V4));
    await runSecureRestore({
      snapshot: WRAPPED_V4.snapshot,
      fetchBackup: async () => ({
        httpOk: true,
        payload: { ok: true, snapshot: { version: 4, exportedAt: "2026-09-08T09:15:00.000Z" } },
      }),
      saveSafetyBackup: () => undefined,
      postRestore: async () => ({ httpOk: true, payload: { ok: true } }),
    });
    assert.deepEqual(writes, []);
  } finally {
    if (previousLocal === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else (globalThis as { localStorage?: unknown }).localStorage = previousLocal;
    if (previousSession === undefined) delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    else (globalThis as { sessionStorage?: unknown }).sessionStorage = previousSession;
  }
});
