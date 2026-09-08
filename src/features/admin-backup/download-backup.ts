import { backupDownloadFilename } from "../../lib/persistence/backup.ts";

export const BACKUP_PENDING_MESSAGE = "Création de la sauvegarde…";
export const BACKUP_SUCCESS_MESSAGE = "✓ Sauvegarde téléchargée avec succès";
export const BACKUP_ERROR_MESSAGE =
  "La sauvegarde n’a pas pu être créée. Aucune donnée n’a été modifiée.";

export function isUsableBackupPayload(
  payload: unknown,
): payload is { ok: true; snapshot: Record<string, unknown> } {
  if (!payload || typeof payload !== "object") return false;
  const body = payload as { ok?: unknown; snapshot?: unknown };
  return body.ok === true && body.snapshot != null && typeof body.snapshot === "object";
}

export function exportedAtFromSnapshot(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== "object") return "";
  const value = (snapshot as { exportedAt?: unknown }).exportedAt;
  return typeof value === "string" ? value : "";
}

export async function createBackupDownload(options: {
  fetchBackup: () => Promise<{ httpOk: boolean; payload: unknown }>;
  saveFile: (filename: string, jsonText: string) => void;
  now?: Date;
}): Promise<{ ok: true; filename: string } | { ok: false }> {
  try {
    const result = await options.fetchBackup();
    if (!result.httpOk || !isUsableBackupPayload(result.payload)) {
      return { ok: false };
    }
    const filename = backupDownloadFilename(
      exportedAtFromSnapshot(result.payload.snapshot),
      options.now,
    );
    options.saveFile(filename, JSON.stringify(result.payload));
    return { ok: true, filename };
  } catch {
    return { ok: false };
  }
}

export function triggerJsonFileDownload(filename: string, jsonText: string): void {
  const blob = new Blob([jsonText], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
