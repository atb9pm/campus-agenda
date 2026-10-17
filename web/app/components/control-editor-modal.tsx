"use client";

import { SCHOOL_WEEKDAY_LABELS } from "@campus/features/school-days";

export interface ControlCoordinationLine {
  agendaItemId: number;
  classroomName: string;
  branchLabel: string;
  title: string;
  teacherName: string;
  dayIndex: number;
}

export function formatControlEditorDateLabel(weekdayLabel: string, iso: string | null | undefined): string {
  if (!iso) return weekdayLabel;
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return weekdayLabel;
  const formatted = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(
    new Date(year, month - 1, day),
  );
  return `${weekdayLabel} ${formatted}`;
}

const EMPTY_CONTROL_DETAIL_PLACEHOLDER = "Aucune précision";

export function controlEditorDetailValue(detail: string | null | undefined): string {
  const value = detail ?? "";
  return value.trim() === EMPTY_CONTROL_DETAIL_PLACEHOLDER ? "" : value;
}

export function formatControlEditorCourseCaption(branchLabel: string, sessionLabel?: string | null): string {
  const branch = branchLabel.trim();
  const periods = sessionLabel?.trim() || "";
  if (!branch) return periods;
  return periods ? `${branch} · ${periods}` : branch;
}

export function ControlCoordinationBlock({
  classroomName,
  dayLabel,
  classDayControls,
  teacherWeekControls,
  confirmationRequired,
}: {
  classroomName: string;
  dayLabel: string;
  classDayControls: readonly ControlCoordinationLine[];
  teacherWeekControls: readonly ControlCoordinationLine[];
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

export function ControlEditorModal({
  mode,
  classroomName,
  dateLabel,
  weekdayLabel,
  courseCaption,
  classDayControls = [],
  teacherWeekControls = [],
  submitting,
  error,
  confirmationRequired = false,
  title,
  detail,
  onTitle,
  onDetail,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  classroomName: string;
  dateLabel: string;
  weekdayLabel?: string;
  courseCaption: string;
  classDayControls?: readonly ControlCoordinationLine[];
  teacherWeekControls?: readonly ControlCoordinationLine[];
  submitting: boolean;
  error: string;
  confirmationRequired?: boolean;
  title: string;
  detail: string;
  onTitle: (value: string) => void;
  onDetail: (value: string) => void;
  onClose: () => void;
  onSubmit: (confirm: boolean) => void;
}) {
  const isEdit = mode === "edit";
  const headingId = isEdit ? "control-edit-title" : "control-plan-title";
  const publishLabel = confirmationRequired ? "Publier quand même" : "Publier";

  return (
    <div className="technical-modal-backdrop" role="presentation">
      <section
        className="technical-modal control-plan-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-control-modal={isEdit ? undefined : ""}
        data-control-edit-modal={isEdit ? "" : undefined}
      >
        <header>
          <div>
            <span className="eyebrow">{isEdit ? "MODIFIER UN CONTRÔLE" : "PLANIFIER UN CONTRÔLE"}</span>
            <h2 id={headingId}>{isEdit ? "Modifier un contrôle" : "Planifier un contrôle"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" disabled={submitting}>
            ×
          </button>
        </header>
        <p
          className="control-plan-fixed"
          data-control-fixed={isEdit ? undefined : ""}
          data-control-edit-fixed={isEdit ? "" : undefined}
        >
          <strong>{classroomName}</strong>
          <span>{dateLabel}</span>
          <span>{courseCaption}</span>
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(isEdit ? false : confirmationRequired);
          }}
        >
          <label>
            Titre *
            <input
              data-control-title={isEdit ? undefined : ""}
              data-control-edit-title={isEdit ? "" : undefined}
              value={title}
              onChange={(event) => onTitle(event.target.value)}
              required
              disabled={submitting}
            />
          </label>
          <label>
            Détail
            <textarea
              data-control-detail={isEdit ? undefined : ""}
              data-control-edit-detail={isEdit ? "" : undefined}
              value={detail}
              onChange={(event) => onDetail(event.target.value)}
              rows={4}
              disabled={submitting}
            />
          </label>
          {isEdit ? null : (
            <ControlCoordinationBlock
              classroomName={classroomName}
              dayLabel={`ce ${(weekdayLabel || dateLabel).split(" ")[0]!.toLocaleLowerCase("fr-CH")}`}
              classDayControls={classDayControls}
              teacherWeekControls={teacherWeekControls}
              confirmationRequired={confirmationRequired}
            />
          )}
          {error ? <p className="control-plan-error">{error}</p> : null}
          <footer>
            <button type="button" onClick={onClose} disabled={submitting}>
              Annuler
            </button>
            {isEdit ? (
              <button type="submit" data-control-edit-save="" disabled={submitting || !title.trim()}>
                {submitting ? "Enregistrement…" : "Enregistrer les modifications"}
              </button>
            ) : (
              <button type="submit" data-control-publish="" disabled={submitting || !title.trim()}>
                {submitting ? "Publication…" : publishLabel}
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}
