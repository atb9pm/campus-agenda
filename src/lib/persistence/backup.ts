import type { PrototypeAgendaItem } from "../../features/agenda/demo-items.ts";
import { AGENDA_ITEM_TYPES } from "../../types/agenda.ts";
import type { MemoryAgendaStore } from "./memory-store.ts";

export const BACKUP_FORMAT_VERSION = 1 as const;

export interface AgendaBackupSnapshot {
  version: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  itemCount: number;
  items: PrototypeAgendaItem[];
}

export type BackupRestoreResult =
  | { ok: true; itemCount: number }
  | { ok: false; reason: string };

function isValidAgendaItem(value: unknown): value is PrototypeAgendaItem {
  if (!value || typeof value !== "object") return false;
  const item = value as PrototypeAgendaItem;
  return (
    Number.isFinite(item.id)
    && typeof item.classroomId === "string"
    && typeof item.subjectId === "string"
    && typeof item.authorTeacherId === "string"
    && Number.isFinite(item.day)
    && Number.isFinite(item.hour)
    && Number.isFinite(item.weekOffset)
    && AGENDA_ITEM_TYPES.includes(item.type)
    && typeof item.title === "string"
    && typeof item.detail === "string"
  );
}

export function exportAgendaSnapshot(store: MemoryAgendaStore): AgendaBackupSnapshot {
  const items = store.exportAllItems();
  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
  };
}

export function restoreAgendaSnapshot(store: MemoryAgendaStore, payload: unknown): BackupRestoreResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "Sauvegarde invalide." };
  }

  const snapshot = payload as Partial<AgendaBackupSnapshot>;
  if (snapshot.version !== BACKUP_FORMAT_VERSION) {
    return { ok: false, reason: "Version de sauvegarde non supportée." };
  }
  if (!Array.isArray(snapshot.items) || !snapshot.items.every(isValidAgendaItem)) {
    return { ok: false, reason: "Contenu de sauvegarde invalide." };
  }

  store.replaceAllItems(snapshot.items.map((item) => ({ ...item })));
  return { ok: true, itemCount: snapshot.items.length };
}
