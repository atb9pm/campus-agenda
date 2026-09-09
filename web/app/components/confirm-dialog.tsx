"use client";

import { useEffect, useId, useRef } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation centrée dans la page — pas la fenêtre native du navigateur. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "OK",
  cancelLabel = "Annuler",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="technical-modal-backdrop" role="presentation">
      <section
        className="technical-modal admin-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
        </header>
        <p>{body}</p>
        <footer>
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? "is-danger" : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
