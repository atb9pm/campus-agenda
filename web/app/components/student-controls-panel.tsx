import type { PrototypeAgendaItem } from "@campus/features/agenda";
import { formatCourseDayHeading } from "@campus/features/calendar";
import {
  calendarDaysBetween,
  type UpcomingTestEntry,
} from "@campus/features/evaluations";
import {
  controlAgendaDateParts,
  type ControlPlanningWeek,
} from "@campus/features/student";
import { decodeRichDetail, isPlaceholderDetail } from "@campus/features/class-notebook";

export function studentUpcomingPlainDetail(item: PrototypeAgendaItem): string | null {
  if (decodeRichDetail(item.detail) || isPlaceholderDetail(item.detail)) return null;
  const detail = item.detail.trim();
  return detail || null;
}

function ControlRow({
  entry,
  today,
}: {
  entry: UpcomingTestEntry;
  today: Date;
}) {
  const daysUntil = calendarDaysBetween(today, entry.slot.date);
  const parts = controlAgendaDateParts(entry.slot.date);
  const detail = studentUpcomingPlainDetail(entry.item);
  const urgency = daysUntil <= 0 ? "today" : daysUntil <= 7 ? "soon" : "later";
  const dateLabel = formatCourseDayHeading(entry.slot);
  const urgencyLabel = urgency === "today" ? "Aujourd’hui. " : urgency === "soon" ? "Proche. " : "";
  return (
    <article
      className={`student-next-control student-control-row urgency-${urgency}`}
      data-next-control=""
      data-control-id={entry.item.id}
    >
      {entry.subjectName ? (
        <p className="student-course-chip student-upcoming-tests-branch">{entry.subjectName}</p>
      ) : null}
      <div className="student-control-main">
        <time className="student-control-date" dateTime={entry.slot.date.toISOString()}>
          <span className="student-control-day" aria-hidden="true">
            {parts.day}
          </span>
          <span className="student-control-month" aria-hidden="true">
            {parts.month}
          </span>
          <span className="student-visually-hidden">
            {urgencyLabel}
            {dateLabel}
          </span>
        </time>
        <div className="student-control-card-body">
          <strong>{entry.item.title}</strong>
          {detail ? <span className="student-next-control-detail student-upcoming-tests-detail">{detail}</span> : null}
        </div>
      </div>
    </article>
  );
}

export function StudentControlsPanel({
  mode,
  futureTests,
  planning,
  today,
}: {
  mode: "preview" | "planning";
  futureTests: UpcomingTestEntry[];
  planning: ControlPlanningWeek[];
  today: Date;
  onSeeAll?: () => void;
}) {
  const title = mode === "preview" ? "Contrôles à venir" : "Contrôles";
  const headingId = mode === "preview" ? "student-next-controls-title" : "student-upcoming-tests-title";
  void planning;

  return (
    <section
      className={mode === "preview" ? "student-controls-preview" : "student-upcoming-tests student-control-timeline"}
      data-panel={mode === "preview" ? "prochains-controles" : "controles"}
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>
        {mode === "preview" ? (
          <span className="student-zone-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M7 3.5v3M17 3.5v3M4.5 8h15M6 5.5h12A1.5 1.5 0 0 1 19.5 7v12A1.5 1.5 0 0 1 18 20.5H6A1.5 1.5 0 0 1 4.5 19V7A1.5 1.5 0 0 1 6 5.5Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ) : null}
        {title}
      </h2>
      {futureTests.length ? (
        <div className="student-control-preview-list">
          {futureTests.map((entry) => (
            <ControlRow key={entry.item.id} entry={entry} today={today} />
          ))}
        </div>
      ) : (
        <p className="student-upcoming-tests-empty">Aucun contrôle planifié.</p>
      )}
    </section>
  );
}
