"use client";

import { useCallback, useEffect, useId, useState } from "react";

import {
  formatAdminWorkingYearOption,
  readAdminWorkingYearId,
  resolveAdminWorkingYearId,
  writeAdminWorkingYearId,
} from "@campus/features/school-year/admin-working-year.ts";
import {
  formatOfficialDateFr,
  formatSchoolYearLabelFr,
  groupOfficialEventsByMonth,
} from "@campus/features/school-year/official-plan-logic.ts";
import { formatPedagogicalWeekLabel } from "@campus/features/school-year/official-course-weeks.ts";
import { SCHOOL_YEAR_UNCONFIGURED_MESSAGE } from "@campus/features/teacher-workspace";
import {
  fetchOfficialSchoolCalendar,
  fetchSchoolYears,
  importSchoolYearPdf,
  isOfficialSchoolPlanPreview,
  parseSchoolYearPdf,
  type OfficialCalendarEvent,
  type OfficialSchoolPlanPreview,
  type SchoolCalendarWeek,
  type SchoolYearPreview,
  type SchoolYearSummary,
  type SchoolYearWeekPreview,
} from "../../lib/api-client.ts";
import { ActiveYearPlanPanel } from "./active-year-plan-panel.tsx";

const STATUS_LABELS: Record<SchoolYearSummary["status"], string> = {
  active: "Active",
  draft: "Préparation",
  archived: "Archivée",
};

function formatDayMarker(marker: OfficialCalendarEvent["startMarker"]): string {
  if (marker === "matin" || marker === "soir") return ` ${marker}`;
  return "";
}

function formatEventRange(event: OfficialCalendarEvent): string {
  const start = `${formatOfficialDateFr(event.startsOn)}${formatDayMarker(event.startMarker)}`;
  if (event.startsOn === event.endsOn) {
    return start;
  }
  return `${start} → ${formatOfficialDateFr(event.endsOn)}${formatDayMarker(event.endMarker)}`;
}

function OfficialEventsByMonth({
  events,
  startYear,
}: {
  events: OfficialCalendarEvent[];
  startYear: number;
}) {
  const groups = groupOfficialEventsByMonth(events, startYear);
  if (groups.length === 0) {
    return <p className="school-year-hint">Aucun événement calendaire détecté.</p>;
  }
  return (
    <div className="school-year-month-groups">
      {groups.map((group) => (
        <section key={group.monthKey} className="school-year-month-group">
          <h4>{group.title}</h4>
          <ul>
            {group.events.map((event) => (
              <li key={`${event.label}-${event.startsOn}`}>
                <strong>{event.label}</strong>
                <span>{formatEventRange(event)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface SchoolYearAdminPanelProps {
  onCalendarUpdated: (weeks: SchoolCalendarWeek[]) => void;
  onNotice: (message: string) => void;
}

export function SchoolYearAdminPanel({ onCalendarUpdated, onNotice }: SchoolYearAdminPanelProps) {
  const officialFileId = useId();
  const [years, setYears] = useState<SchoolYearSummary[]>([]);
  const [workingYearId, setWorkingYearId] = useState<string | null>(null);
  const [workingEvents, setWorkingEvents] = useState<OfficialCalendarEvent[]>([]);
  const [workingWeeks, setWorkingWeeks] = useState<SchoolCalendarWeek[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SchoolYearPreview | null>(null);
  const [existingYear, setExistingYear] = useState<{
    id: string;
    label: string;
    status: SchoolYearSummary["status"];
  } | null>(null);
  const [receivable, setReceivable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const activeYear = years.find((year) => year.status === "active") ?? null;
  const workingYear = years.find((year) => year.id === workingYearId) ?? null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const yearList = await fetchSchoolYears();
      setYears(yearList);
      const stored = typeof window === "undefined" ? null : readAdminWorkingYearId(window.localStorage);
      const nextWorkingId = resolveAdminWorkingYearId(yearList, stored);
      setWorkingYearId(nextWorkingId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!workingYearId) {
        setWorkingEvents([]);
        setWorkingWeeks([]);
        return;
      }
      void fetchOfficialSchoolCalendar(workingYearId)
        .then((calendar) => {
          if (cancelled) return;
          setWorkingEvents(calendar.events);
          setWorkingWeeks(calendar.weeks);
        })
        .catch(() => {
          if (!cancelled) {
            setWorkingEvents([]);
            setWorkingWeeks([]);
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [workingYearId]);

  function handleWorkingYearChange(nextId: string) {
    setWorkingYearId(nextId);
    if (typeof window !== "undefined") {
      writeAdminWorkingYearId(window.localStorage, nextId);
    }
  }

  async function handleOfficialFileChange(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setReceivable(null);
    setExistingYear(null);
    setError("");
    if (!file) return;

    setWorking(true);
    try {
      const result = await parseSchoolYearPdf(file);
      setPreview(result.preview);
      setReceivable(result.receivable);
      setExistingYear(result.existingYear);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Analyse impossible.");
    } finally {
      setWorking(false);
    }
  }

  async function handleImport(replaceDraft = false, file = selectedFile) {
    if (!file) return;
    setWorking(true);
    setError("");
    try {
      const result = await importSchoolYearPdf(file, { replaceDraft });
      setPreview(result.preview);
      setReceivable(result.receivable);
      await refresh();
      if (typeof window !== "undefined") {
        writeAdminWorkingYearId(window.localStorage, result.draft.id);
      }
      setWorkingYearId(result.draft.id);
      onNotice(
        replaceDraft
          ? `Calendrier de ${formatSchoolYearLabelFr(result.draft.label)} mis à jour.`
          : `Année ${formatSchoolYearLabelFr(result.draft.label)} créée en brouillon.`,
      );
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import impossible.");
    } finally {
      setWorking(false);
    }
  }

  const officialPreview = preview && isOfficialSchoolPlanPreview(preview) ? preview : null;
  const weekPreview = preview && !isOfficialSchoolPlanPreview(preview) ? (preview as SchoolYearWeekPreview) : null;
  const officialStartYear = officialPreview ? Number(officialPreview.startsOn.slice(0, 4)) : NaN;
  const workingStartYear = workingYear ? Number(workingYear.startsOn.slice(0, 4)) : NaN;

  const canCreateDraft = Boolean(officialPreview && receivable && !existingYear);
  const canReplaceDraft = Boolean(officialPreview && receivable && existingYear?.status === "draft");

  return (
    <section className="school-year-admin" aria-labelledby="school-year-admin-title">
      <div className="workspace-intro">
        <p className="eyebrow">ADMINISTRATION</p>
        <h2 id="school-year-admin-title">Année scolaire</h2>
        <p>
          Le <strong>plan de scolarité</strong> de l’État du Valais est la source officielle des dates
          (début, fin, vacances, fêtes, interruptions). L’import crée une année en brouillon et génère
          les semaines de cours. La première semaine de cours est A, puis l’alternance suit le numéro
          pédagogique (impair = A, pair = B), sans activer ni archiver l’année en cours.
        </p>
      </div>

      {loading && <p className="school-year-status">Chargement…</p>}
      {error && (
        <p className="school-year-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && !activeYear && (
        <p className="form-hint">
          <strong>{SCHOOL_YEAR_UNCONFIGURED_MESSAGE}</strong> Importez le plan de scolarité officiel
          pour créer une première année en brouillon.
        </p>
      )}

      {!loading && (
        <article className="school-year-card school-year-status-card">
          <div className="school-year-status-grid">
            <div>
              <span className="eyebrow">ANNÉE ACTIVE</span>
              <p>
                <strong>{activeYear ? formatSchoolYearLabelFr(activeYear.label) : "Aucune"}</strong>
                {activeYear && <span className="school-year-badge active">Active</span>}
              </p>
              <p className="school-year-hint">
                Enseignants et élèves utilisent uniquement cette année. Changer l’année de travail
                administrateur ne modifie jamais ce statut.
              </p>
            </div>
            <div>
              <label className="eyebrow" htmlFor="admin-working-year">
                ANNÉE DE TRAVAIL
              </label>
              <select
                id="admin-working-year"
                className="school-year-working-select"
                value={workingYearId ?? ""}
                disabled={years.length === 0}
                onChange={(event) => handleWorkingYearChange(event.target.value)}
              >
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {formatAdminWorkingYearOption({
                      ...year,
                      label: formatSchoolYearLabelFr(year.label),
                    })}
                  </option>
                ))}
              </select>
              {workingYear && (
                <p>
                  <span className={`school-year-badge ${workingYear.status}`}>
                    {STATUS_LABELS[workingYear.status]}
                  </span>
                </p>
              )}
            </div>
          </div>
        </article>
      )}

      {workingYear && (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">CALENDRIER OFFICIEL</span>
            <h3>
              {formatSchoolYearLabelFr(workingYear.label)}
              {workingYear.status === "draft" ? " — Préparation" : ""}
            </h3>
          </header>
          <p className="school-year-meta">
            {formatOfficialDateFr(workingYear.startsOn)} → {formatOfficialDateFr(workingYear.endsOn)}
            {workingWeeks.length > 0 && (
              <>
                <br />
                {workingWeeks.length} semaine{workingWeeks.length > 1 ? "s" : ""} de cours
              </>
            )}
          </p>
          {workingEvents.length > 0 ? (
            <OfficialEventsByMonth events={workingEvents} startYear={workingStartYear} />
          ) : (
            <p className="school-year-hint">Aucun événement officiel enregistré pour cette année.</p>
          )}
          {workingWeeks.length > 0 && (
            <div className="school-year-week-table-wrap">
              <table className="school-year-week-table">
                <thead>
                  <tr>
                    <th scope="col">Semaine</th>
                    <th scope="col">Lundi de référence</th>
                  </tr>
                </thead>
                <tbody>
                  {workingWeeks.map((week) => (
                    <tr key={`${week.number}-${week.monday}`}>
                      <td>{formatPedagogicalWeekLabel(week)}</td>
                      <td>{formatOfficialDateFr(week.monday)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {!loading && workingYear && workingWeeks.length > 0 && (
        <ActiveYearPlanPanel
          key={workingYear.id}
          schoolYearId={workingYear.id}
          yearStatus={workingYear.status}
          onCalendarUpdated={(weeks) => {
            setWorkingWeeks(weeks);
            if (workingYear.status === "active") {
              onCalendarUpdated(weeks);
            }
          }}
          onNotice={onNotice}
        />
      )}

      <article className="school-year-card">
        <header>
          <span className="eyebrow">PLAN DE SCOLARITÉ</span>
          <h3>Importer le PDF officiel</h3>
        </header>
        <p className="school-year-hint">
          Document de référence : Plan de scolarité — État du Valais. L’import crée une année en
          brouillon et ses semaines de cours. L’alternance A/B suit le numéro pédagogique
          (impair = A, pair = B). Une mise à jour du brouillon conserve les corrections A/B déjà
          enregistrées sur les mêmes lundis.
        </p>

        <div className="school-year-upload">
          <input
            id={officialFileId}
            type="file"
            accept="application/pdf,.pdf"
            disabled={working}
            onChange={(event) => void handleOfficialFileChange(event.target.files?.[0] ?? null)}
          />
          <label htmlFor={officialFileId} className="school-year-file-label">
            {selectedFile ? selectedFile.name : "Importer le PDF officiel"}
          </label>
          {working && !preview && <span className="school-year-status">Analyse en cours…</span>}
        </div>

        {officialPreview && (
          <OfficialPlanPreviewCard
            preview={officialPreview}
            receivable={receivable}
            existingYear={existingYear}
            officialStartYear={officialStartYear}
            working={working}
            canCreateDraft={canCreateDraft}
            canReplaceDraft={canReplaceDraft}
            onCreate={() => void handleImport(false)}
            onReplace={() => void handleImport(true)}
          />
        )}

        {weekPreview && (
          <p className="school-year-hint">
            Ce fichier n’est pas un plan de scolarité officiel de l’État du Valais.
          </p>
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
                  <strong>{formatSchoolYearLabelFr(year.label)}</strong>
                  <span className={`school-year-badge ${year.status}`}>{STATUS_LABELS[year.status]}</span>
                </div>
                <button
                  type="button"
                  className="workspace-action secondary"
                  onClick={() => handleWorkingYearChange(year.id)}
                >
                  Travailler sur cette année
                </button>
              </li>
            ))}
          </ul>
        </article>
      )}
    </section>
  );
}

function OfficialPlanPreviewCard({
  preview,
  receivable,
  existingYear,
  officialStartYear,
  working,
  canCreateDraft,
  canReplaceDraft,
  onCreate,
  onReplace,
}: {
  preview: OfficialSchoolPlanPreview;
  receivable: boolean | null;
  existingYear: { id: string; label: string; status: SchoolYearSummary["status"] } | null;
  officialStartYear: number;
  working: boolean;
  canCreateDraft: boolean;
  canReplaceDraft: boolean;
  onCreate: () => void;
  onReplace: () => void;
}) {
  return (
    <div className="school-year-preview">
      <div className="school-year-preview-header">
        <strong>Plan de scolarité détecté</strong>
        <span className={receivable ? "school-year-badge ok" : "school-year-badge warn"}>
          {receivable ? "PDF recevable" : "PDF incomplet"}
        </span>
      </div>
      <p className="school-year-meta">
        Année : <strong>{formatSchoolYearLabelFr(preview.label)}</strong>
        <br />
        Début : {formatOfficialDateFr(preview.startsOn)}
        <br />
        Fin : {formatOfficialDateFr(preview.endsOn)}
        <br />
        Événements détectés : {preview.events.length}
        {preview.totalCourseWeeks != null && (
          <>
            <br />
            Semaines de cours (contrôle) : {preview.totalCourseWeeks} — alternance A/B selon le
            numéro pédagogique (impair = A, pair = B).
          </>
        )}
      </p>
      {preview.warnings.length > 0 && (
        <ul className="school-year-warnings">
          {preview.warnings.map((warning) => (
            <li key={`${warning.message}-${warning.sourceText}`}>{warning.message}</li>
          ))}
        </ul>
      )}
      {existingYear && (
        <p className="school-year-error" role="status">
          L’année scolaire {formatSchoolYearLabelFr(existingYear.label)} existe déjà.
        </p>
      )}
      <OfficialEventsByMonth events={preview.events} startYear={officialStartYear} />
      <div className="school-year-actions">
        {canCreateDraft && (
          <button type="button" className="workspace-action" disabled={working} onClick={onCreate}>
            Créer l’année en brouillon
          </button>
        )}
        {canReplaceDraft && (
          <button type="button" className="workspace-action" disabled={working} onClick={onReplace}>
            Mettre à jour le calendrier du brouillon
          </button>
        )}
      </div>
    </div>
  );
}
