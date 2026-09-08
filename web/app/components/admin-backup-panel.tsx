"use client";

import { useState } from "react";

import {
  BACKUP_ERROR_MESSAGE,
  BACKUP_PENDING_MESSAGE,
  BACKUP_SUCCESS_MESSAGE,
  INVALID_BACKUP_FILE_MESSAGE,
  RESTORE_CONFIRM_TOKEN,
  RESTORE_FAILED_MESSAGE,
  RESTORE_LOSS_WARNING,
  RESTORE_SAFETY_BACKUP_FAILED_MESSAGE,
  RESTORE_SUCCESS_TITLE,
  createBackupDownload,
  isRestoreConfirmToken,
  parseBackupFile,
  restoreReplaceWarning,
  restoreSuccessDetail,
  runSecureRestore,
  triggerJsonFileDownload,
  type BackupFileMeta,
} from "@campus/features/admin-backup/index.ts";

type BackupPhase = "idle" | "pending" | "success" | "error";
type RestorePhase = "idle" | "pending" | "success" | "error";

export function AdminBackupPanel() {
  const [phase, setPhase] = useState<BackupPhase>("idle");
  const [restorePhase, setRestorePhase] = useState<RestorePhase>("idle");
  const [fileError, setFileError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [meta, setMeta] = useState<BackupFileMeta | null>(null);
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  const [successDateLabel, setSuccessDateLabel] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  function clearSelectedSnapshot() {
    setSnapshot(null);
    setMeta(null);
  }

  function keepSelectedSnapshot(next: Record<string, unknown>, nextMeta: BackupFileMeta) {
    setSnapshot(next);
    setMeta(nextMeta);
  }

  async function downloadBackup() {
    if (phase === "pending") return;
    setPhase("pending");
    const outcome = await createBackupDownload({
      fetchBackup: async () => {
        const response = await fetch("/api/admin/backup", { credentials: "include" });
        const payload: unknown = await response.json();
        return { httpOk: response.ok, payload };
      },
      saveFile: triggerJsonFileDownload,
    });
    setPhase(outcome.ok ? "success" : "error");
  }

  async function onBackupFileChosen(file: File | null) {
    setFileError(null);
    setRestoreError(null);
    setSuccessDateLabel(null);
    setRestorePhase("idle");
    clearSelectedSnapshot();
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseBackupFile(file.name, text);
      if (!parsed.ok) {
        setFileError(INVALID_BACKUP_FILE_MESSAGE);
        return;
      }
      keepSelectedSnapshot(parsed.snapshot, parsed.meta);
    } catch {
      setFileError(INVALID_BACKUP_FILE_MESSAGE);
    }
  }

  function openRestoreModal() {
    if (!snapshot || restorePhase === "pending") return;
    setConfirmText("");
    setRestoreError(null);
    setModalOpen(true);
  }

  function closeRestoreModal() {
    if (restorePhase === "pending") return;
    setModalOpen(false);
    setConfirmText("");
  }

  async function confirmRestore() {
    if (!snapshot || !isRestoreConfirmToken(confirmText) || restorePhase === "pending") return;
    setRestorePhase("pending");
    setRestoreError(null);
    const restoredDateLabel = meta?.exportedAtLabel ?? "date inconnue";
    const outcome = await runSecureRestore({
      snapshot,
      fetchBackup: async () => {
        const response = await fetch("/api/admin/backup", { credentials: "include" });
        const payload: unknown = await response.json();
        return { httpOk: response.ok, payload };
      },
      saveSafetyBackup: triggerJsonFileDownload,
      postRestore: async (body) => {
        const response = await fetch("/api/admin/restore", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload: unknown = await response.json();
        return { httpOk: response.ok, payload };
      },
    });
    if (!outcome.ok) {
      setRestorePhase("error");
      setRestoreError(
        outcome.kind === "safety_backup"
          ? RESTORE_SAFETY_BACKUP_FAILED_MESSAGE
          : RESTORE_FAILED_MESSAGE,
      );
      setModalOpen(false);
      setConfirmText("");
      return;
    }
    setSuccessDateLabel(restoredDateLabel);
    clearSelectedSnapshot();
    setConfirmText("");
    setModalOpen(false);
    setRestorePhase("success");
    window.setTimeout(() => {
      window.location.reload();
    }, 800);
  }

  const canRestore = snapshot != null && restorePhase !== "pending";
  const canConfirm = isRestoreConfirmToken(confirmText) && restorePhase !== "pending";
  const dateLabel = meta?.exportedAtLabel ?? successDateLabel ?? "date inconnue";

  return (
    <section className="admin-panel-block admin-backup-block" aria-label="Sauvegarde des données">
      <header className="config-section-header">
        <div>
          <h3>Sauvegarde des données</h3>
          <p>Télécharge une copie complète des données actuelles de Campus Agenda.</p>
        </div>
      </header>
      <button
        type="button"
        className="workspace-action"
        data-admin-backup=""
        disabled={phase === "pending"}
        aria-busy={phase === "pending"}
        onClick={() => {
          void downloadBackup();
        }}
      >
        {phase === "pending" ? BACKUP_PENDING_MESSAGE : "Télécharger une sauvegarde"}
      </button>
      {phase === "success" ? (
        <p className="admin-backup-status is-success" role="status">
          {BACKUP_SUCCESS_MESSAGE}
        </p>
      ) : null}
      {phase === "error" ? (
        <p className="admin-backup-status is-error" role="alert">
          {BACKUP_ERROR_MESSAGE}
        </p>
      ) : null}

      <div className="admin-restore-zone" data-admin-restore="">
        <h4>Restaurer une sauvegarde</h4>
        <p>Restaure les données de Campus Agenda à l’état contenu dans une sauvegarde précédente.</p>
        <label className="admin-restore-file">
          Choisir un fichier de sauvegarde
          <input
            type="file"
            accept=".json,application/json"
            data-admin-restore-file=""
            disabled={restorePhase === "pending"}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              void onBackupFileChosen(file);
            }}
          />
        </label>
        {fileError ? (
          <p className="admin-backup-status is-error" role="alert">
            {fileError}
          </p>
        ) : null}
        {meta ? (
          <div className="admin-restore-meta" data-admin-restore-meta="">
            <dl>
              <dt>Fichier</dt>
              <dd>{meta.fileName}</dd>
              <dt>Date de la sauvegarde</dt>
              <dd>{meta.exportedAtLabel}</dd>
              <dt>Version du format</dt>
              <dd>{meta.version}</dd>
              {meta.itemCount != null ? (
                <>
                  <dt>Éléments</dt>
                  <dd>{meta.itemCount}</dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}
        <button
          type="button"
          className="workspace-action is-danger"
          data-admin-restore-open=""
          disabled={!canRestore}
          onClick={openRestoreModal}
        >
          Restaurer cette sauvegarde
        </button>
        {restorePhase === "success" ? (
          <div className="admin-restore-success" role="status">
            <p className="admin-backup-status is-success">{RESTORE_SUCCESS_TITLE}</p>
            <p>{restoreSuccessDetail(dateLabel)}</p>
          </div>
        ) : null}
        {restoreError ? (
          <p className="admin-backup-status is-error" role="alert">
            {restoreError}
          </p>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="technical-modal-backdrop" role="presentation">
          <section
            className="technical-modal admin-restore-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-restore-title"
            data-admin-restore-modal=""
          >
            <header>
              <div>
                <h2 id="admin-restore-title">Restaurer Campus Agenda ?</h2>
              </div>
              <button type="button" onClick={closeRestoreModal} aria-label="Fermer" disabled={restorePhase === "pending"}>
                ×
              </button>
            </header>
            <p>{restoreReplaceWarning(dateLabel)}</p>
            <p>{RESTORE_LOSS_WARNING}</p>
            <label>
              Saisir {RESTORE_CONFIRM_TOKEN} pour confirmer
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={confirmText}
                data-admin-restore-confirm=""
                disabled={restorePhase === "pending"}
                onChange={(event) => setConfirmText(event.target.value)}
              />
            </label>
            <footer>
              <button type="button" onClick={closeRestoreModal} disabled={restorePhase === "pending"}>
                Annuler
              </button>
              <button
                type="button"
                className="is-danger"
                data-admin-restore-now=""
                disabled={!canConfirm}
                onClick={() => {
                  void confirmRestore();
                }}
              >
                {restorePhase === "pending" ? "Restauration…" : "Restaurer maintenant"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
