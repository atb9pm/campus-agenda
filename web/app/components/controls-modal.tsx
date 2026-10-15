"use client";

import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items";
import type { SchoolWeek } from "@campus/features/calendar";
import {
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
  courseSessions?: CourseSession[] | null;
  controls: PrototypeAgendaItem[];
  onClose: () => void;
  onSelect: (item: PrototypeAgendaItem) => void;
  onDelete: (itemId: number) => Promise<void>;
}

function formatControlDay(
  week: SchoolWeek | undefined,
  item: PrototypeAgendaItem,
  sessions: CourseSession[] | null | undefined,
): string {
  if (week && sessions) {
    const match = sessions.find(
      (session) => session.schoolWeekNumber === week.number && session.dayOfWeek - 1 === item.day,
    );
    if (match) return formatControlSessionDayLabel(match);
  }
  const weekday = weekdayLabelForCourseDayIndex(item.day);
  return weekday ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : `Jour ${item.day}`;
}

export function ControlsModal({
  open,
  classLabel,
  branchLabel,
  schoolWeeks,
  courseSessions = null,
  controls,
  onClose,
  onSelect,
  onDelete,
}: ControlsModalProps) {
  if (!open) return null;

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

        <section className="controls-modal-list" aria-label="Contrôles planifiés">
          <h3>Contrôles planifiés</h3>
          {controls.length ? (
            <ul>
              {controls.map((item) => {
                const week = schoolWeeks.find((entry) => entry.number === item.schoolWeekNumber);
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => onSelect(item)}>
                      <span>
                        {week ? formatPedagogicalWeekLabel(week).replace(/^Semaine /, "") : `Sem ${item.schoolWeekNumber}`}
                        {" · "}
                        {formatControlDay(week, item, courseSessions)}
                      </span>
                      <strong>{item.title}</strong>
                    </button>
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
            <p className="controls-modal-empty">
              Aucun contrôle planifié pour cette classe. Utilisez Planifier dans la semaine concernée.
            </p>
          )}
        </section>
      </section>
    </div>
  );
}
