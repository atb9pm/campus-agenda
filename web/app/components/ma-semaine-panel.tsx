"use client";

import { useMemo } from "react";

import type { SchoolWeek } from "@campus/features/calendar";
import { formatPedagogicalWeekLabel } from "@campus/features/school-year/official-course-weeks.ts";
import { listProfessionColorLegend, resolveProfessionColorTheme } from "@campus/features/school-catalog";
import { professionColorStyle } from "../../lib/profession-color-style.ts";
import {
  formatWeekdayLabel,
  groupClassesByWeekday,
  type TeacherClassSetup,
} from "@campus/features/teacher-setup";
import { TEACHER_WEEK_EMPTY_CLASSES_MESSAGE } from "@campus/features/teacher-workspace";

interface MaSemainePanelProps {
  classes: TeacherClassSetup[];
  schoolWeeks: SchoolWeek[];
  selectedSchoolWeekNumber: number;
  onSelectSchoolWeek: (weekNumber: number) => void;
  onOpenClass: (classSetup: TeacherClassSetup) => void;
}

function formatSchoolWeekHeading(week: SchoolWeek): string {
  const monday = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(week.monday);
  return `${formatPedagogicalWeekLabel(week)} · lundi ${monday.replace(".", "")}`;
}

export function MaSemainePanel({
  classes,
  schoolWeeks,
  selectedSchoolWeekNumber,
  onSelectSchoolWeek,
  onOpenClass,
}: MaSemainePanelProps) {
  const activeClasses = useMemo(
    () => classes.filter((entry) => entry.name.trim()),
    [classes],
  );
  const grouped = useMemo(() => groupClassesByWeekday(activeClasses), [activeClasses]);
  const selectedWeek =
    schoolWeeks.find((week) => week.number === selectedSchoolWeekNumber) ??
    schoolWeeks[0] ??
    null;

  return (
    <section className="teacher-workspace" aria-label="Ma semaine">
      <div className="workspace-intro ma-semaine-intro">
        <p className="eyebrow">VUE PERSONNELLE</p>
        <h2>Ma semaine</h2>
        <p>Vos cours attribués, organisés selon vos préférences de jours d’affichage.</p>
      </div>

      {selectedWeek && (
        <div className="ma-semaine-week-banner">
          <div>
            <span className="eyebrow">SEMAINE SCOLAIRE</span>
            <strong>{formatSchoolWeekHeading(selectedWeek)}</strong>
            <p>
              {selectedWeek.kind === "A"
                ? "Semaine A — jour de cours : lundi"
                : selectedWeek.kind === "B"
                  ? "Semaine B — jours de cours : lundi et jeudi"
                  : "Semaine de cours"}
            </p>
          </div>
          <label className="ma-semaine-week-picker">
            <span>Changer de semaine</span>
            <select
              value={selectedSchoolWeekNumber}
              onChange={(event) => onSelectSchoolWeek(Number(event.target.value))}
            >
              {schoolWeeks.map((week) => (
                <option key={week.number} value={week.number}>
                  {formatPedagogicalWeekLabel(week).replace(/^Semaine /, "")}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!activeClasses.length ? (
        <p className="ma-semaine-empty">{TEACHER_WEEK_EMPTY_CLASSES_MESSAGE}</p>
      ) : (
        <div className="ma-semaine-days">
          {grouped.map((group) => (
            <section className="ma-semaine-day-group" key={group.dayOfWeek} aria-label={group.label}>
              <header className="ma-semaine-day-heading">
                <span>{formatWeekdayLabel(group.dayOfWeek)}</span>
                <small>{group.classes.length} classe{group.classes.length > 1 ? "s" : ""}</small>
              </header>
              <div className="ma-semaine-class-grid">
                {group.classes.map((entry) => {
                  const theme = resolveProfessionColorTheme(entry.professionPrefix, entry.name);
                  return (
                    <button
                      type="button"
                      className="ma-semaine-class-card"
                      key={entry.id}
                      style={professionColorStyle(theme)}
                      title={entry.programLabel || theme.legendLabel}
                      onClick={() => onOpenClass(entry)}
                    >
                      <span className="ma-semaine-class-code">{entry.name}</span>
                      {entry.branchNames.length ? (
                        <span className="ma-semaine-class-branches">
                          {entry.branchNames.map((branch, index) => (
                            <span className="ma-semaine-branch-label" key={`${entry.id}-${branch}`}>
                              {index > 0 ? " · " : null}
                              {branch}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="ma-semaine-no-branches">Branche du cours attribué</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {activeClasses.length > 0 ? (
        <aside className="ma-semaine-profession-legend" aria-label="Code couleur par profession">
          {listProfessionColorLegend().map((theme) => (
            <span
              className="ma-semaine-legend-item"
              key={theme.prefix}
              style={professionColorStyle(theme)}
            >
              <span className="ma-semaine-legend-swatch" aria-hidden="true" />
              {theme.legendLabel}
            </span>
          ))}
        </aside>
      ) : null}

      {selectedWeek && (
        <aside className="ma-semaine-plan-hint" aria-label="Rappel semaine A ou B">
          <p>
            Cette semaine est une semaine <strong>{selectedWeek.kind}</strong>. Les jours affichés ici
            sont une préférence personnelle, pas une attribution.
          </p>
        </aside>
      )}
    </section>
  );
}
