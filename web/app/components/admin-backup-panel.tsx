"use client";

import { useState } from "react";

import {
  BACKUP_ERROR_MESSAGE,
  BACKUP_PENDING_MESSAGE,
  BACKUP_SUCCESS_MESSAGE,
  createBackupDownload,
  triggerJsonFileDownload,
} from "@campus/features/admin-backup/index.ts";

type BackupPhase = "idle" | "pending" | "success" | "error";

export function AdminBackupPanel() {
  const [phase, setPhase] = useState<BackupPhase>("idle");

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
    </section>
  );
}
