import type { PrototypeAgendaItem } from "../../features/agenda/demo-items.ts";
import { isClassNotesPayload } from "../../features/class-notebook/notes-storage.ts";
import { isTeacherSetupPayload } from "../../features/teacher-setup/storage.ts";
import { isLegacyDemoHash, isUsablePasswordHash } from "../auth/password.ts";
import { AGENDA_ITEM_TYPES } from "../../types/agenda.ts";
import type { AgendaStore } from "./types.ts";
import type { TeacherAccountBackupEntry, TeacherAccountStore } from "./teacher-account-types.ts";
import type { TeacherNotesBackupEntry, TeacherNotesStore } from "./teacher-notes-types.ts";
import type { TeacherSetupBackupEntry, TeacherSetupStore } from "./teacher-setup-types.ts";

/** Format courant : agenda + configs + notes + comptes (empreintes). */
export const BACKUP_FORMAT_VERSION = 3 as const;
/** Format v2 : agenda + configs + notes (sans comptes). */
export const BACKUP_FORMAT_VERSION_V2 = 2 as const;
/** Format v1 : agenda uniquement. */
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
  teacherAccountCount: number;
  teacherAccounts: TeacherAccountBackupEntry[];
}

export type BackupRestoreResult =
  | {
      ok: true;
      itemCount: number;
      teacherSetupCount: number;
      teacherNotesCount: number;
      teacherAccountCount: number;
      /** false si sauvegarde v1 : configs/notes non touchées. */
      restoredTeacherData: boolean;
      /** false si sauvegarde v1/v2 : comptes non touchés. */
      restoredTeacherAccounts: boolean;
    }
  | { ok: false; reason: string };

export interface BackupStoreDeps {
  agenda: AgendaStore;
  teacherSetups: TeacherSetupStore;
  teacherNotes: TeacherNotesStore;
  teacherAccounts: TeacherAccountStore;
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

function isValidBackupPasswordHash(hash: string): boolean {
  return isUsablePasswordHash(hash) || isLegacyDemoHash(hash);
}

function isValidTeacherAccountEntry(value: unknown): value is TeacherAccountBackupEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as TeacherAccountBackupEntry;
  return (
    typeof entry.id === "string"
    && entry.id.length > 0
    && typeof entry.displayName === "string"
    && typeof entry.initials === "string"
    && typeof entry.isAdmin === "boolean"
    && typeof entry.isActive === "boolean"
    && typeof entry.mustChangePassword === "boolean"
    && typeof entry.passwordHash === "string"
    && isValidBackupPasswordHash(entry.passwordHash)
    && (entry.createdAt === null || typeof entry.createdAt === "string")
    && (entry.passwordUpdatedAt === null || typeof entry.passwordUpdatedAt === "string")
  );
}

export async function exportAgendaSnapshot(deps: BackupStoreDeps): Promise<AgendaBackupSnapshot> {
  const [items, teacherSetups, teacherNotes, teacherAccounts] = await Promise.all([
    deps.agenda.exportAllItems(),
    deps.teacherSetups.exportAllSetups(),
    deps.teacherNotes.exportAllNotes(),
    deps.teacherAccounts.exportAllAccounts(),
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
    teacherAccountCount: teacherAccounts.length,
    teacherAccounts,
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
    teacherAccounts?: unknown;
  };

  if (
    snapshot.version !== BACKUP_FORMAT_VERSION
    && snapshot.version !== BACKUP_FORMAT_VERSION_V2
    && snapshot.version !== LEGACY_BACKUP_FORMAT_VERSION
  ) {
    return { ok: false, reason: "Version de sauvegarde non supportée." };
  }

  if (!Array.isArray(snapshot.items) || !snapshot.items.every(isValidAgendaItem)) {
    return { ok: false, reason: "Contenu de sauvegarde invalide." };
  }

  const isV1 = snapshot.version === LEGACY_BACKUP_FORMAT_VERSION;
  const isV3 = snapshot.version === BACKUP_FORMAT_VERSION;

  if (!isV1) {
    if (!Array.isArray(snapshot.teacherSetups) || !snapshot.teacherSetups.every(isValidTeacherSetupEntry)) {
      return { ok: false, reason: "Configurations enseignant invalides dans la sauvegarde." };
    }
    if (!Array.isArray(snapshot.teacherNotes) || !snapshot.teacherNotes.every(isValidTeacherNotesEntry)) {
      return { ok: false, reason: "Notes de carnet invalides dans la sauvegarde." };
    }
  }

  if (isV3) {
    if (
      !Array.isArray(snapshot.teacherAccounts)
      || !snapshot.teacherAccounts.every(isValidTeacherAccountEntry)
    ) {
      return { ok: false, reason: "Comptes enseignant invalides dans la sauvegarde." };
    }
  }

  // Comptes d'abord (v3) pour que les FK setups/notes restent valides.
  if (isV3) {
    const teacherAccounts = snapshot.teacherAccounts as TeacherAccountBackupEntry[];
    await deps.teacherAccounts.replaceAllAccounts(teacherAccounts.map((entry) => ({ ...entry })));
  }

  await deps.agenda.replaceAllItems(snapshot.items.map((item) => ({ ...item })));

  if (isV1) {
    return {
      ok: true,
      itemCount: snapshot.items.length,
      teacherSetupCount: 0,
      teacherNotesCount: 0,
      teacherAccountCount: 0,
      restoredTeacherData: false,
      restoredTeacherAccounts: false,
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

  const teacherAccountCount = isV3
    ? (snapshot.teacherAccounts as TeacherAccountBackupEntry[]).length
    : 0;

  return {
    ok: true,
    itemCount: snapshot.items.length,
    teacherSetupCount: teacherSetups.length,
    teacherNotesCount: teacherNotes.length,
    teacherAccountCount,
    restoredTeacherData: true,
    restoredTeacherAccounts: isV3,
  };
}
