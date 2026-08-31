"use client";

import { useMemo } from "react";

import {
  WEEKDAY_LABELS,
  type TeacherSetupConfig,
  type WeekdayIndex,
} from "@campus/features/teacher-setup";
import {
  matchSetupPreference,
  TEACHER_COURSES_EMPTY_MESSAGE,
  upsertSetupPreferenceForCourse,
  WORKSPACE_ASSIGNMENT_ROLE_LABELS,
  type TeacherCourseWorkspaceEntry,
} from "@campus/features/teacher-workspace";

interface ConfigurationPanelProps {
  config: TeacherSetupConfig;
  courses: TeacherCourseWorkspaceEntry[];
  onChange: (config: TeacherSetupConfig) => void;
  onReset: () => void;
  onNotice: (message: string) => void;
}

export function ConfigurationPanel({
  config,
  courses,
  onChange,
  onReset,
}: ConfigurationPanelProps) {
  const preferenceCount = useMemo(() => {
    return courses.filter((course) => matchSetupPreference(course, config)).length;
  }, [config, courses]);

  function patchCourse(
    course: TeacherCourseWorkspaceEntry,
    patch: { dayOfWeek?: WeekdayIndex; icon?: string },
  ) {
    onChange(upsertSetupPreferenceForCourse(config, course, patch));
  }

  return (
    <section className="teacher-workspace" aria-label="Configuration">
      <div className="workspace-intro">
        <p className="eyebrow">PARAMÈTRES PERSONNELS</p>
        <h2>Préférences</h2>
        <p>
          Personnalisez l’affichage de vos cours attribués : jour visible dans Ma semaine et icône.
          Vous ne pouvez pas vous attribuer une classe ou une branche.
        </p>
        <div className="config-summary-row">
          <span>
            <strong>{courses.length}</strong> cours attribué{courses.length > 1 ? "s" : ""}
            {preferenceCount ? ` · ${preferenceCount} préférence${preferenceCount > 1 ? "s" : ""}` : ""}
          </span>
          <button type="button" className="workspace-action secondary" onClick={onReset}>
            Réinitialiser les préférences
          </button>
        </div>
      </div>

      <div className="config-classes-editor" aria-label="Préférences d’affichage">
        <header className="config-section-header">
          <h3>Afficher / masquer mes cours</h3>
        </header>

        {!courses.length ? (
          <p className="ma-semaine-empty">{TEACHER_COURSES_EMPTY_MESSAGE}</p>
        ) : (
          <div className="config-class-list">
            {courses.map((course) => {
              const preference = matchSetupPreference(course, config);
              return (
                <article className="config-class-row config-class-row-simple" key={course.annualCourseId}>
                  <div className="config-field">
                    <span>Cours attribué</span>
                    <strong>
                      {course.classCode} — {course.branchLabel}
                    </strong>
                    <small className="mes-cours-role">
                      {WORKSPACE_ASSIGNMENT_ROLE_LABELS[course.role]}
                    </small>
                  </div>

                  <label className="config-field">
                    <span>Jour d’affichage</span>
                    <select
                      value={preference?.dayOfWeek ?? 1}
                      onChange={(event) =>
                        patchCourse(course, { dayOfWeek: Number(event.target.value) as WeekdayIndex })
                      }
                    >
                      {(Object.entries(WEEKDAY_LABELS) as Array<[string, string]>).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="config-field">
                    <span>Icône</span>
                    <input
                      value={preference?.icon ?? "•"}
                      maxLength={4}
                      onChange={(event) => patchCourse(course, { icon: event.target.value || "•" })}
                    />
                  </label>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
