"use client";

import { useMemo } from "react";

import type { SchoolWeek } from "@campus/features/calendar";
import { formatPedagogicalWeekLabel } from "@campus/features/school-year/official-course-weeks.ts";
import { resolveProfessionColorTheme } from "@campus/features/school-catalog";
import { professionColorStyle } from "../../lib/profession-color-style.ts";
import {
  formatWeekdayLabel,
  groupClassesByWeekday,
  type TeacherClassSetup,
} from "@campus/features/teacher-setup";
import {
  TEACHER_WEEK_EMPTY_CLASSES_MESSAGE,
  teacherCoursesForClass,
  type TeacherCourseWorkspaceEntry,
} from "@campus/features/teacher-workspace";

interface MaSemainePanelProps {
  classes: TeacherClassSetup[];
  courses: TeacherCourseWorkspaceEntry[];
  weekSignals: Record<string, string>;
  schoolWeeks: SchoolWeek[];
  selectedSchoolWeekNumber: number;
  onSelectSchoolWeek: (weekNumber: number) => void;
  onOpenCourse: (course: TeacherCourseWorkspaceEntry) => void;
}

function formatSchoolWeekHeading(week: SchoolWeek): string {
  const monday = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(week.monday);
  return `${formatPedagogicalWeekLabel(week)} · lundi ${monday.replace(".", "")}`;
}

export function MaSemainePanel({
  classes,
  courses,
  weekSignals,
  schoolWeeks,
  selectedSchoolWeekNumber,
  onSelectSchoolWeek,
  onOpenCourse,
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
                  const classCourses = teacherCoursesForClass(courses, entry.id);
                  const uniqueCourse = classCourses.length === 1 ? classCourses[0] : null;
                  const cardStyle = professionColorStyle(theme);
                  const cardTitle = entry.programLabel || theme.legendLabel;
                  const branches = classCourses.length ? (
                    <span className="ma-semaine-class-branches">
                      {classCourses.map((course) => {
                        const signal = weekSignals[course.annualCourseId] ?? "";
                        const signalLine = signal ? (
                          <small style={{ display: "block", fontWeight: 600, opacity: 0.8 }}>{signal}</small>
                        ) : null;
                        if (uniqueCourse) {
                          return (
                            <span className="ma-semaine-branch-badge" key={course.annualCourseId}>
                              {course.branchLabel}
                              {signalLine}
                            </span>
                          );
                        }
                        const label = signal
                          ? `Ouvrir ${course.branchLabel} dans le carnet — ${signal}`
                          : `Ouvrir ${course.branchLabel} dans le carnet`;
                        return (
                          <button
                            type="button"
                            className="ma-semaine-branch-badge"
                            key={course.annualCourseId}
                            aria-label={label}
                            onClick={() => onOpenCourse(course)}
                          >
                            {course.branchLabel}
                            {signalLine}
                          </button>
                        );
                      })}
                    </span>
                  ) : (
                    <span className="ma-semaine-no-branches">Branche du cours attribué</span>
                  );
                  if (uniqueCourse) {
                    return (
                      <button
                        type="button"
                        className="ma-semaine-class-card is-single-course"
                        key={entry.id}
                        style={cardStyle}
                        title={cardTitle}
                        onClick={() => onOpenCourse(uniqueCourse)}
                      >
                        <span className="ma-semaine-class-code">{entry.name}</span>
                        {branches}
                      </button>
                    );
                  }
                  return (
                    <article
                      className="ma-semaine-class-card"
                      key={entry.id}
                      style={cardStyle}
                      title={cardTitle}
                    >
                      <span className="ma-semaine-class-code">{entry.name}</span>
                      {branches}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

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
