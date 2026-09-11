"use client";

import { useEffect, useId, useState } from "react";

import type { TeacherDeletePreview } from "@campus/features/admin-teacher-delete/index.ts";

export interface TeacherDeleteDialogProps {
  open: boolean;
  preview: TeacherDeletePreview | null;
  loading?: boolean;
  error?: string | null;
  pending?: boolean;
  onConfirm: (confirmationText: string) => void;
  onCancel: () => void;
}

export function TeacherDeleteDialog({
  open,
  preview,
  loading = false,
  error = null,
  pending = false,
  onConfirm,
  onCancel,
}: TeacherDeleteDialogProps) {
  if (!open) return null;
  return (
    <TeacherDeleteDialogBody
      key={preview?.target.id ?? "loading"}
      preview={preview}
      loading={loading}
      error={error}
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function TeacherDeleteDialogBody({
  preview,
  loading,
  error,
  pending,
  onConfirm,
  onCancel,
}: Omit<TeacherDeleteDialogProps, "open">) {
  const titleId = useId();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const blocked = Boolean(preview?.lastAdminBlocked);
  const matches = Boolean(preview && typed.trim() === preview.confirmationText);
  const identity = preview ? `${preview.target.displayName} (${preview.target.initials})` : "";

  return (
    <div className="technical-modal-backdrop" role="presentation">
      <section
        className="technical-modal admin-confirm-modal admin-delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <h2 id={titleId}>Supprimer définitivement ce professeur ?</h2>
        </header>
        {loading || !preview ? (
          <p>Analyse des dépendances…</p>
        ) : (
          <>
            <p className="admin-delete-lead">{identity}</p>
            <p className="admin-delete-irreversible">{preview.irreversible}</p>
            {blocked ? (
              <p className="admin-error">{preview.lastAdminReason}</p>
            ) : (
              <>
                <p>Cette action supprimera :</p>
                <ul className="admin-delete-consequences">
                  {preview.willRemove.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p>{preview.willKeep}</p>
                <p>Aperçu des dépendances (les publications sont conservées) :</p>
                <ul className="admin-delete-consequences">
                  {preview.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <label className="admin-delete-confirm">
                  Pour confirmer, saisissez : {preview.confirmationText}
                  <input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`Tapez ${preview.confirmationText} pour confirmer`}
                  />
                </label>
              </>
            )}
          </>
        )}
        {error ? <p className="admin-error">{error}</p> : null}
        <footer>
          <button type="button" onClick={onCancel} disabled={pending}>
            Annuler
          </button>
          <button
            type="button"
            className="is-danger"
            disabled={blocked || !matches || pending || loading || !preview}
            onClick={() => preview && onConfirm(preview.confirmationText)}
          >
            {pending ? "Suppression…" : "Supprimer définitivement"}
          </button>
        </footer>
      </section>
    </div>
  );
}
