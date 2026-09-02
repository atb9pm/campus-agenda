"use client";

import { useEffect, useMemo, useState } from "react";

import {
  formatControlPlanningYearLabel,
  type ControlPlacementOption,
  type ControlPlanningAlert,
  type ControlPlanningCard,
  type ControlPlanningDay,
  type ControlPlanningMode,
  type ControlPlanningView,
} from "@campus/features/control-planning";
import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items.ts";
import { SCHOOL_WEEKDAY_LABELS } from "@campus/features/school-days";
import type { ControlCoordinationSummary } from "@campus/features/evaluations";
import {
  ControlCoordinationRequiredError,
  createTeacherControlApi,
  fetchTeacherControlPlanningApi,
} from "../../lib/api-client.ts";

function formatIsoDay(iso: string | null): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(
    new Date(year, month - 1, day),
  );
}

function formatWeekdayDate(weekdayLabel: string, iso: string | null): string {
  const day = formatIsoDay(iso);
  return day ? `${weekdayLabel} ${day}` : weekdayLabel;
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

function placementCaption(option: ControlPlacementOption): string {
  return option.sessionLabel ? `${option.branchLabel} · ${option.sessionLabel}` : option.branchLabel;
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

function CoordinationBlock({
  classroomName,
  dayLabel,
  classDayControls,
  teacherWeekControls,
  confirmationRequired,
}: {
  classroomName: string;
  dayLabel: string;
  classDayControls: ControlPlanningCard[];
  teacherWeekControls: ControlPlanningCard[];
  confirmationRequired: boolean;
}) {
  return (
    <section className="control-plan-coordination" data-control-coordination="">
      <h3>Coordination</h3>
      {confirmationRequired ? (
        <p className="control-plan-warning" data-control-confirm-warning="">
          ⚠ {classDayControls.length} contrôles sont déjà prévus dans {classroomName} {dayLabel}.
        </p>
      ) : null}
      <p>
        Contrôles déjà prévus dans {classroomName}
        {classDayControls.length === 0 ? " : aucun." : " :"}
      </p>
      {classDayControls.length ? (
        <ul>
          {classDayControls.map((card) => (
            <li key={card.agendaItemId}>
              <strong>{card.branchLabel}</strong> — {card.title}
              <span>{card.teacherName}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        Votre semaine :{" "}
        {teacherWeekControls.length === 1
          ? "1 contrôle déjà planifié"
          : `${teacherWeekControls.length} contrôles déjà planifiés`}
      </p>
      {teacherWeekControls.length ? (
        <ul data-teacher-week-load="">
          {teacherWeekControls.map((card) => (
            <li key={card.agendaItemId}>
              {card.classroomName} — {(SCHOOL_WEEKDAY_LABELS[card.dayIndex] ?? "").toLocaleLowerCase("fr-CH")} —{" "}
              {card.branchLabel}
            </li>
          ))}
        </ul>
      ) : null}
      {confirmationRequired ? (
        <p>Vous pouvez choisir une autre séance ou publier malgré tout.</p>
      ) : null}
    </section>
  );
}

function PlanModal({
  classroomName,
  day,
  option,
  classDayControls,
  teacherWeekControls,
  submitting,
  error,
  confirmationRequired,
  title,
  detail,
  onTitle,
  onDetail,
  onClose,
  onSubmit,
}: {
  classroomName: string;
  day: ControlPlanningDay;
  option: ControlPlacementOption;
  classDayControls: ControlPlanningCard[];
  teacherWeekControls: ControlPlanningCard[];
  submitting: boolean;
  error: string;
  confirmationRequired: boolean;
  title: string;
  detail: string;
  onTitle: (value: string) => void;
  onDetail: (value: string) => void;
  onClose: () => void;
  onSubmit: (confirm: boolean) => void;
}) {
  const dayLabel = formatWeekdayDate(day.weekdayLabel, option.date);
  return (
    <div className="technical-modal-backdrop" role="presentation">
      <section
        className="technical-modal control-plan-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="control-plan-title"
        data-control-modal=""
      >
        <header>
          <div>
            <span className="eyebrow">PLANIFIER UN CONTRÔLE</span>
            <h2 id="control-plan-title">Planifier un contrôle</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" disabled={submitting}>
            ×
          </button>
        </header>
        <p className="control-plan-fixed" data-control-fixed="">
          <strong>{classroomName}</strong>
          <span>{dayLabel}</span>
          <span>{placementCaption(option)}</span>
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(confirmationRequired);
          }}
        >
          <label>
            Titre *
            <input
              data-control-title=""
              value={title}
              onChange={(event) => onTitle(event.target.value)}
              required
              disabled={submitting}
            />
          </label>
          <label>
            Détail
            <textarea
              data-control-detail=""
              value={detail}
              onChange={(event) => onDetail(event.target.value)}
              rows={3}
              disabled={submitting}
            />
          </label>
          <CoordinationBlock
            classroomName={classroomName}
            dayLabel={`ce ${day.weekdayLabel.toLocaleLowerCase("fr-CH")}`}
            classDayControls={classDayControls}
            teacherWeekControls={teacherWeekControls}
            confirmationRequired={confirmationRequired}
          />
          {error ? <p className="control-plan-error">{error}</p> : null}
          <footer>
            <button type="button" onClick={onClose} disabled={submitting}>
              Annuler
            </button>
            <button type="submit" data-control-publish="" disabled={submitting || !title.trim()}>
              {submitting ? "Publication…" : confirmationRequired ? "Publier quand même" : "Publier"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function ControlPlanningPanel({
  onPublicationCreated,
}: {
  onPublicationCreated?: (item: PrototypeAgendaItem) => void;
}) {
  const [schoolYearId, setSchoolYearId] = useState<string | null>(null);
  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [mode, setMode] = useState<ControlPlanningMode>("mine");
  const [week, setWeek] = useState<number | null>(null);
  const [view, setView] = useState<ControlPlanningView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [pickerDay, setPickerDay] = useState<ControlPlanningDay | null>(null);
  const [modalDay, setModalDay] = useState<ControlPlanningDay | null>(null);
  const [modalOption, setModalOption] = useState<ControlPlacementOption | null>(null);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [serverCoordination, setServerCoordination] = useState<ControlCoordinationSummary | null>(null);

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
  }, [schoolYearId, classroomId, mode, week, reloadToken]);

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
    closeModal();
  }

  function selectClassroom(nextId: string | null) {
    setClassroomId(nextId);
    if (!nextId) setMode("mine");
    closeModal();
  }

  function selectMode(next: ControlPlanningMode) {
    if (next === "class-all" && !classroomId) return;
    setMode(next);
  }

  function closeModal() {
    setPickerDay(null);
    setModalDay(null);
    setModalOption(null);
    setTitle("");
    setDetail("");
    setPublishError("");
    setServerCoordination(null);
    setSubmitting(false);
  }

  function openPlan(day: ControlPlanningDay) {
    if (!day.canPlan || day.placementOptions.length === 0) return;
    if (day.placementOptions.length === 1) {
      setPickerDay(null);
      setModalDay(day);
      setModalOption(day.placementOptions[0]!);
      setTitle("");
      setDetail("");
      setPublishError("");
      setServerCoordination(null);
      return;
    }
    setModalDay(null);
    setModalOption(null);
    setPickerDay(day);
  }

  function chooseOption(day: ControlPlanningDay, option: ControlPlacementOption) {
    setPickerDay(null);
    setModalDay(day);
    setModalOption(option);
    setTitle("");
    setDetail("");
    setPublishError("");
    setServerCoordination(null);
  }

  async function submitPlan(confirm: boolean) {
    if (!modalOption || submitting) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setPublishError("Le titre du contrôle est obligatoire.");
      return;
    }
    setSubmitting(true);
    setPublishError("");
    try {
      const created = await createTeacherControlApi({
        annualCourseId: modalOption.annualCourseId,
        courseSessionKey: modalOption.courseSessionKey,
        title: trimmed,
        detail: detail.trim(),
        confirmCoordination: confirm,
      });
      onPublicationCreated?.(created.item);
      closeModal();
      setReloadToken((token) => token + 1);
    } catch (caught) {
      if (caught instanceof ControlCoordinationRequiredError) {
        setServerCoordination(caught.coordination);
        setPublishError(caught.message);
      } else {
        setPublishError(caught instanceof Error ? caught.message : "Publication impossible.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const weekNumbers = view?.weeks.map((entry) => entry.number) ?? [];
  const currentWeekNumber = view?.week?.number ?? null;
  const weekIndex = currentWeekNumber == null ? -1 : weekNumbers.indexOf(currentWeekNumber);
  const previousWeek = weekIndex > 0 ? weekNumbers[weekIndex - 1]! : null;
  const nextWeek = weekIndex >= 0 && weekIndex < weekNumbers.length - 1 ? weekNumbers[weekIndex + 1]! : null;
  const classAllEnabled = Boolean(classroomId);
  const classroomName =
    (view?.classroomId && view.classes.find((entry) => entry.id === view.classroomId)?.name) || "Classe";
  const modalConfirmation =
    Boolean(serverCoordination?.confirmationRequired) || Boolean(modalDay?.confirmationRequired);

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
        {view?.guidedPlanningReason ? (
          <p className="control-planning-hint">{view.guidedPlanningReason}</p>
        ) : null}
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
                  {day.canPlan ? (
                    <button
                      type="button"
                      className="control-plan-add"
                      data-control-plan=""
                      onClick={() => openPlan(day)}
                    >
                      + Planifier un contrôle
                    </button>
                  ) : day.noCourseHint ? (
                    <p className="control-planning-no-course">{day.noCourseHint}</p>
                  ) : null}
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

      {pickerDay ? (
        <div className="technical-modal-backdrop" role="presentation">
          <section className="technical-modal control-plan-modal" role="dialog" aria-modal="true">
            <header>
              <div>
                <span className="eyebrow">SÉANCE</span>
                <h2>Choisir le cours</h2>
              </div>
              <button type="button" onClick={closeModal} aria-label="Fermer">
                ×
              </button>
            </header>
            <ul className="control-plan-options" data-control-session-picker="">
              {pickerDay.placementOptions.map((option) => (
                <li key={option.courseSessionKey}>
                  <button type="button" onClick={() => chooseOption(pickerDay, option)}>
                    {placementCaption(option)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {modalDay && modalOption && view ? (
        <PlanModal
          classroomName={classroomName}
          day={modalDay}
          option={modalOption}
          classDayControls={
            serverCoordination
              ? serverCoordination.classDayControls.map((entry) => ({
                  agendaItemId: entry.agendaItemId,
                  classroomId: entry.classroomId,
                  classroomName: entry.classroomName,
                  subjectId: "",
                  branchLabel: entry.branchLabel,
                  title: entry.title,
                  teacherId: "",
                  teacherName: entry.teacherName,
                  isOwn: false,
                  schoolWeekNumber: entry.schoolWeekNumber,
                  dayIndex: entry.dayIndex,
                  date: entry.date,
                }))
              : modalDay.classDayControls
          }
          teacherWeekControls={
            serverCoordination
              ? serverCoordination.teacherWeekControls.map((entry) => ({
                  agendaItemId: entry.agendaItemId,
                  classroomId: entry.classroomId,
                  classroomName: entry.classroomName,
                  subjectId: "",
                  branchLabel: entry.branchLabel,
                  title: entry.title,
                  teacherId: "",
                  teacherName: entry.teacherName,
                  isOwn: false,
                  schoolWeekNumber: entry.schoolWeekNumber,
                  dayIndex: entry.dayIndex,
                  date: entry.date,
                }))
              : view.teacherWeekControls
          }
          submitting={submitting}
          error={publishError}
          confirmationRequired={modalConfirmation}
          title={title}
          detail={detail}
          onTitle={setTitle}
          onDetail={setDetail}
          onClose={closeModal}
          onSubmit={(confirm) => void submitPlan(confirm)}
        />
      ) : null}
    </section>
  );
}
