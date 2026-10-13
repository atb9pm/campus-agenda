import type { PrototypeAgendaItem } from "@campus/features/agenda";
import { formatCourseDayHeading } from "@campus/features/calendar";
import {
  calendarDaysBetween,
  type UpcomingTestEntry,
} from "@campus/features/evaluations";
import {
  compactControlPresentation,
  planningDayParts,
  previewUpcomingControls,
  STUDENT_CONTROL_PREVIEW_LIMIT,
  type ControlPlanningWeek,
} from "@campus/features/student";
import { decodeRichDetail, isPlaceholderDetail } from "@campus/features/class-notebook";

export function studentUpcomingPlainDetail(item: PrototypeAgendaItem): string | null {
  if (decodeRichDetail(item.detail) || isPlaceholderDetail(item.detail)) return null;
  const detail = item.detail.trim();
  return detail || null;
}

function ControlCard({
  entry,
  today,
  compact,
}: {
  entry: UpcomingTestEntry;
  today: Date;
  compact: boolean;
}) {
  const daysUntil = calendarDaysBetween(today, entry.slot.date);
  const presentation = compactControlPresentation(daysUntil, entry.slot.date);
  const detail = studentUpcomingPlainDetail(entry.item);
  return (
    <article
      className={`student-next-control student-control-card urgency-${presentation.urgency}`}
      data-next-control=""
      data-control-id={entry.item.id}
    >
      <div className={`student-control-badge${presentation.warn ? " student-next-control-warn" : ""}`}>
        <span className="student-control-badge-label">{presentation.badge}</span>
      </div>
      <div className="student-control-card-body">
        <p className="student-item-type">CONTRÔLE</p>
        {entry.subjectName ? (
          <p className="student-upcoming-tests-branch">{entry.subjectName}</p>
        ) : null}
        <strong>{entry.item.title}</strong>
        {detail ? <span className="student-next-control-detail student-upcoming-tests-detail">{detail}</span> : null}
        {compact && presentation.urgency === "week" ? (
          <p className="student-next-control-date">{formatCourseDayHeading(entry.slot)}</p>
        ) : null}
      </div>
    </article>
  );
}

export function StudentControlsPanel({
  mode,
  futureTests,
  planning,
  today,
  onSeeAll,
}: {
  mode: "preview" | "planning";
  futureTests: UpcomingTestEntry[];
  planning: ControlPlanningWeek[];
  today: Date;
  onSeeAll?: () => void;
}) {
  if (mode === "preview") {
    const preview = previewUpcomingControls(futureTests);
    const extra = futureTests.length > STUDENT_CONTROL_PREVIEW_LIMIT;
    return (
      <aside
        className="student-controls-preview"
        data-panel="prochains-controles"
        aria-labelledby="student-next-controls-title"
      >
        <h2 id="student-next-controls-title">Prochains contrôles</h2>
        {preview.length ? (
          <div className="student-control-preview-list">
            {preview.map((entry) => (
              <ControlCard key={entry.item.id} entry={entry} today={today} compact />
            ))}
          </div>
        ) : (
          <p className="student-upcoming-tests-empty">Aucun contrôle planifié à venir pour votre classe.</p>
        )}
        {extra && onSeeAll ? (
          <button type="button" className="student-see-all-controls" onClick={onSeeAll}>
            Voir tout le planning
          </button>
        ) : null}
      </aside>
    );
  }

  return (
    <section
      className="student-upcoming-tests student-control-timeline"
      data-panel="controles"
      aria-labelledby="student-upcoming-tests-title"
    >
      <h2 id="student-upcoming-tests-title">Planning des contrôles</h2>
      {planning.length ? (
        <div className="student-control-planning">
          {planning.map((week) => (
            <section
              className="student-control-planning-week"
              key={`${week.schoolWeekNumber}-${week.weekKind ?? ""}`}
            >
              <h3 className="student-week-label">{week.weekLabel}</h3>
              {week.days.map((day) => {
                const parts = planningDayParts(day.slot.date);
                return (
                  <div className="student-control-planning-day student-planning-row" key={day.dateKey}>
                    <div className="student-planning-date" aria-hidden="true">
                      <span className="student-planning-day-number">{parts.dayNumber}</span>
                      <span className="student-planning-weekday">{parts.weekday}</span>
                    </div>
                    <div className="student-planning-rail" aria-hidden="true" />
                    <ol className="student-upcoming-tests-list">
                      {day.entries.map((entry) => (
                        <li key={entry.item.id} data-control-id={entry.item.id}>
                          {entry.subjectName ? (
                            <span className="student-upcoming-tests-branch">{entry.subjectName}</span>
                          ) : null}
                          <strong>{entry.item.title}</strong>
                          {studentUpcomingPlainDetail(entry.item) ? (
                            <span className="student-upcoming-tests-detail">
                              {studentUpcomingPlainDetail(entry.item)}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      ) : (
        <p className="student-upcoming-tests-empty">Aucun contrôle planifié à venir pour votre classe.</p>
      )}
    </section>
  );
}
