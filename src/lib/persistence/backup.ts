import type { PrototypeAgendaItem } from "../../features/agenda/demo-items.ts";
import { isClassNotesPayload } from "../../features/class-notebook/notes-storage.ts";
import { isTeacherSetupPayload } from "../../features/teacher-setup/storage.ts";
import { AGENDA_ITEM_TYPES } from "../../types/agenda.ts";
import type { AgendaStore } from "./types.ts";
import type { TeacherNotesBackupEntry, TeacherNotesStore } from "./teacher-notes-types.ts";
import type { TeacherSetupBackupEntry, TeacherSetupStore } from "./teacher-setup-types.ts";

/** Format courant (agenda + configs enseignant + notes de carnet). */
export const BACKUP_FORMAT_VERSION = 2 as const;
/** Ancien format (agenda uniquement) — encore accepté à la restauration. */
export const LEGACY_BACKUP_FORMAT_VERSION = 1 as const;

export interface AgendaBackupSnapshot {
  version: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  itemCount: number;
  items: PrototypeAgendaItem[];
  teacherSetupCount: number;
  teacherSetups: TeacherSetupBackupEntry[];
  teacherNotesCount: number;
  teacherNotes: TeacherNotesBackupEntry[];
}

export type BackupRestoreResult =
  | {
      ok: true;
      itemCount: number;
      teacherSetupCount: number;
      teacherNotesCount: number;
      /** false si sauvegarde v1 : configs/notes non touchées. */
      restoredTeacherData: boolean;
    }
  | { ok: false; reason: string };

export interface BackupStoreDeps {
  agenda: AgendaStore;
  teacherSetups: TeacherSetupStore;
  teacherNotes: TeacherNotesStore;
}

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
    && Number.isFinite(item.schoolWeekNumber)
    && AGENDA_ITEM_TYPES.includes(item.type)
    && typeof item.title === "string"
    && typeof item.detail === "string"
    && (item.templateId === undefined || item.templateId === null || typeof item.templateId === "string")
    && (item.schoolYearId === undefined || item.schoolYearId === null || typeof item.schoolYearId === "string")
  );
}

function isValidTeacherSetupEntry(value: unknown): value is TeacherSetupBackupEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as TeacherSetupBackupEntry;
  return typeof entry.teacherId === "string" && entry.teacherId.length > 0 && isTeacherSetupPayload(entry.config);
}

function isValidTeacherNotesEntry(value: unknown): value is TeacherNotesBackupEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as TeacherNotesBackupEntry;
  return typeof entry.teacherId === "string" && entry.teacherId.length > 0 && isClassNotesPayload(entry.document);
}

export async function exportAgendaSnapshot(deps: BackupStoreDeps): Promise<AgendaBackupSnapshot> {
  const [items, teacherSetups, teacherNotes] = await Promise.all([
    deps.agenda.exportAllItems(),
    deps.teacherSetups.exportAllSetups(),
    deps.teacherNotes.exportAllNotes(),
  ]);

  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
    teacherSetupCount: teacherSetups.length,
    teacherSetups,
    teacherNotesCount: teacherNotes.length,
    teacherNotes,
  };
}

export async function restoreAgendaSnapshot(
  deps: BackupStoreDeps,
  payload: unknown,
): Promise<BackupRestoreResult> {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "Sauvegarde invalide." };
  }

  const snapshot = payload as {
    version?: number;
    items?: unknown;
    teacherSetups?: unknown;
    teacherNotes?: unknown;
  };

  if (
    snapshot.version !== BACKUP_FORMAT_VERSION
    && snapshot.version !== LEGACY_BACKUP_FORMAT_VERSION
  ) {
    return { ok: false, reason: "Version de sauvegarde non supportée." };
  }

  if (!Array.isArray(snapshot.items) || !snapshot.items.every(isValidAgendaItem)) {
    return { ok: false, reason: "Contenu de sauvegarde invalide." };
  }

  const isLegacy = snapshot.version === LEGACY_BACKUP_FORMAT_VERSION;

  if (!isLegacy) {
    if (!Array.isArray(snapshot.teacherSetups) || !snapshot.teacherSetups.every(isValidTeacherSetupEntry)) {
      return { ok: false, reason: "Configurations enseignant invalides dans la sauvegarde." };
    }
    if (!Array.isArray(snapshot.teacherNotes) || !snapshot.teacherNotes.every(isValidTeacherNotesEntry)) {
      return { ok: false, reason: "Notes de carnet invalides dans la sauvegarde." };
    }
  }

  await deps.agenda.replaceAllItems(snapshot.items.map((item) => ({ ...item })));

  if (isLegacy) {
    return {
      ok: true,
      itemCount: snapshot.items.length,
      teacherSetupCount: 0,
      teacherNotesCount: 0,
      restoredTeacherData: false,
    };
  }

  const teacherSetups = snapshot.teacherSetups as TeacherSetupBackupEntry[];
  const teacherNotes = snapshot.teacherNotes as TeacherNotesBackupEntry[];

  await deps.teacherSetups.replaceAllSetups(
    teacherSetups.map((entry) => ({
      teacherId: entry.teacherId,
      config: { ...entry.config, classes: entry.config.classes.map((c) => ({ ...c })) },
    })),
  );
  await deps.teacherNotes.replaceAllNotes(
    teacherNotes.map((entry) => ({
      teacherId: entry.teacherId,
      document: { ...entry.document, weeks: { ...entry.document.weeks } },
    })),
  );

  return {
    ok: true,
    itemCount: snapshot.items.length,
    teacherSetupCount: teacherSetups.length,
    teacherNotesCount: teacherNotes.length,
    restoredTeacherData: true,
  };
}
