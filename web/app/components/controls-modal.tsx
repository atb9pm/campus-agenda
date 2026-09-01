"use client";

import { FormEvent, useMemo, useState } from "react";

import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items";
import type { SchoolWeek } from "@campus/features/calendar";
import { getCourseDayOptionsForSchoolWeek } from "@campus/features/calendar";

interface ControlsModalProps {
  open: boolean;
  classLabel: string;
  branchLabel: string;
  schoolWeeks: SchoolWeek[];
  controls: PrototypeAgendaItem[];
  onClose: () => void;
  onSave: (input: { schoolWeekNumber: number; day: number; title: string; existingId?: number }) => Promise<void>;
  onDelete: (itemId: number) => Promise<void>;
}

function formatControlDay(week: SchoolWeek, dayIndex: number): string {
  const options = getCourseDayOptionsForSchoolWeek(week.number);
  return options.find((option) => option.dayIndex === dayIndex)?.label ?? (dayIndex === 3 ? "Jeudi" : "Lundi");
}

export function ControlsModal({
  open,
  classLabel,
  branchLabel,
  schoolWeeks,
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
    () => (selectedWeek ? getCourseDayOptionsForSchoolWeek(selectedWeek.number) : []),
    [selectedWeek],
  );

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Indiquez un intitulé de contrôle.");
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
                  if (week) {
                    const options = getCourseDayOptionsForSchoolWeek(week.number);
                    setDay(options[0]?.dayIndex ?? 0);
                  }
                }}
              >
                {schoolWeeks.map((week) => (
                  <option key={week.number} value={week.number}>
                    {String(week.number).padStart(2, "0")}-{week.kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Jour de cours
              <select value={day} onChange={(event) => setDay(Number(event.target.value))}>
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
            <button type="submit" disabled={working}>
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
                      {week ? `${String(week.number).padStart(2, "0")}-${week.kind}` : `Sem ${item.schoolWeekNumber}`}
                      {" · "}
                      {week ? formatControlDay(week, item.day) : item.day === 3 ? "Jeudi" : "Lundi"}
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
