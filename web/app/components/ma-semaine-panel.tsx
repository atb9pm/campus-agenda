"use client";

import { useMemo } from "react";

import type { SchoolWeek } from "@campus/features/calendar";
import {
  buildSchoolWeekPlanRows,
  formatWeekdayLabel,
  groupClassesByWeekday,
  type TeacherSetupConfig,
} from "@campus/features/teacher-setup";

interface MaSemainePanelProps {
  config: TeacherSetupConfig;
  schoolWeeks: SchoolWeek[];
  selectedSchoolWeekNumber: number;
  onSelectSchoolWeek: (weekNumber: number) => void;
}

function formatSchoolWeekHeading(week: SchoolWeek): string {
  const monday = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(week.monday);
  return `Semaine ${String(week.number).padStart(2, "0")}-${week.kind} · lundi ${monday.replace(".", "")}`;
}

export function MaSemainePanel({
  config,
  schoolWeeks,
  selectedSchoolWeekNumber,
  onSelectSchoolWeek,
}: MaSemainePanelProps) {
  const activeClasses = useMemo(
    () => config.classes.filter((entry) => entry.name.trim()),
    [config.classes],
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
        <p>Vos classes dans l’ordre des jours de cours, avec les branches que vous avez définies.</p>
      </div>

      {selectedWeek && (
        <div className="ma-semaine-week-banner">
          <div>
            <span className="eyebrow">SEMAINE SCOLAIRE</span>
            <strong>{formatSchoolWeekHeading(selectedWeek)}</strong>
            <p>
              {selectedWeek.kind === "A"
                ? "Semaine A — jour de cours : lundi"
                : "Semaine B — jours de cours : lundi et jeudi"}
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
                  {String(week.number).padStart(2, "0")}-{week.kind}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!activeClasses.length ? (
        <p className="ma-semaine-empty">
          Aucune classe configurée. Rendez-vous dans <strong>Configuration</strong> pour saisir vos classes.
        </p>
      ) : (
        <div className="ma-semaine-days">
          {grouped.map((group) => (
            <section className="ma-semaine-day-group" key={group.dayOfWeek} aria-label={group.label}>
              <header className="ma-semaine-day-heading">
                <span>{formatWeekdayLabel(group.dayOfWeek)}</span>
                <small>{group.classes.length} classe{group.classes.length > 1 ? "s" : ""}</small>
              </header>
              <div className="ma-semaine-class-grid">
                {group.classes.map((entry) => (
                  <article className="ma-semaine-class-card" key={entry.id}>
                    <div className="ma-semaine-class-icon" aria-hidden="true">
                      {entry.icon}
                    </div>
                    <div className="ma-semaine-class-body">
                      <span className="eyebrow">{entry.programLabel}</span>
                      <h3>{entry.name}</h3>
                      <p className="ma-semaine-class-day">{formatWeekdayLabel(entry.dayOfWeek)}</p>
                      {entry.branchNames.length ? (
                        <ul className="branch-tags">
                          {entry.branchNames.map((branch) => (
                            <li key={`${entry.id}-${branch}`}>{branch}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="ma-semaine-no-branches">Aucune branche saisie</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {selectedWeek && (
        <aside className="ma-semaine-plan-hint" aria-label="Rappel semaine A ou B">
          <p>
            Cette semaine est une semaine <strong>{selectedWeek.kind}</strong>. Vérifiez le calendrier complet
            dans Configuration si besoin.
          </p>
        </aside>
      )}
    </section>
  );
}

export function MaSemaineWeekPlanPreview({ schoolWeeks }: { schoolWeeks: SchoolWeek[] }) {
  const rows = useMemo(() => buildSchoolWeekPlanRows(schoolWeeks), [schoolWeeks]);
  return (
    <div className="config-week-table-wrap">
      <table className="config-week-table">
        <thead>
          <tr>
            <th>Semaine</th>
            <th>Type</th>
            <th>Lundi</th>
            <th>Jours de cours TMA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.number}>
              <td>{String(row.number).padStart(2, "0")}</td>
              <td>
                <span className={`week-kind-badge week-kind-${row.kind.toLowerCase()}`}>{row.kind}</span>
              </td>
              <td>{row.mondayLabel}</td>
              <td>{row.courseDaysLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
