"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type { AnnualCourse, TeacherCourseAssignment } from "@campus/features/annual-courses/types.ts";
import {
  ADDITIONAL_RHYTHM_CHOICES,
  COURSE_WEEKDAY_LABELS,
  COURSE_WEEK_KIND_LONG_LABELS,
  COURSE_WEEK_KINDS,
  TEACHABLE_PERIODS,
  allowedPeriodEnds,
  attendanceDraftIsComplete,
  attendanceInputsFromDraft,
  attendanceOptionsForSlotForm,
  buildAttendanceRhythmSummary,
  buildAttendanceWeekPreview,
  buildClassScheduleTemplate,
  buildGlobalDayGrid,
  daysPresentInAAndB,
  filterSlotsForScheduleView,
  formatAttendancePresenceDetail,
  formatSlotRhythmLabel,
  formatTeachersLine,
  formatTemplatePeriod,
  groupSlotsByAnnualCourse,
  isClassScheduleWritable,
  nextAdditionalDraftDay,
  scheduleEditorStateAfterYearChange,
  slotRoleBadge,
  suggestAttendanceDraftFromSlots,
  teachersForAnnualCourse,
  usedAttendanceWeekdays,
  type AttendanceEditorDraft,
  type ClassAttendanceDay,
  type ClassAttendanceDayInput,
  type CourseScheduleSlot,
  type CourseWeekKind,
  type CourseWeekday,
} from "@campus/features/course-schedule/index.ts";
import {
  formatCourseSessionPeriods,
  formatSwissDate,
  type CourseSession,
} from "@campus/features/course-sessions/index.ts";
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

type PanelView = "main" | "global" | "dates";
type PreviewMode = "template" | "A" | "B";

interface SlotDraft {
  slotId: string | null;
  annualCourseId: string;
  dayOfWeek: CourseWeekday;
  periodStart: number;
  periodEnd: number;
  weekKind: CourseWeekKind;
}

type AttendanceDraft = AttendanceEditorDraft;

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
  const [view, setView] = useState<PanelView>("main");
  const [selectedYearId, setSelectedYearId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [globalDay, setGlobalDay] = useState<CourseWeekday>(4);
  const [globalWeek, setGlobalWeek] = useState<CourseWeekKind>("A");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("template");
  const [draft, setDraft] = useState<SlotDraft | null>(null);
  const [editingDays, setEditingDays] = useState(false);
  const [attendanceDraft, setAttendanceDraft] = useState<AttendanceDraft>({
    primaryDay: "",
    additional: [],
  });
  const [datesClassId, setDatesClassId] = useState("");
  const [datesCourseId, setDatesCourseId] = useState("");
  const [dateSessions, setDateSessions] = useState<CourseSession[]>([]);
  const [datesLoading, setDatesLoading] = useState(false);

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
    queueMicrotask(() => {
    void refresh()
      .then((payload) => {
        const active = payload.schoolYears.find((year) => year.status === "active") ?? payload.schoolYears[0];
        if (active) setSelectedYearId((current) => current || active.id);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
      })
      .finally(() => setLoading(false));
    });
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

  const datesCourses = useMemo(() => {
    if (!data) return [];
    return data.courses
      .filter((course) => {
        if (course.schoolYearId !== selectedYearId) return false;
        if (datesClassId && course.classId !== datesClassId) return false;
        if (currentYear?.status !== "archived" && course.isArchived) return false;
        return true;
      })
      .sort((left, right) => {
        const leftLabel = branchForCourse(left, data.contexts, data.branches)?.label ?? "";
        const rightLabel = branchForCourse(right, data.contexts, data.branches)?.label ?? "";
        return leftLabel.localeCompare(rightLabel, "fr-CH");
      });
  }, [data, selectedYearId, datesClassId, currentYear?.status]);

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
  const draftAttendanceInputs = attendanceInputsFromDraft(attendanceDraft);
  const abHintDays = daysPresentInAAndB(editingDays ? draftAttendanceInputs : classAttendance);
  const rhythmSummary = buildAttendanceRhythmSummary(
    editingDays ? draftAttendanceInputs : classAttendance,
  );
  const viewSlots = filterSlotsForScheduleView({
    slots: classSlots,
    courses: classCourses,
    yearStatus: currentYear?.status,
  });
  const courseGroups = groupSlotsByAnnualCourse(classCourses, data?.slots ?? []);
  const template = buildClassScheduleTemplate({
    days: classAttendance,
    slots: viewSlots,
  });

  function handleYearChange(nextYearId: string) {
    const next = scheduleEditorStateAfterYearChange(nextYearId);
    setSelectedYearId(next.selectedYearId);
    setSelectedClassId(next.selectedClassId);
    setEditingDays(next.editingDays);
    setAttendanceDraft(next.attendanceDraft);
    setDraft(next.slotDraft);
    setError(next.error);
    setDatesClassId("");
    setDatesCourseId("");
  }

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
    if (!currentClass || !attendanceDraftIsComplete(attendanceDraft)) return;
    setError("");
    const days: ClassAttendanceDayInput[] = attendanceInputsFromDraft(attendanceDraft);
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

  useEffect(() => {
    if (view !== "dates" || !selectedYearId) return;
    let cancelled = false;
    const params = new URLSearchParams({ schoolYearId: selectedYearId });
    if (datesClassId) params.set("classId", datesClassId);
    if (datesCourseId && datesCourses.some((entry) => entry.id === datesCourseId)) {
      params.set("annualCourseId", datesCourseId);
    }
    queueMicrotask(() => {
      if (cancelled) return;
      setDatesLoading(true);
      void fetch(`/api/admin/course-sessions?${params.toString()}`, { credentials: "include" })
        .then(async (response) => {
          const payload = (await response.json()) as { ok: boolean; reason?: string; sessions?: CourseSession[] };
          if (!response.ok || !payload.ok) {
            throw new Error(payload.reason ?? "Chargement des dates réelles impossible.");
          }
          if (!cancelled) {
            setDateSessions(payload.sessions ?? []);
            setError("");
          }
        })
        .catch((loadError: unknown) => {
          if (!cancelled) {
            setDateSessions([]);
            setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
          }
        })
        .finally(() => {
          if (!cancelled) setDatesLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [view, selectedYearId, datesClassId, datesCourseId, datesCourses]);

  if (loading) return <p className="admin-loading">Chargement de l’horaire des classes…</p>;
  if (!data) return <p className="admin-error">{error || "Données indisponibles."}</p>;

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
    options: { showWeekKind: boolean } = { showWeekKind: false },
  ) {
    if (empty) return <p className="class-schedule-empty">Aucun cours configuré</p>;
    return (
      <ul>
        {blocks.map((block) => {
          if (block.kind === "lunch") {
            return (
              <li key="lunch" className="class-schedule-lunch">
                <span className="class-schedule-period">{formatTemplatePeriod(5, 5)}</span>
                <span>Pause de midi</span>
              </li>
            );
          }
          const labels = block.slots.map((slot) => {
            const course = data!.courses.find((entry) => entry.id === slot.annualCourseId);
            const branch = course ? branchForCourse(course, data!.contexts, data!.branches) : undefined;
            return {
              id: slot.id,
              branch: branch?.label ?? "Branche",
              weekKind: slot.weekKind,
            };
          });
          return (
            <li key={`${block.periodStart}-${block.periodEnd}`}>
              <span className="class-schedule-period">
                {formatTemplatePeriod(block.periodStart, block.periodEnd)}
              </span>
              <div>
                {labels.map((entry) => (
                  <p key={entry.id}>
                    <strong>{entry.branch}</strong>
                    {options.showWeekKind && entry.weekKind !== "all" ? (
                      <span className="class-schedule-week-chip"> · {entry.weekKind}</span>
                    ) : null}
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
          <h3>{view === "dates" ? "Dates réelles des cours" : "Horaire des classes"}</h3>
          <p>
            {view === "dates"
              ? "Ces dates sont calculées automatiquement à partir de l’année scolaire et de l’horaire."
              : "Les jours de cours définissent la présence de la classe. Les créneaux placent les branches. L’enseignant reste défini uniquement dans Attributions des cours."}
          </p>
        </div>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="class-schedule-filters admin-inline-form">
        <label>
          Année scolaire
          <select value={selectedYearId} onChange={(event) => handleYearChange(event.target.value)}>
            {data.schoolYears.map((year) => (
              <option key={year.id} value={year.id}>
                {year.label}
                {year.status === "archived" ? " (archivée)" : ""}
              </option>
            ))}
          </select>
        </label>
        {view === "dates" ? (
          <>
            <label>
              Classe
              <select
                value={datesClassId}
                onChange={(event) => {
                  setDatesClassId(event.target.value);
                  setDatesCourseId("");
                }}
              >
                <option value="">Toutes les classes</option>
                {yearClasses.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.code}
                    {!entry.isActive ? " (inactive)" : ""}
                    {entry.isArchived ? " (archivée)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cours / branche
              <select value={datesCourseId} onChange={(event) => setDatesCourseId(event.target.value)}>
                <option value="">Tous les cours</option>
                {datesCourses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {branchForCourse(course, data.contexts, data.branches)?.label ?? "Branche"}
                    {datesClassId
                      ? ""
                      : ` · ${data.classes.find((entry) => entry.id === course.classId)?.code ?? ""}`}
                    {course.isArchived ? " (archivé)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : view !== "global" ? (
          <label>
            Classe
            <select
              value={currentClass?.id ?? ""}
              onChange={(event) => {
                setSelectedClassId(event.target.value);
                setEditingDays(false);
                setDraft(null);
                setAttendanceDraft({ primaryDay: "", additional: [] });
                setError("");
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
        <button type="button" className={view === "main" ? "active" : undefined} onClick={() => setView("main")}>
          Horaire de la classe
        </button>
        <button type="button" className={view === "global" ? "active" : undefined} onClick={() => setView("global")}>
          Vue globale
        </button>
        <button
          type="button"
          className={view === "dates" ? "active" : undefined}
          onClick={() => {
            setView("dates");
            setDatesClassId((current) => current || currentClass?.id || "");
            setError("");
          }}
        >
          Dates réelles
        </button>
      </div>

      {view === "dates" ? (
        <div className="class-schedule-dates">
          {datesLoading ? (
            <p className="admin-loading">Calcul des dates réelles…</p>
          ) : dateSessions.length === 0 ? (
            <p className="class-schedule-empty">Aucune séance calculée pour ces filtres.</p>
          ) : (
            <div className="class-schedule-table-wrap">
              <table className="class-schedule-dates-table">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Date</th>
                    <th>Semaine</th>
                    <th>Type A/B</th>
                    <th>Jour</th>
                    <th>Branche</th>
                    <th>Périodes</th>
                    <th>Enseignant(s)</th>
                  </tr>
                </thead>
                <tbody>
                  {dateSessions.map((session) => {
                    const sessionCourse = data.courses.find((entry) => entry.id === session.annualCourseId);
                    const branchLabel = sessionCourse
                      ? (branchForCourse(sessionCourse, data.contexts, data.branches)?.label ?? "Branche")
                      : "Branche";
                    const teachers = teachersForAnnualCourse(
                      data.assignments,
                      data.teachers,
                      session.annualCourseId,
                      `${session.date}T12:00:00.000Z`,
                    );
                    return (
                      <tr key={session.key}>
                        <td>{session.sequenceNumber}</td>
                        <td>{formatSwissDate(session.date)}</td>
                        <td>{session.schoolWeekNumber}</td>
                        <td>{session.weekKind}</td>
                        <td>{COURSE_WEEKDAY_LABELS[session.dayOfWeek]}</td>
                        <td>{branchLabel}</td>
                        <td>{formatCourseSessionPeriods(session.segments)}</td>
                        <td>{formatTeachersLine(teachers)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : view === "global" ? (
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
                    <div key={`${entry.dayOfWeek}-${index}`} className="class-schedule-additional-row">
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
                      <div>
                        <span className="class-schedule-form-title">Rythme de présence</span>
                        <div className="class-schedule-rhythm-radios">
                          {ADDITIONAL_RHYTHM_CHOICES.map((kind) => (
                            <label
                              key={kind}
                              className={entry.weekKind === kind ? "is-selected" : undefined}
                            >
                              <input
                                type="radio"
                                name={`additional-week-${index}`}
                                checked={entry.weekKind === kind}
                                onChange={() => {
                                  const next = [...attendanceDraft.additional];
                                  next[index] = { ...entry, weekKind: kind };
                                  setAttendanceDraft({ ...attendanceDraft, additional: next });
                                }}
                              />
                              {COURSE_WEEK_KIND_LONG_LABELS[kind]}
                            </label>
                          ))}
                        </div>
                        {entry.weekKind === "" ? (
                          <p className="class-schedule-empty">Choisir…</p>
                        ) : null}
                      </div>
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
                          nextAdditionalDraftDay(attendanceDraft.primaryDay, attendanceDraft.additional),
                        ],
                      })
                    }
                  >
                    + Ajouter un jour complémentaire
                  </button>
                  {attendanceDraft.primaryDay ? (
                    <div className="class-schedule-rhythm-preview">
                      <h5>Aperçu du rythme</h5>
                      <p>
                        Semaine A → <strong>{rhythmSummary.weekALine}</strong>
                      </p>
                      <p>
                        Semaine B → <strong>{rhythmSummary.weekBLine}</strong>
                      </p>
                    </div>
                  ) : null}
                  <div className="admin-inline-form">
                    <button
                      type="submit"
                      className="workspace-action"
                      disabled={!writable || !attendanceDraftIsComplete(attendanceDraft)}
                    >
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
                        <span>{COURSE_WEEKDAY_LABELS[day.dayOfWeek]}</span>
                        <span>{formatAttendancePresenceDetail(day)}</span>
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
                        <th>Créneaux</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {courseGroups.map(({ course, slots }) => {
                        const branch = branchForCourse(course, data.contexts, data.branches);
                        const teachers = teachersForAnnualCourse(data.assignments, data.teachers, course.id);
                        const courseWritable = writable && attendanceConfigured && !course.isArchived;
                        const teacherLine = formatTeachersLine(teachers);
                        const editingThis = draft?.annualCourseId === course.id;
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
                            <td>
                              {slots.length === 0 ? (
                                <span className="admin-teacher-login-meta">Aucun créneau</span>
                              ) : (
                                <ul className="class-schedule-slot-lines">
                                  {slots.map((slot) => {
                                    const badge = slotRoleBadge(slot, classAttendance);
                                    return (
                                      <li key={slot.id}>
                                        <span>
                                          {formatSlotRhythmLabel(slot)}
                                          {" · "}
                                          {formatTemplatePeriod(slot.periodStart, slot.periodEnd)}
                                          {badge ? (
                                            <span className="class-schedule-role-badge">{badge}</span>
                                          ) : null}
                                        </span>
                                        {courseWritable ? (
                                          <div className="class-schedule-row-actions">
                                            <button type="button" onClick={() => openSlotDraft(course, slot)}>
                                              Modifier
                                            </button>
                                            <button type="button" onClick={() => void removeSlot(slot.id)}>
                                              Supprimer
                                            </button>
                                          </div>
                                        ) : null}
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              {editingThis && attendanceConfigured ? (
                                <form
                                  className="class-schedule-slot-form admin-inline-form"
                                  onSubmit={(event) => void submitDraft(event)}
                                >
                                  <p className="class-schedule-form-title">
                                    {draft.slotId ? "Modifier le créneau" : "Ajouter un créneau"}
                                  </p>
                                  <p className="class-schedule-meta">
                                    Branche : <strong>{branch?.label ?? "Branche"}</strong>
                                  </p>
                                  <label>
                                    Jour
                                    <select
                                      value={draft.dayOfWeek}
                                      onChange={(event) => {
                                        const dayOfWeek = Number(event.target.value) as CourseWeekday;
                                        const kinds =
                                          slotDayOptions.find((entry) => entry.dayOfWeek === dayOfWeek)?.weekKinds ??
                                          [];
                                        const weekKind = kinds.includes(draft.weekKind)
                                          ? draft.weekKind
                                          : (kinds[0] ?? "all");
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
                                  {draftWeekKinds.length === 1 ? (
                                    <p className="class-schedule-readonly">
                                      Rythme : {COURSE_WEEK_KIND_LONG_LABELS[draftWeekKinds[0]!]}
                                    </p>
                                  ) : (
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
                                  )}
                                  <label>
                                    Début
                                    <select
                                      value={draft.periodStart}
                                      onChange={(event) => {
                                        const periodStart = Number(event.target.value);
                                        const ends = allowedPeriodEnds(periodStart);
                                        const periodEnd = ends.includes(draft.periodEnd)
                                          ? draft.periodEnd
                                          : (ends[0] ?? periodStart);
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
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="class-schedule-col-right">
            <section className="class-schedule-section">
              <h4>3. Aperçu horaire généré</h4>
              {!attendanceConfigured && classSlots.length > 0 ? (
                <p className="class-schedule-hint">
                  Horaire existant (lecture) — configurez d’abord les jours de cours.
                </p>
              ) : null}
              {attendanceConfigured || classSlots.length > 0 ? (
                <>
                  {attendanceConfigured || editingDays ? (
                    <div className="class-schedule-summary-pair">
                      <div className="class-schedule-summary-card">
                        <span>Semaine A</span>
                        <strong>{rhythmSummary.weekALine}</strong>
                      </div>
                      <div className="class-schedule-summary-card">
                        <span>Semaine B</span>
                        <strong>{rhythmSummary.weekBLine}</strong>
                      </div>
                    </div>
                  ) : null}
                  <div className="class-schedule-preview-tabs">
                    <button
                      type="button"
                      className={previewMode === "template" ? "is-selected" : undefined}
                      onClick={() => setPreviewMode("template")}
                    >
                      Trame
                    </button>
                    <button
                      type="button"
                      className={previewMode === "A" ? "is-selected" : undefined}
                      onClick={() => setPreviewMode("A")}
                    >
                      Semaine A
                    </button>
                    <button
                      type="button"
                      className={previewMode === "B" ? "is-selected" : undefined}
                      onClick={() => setPreviewMode("B")}
                    >
                      Semaine B
                    </button>
                  </div>
                  {previewMode === "template" ? (
                    template.days.length === 0 ? (
                      <p className="class-schedule-empty">Aucun jour de cours configuré.</p>
                    ) : (
                      <div className="class-schedule-template">
                        {template.days.map((day) => (
                          <div key={day.dayOfWeek} className="class-schedule-template-day class-schedule-day">
                            <h4>{day.dayLabel.toUpperCase()}</h4>
                            <p className="class-schedule-template-meta">
                              {day.coverageLabel}
                              {day.roleLabel ? ` · ${day.roleLabel}` : ""}
                            </p>
                            {renderDayBlocks(day.blocks, day.blocks.every((block) => block.kind !== "course"), {
                              showWeekKind: true,
                            })}
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    (() => {
                      const preview = previewMode === "A" ? previewA : previewB;
                      if (!preview || preview.days.length === 0) {
                        return <p className="class-schedule-empty">Aucun jour de présence.</p>;
                      }
                      return (
                        <div className="class-schedule-day">
                          {preview.days.map((day) => (
                            <div key={`${preview.weekKind}-${day.dayOfWeek}`}>
                              <h4>
                                {day.roleLabel ? `${day.dayLabel} — ${day.roleLabel}` : day.dayLabel}
                              </h4>
                              {renderDayBlocks(day.blocks, day.empty)}
                            </div>
                          ))}
                        </div>
                      );
                    })()
                  )}
                </>
              ) : (
                <p className="class-schedule-empty">
                  {attendanceConfigured ? "Aucun jour de présence." : "Aucun jour de cours configuré."}
                </p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
