"use client";

import { useEffect, useId, useState } from "react";

import type { CatalogDeletePreview } from "@campus/features/admin-catalog-delete/index.ts";

export interface DestructiveConfirmDialogProps {
  open: boolean;
  preview: CatalogDeletePreview | null;
  loading?: boolean;
  error?: string | null;
  pending?: boolean;
  onConfirm: (confirmationText: string) => void;
  onCancel: () => void;
}

export function DestructiveConfirmDialog({
  open,
  preview,
  loading = false,
  error = null,
  pending = false,
  onConfirm,
  onCancel,
}: DestructiveConfirmDialogProps) {
  if (!open) return null;
  return (
    <DestructiveConfirmDialogBody
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

function DestructiveConfirmDialogBody({
  preview,
  loading,
  error,
  pending,
  onConfirm,
  onCancel,
}: Omit<DestructiveConfirmDialogProps, "open">) {
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

  const matches = Boolean(preview && typed.trim() === preview.confirmationText);
  const targetLabel = preview ? `« ${preview.target.label || preview.target.code} »` : "";

  return (
    <div className="technical-modal-backdrop" role="presentation">
      <section
        className="technical-modal admin-confirm-modal admin-delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <h2 id={titleId}>Suppression définitive</h2>
        </header>
        {loading || !preview ? (
          <p>Analyse des dépendances…</p>
        ) : (
          <>
            <p className="admin-delete-lead">
              Supprimer définitivement {preview.kind === "class" ? "la classe" : preview.kind === "profession" ? "la profession" : preview.kind === "branch" ? "la branche" : "le contexte"}{" "}
              {targetLabel} ?
            </p>
            <p className="admin-delete-irreversible">{preview.irreversible}</p>
            <p>{preview.warning}</p>
            {preview.lines.length > 0 ? (
              <ul className="admin-delete-consequences">
                {preview.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p>Aucune donnée métier liée n’a été trouvée.</p>
            )}
            <label className="admin-delete-confirm">
              Tapez {preview.confirmationText} pour confirmer
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
        {error ? <p className="admin-error">{error}</p> : null}
        <footer>
          <button type="button" onClick={onCancel} disabled={pending}>
            Annuler
          </button>
          <button
            type="button"
            className="is-danger"
            disabled={!matches || pending || loading || !preview}
            onClick={() => preview && onConfirm(preview.confirmationText)}
          >
            {pending ? "Suppression…" : "Supprimer définitivement"}
          </button>
        </footer>
      </section>
    </div>
  );
}
