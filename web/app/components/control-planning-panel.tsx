"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";

import {
  canManageOwnStructuredControlCard,
  classDayControlsForPlacementOption,
  confirmationRequiredForPlacementOption,
  formatControlPlanningYearLabel,
  isMovableStructuredControlCard,
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
  deleteTeacherControlApi,
  fetchTeacherControlPlanningApi,
  moveTeacherControlApi,
  updateTeacherControlApi,
} from "../../lib/api-client.ts";

const CONTROL_DRAG_MIME = "application/x-campus-control";

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
    detail: "",
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
  movable = false,
  manageable = false,
  dragging = false,
  selected = false,
  onDragStart,
  onDragEnd,
  onEditClick,
  onMoveClick,
  onDeleteClick,
}: {
  card: ControlPlanningCard;
  compact?: boolean;
  showTeacher?: boolean;
  toneIndex?: number;
  movable?: boolean;
  manageable?: boolean;
  dragging?: boolean;
  selected?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onEditClick?: () => void;
  onMoveClick?: () => void;
  onDeleteClick?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const title = [card.classroomName, card.branchLabel, card.title, card.teacherName].filter(Boolean).join(" · ");
  const classes = [
    "control-planning-card",
    compact ? "is-compact" : "",
    card.isOwn ? "" : "is-peer",
    movable ? "is-draggable" : "",
    dragging ? "is-dragging" : "",
    selected ? "is-move-source" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (dragging) setMenuOpen(false);
  }, [dragging]);

  function stopCardGesture(event: { preventDefault(): void; stopPropagation(): void }) {
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <article
      className={classes}
      data-control-card=""
      data-classroom-name={card.classroomName}
      data-own={card.isOwn ? "true" : "false"}
      data-movable={movable ? "true" : "false"}
      data-class-tone={toneIndex}
      data-agenda-item-id={card.agendaItemId}
      data-annual-course-id={card.annualCourseId ?? ""}
      data-course-session-key={card.courseSessionKey ?? ""}
      data-course-session-date={card.courseSessionDate ?? card.date ?? ""}
      title={title}
      draggable={movable}
      onDragStart={movable ? onDragStart : undefined}
      onDragEnd={movable ? onDragEnd : undefined}
    >
      <div className="control-planning-card-head">
        <span className="control-planning-class-badge">{card.classroomName}</span>
        {manageable ? (
          <div className="control-planning-card-actions" ref={menuRef} data-control-actions="">
            <button
              type="button"
              className="control-planning-card-menu-trigger"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Actions du contrôle"
              data-control-menu=""
              onMouseDown={stopCardGesture}
              onClick={(event) => {
                stopCardGesture(event);
                setMenuOpen((open) => !open);
              }}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="control-planning-card-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  data-control-edit=""
                  onMouseDown={stopCardGesture}
                  onClick={(event) => {
                    stopCardGesture(event);
                    setMenuOpen(false);
                    onEditClick?.();
                  }}
                >
                  Modifier
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-control-move=""
                  onMouseDown={stopCardGesture}
                  onClick={(event) => {
                    stopCardGesture(event);
                    setMenuOpen(false);
                    onMoveClick?.();
                  }}
                >
                  Déplacer
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  data-control-delete=""
                  onMouseDown={stopCardGesture}
                  onClick={(event) => {
                    stopCardGesture(event);
                    setMenuOpen(false);
                    onDeleteClick?.();
                  }}
                >
                  Supprimer
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
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

function MoveModal({
  classroomName,
  day,
  option,
  card,
  classDayControls,
  teacherWeekControls,
  submitting,
  error,
  confirmationRequired,
  onClose,
  onSubmit,
}: {
  classroomName: string;
  day: ControlPlanningDay;
  option: ControlPlacementOption;
  card: ControlPlanningCard;
  classDayControls: ControlPlanningCard[];
  teacherWeekControls: ControlPlanningCard[];
  submitting: boolean;
  error: string;
  confirmationRequired: boolean;
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
        aria-labelledby="control-move-title"
        data-control-move-modal=""
      >
        <header>
          <div>
            <span className="eyebrow">DÉPLACER UN CONTRÔLE</span>
            <h2 id="control-move-title">Déplacer un contrôle</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" disabled={submitting}>
            ×
          </button>
        </header>
        <p className="control-plan-fixed" data-control-fixed="">
          <strong>{card.title}</strong>
          <span>{classroomName}</span>
          <span>{dayLabel}</span>
          <span>{placementCaption(option)}</span>
        </p>
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
          <button
            type="button"
            data-control-move-confirm=""
            disabled={submitting}
            onClick={() => onSubmit(confirmationRequired)}
          >
            {submitting ? "Déplacement…" : confirmationRequired ? "Déplacer quand même" : "Déplacer"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function EditModal({
  card,
  title,
  detail,
  submitting,
  error,
  onTitle,
  onDetail,
  onClose,
  onSubmit,
}: {
  card: ControlPlanningCard;
  title: string;
  detail: string;
  submitting: boolean;
  error: string;
  onTitle: (value: string) => void;
  onDetail: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const placement = [card.classroomName, card.branchLabel, formatIsoDay(card.courseSessionDate ?? card.date)]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="technical-modal-backdrop" role="presentation">
      <section
        className="technical-modal control-plan-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="control-edit-title"
        data-control-edit-modal=""
      >
        <header>
          <div>
            <span className="eyebrow">MODIFIER UN CONTRÔLE</span>
            <h2 id="control-edit-title">Modifier un contrôle</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" disabled={submitting}>
            ×
          </button>
        </header>
        <p className="control-plan-fixed" data-control-edit-fixed="">
          <strong>{placement}</strong>
          <span>Classe, branche et séance inchangées.</span>
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label>
            Titre *
            <input
              data-control-edit-title=""
              value={title}
              onChange={(event) => onTitle(event.target.value)}
              required
              disabled={submitting}
            />
          </label>
          <label>
            Détail
            <textarea
              data-control-edit-detail=""
              value={detail}
              onChange={(event) => onDetail(event.target.value)}
              rows={3}
              disabled={submitting}
            />
          </label>
          {error ? <p className="control-plan-error">{error}</p> : null}
          <footer>
            <button type="button" onClick={onClose} disabled={submitting}>
              Annuler
            </button>
            <button type="submit" data-control-edit-save="" disabled={submitting || !title.trim()}>
              {submitting ? "Enregistrement…" : "Enregistrer"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function DeleteModal({
  card,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  card: ControlPlanningCard;
  submitting: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="technical-modal-backdrop" role="presentation">
      <section
        className="technical-modal control-plan-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="control-delete-title"
        data-control-delete-modal=""
      >
        <header>
          <div>
            <span className="eyebrow">SUPPRIMER UN CONTRÔLE</span>
            <h2 id="control-delete-title">Supprimer un contrôle</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" disabled={submitting}>
            ×
          </button>
        </header>
        <p data-control-delete-copy="">
          Supprimer ce contrôle ? Cette action est définitive.
        </p>
        <p className="control-plan-fixed">
          <strong>{card.title}</strong>
          <span>{card.classroomName}</span>
          <span>{card.branchLabel}</span>
        </p>
        {error ? <p className="control-plan-error">{error}</p> : null}
        <footer>
          <button type="button" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button
            type="button"
            className="is-danger"
            data-control-delete-confirm=""
            disabled={submitting}
            onClick={onConfirm}
          >
            {submitting ? "Suppression…" : "Supprimer le contrôle"}
          </button>
        </footer>
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
  const [draggingCard, setDraggingCard] = useState<ControlPlanningCard | null>(null);
  const [moveSource, setMoveSource] = useState<ControlPlanningCard | null>(null);
  const [pendingMoveDay, setPendingMoveDay] = useState<ControlPlanningDay | null>(null);
  const [moveDay, setMoveDay] = useState<ControlPlanningDay | null>(null);
  const [moveOption, setMoveOption] = useState<ControlPlacementOption | null>(null);
  const [moveCard, setMoveCard] = useState<ControlPlanningCard | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState("");
  const [editCard, setEditCard] = useState<ControlPlanningCard | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDetail, setEditDetail] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteCard, setDeleteCard] = useState<ControlPlanningCard | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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
    setPendingMoveDay(null);
    setMoveDay(null);
    setMoveOption(null);
    setMoveCard(null);
    setMoving(false);
    setMoveError("");
    setMoveSource(null);
    setDraggingCard(null);
    setEditCard(null);
    setEditTitle("");
    setEditDetail("");
    setEditing(false);
    setEditError("");
    setDeleteCard(null);
    setDeleting(false);
    setDeleteError("");
  }

  function cancelMoveMode() {
    setMoveSource(null);
    setDraggingCard(null);
    setPendingMoveDay(null);
    setMoveDay(null);
    setMoveOption(null);
    setMoveCard(null);
    setMoveError("");
    setServerCoordination(null);
  }

  function cardIsMovable(card: ControlPlanningCard): boolean {
    return isMovableStructuredControlCard(card, Boolean(view?.canCreate));
  }

  function cardIsManageable(card: ControlPlanningCard): boolean {
    return canManageOwnStructuredControlCard(card, Boolean(view?.canCreate));
  }

  function openEdit(card: ControlPlanningCard) {
    if (!cardIsManageable(card)) return;
    cancelMoveMode();
    setPickerDay(null);
    setModalDay(null);
    setModalOption(null);
    setDeleteCard(null);
    setDeleteError("");
    setEditCard(card);
    setEditTitle(card.title);
    setEditDetail(card.detail ?? "");
    setEditError("");
  }

  function openDelete(card: ControlPlanningCard) {
    if (!cardIsManageable(card)) return;
    cancelMoveMode();
    setPickerDay(null);
    setModalDay(null);
    setModalOption(null);
    setEditCard(null);
    setEditError("");
    setDeleteCard(card);
    setDeleteError("");
  }

  async function submitEdit() {
    if (!editCard) return;
    const nextTitle = editTitle.trim();
    if (!nextTitle) {
      setEditError("Le titre du contrôle est obligatoire.");
      return;
    }
    setEditing(true);
    setEditError("");
    try {
      await updateTeacherControlApi(editCard.agendaItemId, {
        title: nextTitle,
        detail: editDetail,
      });
      closeModal();
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "Modification impossible.");
    } finally {
      setEditing(false);
    }
  }

  async function submitDelete() {
    if (!deleteCard) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteTeacherControlApi(deleteCard.agendaItemId);
      closeModal();
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setDeleting(false);
    }
  }

  function startCardDrag(card: ControlPlanningCard, event: DragEvent<HTMLElement>) {
    if (!cardIsMovable(card)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(CONTROL_DRAG_MIME, String(card.agendaItemId));
    event.dataTransfer.setData("text/plain", String(card.agendaItemId));
    event.dataTransfer.effectAllowed = "move";
    setDraggingCard(card);
    setMoveError("");
  }

  function dropState(options: readonly ControlPlacementOption[]): "ok" | "forbidden" | null {
    if (!draggingCard && !moveSource) return null;
    return options.length > 0 ? "ok" : "forbidden";
  }

  function sameSession(card: ControlPlanningCard, option: ControlPlacementOption): boolean {
    return card.annualCourseId === option.annualCourseId && card.courseSessionKey === option.courseSessionKey;
  }

  async function executeMove(
    card: ControlPlanningCard,
    option: ControlPlacementOption,
    confirm: boolean,
    day?: ControlPlanningDay,
  ) {
    setMoving(true);
    setMoveError("");
    try {
      await moveTeacherControlApi(card.agendaItemId, {
        annualCourseId: option.annualCourseId,
        courseSessionKey: option.courseSessionKey,
        confirmCoordination: confirm,
      });
      closeModal();
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setMoveCard(card);
      setMoveOption(option);
      if (day) setMoveDay(day);
      if (caught instanceof ControlCoordinationRequiredError) {
        setServerCoordination(caught.coordination);
        setMoveError(caught.message);
      } else {
        setMoveError(caught instanceof Error ? caught.message : "Déplacement impossible.");
      }
    } finally {
      setMoving(false);
    }
  }

  function openMoveConfirm(card: ControlPlanningCard, day: ControlPlanningDay, option: ControlPlacementOption) {
    setPickerDay(null);
    setPendingMoveDay(null);
    setModalDay(null);
    setModalOption(null);
    setMoveSource(null);
    setDraggingCard(null);
    setMoveCard(card);
    setMoveDay(day);
    setMoveOption(option);
    setMoveError("");
    setServerCoordination(null);
  }

  function chooseMoveDestination(card: ControlPlanningCard, day: ControlPlanningDay, option: ControlPlacementOption) {
    if (!cardIsMovable(card)) return;
    if (sameSession(card, option)) {
      cancelMoveMode();
      return;
    }
    const previewConfirm = confirmationRequiredForPlacementOption(
      day.classDayControls,
      option,
      card.agendaItemId,
    );
    if (previewConfirm) {
      openMoveConfirm(card, day, option);
      return;
    }
    void executeMove(card, option, false, day);
  }

  function resolveDroppedCard(event: DragEvent<HTMLElement>): ControlPlanningCard | null {
    const raw =
      event.dataTransfer.getData(CONTROL_DRAG_MIME) || event.dataTransfer.getData("text/plain");
    const agendaItemId = Number(raw);
    if (draggingCard && draggingCard.agendaItemId === agendaItemId) return draggingCard;
    if (Number.isInteger(agendaItemId) && agendaItemId > 0 && view) {
      const days = [
        ...(view.week?.days ?? []),
        ...(view.semester?.weeks.flatMap((week) => week.days.map(toPlanningDay)) ?? []),
      ];
      for (const day of days) {
        const found = day.controls.find((entry) => entry.agendaItemId === agendaItemId);
        if (found) return found;
      }
    }
    return draggingCard;
  }

  function handleDayDragOver(event: DragEvent<HTMLElement>, options: readonly ControlPlacementOption[]) {
    if (!draggingCard) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = options.length > 0 ? "move" : "none";
  }

  function handleDropOnDay(event: DragEvent<HTMLElement>, day: ControlPlanningDay) {
    event.preventDefault();
    const card = resolveDroppedCard(event);
    setDraggingCard(null);
    if (!card || !day.placementOptions.length) return;
    if (day.placementOptions.length === 1) {
      chooseMoveDestination(card, day, day.placementOptions[0]!);
      return;
    }
    setMoveCard(card);
    setPendingMoveDay(day);
  }

  function handleDropOnOption(
    event: DragEvent<HTMLElement>,
    day: ControlPlanningDay,
    option: ControlPlacementOption,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const card = resolveDroppedCard(event);
    setDraggingCard(null);
    if (!card) return;
    chooseMoveDestination(card, day, option);
  }

  function activatePlacement(day: ControlPlanningDay, option?: ControlPlacementOption) {
    const source = moveSource;
    if (source) {
      if (option) {
        chooseMoveDestination(source, day, option);
        return;
      }
      if (day.placementOptions.length === 1) {
        chooseMoveDestination(source, day, day.placementOptions[0]!);
        return;
      }
      if (day.placementOptions.length > 1) {
        setMoveCard(source);
        setPendingMoveDay(day);
      }
      return;
    }
    if (option) {
      chooseOption(day, option);
      return;
    }
    openPlan(day);
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
  const targetClassDayControls =
    modalDay && modalOption
      ? classDayControlsForPlacementOption(modalDay.classDayControls, modalOption)
      : [];
  const modalConfirmation = serverCoordination
    ? Boolean(serverCoordination.confirmationRequired)
    : Boolean(modalOption && confirmationRequiredForPlacementOption(modalDay?.classDayControls ?? [], modalOption));
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
        {moveSource ? (
          <div className="control-planning-move-bar" data-control-move-mode="">
            <p>
              Choisissez la séance destination pour « {moveSource.title} ». Seules les cases avec une
              CourseSession réelle sont valides.
            </p>
            <button type="button" onClick={cancelMoveMode}>
              Annuler le déplacement
            </button>
          </div>
        ) : null}
        {moveError && !moveCard ? <p className="control-plan-error">{moveError}</p> : null}
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
                  className={[
                    "control-planning-day",
                    dropState(day.placementOptions) === "ok" ? "is-drop-ok" : "",
                    dropState(day.placementOptions) === "forbidden" ? "is-drop-forbidden" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-day-index={day.dayIndex}
                  data-control-drop={dropState(day.placementOptions) ?? ""}
                  aria-label={day.weekdayLabel}
                  onDragOver={(event) => handleDayDragOver(event, day.placementOptions)}
                  onDrop={(event) => handleDropOnDay(event, day)}
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
                            movable={cardIsMovable(card)}
                            manageable={cardIsManageable(card)}
                            dragging={draggingCard?.agendaItemId === card.agendaItemId}
                            selected={moveSource?.agendaItemId === card.agendaItemId}
                            onDragStart={(event) => startCardDrag(card, event)}
                            onDragEnd={() => setDraggingCard(null)}
                            onEditClick={() => openEdit(card)}
                            onMoveClick={() => setMoveSource(card)}
                            onDeleteClick={() => openDelete(card)}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="control-planning-day-empty">Aucun contrôle</p>
                  )}
                  {day.canPlan && day.placementOptions.length > 1
                    ? day.placementOptions.map((option) => (
                        <button
                          key={option.courseSessionKey}
                          type="button"
                          className="control-plan-add"
                          data-control-plan=""
                          data-control-placement={option.courseSessionKey}
                          data-annual-course-id={option.annualCourseId}
                          data-course-session-key={option.courseSessionKey}
                          onClick={() => activatePlacement(day, option)}
                          onDragOver={(event) => handleDayDragOver(event, [option])}
                          onDrop={(event) => handleDropOnOption(event, day, option)}
                        >
                          {moveSource ? `→ ${placementCaption(option)}` : placementHint(option)}
                        </button>
                      ))
                    : day.canPlan ? (
                    <button
                      type="button"
                      className="control-plan-add"
                      data-control-plan=""
                      onClick={() => activatePlacement(day)}
                      onDragOver={(event) => handleDayDragOver(event, day.placementOptions)}
                      onDrop={(event) => handleDropOnDay(event, day)}
                    >
                      {moveSource ? "Déposer ici" : "+ Planifier un contrôle"}
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
                      className={[
                        day.hasCourse ? "is-available" : "is-inactive",
                        dropState(day.placementOptions) === "ok" ? "is-drop-ok" : "",
                        dropState(day.placementOptions) === "forbidden" ? "is-drop-forbidden" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-day-index={day.dayIndex}
                      data-has-course={day.hasCourse ? "true" : "false"}
                      data-date={day.date ?? ""}
                      data-control-drop={dropState(day.placementOptions) ?? ""}
                      onDragOver={(event) => handleDayDragOver(event, day.placementOptions)}
                      onDrop={(event) => handleDropOnDay(event, toPlanningDay(day))}
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
                                movable={cardIsMovable(card)}
                                manageable={cardIsManageable(card)}
                                dragging={draggingCard?.agendaItemId === card.agendaItemId}
                                selected={moveSource?.agendaItemId === card.agendaItemId}
                                onDragStart={(event) => startCardDrag(card, event)}
                                onDragEnd={() => setDraggingCard(null)}
                                onEditClick={() => openEdit(card)}
                                onMoveClick={() => setMoveSource(card)}
                                onDeleteClick={() => openDelete(card)}
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
                              onClick={() => activatePlacement(toPlanningDay(day), option)}
                              onDragOver={(event) => handleDayDragOver(event, [option])}
                              onDrop={(event) => handleDropOnOption(event, toPlanningDay(day), option)}
                            >
                              {moveSource ? `→ ${placementHint(option)}` : placementHint(option)}
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

      {pickerDay || pendingMoveDay ? (
        <div className="technical-modal-backdrop" role="presentation">
          <section className="technical-modal control-plan-modal" role="dialog" aria-modal="true">
            <header>
              <div>
                <span className="eyebrow">SÉANCE</span>
                <h2>{pendingMoveDay ? "Choisir la séance destination" : "Choisir le cours"}</h2>
              </div>
              <button type="button" onClick={pendingMoveDay ? cancelMoveMode : closeModal} aria-label="Fermer">
                ×
              </button>
            </header>
            <ul className="control-plan-options" data-control-session-picker="">
              {(pendingMoveDay ?? pickerDay)!.placementOptions.map((option) => (
                <li key={option.courseSessionKey}>
                  <button
                    type="button"
                    data-course-session-key={option.courseSessionKey}
                    onClick={() => {
                      if (pendingMoveDay && moveCard) {
                        chooseMoveDestination(moveCard, pendingMoveDay, option);
                        return;
                      }
                      chooseOption((pendingMoveDay ?? pickerDay)!, option);
                    }}
                  >
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
              : targetClassDayControls
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

      {moveDay && moveOption && moveCard && view ? (
        <MoveModal
          classroomName={
            moveOption.classroomName ||
            view.classes.find((entry) => entry.id === moveOption.classroomId)?.name ||
            "Classe"
          }
          day={moveDay}
          option={moveOption}
          card={moveCard}
          classDayControls={
            serverCoordination
              ? coordinationCardsFromSummary(serverCoordination.classDayControls)
              : classDayControlsForPlacementOption(moveDay.classDayControls, moveOption).filter(
                  (entry) => entry.agendaItemId !== moveCard.agendaItemId,
                )
          }
          teacherWeekControls={
            serverCoordination
              ? coordinationCardsFromSummary(serverCoordination.teacherWeekControls)
              : view.teacherWeekControls.filter((entry) => entry.agendaItemId !== moveCard.agendaItemId)
          }
          submitting={moving}
          error={moveError}
          confirmationRequired={
            serverCoordination
              ? Boolean(serverCoordination.confirmationRequired)
              : confirmationRequiredForPlacementOption(
                  moveDay.classDayControls,
                  moveOption,
                  moveCard.agendaItemId,
                )
          }
          onClose={cancelMoveMode}
          onSubmit={(confirm) => void executeMove(moveCard, moveOption, confirm, moveDay)}
        />
      ) : null}

      {editCard ? (
        <EditModal
          card={editCard}
          title={editTitle}
          detail={editDetail}
          submitting={editing}
          error={editError}
          onTitle={setEditTitle}
          onDetail={setEditDetail}
          onClose={closeModal}
          onSubmit={() => void submitEdit()}
        />
      ) : null}

      {deleteCard ? (
        <DeleteModal
          card={deleteCard}
          submitting={deleting}
          error={deleteError}
          onClose={closeModal}
          onConfirm={() => void submitDelete()}
        />
      ) : null}
    </section>
  );
}
