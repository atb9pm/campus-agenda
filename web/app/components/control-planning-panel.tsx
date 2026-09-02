"use client";

import { useEffect, useMemo, useState } from "react";

import {
  formatControlPlanningYearLabel,
  type ControlPlanningAlert,
  type ControlPlanningCard,
  type ControlPlanningMode,
  type ControlPlanningView,
} from "@campus/features/control-planning";
import { fetchTeacherControlPlanningApi } from "../../lib/api-client.ts";

function formatIsoDay(iso: string | null): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "short" }).format(
    new Date(year, month - 1, day),
  );
}

function summaryLabel(view: ControlPlanningView): string {
  const controls =
    view.summary.controlCount === 1
      ? "1 contrôle planifié"
      : `${view.summary.controlCount} contrôles planifiés`;
  const classes =
    view.summary.classCount === 1
      ? "1 classe concernée"
      : `${view.summary.classCount} classes concernées`;
  return `${controls} · ${classes}`;
}

function ControlCard({ card }: { card: ControlPlanningCard }) {
  return (
    <article
      className={card.isOwn ? "control-planning-card" : "control-planning-card is-peer"}
      data-control-card=""
      data-classroom-name={card.classroomName}
      data-own={card.isOwn ? "true" : "false"}
    >
      <span className="control-planning-class-badge">{card.classroomName}</span>
      <span className="control-planning-branch">{card.branchLabel}</span>
      <strong>{card.title}</strong>
      <span className="control-planning-teacher">{card.teacherName}</span>
    </article>
  );
}

export function ControlPlanningPanel() {
  const [schoolYearId, setSchoolYearId] = useState<string | null>(null);
  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [mode, setMode] = useState<ControlPlanningMode>("mine");
  const [week, setWeek] = useState<number | null>(null);
  const [view, setView] = useState<ControlPlanningView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const resolvedMode: ControlPlanningMode = classroomId ? mode : "mine";

    async function load() {
      setLoading(true);
      setError("");
      try {
        const next = await fetchTeacherControlPlanningApi(
          {
            schoolYearId,
            classroomId,
            mode: resolvedMode,
            week,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setView(next);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [schoolYearId, classroomId, mode, week]);

  const yearLabel = view ? formatControlPlanningYearLabel(view.schoolYearLabel) : null;
  const coordinationAlerts = useMemo(
    () => (view?.alerts ?? []).filter((alert) => alert.kind !== "teacher-load"),
    [view],
  );
  const loadAlert = useMemo(
    () => view?.alerts.find((alert: ControlPlanningAlert) => alert.kind === "teacher-load") ?? null,
    [view],
  );

  function selectYear(nextId: string) {
    setSchoolYearId(nextId);
    setClassroomId(null);
    setMode("mine");
    setWeek(null);
  }

  function selectClassroom(nextId: string | null) {
    setClassroomId(nextId);
    if (!nextId) setMode("mine");
  }

  function selectMode(next: ControlPlanningMode) {
    if (next === "class-all" && !classroomId) return;
    setMode(next);
  }

  const weekNumbers = view?.weeks.map((entry) => entry.number) ?? [];
  const currentWeekNumber = view?.week?.number ?? null;
  const weekIndex = currentWeekNumber == null ? -1 : weekNumbers.indexOf(currentWeekNumber);
  const previousWeek = weekIndex > 0 ? weekNumbers[weekIndex - 1]! : null;
  const nextWeek = weekIndex >= 0 && weekIndex < weekNumbers.length - 1 ? weekNumbers[weekIndex + 1]! : null;
  const classAllEnabled = Boolean(classroomId);

  return (
    <section className="teacher-workspace control-planning" aria-label="Contrôles" data-control-planning="">
      <div className="workspace-intro">
        <p className="eyebrow">ESPACE ENSEIGNANT</p>
        <h2>Contrôles{yearLabel ? ` — ${yearLabel}` : ""}</h2>
        <p>Planification des contrôles publiés dans l’agenda.</p>
        {view ? <p className="control-planning-summary">{summaryLabel(view)}</p> : null}
      </div>

      <div className="control-planning-filters" role="region" aria-label="Filtres des contrôles">
        <label className="control-planning-select control-planning-year">
          <span>Année scolaire</span>
          <select
            data-control-year=""
            value={schoolYearId ?? view?.schoolYearId ?? ""}
            onChange={(event) => selectYear(event.target.value)}
            disabled={!view?.years.length}
          >
            {(view?.years ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {formatControlPlanningYearLabel(entry.label)}
                {entry.status === "active" ? " (active)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="control-planning-select">
          <span>Classe</span>
          <select
            value={classroomId ?? ""}
            onChange={(event) => selectClassroom(event.target.value || null)}
          >
            <option value="">Toutes mes classes</option>
            {(view?.classes ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>

        <div className="control-planning-chips" role="group" aria-label="Classes attribuées">
          <button
            type="button"
            className={!classroomId ? "is-active" : ""}
            onClick={() => selectClassroom(null)}
          >
            Toutes mes classes
          </button>
          {(view?.classes ?? []).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={classroomId === entry.id ? "is-active" : ""}
              onClick={() => selectClassroom(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </div>

        <div className="control-planning-modes" role="group" aria-label="Mode d’affichage">
          <button
            type="button"
            className={mode === "mine" || !classroomId ? "is-active" : ""}
            aria-pressed={mode === "mine" || !classroomId}
            onClick={() => selectMode("mine")}
          >
            Mes contrôles
          </button>
          <button
            type="button"
            className={mode === "class-all" && classAllEnabled ? "is-active" : ""}
            aria-pressed={mode === "class-all" && classAllEnabled}
            disabled={!classAllEnabled}
            title={
              classAllEnabled
                ? "Afficher tous les contrôles de la classe, y compris ceux des collègues"
                : "Sélectionnez une classe pour voir tous ses contrôles"
            }
            onClick={() => selectMode("class-all")}
          >
            Tous les contrôles de la classe
          </button>
        </div>
      </div>

      {error ? (
        <p className="ma-semaine-empty control-planning-error">{error}</p>
      ) : loading && !view ? (
        <p className="ma-semaine-empty">Chargement du planning des contrôles…</p>
      ) : view?.week ? (
        <div className="control-planning-body">
          <div className="control-planning-main">
            <div className="control-planning-week-nav">
              <div>
                <span className="eyebrow">SEMAINE SCOLAIRE</span>
                <strong>
                  Semaine {String(view.week.number).padStart(2, "0")}-{view.week.kind}
                  {view.week.monday ? ` · lundi ${formatIsoDay(view.week.monday)}` : ""}
                </strong>
              </div>
              <div className="control-planning-week-actions">
                <button type="button" disabled={!previousWeek} onClick={() => previousWeek && setWeek(previousWeek)}>
                  Semaine précédente
                </button>
                <button type="button" onClick={() => setWeek(null)}>
                  Semaine en cours
                </button>
                <button type="button" disabled={!nextWeek} onClick={() => nextWeek && setWeek(nextWeek)}>
                  Semaine suivante
                </button>
              </div>
            </div>

            <div
              className="control-planning-week"
              data-control-week=""
              data-day-count={view.week.days.length}
              aria-label="Planning hebdomadaire des contrôles"
            >
              {view.week.days.map((day) => (
                <section
                  key={day.dayIndex}
                  className="control-planning-day"
                  data-day-index={day.dayIndex}
                  aria-label={day.weekdayLabel}
                >
                  <header>
                    <strong>{day.weekdayLabel}</strong>
                    <span>{formatIsoDay(day.date)}</span>
                  </header>
                  {day.controls.length ? (
                    <ul>
                      {day.controls.map((card) => (
                        <li key={card.agendaItemId}>
                          <ControlCard card={card} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="control-planning-day-empty">Aucun contrôle</p>
                  )}
                </section>
              ))}
            </div>
          </div>

          <aside className="control-planning-sidebar" aria-label="Coordination des contrôles">
            <section>
              <h3>Alertes de coordination</h3>
              {coordinationAlerts.length ? (
                <ul>
                  {coordinationAlerts.map((alert) => (
                    <li key={`${alert.kind}-${alert.message}`} className={`is-${alert.kind}`}>
                      {alert.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Aucune alerte pour cette semaine.</p>
              )}
            </section>
            <section>
              <h3>Charge enseignant</h3>
              <p>{loadAlert?.message ?? `${view.teacherLoadThisWeek} contrôles cette semaine`}</p>
            </section>
          </aside>
        </div>
      ) : (
        <p className="ma-semaine-empty">Aucune semaine scolaire n’est disponible pour cette année.</p>
      )}
    </section>
  );
}
