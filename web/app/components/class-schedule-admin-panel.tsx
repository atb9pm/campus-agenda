"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type { AnnualCourse, TeacherCourseAssignment } from "@campus/features/annual-courses/types.ts";
import {
  COURSE_WEEKDAY_LABELS,
  COURSE_WEEK_KIND_LONG_LABELS,
  COURSE_WEEK_KINDS,
  TEACHABLE_PERIODS,
  allowedPeriodEnds,
  attendanceOptionsForSlotForm,
  buildAttendanceWeekPreview,
  buildClassSchedulePreview,
  buildGlobalDayGrid,
  daysPresentInAAndB,
  formatPeriodRange,
  formatSlotDayBadge,
  formatTeachersLine,
  isClassScheduleWritable,
  suggestAttendanceDraftFromSlots,
  teachersForAnnualCourse,
  usedAttendanceWeekdays,
  type ClassAttendanceDay,
  type ClassAttendanceDayInput,
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
  attendanceDays: ClassAttendanceDay[];
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  classes: SchoolClassRecord[];
  branches: SchoolBranchRecord[];
  professions: SchoolProfessionRecord[];
  contexts: PedagogicalContextRecord[];
  schoolYears: Array<{ id: string; label: string; status: "draft" | "active" | "archived" }>;
  teachers: TeacherSummary[];
}

type PanelView = "main" | "global";

interface SlotDraft {
  slotId: string | null;
  annualCourseId: string;
  dayOfWeek: CourseWeekday;
  periodStart: number;
  periodEnd: number;
  weekKind: CourseWeekKind;
}

interface AttendanceDraft {
  primaryDay: CourseWeekday | "";
  additional: Array<{ dayOfWeek: CourseWeekday; weekKind: CourseWeekKind }>;
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

function nextAdditionalDefault(
  primaryDay: CourseWeekday | "",
  additional: AttendanceDraft["additional"],
): { dayOfWeek: CourseWeekday; weekKind: CourseWeekKind } {
  const used = new Set<CourseWeekday>([
    ...(primaryDay ? [primaryDay] : []),
    ...additional.map((entry) => entry.dayOfWeek),
  ]);
  const free = ([1, 2, 3, 4, 5] as const).find((day) => !used.has(day));
  return { dayOfWeek: free ?? 4, weekKind: "all" };
}

export function ClassScheduleAdminPanel({ onNotice, onOpenAssignments }: ClassScheduleAdminPanelProps) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<PanelView>("main");
  const [selectedYearId, setSelectedYearId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [globalDay, setGlobalDay] = useState<CourseWeekday>(4);
  const [globalWeek, setGlobalWeek] = useState<CourseWeekKind>("A");
  const [draft, setDraft] = useState<SlotDraft | null>(null);
  const [editingDays, setEditingDays] = useState(false);
  const [attendanceDraft, setAttendanceDraft] = useState<AttendanceDraft>({
    primaryDay: "",
    additional: [],
  });

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/course-schedule", { credentials: "include" });
    const payload = (await response.json()) as OverviewPayload;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.reason ?? "Chargement de l’horaire impossible.");
    }
    setData({ ...payload, attendanceDays: payload.attendanceDays ?? [] });
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

  const classAttendance = useMemo(() => {
    if (!data || !currentClass) return [];
    return data.attendanceDays
      .filter((day) => day.classId === currentClass.id)
      .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.role.localeCompare(right.role));
  }, [data, currentClass]);

  const writable = Boolean(
    currentClass &&
      isClassScheduleWritable({
        classIsActive: currentClass.isActive,
        classIsArchived: currentClass.isArchived,
        yearStatus: currentYear?.status,
      }),
  );
  const attendanceConfigured = classAttendance.length > 0;
  const slotDayOptions = attendanceOptionsForSlotForm(classAttendance);
  const suggestedPrimary = suggestAttendanceDraftFromSlots(classSlots);
  const usedSlotDays = usedAttendanceWeekdays(classSlots);
  const abHintDays = daysPresentInAAndB(
    editingDays
      ? [
          ...(attendanceDraft.primaryDay
            ? [{ dayOfWeek: attendanceDraft.primaryDay, weekKind: "all" as const }]
            : []),
          ...attendanceDraft.additional,
        ]
      : classAttendance,
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

  function startAttendanceEditor() {
    const primary = classAttendance.find((day) => day.role === "PRIMARY");
    if (primary) {
      setAttendanceDraft({
        primaryDay: primary.dayOfWeek,
        additional: classAttendance
          .filter((day) => day.role === "ADDITIONAL")
          .map((day) => ({ dayOfWeek: day.dayOfWeek, weekKind: day.weekKind })),
      });
    } else if (suggestedPrimary) {
      setAttendanceDraft({
        primaryDay: suggestedPrimary[0]!.dayOfWeek,
        additional: [],
      });
    } else {
      setAttendanceDraft({ primaryDay: "", additional: [] });
    }
    setEditingDays(true);
    setDraft(null);
  }

  async function submitAttendance(event: FormEvent) {
    event.preventDefault();
    if (!currentClass || attendanceDraft.primaryDay === "") return;
    setError("");
    const days: ClassAttendanceDayInput[] = [
      { dayOfWeek: attendanceDraft.primaryDay, weekKind: "all", role: "PRIMARY" },
      ...attendanceDraft.additional.map((day) => ({
        dayOfWeek: day.dayOfWeek,
        weekKind: day.weekKind,
        role: "ADDITIONAL" as const,
      })),
    ];
    try {
      await postAction({
        action: "replaceAttendanceDays",
        classId: currentClass.id,
        days,
      });
      onNotice("Jours de cours enregistrés.");
      setEditingDays(false);
      await refresh();
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "Enregistrement impossible.");
    }
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

  function openSlotDraft(course: AnnualCourse, slot?: CourseScheduleSlot) {
    const defaultDay = slot?.dayOfWeek ?? slotDayOptions[0]?.dayOfWeek;
    if (!defaultDay) return;
    const kinds = slotDayOptions.find((entry) => entry.dayOfWeek === defaultDay)?.weekKinds ?? ["all"];
    const weekKind = slot?.weekKind && kinds.includes(slot.weekKind) ? slot.weekKind : (kinds[0] ?? "all");
    setDraft({
      slotId: slot?.id ?? null,
      annualCourseId: course.id,
      dayOfWeek: defaultDay,
      periodStart: slot?.periodStart ?? 1,
      periodEnd: slot?.periodEnd ?? 2,
      weekKind,
    });
  }

  if (loading) return <p className="admin-loading">Chargement de l’horaire des classes…</p>;
  if (!data) return <p className="admin-error">{error || "Données indisponibles."}</p>;

  const profession = currentClass
    ? data.professions.find((entry) => entry.id === currentClass.professionId)
    : null;
  const legacyPreview =
    currentClass && !attendanceConfigured
      ? buildClassSchedulePreview({
          schoolClass: currentClass,
          profession,
          slots: classSlots,
          courses: data.courses,
          yearStatus: currentYear?.status,
        })
      : null;
  const previewA = currentClass
    ? buildAttendanceWeekPreview({
        days: classAttendance,
        slots: classSlots,
        weekKind: "A",
        courses: data.courses,
        yearStatus: currentYear?.status,
      })
    : null;
  const previewB = currentClass
    ? buildAttendanceWeekPreview({
        days: classAttendance,
        slots: classSlots,
        weekKind: "B",
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
  const draftWeekKinds =
    draft ? (slotDayOptions.find((entry) => entry.dayOfWeek === draft.dayOfWeek)?.weekKinds ?? []) : [];
  const readOnlyReason =
    currentYear?.status === "archived"
      ? "Année scolaire archivée — lecture seule."
      : currentClass?.isArchived
        ? "Classe archivée — lecture seule."
        : currentClass && !currentClass.isActive
          ? "Classe inactive — consultation uniquement, aucun nouveau créneau opérationnel."
          : null;

  function renderDayBlocks(
    blocks: ReturnType<typeof buildAttendanceWeekPreview>["days"][number]["blocks"],
    empty: boolean,
  ) {
    if (empty) return <p className="class-schedule-empty">Aucun cours configuré</p>;
    return (
      <ul>
        {blocks.map((block) => {
          if (block.kind === "lunch") {
            return (
              <li key="lunch" className="class-schedule-lunch">
                <span className="class-schedule-period">P5</span>
                <span>Pause de midi</span>
              </li>
            );
          }
          const labels = block.slots.map((slot) => {
            const course = data!.courses.find((entry) => entry.id === slot.annualCourseId);
            const branch = course ? branchForCourse(course, data!.contexts, data!.branches) : undefined;
            const teachers = course
              ? teachersForAnnualCourse(data!.assignments, data!.teachers, course.id)
              : [];
            return {
              id: slot.id,
              branch: branch?.label ?? "Branche",
              teachers: formatTeachersLine(teachers),
            };
          });
          return (
            <li key={`${block.periodStart}-${block.periodEnd}`}>
              <span className="class-schedule-period">
                {block.periodStart === block.periodEnd
                  ? `P${block.periodStart}`
                  : `P${block.periodStart}–P${block.periodEnd}`}
              </span>
              <div>
                {labels.map((entry) => (
                  <p key={entry.id}>
                    <strong>{entry.branch}</strong>
                    <span> · {entry.teachers}</span>
                  </p>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="admin-panel-block class-schedule-admin">
      <header className="config-section-header">
        <div>
          <h3>Horaire des classes</h3>
          <p>
            Les jours de cours définissent la présence de la classe. Les créneaux placent les branches.
            L’enseignant reste défini uniquement dans Attributions des cours.
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
              onChange={(event) => {
                setSelectedClassId(event.target.value);
                setEditingDays(false);
                setDraft(null);
              }}
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

      <div className="class-schedule-toolbar">
        {view === "global" ? (
          <button type="button" onClick={() => setView("main")}>
            Horaire de la classe
          </button>
        ) : (
          <button type="button" onClick={() => setView("global")}>
            Vue globale
          </button>
        )}
      </div>

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
      ) : !currentClass ? (
        <p className="admin-loading">Aucune classe pour cette année scolaire.</p>
      ) : (
        <div className="class-schedule-layout">
          <div className="class-schedule-col-left">
            <section className="class-schedule-section">
              <h4>1. Jours de cours de la classe</h4>
              <p className="class-schedule-meta">
                Année scolaire : <strong>{currentYear?.label ?? "—"}</strong>
                <br />
                Classe : <strong>{currentClass.code}</strong>
              </p>
              {readOnlyReason ? <p className="admin-loading">{readOnlyReason}</p> : null}
              {editingDays ? (
                <form className="class-schedule-attendance-form" onSubmit={(event) => void submitAttendance(event)}>
                  <h5>Jour principal</h5>
                  <div className="admin-inline-form">
                    <label>
                      Jour
                      <select
                        value={attendanceDraft.primaryDay}
                        required
                        onChange={(event) =>
                          setAttendanceDraft({
                            ...attendanceDraft,
                            primaryDay: event.target.value
                              ? (Number(event.target.value) as CourseWeekday)
                              : "",
                          })
                        }
                      >
                        <option value="">Choisir…</option>
                        {([1, 2, 3, 4, 5] as const).map((day) => (
                          <option key={day} value={day}>
                            {COURSE_WEEKDAY_LABELS[day]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="class-schedule-meta">
                      Rythme : <strong>Toutes les semaines</strong>
                    </p>
                  </div>
                  {!attendanceConfigured && usedSlotDays.length > 1 ? (
                    <p className="admin-loading">
                      Plusieurs jours sont utilisés par les cours existants. Sélectionnez le jour principal.
                    </p>
                  ) : null}
                  <h5>Jours complémentaires</h5>
                  {attendanceDraft.additional.map((entry, index) => (
                    <div key={`${entry.dayOfWeek}-${entry.weekKind}-${index}`} className="class-schedule-additional-row">
                      <label>
                        Jour
                        <select
                          value={entry.dayOfWeek}
                          onChange={(event) => {
                            const next = [...attendanceDraft.additional];
                            next[index] = {
                              ...entry,
                              dayOfWeek: Number(event.target.value) as CourseWeekday,
                            };
                            setAttendanceDraft({ ...attendanceDraft, additional: next });
                          }}
                        >
                          {([1, 2, 3, 4, 5] as const).map((day) => (
                            <option key={day} value={day}>
                              {COURSE_WEEKDAY_LABELS[day]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Présence
                        <select
                          value={entry.weekKind}
                          onChange={(event) => {
                            const next = [...attendanceDraft.additional];
                            next[index] = {
                              ...entry,
                              weekKind: event.target.value as CourseWeekKind,
                            };
                            setAttendanceDraft({ ...attendanceDraft, additional: next });
                          }}
                        >
                          {COURSE_WEEK_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {COURSE_WEEK_KIND_LONG_LABELS[kind]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setAttendanceDraft({
                            ...attendanceDraft,
                            additional: attendanceDraft.additional.filter((_, other) => other !== index),
                          })
                        }
                      >
                        Retirer
                      </button>
                    </div>
                  ))}
                  {abHintDays.map((day) => (
                    <p key={day} className="class-schedule-hint">
                      {COURSE_WEEKDAY_LABELS[day]} est présent en A et B. Vous pouvez le simplifier en Toutes les
                      semaines.
                    </p>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setAttendanceDraft({
                        ...attendanceDraft,
                        additional: [
                          ...attendanceDraft.additional,
                          nextAdditionalDefault(attendanceDraft.primaryDay, attendanceDraft.additional),
                        ],
                      })
                    }
                  >
                    + Ajouter un jour complémentaire
                  </button>
                  <div className="admin-inline-form">
                    <button type="submit" className="workspace-action" disabled={!writable || !attendanceDraft.primaryDay}>
                      Enregistrer
                    </button>
                    <button type="button" onClick={() => setEditingDays(false)}>
                      Annuler
                    </button>
                  </div>
                </form>
              ) : !attendanceConfigured ? (
                <>
                  <p className="admin-loading">Les jours de cours de cette classe ne sont pas encore configurés.</p>
                  {usedSlotDays.length === 1 ? (
                    <p className="class-schedule-hint">
                      Les cours existants utilisent actuellement le {COURSE_WEEKDAY_LABELS[usedSlotDays[0]!].toLowerCase()}.
                    </p>
                  ) : usedSlotDays.length > 1 ? (
                    <p className="class-schedule-hint">
                      Les cours existants utilisent plusieurs jours. Sélectionnez le jour principal.
                    </p>
                  ) : null}
                  {writable ? (
                    <button type="button" className="workspace-action" onClick={startAttendanceEditor}>
                      Configurer les jours de cours
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <ul className="class-schedule-day-list">
                    {classAttendance.map((day) => (
                      <li key={day.id}>
                        <strong>
                          {day.role === "PRIMARY" ? "⭐ Jour principal" : "＋ Jour complémentaire"}
                        </strong>
                        <span>
                          {COURSE_WEEKDAY_LABELS[day.dayOfWeek]}
                          {" · "}
                          {COURSE_WEEK_KIND_LONG_LABELS[day.weekKind]}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {abHintDays.map((day) => (
                    <p key={day} className="class-schedule-hint">
                      {COURSE_WEEKDAY_LABELS[day]} est présent en A et B. Vous pouvez le simplifier en Toutes les
                      semaines.
                    </p>
                  ))}
                  {writable ? (
                    <button type="button" onClick={startAttendanceEditor}>
                      Modifier les jours de cours
                    </button>
                  ) : null}
                </>
              )}
            </section>

            <section className="class-schedule-section">
              <h4>2. Configuration des cours</h4>
              <p className="class-schedule-hint">
                L’enseignant est défini dans Attributions des cours.
                <button type="button" className="admin-link-button" onClick={onOpenAssignments}>
                  Gérer les attributions
                </button>
              </p>
              {classCourses.length === 0 ? (
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
                        <th>Jour de cours</th>
                        <th>Périodes</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classCourses.map((course) => {
                        const branch = branchForCourse(course, data.contexts, data.branches);
                        const teachers = teachersForAnnualCourse(data.assignments, data.teachers, course.id);
                        const slots = data.slots
                          .filter((slot) => slot.annualCourseId === course.id)
                          .sort(
                            (left, right) =>
                              left.dayOfWeek - right.dayOfWeek || left.periodStart - right.periodStart,
                          );
                        const courseWritable = writable && attendanceConfigured && !course.isArchived;
                        const teacherLine = formatTeachersLine(teachers);
                        if (slots.length === 0) {
                          return (
                            <tr key={course.id}>
                              <td>
                                <strong>{branch?.label ?? "Branche"}</strong>
                                {course.isArchived ? (
                                  <div className="admin-teacher-login-meta">Cours archivé</div>
                                ) : null}
                              </td>
                              <td className={teachers.length ? undefined : "class-schedule-no-teacher"}>
                                {teacherLine}
                              </td>
                              <td colSpan={2} className="admin-teacher-login-meta">
                                Aucun créneau
                              </td>
                              <td>
                                {courseWritable ? (
                                  <button type="button" onClick={() => openSlotDraft(course)}>
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
                                  {course.isArchived ? (
                                    <div className="admin-teacher-login-meta">Cours archivé</div>
                                  ) : null}
                                </>
                              ) : (
                                <span className="admin-teacher-login-meta">{branch?.label}</span>
                              )}
                            </td>
                            <td className={teachers.length ? undefined : "class-schedule-no-teacher"}>
                              {index === 0 ? teacherLine : ""}
                            </td>
                            <td>{formatSlotDayBadge(slot, classAttendance)}</td>
                            <td>{formatPeriodRange(slot.periodStart, slot.periodEnd)}</td>
                            <td>
                              {courseWritable ? (
                                <div className="class-schedule-row-actions">
                                  <button type="button" onClick={() => openSlotDraft(course, slot)}>
                                    Modifier
                                  </button>
                                  <button type="button" onClick={() => void removeSlot(slot.id)}>
                                    Supprimer
                                  </button>
                                  {index === slots.length - 1 ? (
                                    <button type="button" onClick={() => openSlotDraft(course)}>
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

              {draft && attendanceConfigured ? (
                <form className="class-schedule-slot-form admin-inline-form" onSubmit={(event) => void submitDraft(event)}>
                  <p className="class-schedule-form-title">
                    {draft.slotId ? "Modifier le créneau" : "Ajouter un créneau"}
                  </p>
                  <label>
                    Jour de cours
                    <select
                      value={draft.dayOfWeek}
                      onChange={(event) => {
                        const dayOfWeek = Number(event.target.value) as CourseWeekday;
                        const kinds =
                          slotDayOptions.find((entry) => entry.dayOfWeek === dayOfWeek)?.weekKinds ?? [];
                        const weekKind = kinds.includes(draft.weekKind) ? draft.weekKind : (kinds[0] ?? "all");
                        setDraft({ ...draft, dayOfWeek, weekKind });
                      }}
                    >
                      {slotDayOptions.map((option) => (
                        <option key={option.dayOfWeek} value={option.dayOfWeek}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Rythme du cours
                    <select
                      value={draft.weekKind}
                      onChange={(event) =>
                        setDraft({ ...draft, weekKind: event.target.value as CourseWeekKind })
                      }
                    >
                      {draftWeekKinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {COURSE_WEEK_KIND_LONG_LABELS[kind]}
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
                  <button type="submit" className="workspace-action">
                    Enregistrer
                  </button>
                  <button type="button" onClick={() => setDraft(null)}>
                    Annuler
                  </button>
                </form>
              ) : null}
            </section>
          </div>

          <div className="class-schedule-col-right">
            <section className="class-schedule-section">
              <h4>3. Aperçu horaire généré</h4>
              {!attendanceConfigured ? (
                legacyPreview && legacyPreview.days.length > 0 ? (
                  <div className="class-schedule-preview">
                    <p className="class-schedule-hint">Horaire existant (lecture) — configurez d’abord les jours de cours.</p>
                    {legacyPreview.days.map((day) => (
                      <section key={day.dayOfWeek} className="class-schedule-day">
                        <h4>
                          {legacyPreview.classCode} — {day.dayLabel}
                        </h4>
                        {renderDayBlocks(day.blocks, false)}
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="class-schedule-empty">Aucun jour de cours configuré.</p>
                )
              ) : (
                <div className="class-schedule-week-pair">
                  {[previewA, previewB].map((preview) =>
                    preview ? (
                      <section key={preview.weekKind} className="class-schedule-week-card">
                        <h4>SEMAINE {preview.weekKind}</h4>
                        {preview.days.length === 0 ? (
                          <p className="class-schedule-empty">Aucun jour de présence.</p>
                        ) : (
                          preview.days.map((day) => (
                            <div key={`${preview.weekKind}-${day.dayOfWeek}`} className="class-schedule-day">
                              <h4>
                                {day.dayLabel} — {day.roleLabel}
                              </h4>
                              {renderDayBlocks(day.blocks, day.empty)}
                            </div>
                          ))
                        )}
                      </section>
                    ) : null,
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
