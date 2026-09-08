import {
  BACKUP_FORMAT_VERSION,
  BACKUP_FORMAT_VERSION_V2,
  LEGACY_BACKUP_FORMAT_VERSION,
} from "../../lib/persistence/backup.ts";
import { BACKUP_FORMAT_VERSION_V4 } from "../../lib/persistence/campus-backup-tables.ts";

export const INVALID_BACKUP_FILE_MESSAGE =
  "Ce fichier n’est pas une sauvegarde Campus Agenda valide.";

export const COMPATIBLE_BACKUP_VERSIONS: readonly number[] = [
  LEGACY_BACKUP_FORMAT_VERSION,
  BACKUP_FORMAT_VERSION_V2,
  BACKUP_FORMAT_VERSION,
  BACKUP_FORMAT_VERSION_V4,
];

export const CURRENT_BACKUP_FORMAT_VERSION = BACKUP_FORMAT_VERSION_V4;

export const LEGACY_BACKUP_FILE_NOTICE =
  "Ancienne sauvegarde : elle ne contient pas l’intégralité des données modernes de Campus Agenda (années, classes, attributions, horaires, etc.). Le backend peut quand même la restaurer dans son périmètre historique.";

export interface BackupFileMeta {
  fileName: string;
  version: number;
  versionLabel: string;
  isLegacy: boolean;
  exportedAt: string | null;
  exportedAtLabel: string;
  itemCount: number | null;
}

export type ParsedBackupFile =
  | { ok: true; snapshot: Record<string, unknown>; meta: BackupFileMeta }
  | { ok: false; message: string };

export function formatBackupExportedAt(exportedAt: string | null): string {
  if (!exportedAt) return "date inconnue";
  const date = new Date(exportedAt);
  if (!Number.isFinite(date.getTime())) return "date inconnue";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes} UTC`;
}

export function isCompatibleBackupVersion(version: unknown): version is number {
  return typeof version === "number" && COMPATIBLE_BACKUP_VERSIONS.includes(version);
}

export function isLegacyBackupVersion(version: number): boolean {
  return (
    version === LEGACY_BACKUP_FORMAT_VERSION
    || version === BACKUP_FORMAT_VERSION_V2
    || version === BACKUP_FORMAT_VERSION
  );
}

export function backupFormatVersionLabel(version: number): string {
  if (version === CURRENT_BACKUP_FORMAT_VERSION) return `${version} — format courant`;
  return `${version} — ancienne sauvegarde`;
}

export function extractBackupSnapshot(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;
  if (body.snapshot != null && typeof body.snapshot === "object" && !Array.isArray(body.snapshot)) {
    return body.snapshot as Record<string, unknown>;
  }
  if ("version" in body) return body;
  return null;
}

export function countSnapshotElements(snapshot: Record<string, unknown>): number | null {
  if (typeof snapshot.itemCount === "number" && Number.isFinite(snapshot.itemCount)) {
    return snapshot.itemCount;
  }
  if (Array.isArray(snapshot.items)) return snapshot.items.length;
  const tables = snapshot.tables;
  if (tables && typeof tables === "object" && !Array.isArray(tables)) {
    let total = 0;
    let found = false;
    for (const value of Object.values(tables as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        found = true;
        total += value.length;
      }
    }
    if (found) return total;
  }
  return null;
}

function isJsonFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".json");
}

export function parseBackupFile(fileName: string, text: string): ParsedBackupFile {
  if (!isJsonFileName(fileName)) {
    return { ok: false, message: INVALID_BACKUP_FILE_MESSAGE };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: INVALID_BACKUP_FILE_MESSAGE };
  }

  const snapshot = extractBackupSnapshot(parsed);
  if (!snapshot || !isCompatibleBackupVersion(snapshot.version)) {
    return { ok: false, message: INVALID_BACKUP_FILE_MESSAGE };
  }

  const exportedAtRaw = snapshot.exportedAt;
  let exportedAt: string | null = null;
  if (exportedAtRaw !== undefined && exportedAtRaw !== null && exportedAtRaw !== "") {
    if (typeof exportedAtRaw !== "string" || !Number.isFinite(Date.parse(exportedAtRaw))) {
      return { ok: false, message: INVALID_BACKUP_FILE_MESSAGE };
    }
    exportedAt = exportedAtRaw;
  }

  return {
    ok: true,
    snapshot,
    meta: {
      fileName,
      version: snapshot.version,
      versionLabel: backupFormatVersionLabel(snapshot.version),
      isLegacy: isLegacyBackupVersion(snapshot.version),
      exportedAt,
      exportedAtLabel: formatBackupExportedAt(exportedAt),
      itemCount: countSnapshotElements(snapshot),
    },
  };
}
