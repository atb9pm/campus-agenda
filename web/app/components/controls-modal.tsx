"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items";
import type { SchoolWeek } from "@campus/features/calendar";
import { getCourseDayOptionsForSchoolWeek } from "@campus/features/calendar";
import {
  controlDayOptionsForCourseWeek,
  formatControlSessionDayLabel,
  weekdayLabelForCourseDayIndex,
} from "@campus/features/class-notebook";
import type { CourseSession } from "@campus/features/course-sessions";
import { formatPedagogicalWeekLabel } from "@campus/features/school-year/official-course-weeks.ts";

interface ControlsModalProps {
  open: boolean;
  classLabel: string;
  branchLabel: string;
  schoolWeeks: SchoolWeek[];
  /** Séances calculées du AnnualCourse ouvert ; `null` = horaire générique legacy. */
  courseSessions?: CourseSession[] | null;
  controls: PrototypeAgendaItem[];
  onClose: () => void;
  onSave: (input: { schoolWeekNumber: number; day: number; title: string; existingId?: number }) => Promise<void>;
  onDelete: (itemId: number) => Promise<void>;
}

function dayOptionsForWeek(week: SchoolWeek | undefined, sessions: CourseSession[] | null | undefined) {
  if (!week) return [];
  if (sessions) return controlDayOptionsForCourseWeek(sessions, week.number);
  return getCourseDayOptionsForSchoolWeek(week.number);
}

function formatControlDay(
  week: SchoolWeek | undefined,
  dayIndex: number,
  sessions: CourseSession[] | null | undefined,
): string {
  if (week && sessions) {
    const match = sessions.find(
      (session) => session.schoolWeekNumber === week.number && session.dayOfWeek - 1 === dayIndex,
    );
    if (match) return formatControlSessionDayLabel(match);
  }
  if (week) {
    const options = getCourseDayOptionsForSchoolWeek(week.number);
    const option = options.find((entry) => entry.dayIndex === dayIndex);
    if (option) return option.label;
  }
  const weekday = weekdayLabelForCourseDayIndex(dayIndex);
  return weekday ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : `Jour ${dayIndex}`;
}

export function ControlsModal({
  open,
  classLabel,
  branchLabel,
  schoolWeeks,
  courseSessions = null,
  controls,
  onClose,
  onSave,
  onDelete,
}: ControlsModalProps) {
  const defaultWeek = schoolWeeks[0]?.number ?? 1;
  const [schoolWeekNumber, setSchoolWeekNumber] = useState(defaultWeek);
  const [day, setDay] = useState(0);
  const [title, setTitle] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const selectedWeek = useMemo(
    () => schoolWeeks.find((week) => week.number === schoolWeekNumber) ?? schoolWeeks[0],
    [schoolWeekNumber, schoolWeeks],
  );

  const dayOptions = useMemo(
    () => dayOptionsForWeek(selectedWeek, courseSessions),
    [courseSessions, selectedWeek],
  );

  useEffect(() => {
    if (!open) return;
    const weekExists = schoolWeeks.some((week) => week.number === schoolWeekNumber);
    const nextWeek = weekExists ? schoolWeekNumber : (schoolWeeks[0]?.number ?? 1);
    if (nextWeek !== schoolWeekNumber) setSchoolWeekNumber(nextWeek);
    const week = schoolWeeks.find((entry) => entry.number === nextWeek) ?? schoolWeeks[0];
    const options = dayOptionsForWeek(week, courseSessions);
    if (!options.some((option) => option.dayIndex === day)) {
      setDay(options[0]?.dayIndex ?? 0);
    }
  }, [courseSessions, day, open, schoolWeekNumber, schoolWeeks]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Indiquez un intitulé de contrôle.");
      return;
    }
    if (!selectedWeek || dayOptions.length === 0) {
      setError("Aucune séance de ce cours n’est disponible pour un contrôle.");
      return;
    }

    setWorking(true);
    setError("");
    try {
      await onSave({ schoolWeekNumber, day, title: trimmed });
      setTitle("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Enregistrement impossible.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="technical-modal-backdrop" role="presentation">
      <section className="technical-modal controls-modal" role="dialog" aria-modal="true" aria-labelledby="controls-modal-title">
        <header className="controls-modal-header">
          <div>
            <span className="eyebrow">CONTRÔLES</span>
            <h2 id="controls-modal-title">{classLabel} · {branchLabel}</h2>
          </div>
          <button type="button" className="controls-modal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <form className="controls-modal-form" onSubmit={(event) => void submit(event)}>
          <div className="controls-modal-row">
            <label>
              Semaine
              <select
                value={schoolWeekNumber}
                onChange={(event) => {
                  const nextWeek = Number(event.target.value);
                  setSchoolWeekNumber(nextWeek);
                  const week = schoolWeeks.find((entry) => entry.number === nextWeek);
                  const options = dayOptionsForWeek(week, courseSessions);
                  setDay(options[0]?.dayIndex ?? 0);
                }}
                disabled={schoolWeeks.length === 0}
              >
                {schoolWeeks.map((week) => (
                  <option key={week.number} value={week.number}>
                    {formatPedagogicalWeekLabel(week).replace(/^Semaine /, "")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Jour de cours
              <select
                value={day}
                onChange={(event) => setDay(Number(event.target.value))}
                disabled={dayOptions.length === 0}
              >
                {dayOptions.map((option) => (
                  <option key={option.dayIndex} value={option.dayIndex}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Intitulé
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex. Injection, Distribution…"
            />
          </label>

          {error ? <p className="controls-modal-error">{error}</p> : null}

          <footer className="controls-modal-footer">
            <button type="submit" disabled={working || dayOptions.length === 0}>
              {working ? "Enregistrement…" : "Enregistrer"}
            </button>
          </footer>
        </form>

        <section className="controls-modal-list" aria-label="Contrôles planifiés">
          <h3>Contrôles planifiés</h3>
          {controls.length ? (
            <ul>
              {controls.map((item) => {
                const week = schoolWeeks.find((entry) => entry.number === item.schoolWeekNumber);
                return (
                  <li key={item.id}>
                    <span>
                      {week ? formatPedagogicalWeekLabel(week).replace(/^Semaine /, "") : `Sem ${item.schoolWeekNumber}`}
                      {" · "}
                      {formatControlDay(week, item.day, courseSessions)}
                    </span>
                    <strong>{item.title}</strong>
                    <button
                      type="button"
                      aria-label={`Supprimer ${item.title}`}
                      onClick={() => void onDelete(item.id)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="controls-modal-empty">Aucun contrôle planifié pour cette classe.</p>
          )}
        </section>
      </section>
    </div>
  );
}
