"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchActiveSchoolPlan,
  saveActiveSchoolDay,
  saveActiveSchoolWeeks,
  type ActiveSchoolPlan,
  type SchoolCalendarWeek,
  type SchoolDayCell,
} from "../../lib/api-client.ts";

const WEEKDAY_HEADINGS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

interface ActiveYearPlanPanelProps {
  onCalendarUpdated: (weeks: SchoolCalendarWeek[]) => void;
  onNotice: (message: string) => void;
}

function formatDayNumber(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${Number(day)}.${Number(month)}`;
}

function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return new Intl.DateTimeFormat("fr-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function ActiveYearPlanPanel({ onCalendarUpdated, onNotice }: ActiveYearPlanPanelProps) {
  const [plan, setPlan] = useState<ActiveSchoolPlan | null>(null);
  const [draftWeeks, setDraftWeeks] = useState<SchoolCalendarWeek[]>([]);
  const [selectedDay, setSelectedDay] = useState<SchoolDayCell | null>(null);
  const [dayLabel, setDayLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = await fetchActiveSchoolPlan();
      setPlan(loaded);
      setDraftWeeks(loaded.weeks);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasWeekChanges = useMemo(() => {
    if (!plan) return false;
    return draftWeeks.some((week, index) => {
      const original = plan.weeks[index];
      return !original || original.kind !== week.kind || original.monday !== week.monday;
    });
  }, [draftWeeks, plan]);

  function patchWeek(number: number, patch: Partial<SchoolCalendarWeek>) {
    setDraftWeeks((current) =>
      current.map((week) => (week.number === number ? { ...week, ...patch } : week)),
    );
  }

  async function submitWeeks() {
    setWorking(true);
    setError("");
    try {
      const saved = await saveActiveSchoolWeeks(draftWeeks);
      setPlan(saved);
      setDraftWeeks(saved.weeks);
      onCalendarUpdated(saved.weeks);
      onNotice("Plan des semaines corrigé.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Enregistrement impossible.");
    } finally {
      setWorking(false);
    }
  }

  function selectDay(day: SchoolDayCell) {
    setSelectedDay(day);
    setDayLabel(day.label ?? "");
  }

  async function applyDay(state: "class" | "holiday" | null) {
    if (!selectedDay || !plan) return;
    setWorking(true);
    setError("");
    try {
      const result = await saveActiveSchoolDay({
        date: selectedDay.date,
        state,
        label: state === "holiday" ? dayLabel : null,
      });
      setPlan({ ...plan, rows: result.rows, classDayCount: result.classDayCount, holidays: result.holidays });
      setSelectedDay(null);
      setDayLabel("");
      onNotice(
        state === null
          ? "Jour rendu au calcul automatique."
          : state === "holiday"
            ? "Jour marqué sans cours."
            : "Jour marqué comme jour de classe.",
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Enregistrement impossible.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <p className="school-year-status">Chargement du plan…</p>;
  if (!plan) {
    return (
      <p className="school-year-error" role="alert">
        {error || "Aucune année scolaire active."}
      </p>
    );
  }

  return (
    <div className="active-plan">
      {error && (
        <p className="school-year-error" role="alert">
          {error}
        </p>
      )}

      <article className="school-year-card">
        <header>
          <span className="eyebrow">ANNÉE ACTIVE</span>
          <h3>{plan.year.label} — plan complet</h3>
        </header>
        <p className="school-year-meta">
          <strong>{plan.weeks.length}</strong> semaines · <strong>{plan.classDayCount}</strong> jours de
          classe · <strong>{plan.holidays.length}</strong> jours sans cours.
        </p>
        <p className="school-year-hint">
          Corrigez le type A/B ou la date d’un lundi mal reconnu dans le PDF, puis enregistrez. Les
          publications restent attachées au numéro de semaine : rien n’est déplacé ni perdu.
        </p>

        {plan.warnings.length > 0 && (
          <ul className="school-year-warnings">
            {plan.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        <div className="school-year-week-table-wrap">
          <table className="school-year-week-table">
            <thead>
              <tr>
                <th scope="col">Semaine</th>
                <th scope="col">Type</th>
                <th scope="col">Lundi de référence</th>
              </tr>
            </thead>
            <tbody>
              {draftWeeks.map((week) => (
                <tr key={week.number}>
                  <td>Semaine {String(week.number).padStart(2, "0")}</td>
                  <td>
                    <select
                      aria-label={`Type de la semaine ${week.number}`}
                      value={week.kind}
                      disabled={working}
                      onChange={(event) =>
                        patchWeek(week.number, { kind: event.target.value as "A" | "B" })
                      }
                    >
                      <option value="A">A</option>
                      <option value="B">B</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="date"
                      aria-label={`Lundi de la semaine ${week.number}`}
                      value={week.monday}
                      disabled={working}
                      onChange={(event) => patchWeek(week.number, { monday: event.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="school-year-actions">
          <button
            type="button"
            className="workspace-action"
            disabled={working || !hasWeekChanges}
            onClick={() => void submitWeeks()}
          >
            Enregistrer les corrections
          </button>
          <button
            type="button"
            className="workspace-action secondary"
            disabled={working || !hasWeekChanges}
            onClick={() => setDraftWeeks(plan.weeks)}
          >
            Annuler les modifications
          </button>
        </div>
      </article>

      <article className="school-year-card">
        <header>
          <span className="eyebrow">JOURS DE L’ANNÉE</span>
          <h3>Jours de classe et jours sans cours</h3>
        </header>
        <p className="school-year-hint">
          Les fêtes valaisannes sont proposées automatiquement (Lundi de Pentecôte, Fête-Dieu,
          Assomption…). Cliquez sur un jour pour le corriger.
        </p>

        <ul className="day-grid-legend">
          <li>
            <span className="day-swatch class" /> Jour de classe
          </li>
          <li>
            <span className="day-swatch holiday" /> Sans cours
          </li>
          <li>
            <span className="day-swatch manual" /> Corrigé à la main
          </li>
          <li>
            <span className="day-swatch break" /> Vacances
          </li>
        </ul>

        <div className="day-grid" role="table" aria-label="Jours de l’année scolaire">
          <div className="day-grid-head" role="row">
            <span role="columnheader">Semaine</span>
            {WEEKDAY_HEADINGS.map((heading) => (
              <span key={heading} role="columnheader">
                {heading}
              </span>
            ))}
          </div>

          {plan.rows.map((row) =>
            row.kind === "break" ? (
              <div className="day-grid-break" role="row" key={`break-${row.fromMonday}`}>
                <span role="cell">
                  Vacances · {row.weekCount} semaine{row.weekCount > 1 ? "s" : ""} après la semaine{" "}
                  {String(row.afterWeekNumber).padStart(2, "0")}
                </span>
              </div>
            ) : (
              <div className="day-grid-row" role="row" key={`week-${row.number}`}>
                <span className="day-grid-week" role="rowheader">
                  {String(row.number).padStart(2, "0")}
                  <em className={`week-kind-badge week-kind-${row.weekKind.toLowerCase()}`}>
                    {row.weekKind}
                  </em>
                </span>
                {row.days.map((day) => (
                  <button
                    type="button"
                    role="cell"
                    key={day.date}
                    className={[
                      "day-cell",
                      day.state,
                      day.isManual ? "manual" : "",
                      selectedDay?.date === day.date ? "selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={day.label ? `${formatLongDate(day.date)} — ${day.label}` : formatLongDate(day.date)}
                    aria-label={`${formatLongDate(day.date)}${day.label ? ` — ${day.label}` : ""}`}
                    onClick={() => selectDay(day)}
                  >
                    <span className="day-cell-date">{formatDayNumber(day.date)}</span>
                    {day.label && <span className="day-cell-label">{day.label}</span>}
                  </button>
                ))}
              </div>
            ),
          )}
        </div>

        {selectedDay && (
          <div className="day-editor" aria-label="Correction du jour">
            <p className="day-editor-title">{formatLongDate(selectedDay.date)}</p>
            <label className="config-field">
              <span>Motif (facultatif)</span>
              <input
                value={dayLabel}
                placeholder="Fête-Dieu, journée sportive…"
                disabled={working}
                onChange={(event) => setDayLabel(event.target.value)}
              />
            </label>
            <div className="school-year-actions">
              <button
                type="button"
                className="workspace-action"
                disabled={working}
                onClick={() => void applyDay("holiday")}
              >
                Sans cours
              </button>
              <button
                type="button"
                className="workspace-action secondary"
                disabled={working}
                onClick={() => void applyDay("class")}
              >
                Jour de classe
              </button>
              {selectedDay.isManual && (
                <button
                  type="button"
                  className="workspace-action secondary"
                  disabled={working}
                  onClick={() => void applyDay(null)}
                >
                  Rétablir l’automatique
                </button>
              )}
              <button
                type="button"
                className="workspace-action secondary"
                disabled={working}
                onClick={() => setSelectedDay(null)}
              >
                Fermer
              </button>
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
