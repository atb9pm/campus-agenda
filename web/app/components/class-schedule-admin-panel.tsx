"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type { AnnualCourse, TeacherCourseAssignment } from "@campus/features/annual-courses/types.ts";
import {
  COURSE_WEEKDAY_LABELS,
  COURSE_WEEK_KIND_LABELS,
  COURSE_WEEK_KIND_LONG_LABELS,
  COURSE_WEEK_KINDS,
  TEACHABLE_PERIODS,
  allowedPeriodEnds,
  buildClassSchedulePreview,
  buildGlobalDayGrid,
  formatPeriodRange,
  formatTeachersLine,
  isClassScheduleWritable,
  teachersForAnnualCourse,
  type CourseScheduleSlot,
  type CourseWeekKind,
  type CourseWeekday,
} from "@campus/features/course-schedule/index.ts";
import { classDisplayProfessionLabel, classDisplayTrainingYearLabel } from "@campus/features/school-catalog/class-display.ts";
import type { PedagogicalContextRecord, SchoolProfessionRecord } from "@campus/features/school-catalog";
import type { SchoolBranchRecord, SchoolClassRecord } from "@campus/features/school-catalog";

interface TeacherSummary {
  id: string;
  displayName: string;
  initials: string;
  isActive: boolean;
  isArchived: boolean;
}

interface OverviewPayload {
  ok: boolean;
  reason?: string;
  slots: CourseScheduleSlot[];
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  classes: SchoolClassRecord[];
  branches: SchoolBranchRecord[];
  professions: SchoolProfessionRecord[];
  contexts: PedagogicalContextRecord[];
  schoolYears: Array<{ id: string; label: string; status: "draft" | "active" | "archived" }>;
  teachers: TeacherSummary[];
}

type PanelView = "config" | "preview" | "global";

interface SlotDraft {
  slotId: string | null;
  annualCourseId: string;
  dayOfWeek: CourseWeekday;
  periodStart: number;
  periodEnd: number;
  weekKind: CourseWeekKind;
}

interface ClassScheduleAdminPanelProps {
  onNotice: (message: string) => void;
  onOpenAssignments: () => void;
}

function branchForCourse(
  course: AnnualCourse,
  contexts: PedagogicalContextRecord[],
  branches: SchoolBranchRecord[],
): SchoolBranchRecord | undefined {
  const context = contexts.find((entry) => entry.id === course.contextId);
  return context ? branches.find((entry) => entry.id === context.branchId) : undefined;
}

export function ClassScheduleAdminPanel({ onNotice, onOpenAssignments }: ClassScheduleAdminPanelProps) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<PanelView>("config");
  const [selectedYearId, setSelectedYearId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [globalDay, setGlobalDay] = useState<CourseWeekday>(4);
  const [globalWeek, setGlobalWeek] = useState<CourseWeekKind>("A");
  const [draft, setDraft] = useState<SlotDraft | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/course-schedule", { credentials: "include" });
    const payload = (await response.json()) as OverviewPayload;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.reason ?? "Chargement de l’horaire impossible.");
    }
    setData(payload);
    return payload;
  }, []);

  useEffect(() => {
    void refresh()
      .then((payload) => {
        const active = payload.schoolYears.find((year) => year.status === "active") ?? payload.schoolYears[0];
        if (active) setSelectedYearId((current) => current || active.id);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const yearClasses = useMemo(() => {
    if (!data) return [];
    return data.classes
      .filter((entry) => entry.schoolYearId === selectedYearId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code, "fr-CH"));
  }, [data, selectedYearId]);

  const currentClass = yearClasses.find((entry) => entry.id === selectedClassId) ?? yearClasses[0] ?? null;
  const currentYear = data?.schoolYears.find((entry) => entry.id === selectedYearId) ?? null;

  const classCourses = useMemo(() => {
    if (!data || !currentClass) return [];
    return data.courses
      .filter((course) => course.classId === currentClass.id && course.schoolYearId === currentClass.schoolYearId)
      .sort((left, right) => {
        const leftLabel = branchForCourse(left, data.contexts, data.branches)?.label ?? "";
        const rightLabel = branchForCourse(right, data.contexts, data.branches)?.label ?? "";
        return leftLabel.localeCompare(rightLabel, "fr-CH");
      });
  }, [data, currentClass]);

  const classSlots = useMemo(() => {
    if (!data) return [];
    const ids = new Set(classCourses.map((course) => course.id));
    return data.slots.filter((slot) => ids.has(slot.annualCourseId));
  }, [data, classCourses]);

  const writable = Boolean(
    currentClass &&
      isClassScheduleWritable({
        classIsActive: currentClass.isActive,
        classIsArchived: currentClass.isArchived,
        yearStatus: currentYear?.status,
      }),
  );

  async function postAction(body: Record<string, unknown>) {
    const response = await fetch("/api/admin/course-schedule", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.reason ?? "Action impossible.");
    }
    return payload;
  }

  async function submitDraft(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setError("");
    try {
      await postAction({
        action: draft.slotId ? "update" : "create",
        id: draft.slotId ?? undefined,
        annualCourseId: draft.annualCourseId,
        dayOfWeek: draft.dayOfWeek,
        periodStart: draft.periodStart,
        periodEnd: draft.periodEnd,
        weekKind: draft.weekKind,
      });
      onNotice(draft.slotId ? "Créneau mis à jour." : "Créneau ajouté.");
      setDraft(null);
      await refresh();
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "Enregistrement impossible.");
    }
  }

  async function removeSlot(id: string) {
    setError("");
    try {
      await postAction({ action: "delete", id });
      onNotice("Créneau supprimé.");
      if (draft?.slotId === id) setDraft(null);
      await refresh();
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "Suppression impossible.");
    }
  }

  if (loading) return <p className="admin-loading">Chargement de l’horaire des classes…</p>;
  if (!data) return <p className="admin-error">{error || "Données indisponibles."}</p>;

  const profession = currentClass
    ? data.professions.find((entry) => entry.id === currentClass.professionId)
    : null;
  const preview = currentClass
    ? buildClassSchedulePreview({
        schoolClass: currentClass,
        profession,
        slots: classSlots,
        courses: data.courses,
        yearStatus: currentYear?.status,
      })
    : null;
  const yearSlots = data.slots.filter((slot) => {
    const course = data.courses.find((entry) => entry.id === slot.annualCourseId);
    return course?.schoolYearId === selectedYearId;
  });
  const globalGrid = buildGlobalDayGrid({
    dayOfWeek: globalDay,
    weekKind: globalWeek,
    slots: yearSlots,
    courses: data.courses,
    classes: yearClasses.filter((entry) => !entry.isArchived),
    contexts: data.contexts,
    branches: data.branches,
    yearStatus: currentYear?.status,
  });

  return (
    <div className="admin-panel-block class-schedule-admin">
      <header className="config-section-header">
        <div>
          <h3>Horaire des classes</h3>
          <p>
            Les créneaux sont configurés sur chaque cours annuel. L’horaire affiché est généré
            automatiquement. L’enseignant reste défini uniquement dans Attributions des cours.
          </p>
        </div>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="class-schedule-filters admin-inline-form">
        <label>
          Année scolaire
          <select value={selectedYearId} onChange={(event) => setSelectedYearId(event.target.value)}>
            {data.schoolYears.map((year) => (
              <option key={year.id} value={year.id}>
                {year.label}
                {year.status === "archived" ? " (archivée)" : ""}
              </option>
            ))}
          </select>
        </label>
        {view !== "global" ? (
          <label>
            Classe
            <select
              value={currentClass?.id ?? ""}
              onChange={(event) => setSelectedClassId(event.target.value)}
            >
              {yearClasses.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.code}
                  {!entry.isActive ? " (inactive)" : ""}
                  {entry.isArchived ? " (archivée)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              Jour
              <select
                value={globalDay}
                onChange={(event) => setGlobalDay(Number(event.target.value) as CourseWeekday)}
              >
                {([1, 2, 3, 4, 5] as const).map((day) => (
                  <option key={day} value={day}>
                    {COURSE_WEEKDAY_LABELS[day]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Semaine
              <select
                value={globalWeek}
                onChange={(event) => setGlobalWeek(event.target.value as CourseWeekKind)}
              >
                {COURSE_WEEK_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {COURSE_WEEK_KIND_LONG_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <div className="admin-teacher-toolbar">
        <button type="button" className={view === "config" ? "is-selected" : undefined} onClick={() => setView("config")}>
          Configuration des cours
        </button>
        <button type="button" className={view === "preview" ? "is-selected" : undefined} onClick={() => setView("preview")}>
          Aperçu horaire
        </button>
        <button type="button" className={view === "global" ? "is-selected" : undefined} onClick={() => setView("global")}>
          Vue globale
        </button>
      </div>

      {view !== "global" && currentClass ? (
        <div className="class-schedule-class-heading">
          <strong>{currentClass.code}</strong>
          <p>
            {classDisplayProfessionLabel(currentClass, profession)} —{" "}
            {classDisplayTrainingYearLabel(currentClass.trainingYear)}
          </p>
        </div>
      ) : null}

      {view === "config" ? (
        <>
          <p className="class-schedule-hint">
            L’enseignant est défini dans Attributions des cours.
            <button type="button" className="admin-link-button" onClick={onOpenAssignments}>
              Gérer les attributions
            </button>
          </p>
          {!writable ? (
            <p className="admin-loading">
              {currentYear?.status === "archived"
                ? "Année scolaire archivée — lecture seule."
                : currentClass?.isArchived
                  ? "Classe archivée — lecture seule."
                  : currentClass && !currentClass.isActive
                    ? "Classe inactive — consultation uniquement, aucun nouveau créneau opérationnel."
                    : "Sélectionnez une classe."}
            </p>
          ) : null}

          {!currentClass ? (
            <p className="admin-loading">Aucune classe pour cette année scolaire.</p>
          ) : classCourses.length === 0 ? (
            <p className="admin-loading">
              Aucun cours annuel pour cette classe. Créez d’abord les cours dans Attributions des cours.
            </p>
          ) : (
            <div className="class-schedule-table-wrap">
              <table className="annual-course-table class-schedule-table">
                <thead>
                  <tr>
                    <th>Branche</th>
                    <th>Enseignant</th>
                    <th>Jour</th>
                    <th>Périodes</th>
                    <th>Semaine</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {classCourses.map((course) => {
                    const branch = branchForCourse(course, data.contexts, data.branches);
                    const teachers = teachersForAnnualCourse(data.assignments, data.teachers, course.id);
                    const slots = data.slots
                      .filter((slot) => slot.annualCourseId === course.id)
                      .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.periodStart - right.periodStart);
                    const courseWritable = writable && !course.isArchived;
                    const teacherLine = formatTeachersLine(teachers);
                    if (slots.length === 0) {
                      return (
                        <tr key={course.id}>
                          <td>
                            <strong>{branch?.label ?? "Branche"}</strong>
                            {course.isArchived ? <div className="admin-teacher-login-meta">Cours archivé</div> : null}
                          </td>
                          <td className={teachers.length ? undefined : "class-schedule-no-teacher"}>{teacherLine}</td>
                          <td colSpan={3} className="admin-teacher-login-meta">
                            Aucun créneau
                          </td>
                          <td>
                            {courseWritable ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft({
                                    slotId: null,
                                    annualCourseId: course.id,
                                    dayOfWeek: 4,
                                    periodStart: 1,
                                    periodEnd: 2,
                                    weekKind: "all",
                                  })
                                }
                              >
                                + Ajouter un créneau
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    }
                    return slots.map((slot, index) => (
                      <tr key={slot.id}>
                        <td>
                          {index === 0 ? (
                            <>
                              <strong>{branch?.label ?? "Branche"}</strong>
                              {course.isArchived ? <div className="admin-teacher-login-meta">Cours archivé</div> : null}
                            </>
                          ) : (
                            <span className="admin-teacher-login-meta">{branch?.label}</span>
                          )}
                        </td>
                        <td className={teachers.length ? undefined : "class-schedule-no-teacher"}>
                          {index === 0 ? teacherLine : ""}
                        </td>
                        <td>{COURSE_WEEKDAY_LABELS[slot.dayOfWeek]}</td>
                        <td>{formatPeriodRange(slot.periodStart, slot.periodEnd)}</td>
                        <td>{COURSE_WEEK_KIND_LABELS[slot.weekKind]}</td>
                        <td>
                          {courseWritable ? (
                            <div className="class-schedule-row-actions">
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft({
                                    slotId: slot.id,
                                    annualCourseId: course.id,
                                    dayOfWeek: slot.dayOfWeek,
                                    periodStart: slot.periodStart,
                                    periodEnd: slot.periodEnd,
                                    weekKind: slot.weekKind,
                                  })
                                }
                              >
                                Modifier
                              </button>
                              <button type="button" onClick={() => void removeSlot(slot.id)}>
                                Supprimer
                              </button>
                              {index === slots.length - 1 ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraft({
                                      slotId: null,
                                      annualCourseId: course.id,
                                      dayOfWeek: slot.dayOfWeek,
                                      periodStart: 1,
                                      periodEnd: 2,
                                      weekKind: "all",
                                    })
                                  }
                                >
                                  + Ajouter un créneau
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          )}

          {draft ? (
            <form className="class-schedule-slot-form admin-inline-form" onSubmit={(event) => void submitDraft(event)}>
              <p className="class-schedule-form-title">
                {draft.slotId ? "Modifier le créneau" : "Ajouter un créneau"}
              </p>
              <label>
                Jour
                <select
                  value={draft.dayOfWeek}
                  onChange={(event) =>
                    setDraft({ ...draft, dayOfWeek: Number(event.target.value) as CourseWeekday })
                  }
                >
                  {([1, 2, 3, 4, 5] as const).map((day) => (
                    <option key={day} value={day}>
                      {COURSE_WEEKDAY_LABELS[day]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Début
                <select
                  value={draft.periodStart}
                  onChange={(event) => {
                    const periodStart = Number(event.target.value);
                    const ends = allowedPeriodEnds(periodStart);
                    const periodEnd = ends.includes(draft.periodEnd) ? draft.periodEnd : (ends[0] ?? periodStart);
                    setDraft({ ...draft, periodStart, periodEnd });
                  }}
                >
                  {TEACHABLE_PERIODS.map((period) => (
                    <option key={period} value={period}>
                      P{period}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fin
                <select
                  value={draft.periodEnd}
                  onChange={(event) => setDraft({ ...draft, periodEnd: Number(event.target.value) })}
                >
                  {allowedPeriodEnds(draft.periodStart).map((period) => (
                    <option key={period} value={period}>
                      P{period}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rythme
                <select
                  value={draft.weekKind}
                  onChange={(event) => setDraft({ ...draft, weekKind: event.target.value as CourseWeekKind })}
                >
                  {COURSE_WEEK_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {COURSE_WEEK_KIND_LONG_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="workspace-action">
                Enregistrer
              </button>
              <button type="button" onClick={() => setDraft(null)}>
                Annuler
              </button>
            </form>
          ) : null}
        </>
      ) : null}

      {view === "preview" ? (
        !currentClass ? (
          <p className="admin-loading">Aucune classe pour cette année scolaire.</p>
        ) : !preview || preview.days.length === 0 ? (
          <p className="admin-loading">Aucun créneau configuré pour cette classe.</p>
        ) : (
          <div className="class-schedule-preview">
            {preview.days.map((day) => (
              <section key={day.dayOfWeek} className="class-schedule-day">
                <h4>
                  {preview.classCode} — {day.dayLabel.toUpperCase()}
                </h4>
                <ul>
                  {day.blocks.map((block) => {
                    if (block.kind === "lunch") {
                      return (
                        <li key="lunch" className="class-schedule-lunch">
                          <span className="class-schedule-period">5</span>
                          <span>🍴 Pause de midi</span>
                        </li>
                      );
                    }
                    const labels = block.slots.map((slot) => {
                      const course = data.courses.find((entry) => entry.id === slot.annualCourseId);
                      const branch = course
                        ? branchForCourse(course, data.contexts, data.branches)
                        : undefined;
                      const teachers = course
                        ? teachersForAnnualCourse(data.assignments, data.teachers, course.id)
                        : [];
                      return {
                        id: slot.id,
                        branch: branch?.label ?? "Branche",
                        teachers: formatTeachersLine(teachers),
                        week: COURSE_WEEK_KIND_LABELS[slot.weekKind],
                      };
                    });
                    return (
                      <li key={`${block.periodStart}-${block.periodEnd}`}>
                        <span className="class-schedule-period">
                          {formatPeriodRange(block.periodStart, block.periodEnd)}
                        </span>
                        <div>
                          {labels.map((entry) => (
                            <p key={entry.id}>
                              <strong>{entry.branch}</strong>
                              <span>
                                {" "}
                                · {entry.teachers} · {entry.week}
                              </span>
                            </p>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : null}

      {view === "global" ? (
        <div className="class-schedule-global">
          <h4>
            {COURSE_WEEKDAY_LABELS[globalDay].toUpperCase()} —{" "}
            {globalWeek === "all" ? "TOUTES LES SEMAINES" : `SEMAINE ${globalWeek}`}
          </h4>
          {globalGrid.classColumns.length === 0 ? (
            <p className="admin-loading">Aucune classe pour cette année scolaire.</p>
          ) : (
            <div className="class-schedule-global-wrap">
              <table className="class-schedule-global-table">
                <thead>
                  <tr>
                    <th>Période</th>
                    {globalGrid.classColumns.map((column) => (
                      <th key={column.classId}>{column.classCode}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {globalGrid.rows.map((row) =>
                    row.kind === "lunch" ? (
                      <tr key="lunch" className="class-schedule-lunch-row">
                        <td>5</td>
                        <td colSpan={Math.max(globalGrid.classColumns.length, 1)}>🍴 Pause de midi</td>
                      </tr>
                    ) : (
                      <tr key={row.period}>
                        <td>{row.period}</td>
                        {row.cells.map((cell) => (
                          <td key={cell.classId}>
                            {cell.entries.length === 0
                              ? ""
                              : cell.entries
                                  .map((entry) =>
                                    entry.weekKind === "all"
                                      ? entry.branchLabel
                                      : `${entry.branchLabel} (${entry.weekKindLabel})`,
                                  )
                                  .join(" / ")}
                          </td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
