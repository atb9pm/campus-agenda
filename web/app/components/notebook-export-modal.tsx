"use client";

import { FormEvent, useState } from "react";

import { DEFAULT_NOTEBOOK_EXPORT_OPTIONS } from "@campus/features/notebook-export/options.ts";
import {
  NOTEBOOK_EXPORT_EMPTY_REASON,
  NOTEBOOK_EXPORT_FAILED_REASON,
  type NotebookExportLayout,
  type NotebookExportPeriod,
} from "@campus/features/notebook-export/types.ts";
import { fetchTeacherNotebookExportApi } from "../../lib/api-client.ts";

interface NotebookExportModalProps {
  open: boolean;
  annualCourseId: string;
  classLabel: string;
  branchLabel: string;
  schoolYearLabel: string;
  onClose: () => void;
}

export function NotebookExportModal({
  open,
  annualCourseId,
  classLabel,
  branchLabel,
  schoolYearLabel,
  onClose,
}: NotebookExportModalProps) {
  const [includePublications, setIncludePublications] = useState(DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includePublications);
  const [includeControls, setIncludeControls] = useState(DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includeControls);
  const [includeTeacherNotes, setIncludeTeacherNotes] = useState(DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includeTeacherNotes);
  const [includeDrafts, setIncludeDrafts] = useState(DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includeDrafts);
  const [period, setPeriod] = useState<NotebookExportPeriod>(DEFAULT_NOTEBOOK_EXPORT_OPTIONS.period);
  const [layout, setLayout] = useState<NotebookExportLayout>(DEFAULT_NOTEBOOK_EXPORT_OPTIONS.layout);
  const [coverPage, setCoverPage] = useState(DEFAULT_NOTEBOOK_EXPORT_OPTIONS.coverPage);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const { blob, filename } = await fetchTeacherNotebookExportApi({
        annualCourseId,
        includePublications,
        includeControls,
        includeTeacherNotes,
        includeDrafts,
        period,
        layout,
        coverPage,
      });
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onClose();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : NOTEBOOK_EXPORT_FAILED_REASON;
      setError(message === NOTEBOOK_EXPORT_EMPTY_REASON ? message : NOTEBOOK_EXPORT_FAILED_REASON);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="technical-modal-backdrop" role="presentation">
      <section className="technical-modal notebook-export-modal" role="dialog" aria-modal="true" aria-labelledby="notebook-export-title">
        <header className="controls-modal-header">
          <div>
            <span className="eyebrow">CARNET</span>
            <h2 id="notebook-export-title">Exporter le carnet</h2>
            <p className="notebook-export-context">
              {classLabel} · {branchLabel}
              {schoolYearLabel ? <><br />{schoolYearLabel}</> : null}
            </p>
          </div>
          <button type="button" className="controls-modal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <form className="notebook-export-form" onSubmit={(event) => void submit(event)}>
          <fieldset className="notebook-export-fieldset">
            <legend>Contenu</legend>
            <label className="notebook-export-option">
              <input type="checkbox" checked={includePublications} onChange={(event) => setIncludePublications(event.target.checked)} />
              <span>Publications élèves</span>
            </label>
            <label className="notebook-export-option">
              <input type="checkbox" checked={includeControls} onChange={(event) => setIncludeControls(event.target.checked)} />
              <span>Contrôles</span>
            </label>
            <label className="notebook-export-option">
              <input type="checkbox" checked={includeTeacherNotes} onChange={(event) => setIncludeTeacherNotes(event.target.checked)} />
              <span>Notes professeur</span>
            </label>
            <label className="notebook-export-option">
              <input type="checkbox" checked={includeDrafts} onChange={(event) => setIncludeDrafts(event.target.checked)} />
              <span>Brouillons</span>
            </label>
          </fieldset>

          <fieldset className="notebook-export-fieldset">
            <legend>Période</legend>
            <label className="notebook-export-option">
              <input type="radio" name="export-period" checked={period === "year"} onChange={() => setPeriod("year")} />
              <span>Année scolaire complète</span>
            </label>
            <label className="notebook-export-option">
              <input type="radio" name="export-period" checked={period === "semester-1"} onChange={() => setPeriod("semester-1")} />
              <span>Semestre 1</span>
            </label>
            <label className="notebook-export-option">
              <input type="radio" name="export-period" checked={period === "semester-2"} onChange={() => setPeriod("semester-2")} />
              <span>Semestre 2</span>
            </label>
          </fieldset>

          <fieldset className="notebook-export-fieldset">
            <legend>Présentation</legend>
            <label className="notebook-export-option">
              <input type="radio" name="export-layout" checked={layout === "summary"} onChange={() => setLayout("summary")} />
              <span>Synthèse annuelle</span>
            </label>
            <label className="notebook-export-option">
              <input type="radio" name="export-layout" checked={layout === "detailed"} onChange={() => setLayout("detailed")} />
              <span>Carnet détaillé</span>
            </label>
          </fieldset>

          <label className="notebook-export-option notebook-export-cover">
            <input type="checkbox" checked={coverPage} onChange={(event) => setCoverPage(event.target.checked)} />
            <span>Ajouter une page de garde</span>
          </label>

          {error ? <p className="controls-modal-error">{error}</p> : null}

          <footer className="notebook-export-footer">
            <button type="button" className="workspace-action secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="workspace-action" disabled={working}>
              {working ? "Génération…" : "Générer le PDF"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
