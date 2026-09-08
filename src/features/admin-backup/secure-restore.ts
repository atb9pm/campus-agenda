import { beforeRestoreDownloadFilename } from "../../lib/persistence/backup.ts";
import { exportedAtFromSnapshot, isUsableBackupPayload } from "./download-backup.ts";

export const RESTORE_CONFIRM_TOKEN = "RESTAURER";
export const RESTORE_SAFETY_BACKUP_FAILED_MESSAGE =
  "La sauvegarde de sécurité n’a pas pu être créée. La restauration a été annulée.";
export const RESTORE_FAILED_MESSAGE =
  "La restauration n’a pas pu être effectuée. Les données actuelles ont été conservées.";
export const RESTORE_SUCCESS_TITLE = "✓ Sauvegarde restaurée avec succès";
export const RESTORE_LOSS_WARNING =
  "Toutes les modifications réalisées après cette sauvegarde seront perdues.";

export function restoreReplaceWarning(dateLabel: string): string {
  return `Cette opération remplacera les données actuelles par celles de la sauvegarde du ${dateLabel}.`;
}

export function restoreSuccessDetail(dateLabel: string): string {
  return `Campus Agenda a été replacé dans l’état de la sauvegarde du ${dateLabel}.`;
}

export function isRestoreConfirmToken(value: string): boolean {
  return value === RESTORE_CONFIRM_TOKEN;
}

export function restoreRequestBody(snapshot: Record<string, unknown>): { snapshot: Record<string, unknown> } {
  return { snapshot };
}

export async function createSafetyBackupDownload(options: {
  fetchBackup: () => Promise<{ httpOk: boolean; payload: unknown }>;
  saveFile: (filename: string, jsonText: string) => void;
  now?: Date;
}): Promise<{ ok: true; filename: string } | { ok: false }> {
  try {
    const result = await options.fetchBackup();
    if (!result.httpOk || !isUsableBackupPayload(result.payload)) {
      return { ok: false };
    }
    const filename = beforeRestoreDownloadFilename(
      exportedAtFromSnapshot(result.payload.snapshot),
      options.now,
    );
    options.saveFile(filename, JSON.stringify(result.payload));
    return { ok: true, filename };
  } catch {
    return { ok: false };
  }
}

export type SecureRestoreResult =
  | { ok: true; safetyFilename: string }
  | { ok: false; kind: "safety_backup" | "restore" };

export async function runSecureRestore(options: {
  snapshot: Record<string, unknown>;
  fetchBackup: () => Promise<{ httpOk: boolean; payload: unknown }>;
  saveSafetyBackup: (filename: string, jsonText: string) => void;
  postRestore: (body: { snapshot: Record<string, unknown> }) => Promise<{ httpOk: boolean; payload: unknown }>;
  now?: Date;
}): Promise<SecureRestoreResult> {
  const safety = await createSafetyBackupDownload({
    fetchBackup: options.fetchBackup,
    saveFile: options.saveSafetyBackup,
    now: options.now,
  });
  if (!safety.ok) {
    return { ok: false, kind: "safety_backup" };
  }

  try {
    const result = await options.postRestore(restoreRequestBody(options.snapshot));
    if (!result.httpOk) {
      return { ok: false, kind: "restore" };
    }
    const payload = result.payload;
    if (!payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true) {
      return { ok: false, kind: "restore" };
    }
    return { ok: true, safetyFilename: safety.filename };
  } catch {
    return { ok: false, kind: "restore" };
  }
}