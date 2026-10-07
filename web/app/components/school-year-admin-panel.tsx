"use client";

import { useCallback, useEffect, useId, useState } from "react";

import {
  activateSchoolYear,
  fetchSchoolCalendar,
  fetchSchoolYears,
  importSchoolYearPdf,
  parseSchoolYearPdf,
  type SchoolCalendarWeek,
  type SchoolYearPreview,
  type SchoolYearSummary,
} from "../../lib/api-client.ts";

const STATUS_LABELS: Record<SchoolYearSummary["status"], string> = {
  active: "Active",
  draft: "Brouillon",
  archived: "Archivée",
};

function formatMondayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "short" }).format(date);
  const datePart = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long", year: "numeric" }).format(date);
  return `${weekday}. ${datePart.replace(".", "")}`;
}

function formatWeekLabel(week: SchoolCalendarWeek): string {
  return `Semaine ${String(week.number).padStart(2, "0")}-${week.kind}`;
}

interface SchoolYearAdminPanelProps {
  onCalendarUpdated: (weeks: SchoolCalendarWeek[]) => void;
  onNotice: (message: string) => void;
}

export function SchoolYearAdminPanel({ onCalendarUpdated, onNotice }: SchoolYearAdminPanelProps) {
  const fileInputId = useId();
  const [years, setYears] = useState<SchoolYearSummary[]>([]);
  const [activeCalendar, setActiveCalendar] = useState<{ label: string; weeks: SchoolCalendarWeek[] } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SchoolYearPreview | null>(null);
  const [receivable, setReceivable] = useState<boolean | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [yearList, calendar] = await Promise.all([fetchSchoolYears(), fetchSchoolCalendar()]);
      setYears(yearList);
      setActiveCalendar({ label: calendar.label, weeks: calendar.weeks });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleFileChange(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setReceivable(null);
    setDraftId(null);
    setError("");
    if (!file) return;

    setWorking(true);
    try {
      const result = await parseSchoolYearPdf(file);
      setPreview(result.preview);
      setReceivable(result.receivable);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Analyse impossible.");
    } finally {
      setWorking(false);
    }
  }

  async function handleImport() {
    if (!selectedFile) return;
    setWorking(true);
    setError("");
    try {
      const result = await importSchoolYearPdf(selectedFile);
      setPreview(result.preview);
      setReceivable(result.receivable);
      setDraftId(result.draft.id);
      await refresh();
      onNotice(`Année ${result.draft.label} importée en brouillon.`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import impossible.");
    } finally {
      setWorking(false);
    }
  }

  async function handleActivate(targetId: string) {
    setWorking(true);
    setError("");
    try {
      const calendar = await activateSchoolYear(targetId);
      setActiveCalendar({ label: calendar.label, weeks: calendar.weeks });
      onCalendarUpdated(calendar.weeks);
      setDraftId(null);
      setPreview(null);
      setSelectedFile(null);
      await refresh();
      onNotice(`Année scolaire ${calendar.label} activée.`);
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Activation impossible.");
    } finally {
      setWorking(false);
    }
  }

  const pendingDraft = draftId ?? years.find((year) => year.status === "draft" && preview?.label === year.label)?.id ?? null;

  return (
    <section className="school-year-admin" aria-labelledby="school-year-admin-title">
      <div className="workspace-intro">
        <p className="eyebrow">ADMINISTRATION</p>
        <h2 id="school-year-admin-title">Année scolaire</h2>
        <p>
          Déposez le PDF officiel du secrétariat (plan des semaines A/B) pour préparer la nouvelle année,
          puis activez-la lorsque tout est correct.
        </p>
      </div>

      {loading && <p className="school-year-status">Chargement…</p>}
      {error && <p className="school-year-error" role="alert">{error}</p>}

      {!loading && activeCalendar && (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">ANNÉE ACTIVE</span>
            <h3>{activeCalendar.label}</h3>
          </header>
          <p className="school-year-meta">
            <strong>{activeCalendar.weeks.length}</strong> semaines A/B configurées en base.
          </p>
          {activeCalendar.weeks.length > 0 && (
            <ul className="school-year-week-snapshot">
              {[activeCalendar.weeks[0], activeCalendar.weeks[1], activeCalendar.weeks[37]]
                .filter(Boolean)
                .map((week) => (
                  <li key={week.number}>
                    {formatWeekLabel(week)} · {formatMondayLabel(week.monday)}
                  </li>
                ))}
            </ul>
          )}
        </article>
      )}

      <article className="school-year-card">
        <header>
          <span className="eyebrow">IMPORT PDF</span>
          <h3>Nouvelle année scolaire</h3>
        </header>
        <p className="school-year-hint">
          Format attendu : calendrier Août–Juin, titre « Année scolaire YYYY-YYYY », semaines 01 à 38.
        </p>

        <div className="school-year-upload">
          <input
            id={fileInputId}
            type="file"
            accept="application/pdf,.pdf"
            disabled={working}
            onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
          />
          <label htmlFor={fileInputId} className="school-year-file-label">
            {selectedFile ? selectedFile.name : "Choisir le PDF des semaines A/B"}
          </label>
          {working && !preview && <span className="school-year-status">Analyse en cours…</span>}
        </div>

        {preview && (
          <div className="school-year-preview">
            <div className="school-year-preview-header">
              <strong>{preview.label}</strong>
              <span className={receivable ? "school-year-badge ok" : "school-year-badge warn"}>
                {receivable ? "PDF recevable" : "PDF incomplet"}
              </span>
            </div>
            <p className="school-year-meta">
              {preview.weekCount} semaine{preview.weekCount > 1 ? "s" : ""} détectée{preview.weekCount > 1 ? "s" : ""}.
            </p>
            {preview.warnings.length > 0 && (
              <ul className="school-year-warnings">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className="school-year-week-table-wrap">
              <table className="school-year-week-table">
                <thead>
                  <tr>
                    <th scope="col">Semaine</th>
                    <th scope="col">Lundi de référence</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.weeks.map((week) => (
                    <tr key={week.number}>
                      <td>{formatWeekLabel(week)}</td>
                      <td>{formatMondayLabel(week.monday)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="school-year-actions">
              {!pendingDraft && (
                <button type="button" className="workspace-action" disabled={working || !receivable} onClick={() => void handleImport()}>
                  Enregistrer en brouillon
                </button>
              )}
              {pendingDraft && (
                <button type="button" className="workspace-action" disabled={working || !receivable} onClick={() => void handleActivate(pendingDraft)}>
                  Activer cette année
                </button>
              )}
            </div>
          </div>
        )}
      </article>

      {years.length > 0 && (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">HISTORIQUE</span>
            <h3>Années enregistrées</h3>
          </header>
          <ul className="school-year-history">
            {years.map((year) => (
              <li key={year.id}>
                <div>
                  <strong>{year.label}</strong>
                  <span className={`school-year-badge ${year.status}`}>{STATUS_LABELS[year.status]}</span>
                </div>
                {year.status === "draft" && (
                  <button type="button" className="workspace-action secondary" disabled={working} onClick={() => void handleActivate(year.id)}>
                    Activer
                  </button>
                )}
              </li>
            ))}
          </ul>
        </article>
      )}
    </section>
  );
}
