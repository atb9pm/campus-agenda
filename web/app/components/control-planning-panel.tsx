"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  formatControlPlanningYearLabel,
  toggleControlPlanningClassroomSelection,
  type ControlPlacementOption,
  type ControlPlanningAlert,
  type ControlPlanningCard,
  type ControlPlanningDay,
  type ControlPlanningLayout,
  type ControlPlanningMode,
  type ControlPlanningPeriodId,
  type ControlPlanningSemesterDay,
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

function formatCompactDay(iso: string | null): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "short" }).format(
    new Date(year, month - 1, day),
  );
}

function summaryLabel(view: ControlPlanningView): string {
  const source = view.layout === "semester" && view.semesterSummary ? view.semesterSummary : view.summary;
  const controls =
    source.controlCount === 1 ? "1 contrôle planifié" : `${source.controlCount} contrôles planifiés`;
  const classes =
    view.classroomIds.length === 1
      ? "1 classe sélectionnée"
      : `${view.classroomIds.length} classes sélectionnées`;
  if (view.layout === "semester" && view.semesterSummary) {
    const weeks =
      view.semesterSummary.weekCount === 1
        ? "1 semaine concernée"
        : `${view.semesterSummary.weekCount} semaines concernées`;
    const busy =
      view.semesterSummary.busyDayCount === 1
        ? "1 journée avec ≥ 2 contrôles"
        : `${view.semesterSummary.busyDayCount} journées avec ≥ 2 contrôles`;
    return `${view.semester?.label ?? "Semestre"} · ${controls} · ${classes} · ${weeks} · ${busy}`;
  }
  return `${controls} · ${classes}`;
}

function placementCaption(option: ControlPlacementOption): string {
  const branch = option.sessionLabel ? `${option.branchLabel} · ${option.sessionLabel}` : option.branchLabel;
  return option.classroomName ? `${option.classroomName} · ${branch}` : branch;
}

function placementHint(option: ControlPlacementOption): string {
  return option.classroomName
    ? `+ ${option.classroomName} · ${option.branchLabel}`
    : `+ ${option.branchLabel}`;
}

function classToneIndex(classroomId: string, classroomIds: readonly string[]): number {
  const index = classroomIds.indexOf(classroomId);
  return index < 0 ? 0 : index % 6;
}

function toPlanningDay(day: ControlPlanningSemesterDay): ControlPlanningDay {
  return {
    dayIndex: day.dayIndex,
    weekdayLabel: day.weekdayLabel,
    date: day.date,
    controls: day.controls,
    placementOptions: day.placementOptions,
    canPlan: day.canPlan,
    noCourseHint: day.hasCourse ? null : "Aucun cours",
    classDayControls: day.classDayControls,
    confirmationRequired: day.confirmationRequired,
  };
}

function coordinationCardsFromSummary(
  entries: ControlCoordinationSummary["classDayControls"],
): ControlPlanningCard[] {
  return entries.map((entry) => ({
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
    annualCourseId: null,
    courseSessionKey: null,
    courseSessionDate: entry.date,
  }));
}

function ControlCard({
  card,
  compact = false,
  showTeacher = true,
  toneIndex = 0,
}: {
  card: ControlPlanningCard;
  compact?: boolean;
  showTeacher?: boolean;
  toneIndex?: number;
}) {
  const title = [card.classroomName, card.branchLabel, card.title, card.teacherName].filter(Boolean).join(" · ");
  return (
    <article
      className={
        compact
          ? card.isOwn
            ? "control-planning-card is-compact"
            : "control-planning-card is-compact is-peer"
          : card.isOwn
            ? "control-planning-card"
            : "control-planning-card is-peer"
      }
      data-control-card=""
      data-classroom-name={card.classroomName}
      data-own={card.isOwn ? "true" : "false"}
      data-class-tone={toneIndex}
      data-agenda-item-id={card.agendaItemId}
      data-annual-course-id={card.annualCourseId ?? ""}
      data-course-session-key={card.courseSessionKey ?? ""}
      data-course-session-date={card.courseSessionDate ?? card.date ?? ""}
      title={title}
    >
      <span className="control-planning-class-badge">{card.classroomName}</span>
      <span className="control-planning-branch">{card.branchLabel}</span>
      <strong>{card.title}</strong>
      {showTeacher ? <span className="control-planning-teacher">{card.teacherName}</span> : null}
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
  const [classroomIds, setClassroomIds] = useState<string[] | null>(null);
  const [mode, setMode] = useState<ControlPlanningMode>("mine");
  const [week, setWeek] = useState<number | null>(null);
  const [layout, setLayout] = useState<ControlPlanningLayout>("semester");
  const [period, setPeriod] = useState<ControlPlanningPeriodId | null>(null);
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

    async function load() {
      setLoading(true);
      setError("");
      try {
        const next = await fetchTeacherControlPlanningApi(
          {
            schoolYearId,
            classroomIds,
            mode,
            week,
            view: layout,
            period,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setView(next);
        setPeriod((current) => current ?? next.periodId);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [schoolYearId, classroomIds, mode, week, layout, period, reloadToken]);

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
    setClassroomIds(null);
    setMode("mine");
    setWeek(null);
    setPeriod(null);
    setLayout("semester");
    closeModal();
  }

  function selectAllClasses() {
    setClassroomIds(null);
    closeModal();
  }

  function toggleClassroom(classroomId: string) {
    const assignedIds = (view?.classes ?? []).map((entry) => entry.id);
    setClassroomIds((current) => toggleControlPlanningClassroomSelection(current, assignedIds, classroomId));
    closeModal();
  }

  function selectMode(next: ControlPlanningMode) {
    if (next === "class-all" && !(view?.classes.length)) return;
    setMode(next);
  }

  function selectLayout(next: ControlPlanningLayout) {
    setLayout(next);
    closeModal();
  }

  function selectPeriod(next: ControlPlanningPeriodId) {
    setPeriod(next);
    closeModal();
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
  const classAllEnabled = Boolean(view?.classes.length);
  const selectedCount = classroomIds?.length ?? view?.classes.length ?? 0;
  const allClassesSelected = classroomIds === null || Boolean(view?.allClassesSelected);
  const classAllLabel =
    selectedCount > 1 ? "Tous les contrôles des classes" : "Tous les contrôles de la classe";
  const modalClassroomName =
    modalOption?.classroomName ||
    (view?.classes.find((entry) => entry.id === modalOption?.classroomId)?.name) ||
    "Classe";
  const modalConfirmation =
    Boolean(serverCoordination?.confirmationRequired) || Boolean(modalDay?.confirmationRequired);
  const assignedIds = view?.classes.map((entry) => entry.id) ?? [];

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

        <div className="control-planning-modes" role="group" aria-label="Vue">
          <button
            type="button"
            className={layout === "semester" ? "is-active" : ""}
            aria-pressed={layout === "semester"}
            data-control-layout="semester"
            onClick={() => selectLayout("semester")}
          >
            Semestre
          </button>
          <button
            type="button"
            className={layout === "week" ? "is-active" : ""}
            aria-pressed={layout === "week"}
            data-control-layout="week"
            onClick={() => selectLayout("week")}
          >
            Semaine
          </button>
        </div>

        {layout === "semester" ? (
          <div className="control-planning-modes" role="group" aria-label="Semestre">
            <button
              type="button"
              className={(period ?? view?.periodId) === "semester-1" ? "is-active" : ""}
              aria-pressed={(period ?? view?.periodId) === "semester-1"}
              data-control-period="semester-1"
              onClick={() => selectPeriod("semester-1")}
            >
              Semestre 1
            </button>
            <button
              type="button"
              className={(period ?? view?.periodId) === "semester-2" ? "is-active" : ""}
              aria-pressed={(period ?? view?.periodId) === "semester-2"}
              data-control-period="semester-2"
              onClick={() => selectPeriod("semester-2")}
            >
              Semestre 2
            </button>
          </div>
        ) : null}

        <div className="control-planning-chips" role="group" aria-label="Classes attribuées">
          <button
            type="button"
            className={allClassesSelected ? "is-active" : ""}
            aria-pressed={allClassesSelected}
            data-control-chip="all"
            onClick={() => selectAllClasses()}
          >
            Toutes mes classes
          </button>
          {(view?.classes ?? []).map((entry) => {
            const pressed = allClassesSelected || Boolean(classroomIds?.includes(entry.id));
            return (
              <button
                key={entry.id}
                type="button"
                className={pressed ? "is-active" : ""}
                aria-pressed={pressed}
                data-control-chip={entry.id}
                data-class-tone={classToneIndex(entry.id, assignedIds)}
                onClick={() => toggleClassroom(entry.id)}
              >
                {entry.name}
              </button>
            );
          })}
        </div>

        <div className="control-planning-modes" role="group" aria-label="Mode d’affichage">
          <button
            type="button"
            className={mode === "mine" ? "is-active" : ""}
            aria-pressed={mode === "mine"}
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
                ? "Afficher tous les contrôles des classes sélectionnées, y compris ceux des collègues"
                : "Aucune classe attribuée via l’horaire structuré"
            }
            onClick={() => selectMode("class-all")}
          >
            {classAllLabel}
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
      ) : view?.layout === "week" && view.week ? (
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

            {view.week.days.length ? (
            <div
              className="control-planning-week"
              data-control-week=""
              data-day-count={view.week.days.length}
              style={{ "--control-day-count": String(view.week.days.length) } as CSSProperties}
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
                          <ControlCard
                            card={card}
                            showTeacher={mode === "class-all" || !card.isOwn}
                            toneIndex={classToneIndex(card.classroomId, assignedIds)}
                          />
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
            ) : (
              <p className="ma-semaine-empty" data-control-empty-week="">
                {view.emptyWeekMessage ?? "Aucun de vos cours n’est prévu cette semaine."}
              </p>
            )}
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
      ) : view?.semester ? (
        <div
          className="control-planning-semester-wrap"
          data-control-semester=""
          style={{ "--control-day-count": String(view.semester.visibleDayIndexes.length) } as CSSProperties}
        >
          <table className="control-planning-semester">
            <thead>
              <tr>
                <th scope="col" className="control-planning-semester-week">
                  Semaine
                </th>
                {view.semester.visibleDayIndexes.map((dayIndex) => (
                  <th key={dayIndex} scope="col">
                    {SCHOOL_WEEKDAY_LABELS[dayIndex] ?? `Jour ${dayIndex + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.semester.weeks.map((semesterWeek) => (
                <tr
                  key={semesterWeek.number}
                  className={semesterWeek.hasCourse ? undefined : "is-empty-week"}
                  data-week-number={semesterWeek.number}
                  data-week-kind={semesterWeek.kind}
                >
                  <th scope="row" className="control-planning-semester-week">
                    <button
                      type="button"
                      className="control-planning-week-link"
                      onClick={() => {
                        setWeek(semesterWeek.number);
                        selectLayout("week");
                      }}
                    >
                      S{String(semesterWeek.number).padStart(2, "0")}-{semesterWeek.kind}
                    </button>
                    <span>{formatCompactDay(semesterWeek.monday)}</span>
                  </th>
                  {semesterWeek.days.map((day) => (
                    <td
                      key={`${semesterWeek.number}-${day.dayIndex}`}
                      className={day.hasCourse ? "is-available" : "is-inactive"}
                      data-day-index={day.dayIndex}
                      data-has-course={day.hasCourse ? "true" : "false"}
                      data-date={day.date ?? ""}
                    >
                      {day.controls.length ? (
                        <ul>
                          {day.controls.map((card) => (
                            <li key={card.agendaItemId}>
                              <ControlCard
                                card={card}
                                compact
                                showTeacher={mode === "class-all" || !card.isOwn}
                                toneIndex={classToneIndex(card.classroomId, assignedIds)}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : !day.hasCourse ? (
                        <p className="control-planning-day-empty">Aucun cours</p>
                      ) : null}
                      {day.canPlan
                        ? day.placementOptions.map((option) => (
                            <button
                              key={option.courseSessionKey}
                              type="button"
                              className="control-plan-add is-compact"
                              data-control-plan=""
                              data-control-placement={option.courseSessionKey}
                              data-annual-course-id={option.annualCourseId}
                              data-course-session-key={option.courseSessionKey}
                              data-course-session-date={option.date}
                              onClick={() => chooseOption(toPlanningDay(day), option)}
                            >
                              {placementHint(option)}
                            </button>
                          ))
                        : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
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
          classroomName={modalClassroomName}
          day={modalDay}
          option={modalOption}
          classDayControls={
            serverCoordination
              ? coordinationCardsFromSummary(serverCoordination.classDayControls)
              : modalDay.classDayControls
          }
          teacherWeekControls={
            serverCoordination
              ? coordinationCardsFromSummary(serverCoordination.teacherWeekControls)
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
