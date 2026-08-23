"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ALL_FILTER, applySharedAgendaFilters, buildClassWorkloadSummary, canModifyPublication, DEMO_PROTOTYPE_ITEMS, filterItemsForSchoolWeek, WORKLOAD_LEVEL_LABELS, type PrototypeAgendaItem } from "@campus/features/agenda";
import {
  DEMO_CATALOG,
  DEMO_CURRENT_TEACHER_ID,
  countBranchesInClassroom,
  countTeachersInClassroom,
  getClassroomById,
  getClassroomsForTeacher,
  getSubjectById,
  getSubjectsForClassroom,
  getSubjectsForTeacherInClassroom,
  getTeacherById,
  getTeachersInClassroom,
  teacherTeachesSubject,
} from "@campus/features/classes";
import {
  DEFAULT_TEACHER_AGENDA_VIEW,
  TEACHER_NAV_ICONS,
  TEACHER_NAV_LABELS,
  TEACHER_NAV_SECTIONS,
  filterItemsForAgendaView,
  getAgendaSectionDescription,
  getAgendaSectionTitle,
  getTeacherClassSummaries,
  type TeacherAgendaView,
  type TeacherNavSection,
} from "@campus/features/teacher";
import {
  filterItemsForCourseDay,
  findStudentAccessForClassroom,
  getStudentAgendaItems,
  getStudentClassroom,
  groupItemsBySubject,
  resolveStudentAccess,
} from "@campus/features/student";
import {
  buildSchoolWeeks,
  buildSchoolWeeksFromEntries,
  courseDayKey,
  findSchoolWeekByNumber,
  findSchoolWeekForDate,
  formatCourseDayHeading,
  formatCourseDayMenuLabel,
  formatSchoolWeekLabel,
  formatSchoolWeekOptionLabel,
  getCourseDayOptionsForSchoolWeek,
  listPreviousCourseDays,
  resolveDisplayCourseDay,
  type CourseDaySlot,
  type SchoolWeek,
} from "@campus/features/calendar";
import {
  courseDaysWithMultipleTests,
  evaluateThirdTestAlert,
  listClassTestsForSchoolWeek,
  listUpcomingTestsForClass,
  listUpcomingTestsForTeacher,
  type ThirdTestAlert,
} from "@campus/features/evaluations";
import type { AgendaItemType } from "@campus/types/agenda";
import {
  createAgendaItemApi,
  deleteAgendaItemApi,
  fetchAgendaItems,
  fetchApiSession,
  fetchSchoolCalendar,
  loginStudentApi,
  loginTeacherApi,
  logoutApiSession,
  savePublicationToLibrary,
  syncTemplateFromPublication,
  updateAgendaItemApi,
  type ApiTeacherSession,
  type SchoolCalendarWeek,
} from "../lib/api-client.ts";
import { SchoolYearAdminPanel } from "./components/school-year-admin-panel.tsx";
import { MultiYearOperationsPanel } from "./components/multi-year-operations-panel.tsx";
import { TimetableImportPanel } from "./components/timetable-import-panel.tsx";
import { PedagogicalLibraryPanel } from "./components/pedagogical-library-panel.tsx";

type AppMode = "teacher" | "student";
type StudentEntry = "code" | "teacher-preview";

const TYPE_LABELS: Record<AgendaItemType, string> = {
  HOMEWORK: "Devoir",
  TEST: "Contrôle",
  INFORMATION: "Information",
};

const ALL_SUBJECTS_FILTER = "Toutes les branches";
const HOURS = Array.from({ length: 10 }, (_, index) => index + 8);

async function loadTeacherAgendaItems(classroomIds: string[]): Promise<PrototypeAgendaItem[]> {
  const batches = await Promise.all(classroomIds.map((classroomId) => fetchAgendaItems(classroomId)));
  const merged = new Map<number, PrototypeAgendaItem>();
  for (const batch of batches) {
    for (const item of batch) merged.set(item.id, item);
  }
  return [...merged.values()].sort((left, right) => left.id - right.id);
}

function shortDate(date: Date) {
  return new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "short" }).format(date).replace(".", "");
}

function dayName(date: Date) {
  return new Intl.DateTimeFormat("fr-CH", { weekday: "short" }).format(date).replace(".", "").toUpperCase();
}

function BrandEmblem() {
  return <span className="brand-emblem-image" aria-hidden="true" />;
}

function teacherLabel(teacherId: string, currentTeacherId: string) {
  if (teacherId === currentTeacherId) return "Vous · compte démo";
  return getTeacherById(DEMO_CATALOG, teacherId)?.displayName ?? "Enseignant · démo";
}

function sectionTitle(activeSection: TeacherNavSection, agendaView: TeacherAgendaView, classroomName: string, isStudentView: boolean) {
  if (isStudentView) return "Mon agenda";
  if (activeSection === "dashboard") return "Tableau de bord";
  if (activeSection === "classes") return "Mes classes";
  if (activeSection === "library") return "Bibliothèque pédagogique";
  if (activeSection === "settings") return "Paramètres";
  return getAgendaSectionTitle(agendaView, classroomName);
}

function sectionDescription(activeSection: TeacherNavSection, agendaView: TeacherAgendaView, classroomName: string, isStudentView: boolean) {
  if (isStudentView) return `Consultation anonyme — agenda complet de la classe ${classroomName}, toutes branches confondues.`;
  if (activeSection === "dashboard") return "Vue d’ensemble de vos classes et de vos publications.";
  if (activeSection === "classes") return "Classes auxquelles vous êtes rattaché et branches enseignées.";
  if (activeSection === "library") return "Modèles réutilisables, déploiement annuel et reprise depuis une année archivée.";
  if (activeSection === "settings") return "Année scolaire, archives multi-années, grille horaire secteur MA et activation.";
  return getAgendaSectionDescription(agendaView, classroomName);
}

export default function Home() {
  const [currentTeacherId, setCurrentTeacherId] = useState(DEMO_CURRENT_TEACHER_ID);
  const teacherClassrooms = useMemo(
    () => getClassroomsForTeacher(DEMO_CATALOG, currentTeacherId),
    [currentTeacherId],
  );
  const defaultClassroomId = teacherClassrooms[0]?.id ?? DEMO_CATALOG.classrooms[0].id;
  const currentTeacher = getTeacherById(DEMO_CATALOG, currentTeacherId);

  const [activeSection, setActiveSection] = useState<TeacherNavSection>("dashboard");
  const [selectedClassroomId, setSelectedClassroomId] = useState(defaultClassroomId);
  const [classPickerOpen, setClassPickerOpen] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>("teacher");
  const [studentSession, setStudentSession] = useState<StudentAccess | null>(null);
  const [studentEntry, setStudentEntry] = useState<StudentEntry | null>(null);
  const [studentCodeModalOpen, setStudentCodeModalOpen] = useState(false);
  const [agendaView, setAgendaView] = useState<TeacherAgendaView>(DEFAULT_TEACHER_AGENDA_VIEW);
  const [typeFilter, setTypeFilter] = useState<AgendaItemType | "ALL">("ALL");
  const [subjectFilter, setSubjectFilter] = useState(ALL_SUBJECTS_FILTER);
  const [teacherFilter, setTeacherFilter] = useState<string | typeof ALL_FILTER>(ALL_FILTER);
  const [dayFilter, setDayFilter] = useState<number | typeof ALL_FILTER>(ALL_FILTER);
  const [selectedSchoolWeekNumber, setSelectedSchoolWeekNumber] = useState(
    () => findSchoolWeekForDate(new Date()).number,
  );
  const [publishSchoolWeekNumber, setPublishSchoolWeekNumber] = useState(selectedSchoolWeekNumber);
  const [items, setItems] = useState<PrototypeAgendaItem[]>(DEMO_PROTOTYPE_ITEMS);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [modalType, setModalType] = useState<AgendaItemType | null>(null);
  const [editingItem, setEditingItem] = useState<PrototypeAgendaItem | null>(null);
  const [notice, setNotice] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [teacherAuthenticated, setTeacherAuthenticated] = useState(false);
  const [teacherIsAdmin, setTeacherIsAdmin] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [studentCourseDayKey, setStudentCourseDayKey] = useState<string | null>(null);
  const [studentHistoryOpen, setStudentHistoryOpen] = useState(false);
  const [schoolWeeks, setSchoolWeeks] = useState<SchoolWeek[]>(() => buildSchoolWeeks());
  const [controlAlert, setControlAlert] = useState<ThirdTestAlert | null>(null);
  const [controlsPanel, setControlsPanel] = useState<null | "class" | "mine">(null);
  const [pendingPublish, setPendingPublish] = useState<{
    title: string;
    detail: string;
    subjectId: string;
    schoolWeekNumber: number;
    day: number;
  } | null>(null);

  async function applyTeacherSession(session: ApiTeacherSession) {
    setCurrentTeacherId(session.teacherId);
    setTeacherIsAdmin(Boolean(session.isAdmin));
    setAppMode("teacher");
    setTeacherAuthenticated(true);
    setStudentSession(null);
    setStudentEntry(null);
    setLoginError("");
    const classroomIds = getClassroomsForTeacher(DEMO_CATALOG, session.teacherId).map((classroom) => classroom.id);
    const loadedItems = await loadTeacherAgendaItems(classroomIds);
    setItems(loadedItems);
    if (classroomIds.length) {
      setSelectedClassroomId((current) => (classroomIds.includes(current) ? current : classroomIds[0]));
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSession() {
      try {
        void fetchSchoolCalendar()
          .then((calendar) => {
            if (!cancelled && calendar?.weeks.length) {
              setSchoolWeeks(buildSchoolWeeksFromEntries(calendar.weeks));
            }
          })
          .catch(() => undefined);

        const session = await Promise.race([
          fetchApiSession(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (cancelled) return;

        if (session?.kind === "teacher") {
          void applyTeacherSession(session).catch((error) => {
            if (!cancelled) {
              setNotice(error instanceof Error ? error.message : "Connexion impossible.");
            }
          });
          return;
        }

        if (session?.kind === "student") {
          const access = resolveStudentAccess(DEMO_CATALOG, session.label);
          if (!access) return;
          setStudentSession(access);
          setSelectedClassroomId(session.classroomId);
          setStudentEntry("code");
          setAppMode("student");
          void fetchAgendaItems(session.classroomId)
            .then((loadedItems) => {
              if (!cancelled) setItems(loadedItems);
            })
            .catch((error) => {
              if (!cancelled) {
                setNotice(error instanceof Error ? error.message : "Chargement agenda impossible.");
              }
            });
          return;
        }
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Connexion impossible.");
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    }

    bootstrapSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const isStudentView = appMode === "student" && studentSession !== null;
  const studentClassroom = studentSession ? getStudentClassroom(DEMO_CATALOG, studentSession) : null;
  const activeClassroomId = isStudentView ? studentSession!.classroomId : selectedClassroomId;

  const selectedClassroom = (isStudentView ? studentClassroom : getClassroomById(DEMO_CATALOG, selectedClassroomId)) ?? DEMO_CATALOG.classrooms[0];
  const classSummaries = useMemo(
    () => getTeacherClassSummaries(DEMO_CATALOG, currentTeacherId, items),
    [currentTeacherId, items],
  );
  const classroomSubjects = useMemo(
    () => getSubjectsForClassroom(DEMO_CATALOG, activeClassroomId),
    [activeClassroomId],
  );
  const publishableSubjects = useMemo(
    () => getSubjectsForTeacherInClassroom(DEMO_CATALOG, currentTeacherId, selectedClassroomId),
    [currentTeacherId, selectedClassroomId],
  );
  const subjectFilterOptions = useMemo(
    () => [ALL_SUBJECTS_FILTER, ...classroomSubjects.map((subject) => subject.name)],
    [classroomSubjects],
  );

  const schoolWeeksMemo = schoolWeeks;
  const selectedSchoolWeek = useMemo(
    () => findSchoolWeekByNumber(selectedSchoolWeekNumber, schoolWeeksMemo),
    [selectedSchoolWeekNumber, schoolWeeksMemo],
  );

  const days = useMemo(() => {
    const monday = new Date(selectedSchoolWeek.monday);
    return Array.from({ length: 5 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return date;
    });
  }, [selectedSchoolWeek]);

  const publishCourseDayOptions = useMemo(
    () => getCourseDayOptionsForSchoolWeek(publishSchoolWeekNumber, schoolWeeksMemo),
    [publishSchoolWeekNumber, schoolWeeksMemo],
  );

  const agendaBaseItems = filterItemsForAgendaView(
    items,
    activeClassroomId,
    currentTeacherId,
    isStudentView ? "class" : agendaView,
  );
  const classroomItems = items.filter((item) => item.classroomId === activeClassroomId);
  const classroomTeachers = useMemo(
    () => getTeachersInClassroom(DEMO_CATALOG, activeClassroomId),
    [activeClassroomId],
  );
  const showSharedInsights = !isStudentView && (agendaView === "class");

  const studentAutoCourseDay = useMemo(
    () => resolveDisplayCourseDay(new Date(), schoolWeeksMemo),
    [schoolWeeksMemo],
  );

  const studentCourseDayCatalog = useMemo(() => {
    const all = [studentAutoCourseDay, ...listPreviousCourseDays(studentAutoCourseDay.date, 20, schoolWeeksMemo)];
    const unique = new Map<string, CourseDaySlot>();
    for (const slot of all) {
      unique.set(courseDayKey(slot), slot);
    }
    return unique;
  }, [studentAutoCourseDay, schoolWeeksMemo]);

  const studentDisplayCourseDay = useMemo(() => {
    if (studentCourseDayKey && studentCourseDayCatalog.has(studentCourseDayKey)) {
      return studentCourseDayCatalog.get(studentCourseDayKey)!;
    }
    return studentAutoCourseDay;
  }, [studentAutoCourseDay, studentCourseDayCatalog, studentCourseDayKey]);

  const studentPreviousCourseDays = useMemo(
    () => listPreviousCourseDays(studentDisplayCourseDay.date, 12, schoolWeeksMemo),
    [studentDisplayCourseDay, schoolWeeksMemo],
  );

  const studentCourseDayGroups = useMemo(() => {
    if (!studentSession) return [];
    const classroomItems = getStudentAgendaItems(items, studentSession.classroomId);
    const dayItems = filterItemsForCourseDay(classroomItems, studentDisplayCourseDay);
    return groupItemsBySubject(dayItems, getSubjectsForClassroom(DEMO_CATALOG, studentSession.classroomId));
  }, [studentSession, items, studentDisplayCourseDay]);

  const studentFollowingCourseDay = useMemo(
    () => courseDayKey(studentDisplayCourseDay) === courseDayKey(studentAutoCourseDay),
    [studentDisplayCourseDay, studentAutoCourseDay],
  );

  const teacherVisibleItems = useMemo(
    () => applySharedAgendaFilters(agendaBaseItems, DEMO_CATALOG, {
      subjectName: subjectFilter === ALL_SUBJECTS_FILTER ? ALL_FILTER : subjectFilter,
      type: typeFilter,
      teacherId: teacherFilter,
      day: dayFilter,
      weekOffset: 0,
      schoolWeekNumber: selectedSchoolWeekNumber,
    }),
    [agendaBaseItems, subjectFilter, typeFilter, teacherFilter, dayFilter, selectedSchoolWeekNumber],
  );

  const visibleItems = isStudentView ? [] : teacherVisibleItems;

  const workload = useMemo(
    () => (showSharedInsights ? buildClassWorkloadSummary(items, DEMO_CATALOG, activeClassroomId, selectedSchoolWeekNumber) : null),
    [showSharedInsights, items, activeClassroomId, selectedSchoolWeekNumber],
  );

  const busyTestDays = useMemo(
    () => courseDaysWithMultipleTests(items, activeClassroomId, selectedSchoolWeekNumber),
    [items, activeClassroomId, selectedSchoolWeekNumber],
  );

  const studentUpcomingTests = useMemo(() => {
    if (!studentSession) return [];
    return listUpcomingTestsForClass(
      items,
      DEMO_CATALOG,
      studentSession.classroomId,
      studentAutoCourseDay,
      schoolWeeksMemo,
    );
  }, [studentSession, items, studentAutoCourseDay, schoolWeeksMemo]);

  const classTestsForWeek = useMemo(
    () => listClassTestsForSchoolWeek(items, DEMO_CATALOG, activeClassroomId, selectedSchoolWeekNumber, schoolWeeksMemo),
    [items, activeClassroomId, selectedSchoolWeekNumber, schoolWeeksMemo],
  );

  const myUpcomingTests = useMemo(
    () => listUpcomingTestsForTeacher(items, DEMO_CATALOG, currentTeacherId, new Date(), schoolWeeksMemo),
    [items, currentTeacherId, schoolWeeksMemo],
  );

  function resetAgendaFilters() {
    setSubjectFilter(ALL_SUBJECTS_FILTER);
    setTeacherFilter(ALL_FILTER);
    setDayFilter(ALL_FILTER);
    setTypeFilter("ALL");
    setSelectedSchoolWeekNumber(findSchoolWeekForDate(new Date(), schoolWeeksMemo).number);
  }

  function isTodayCourseColumn(date: Date) {
    const slot = resolveDisplayCourseDay(new Date(), schoolWeeksMemo);
    return selectedSchoolWeekNumber === slot.schoolWeekNumber
      && date.getFullYear() === slot.date.getFullYear()
      && date.getMonth() === slot.date.getMonth()
      && date.getDate() === slot.date.getDate();
  }

  function enterTeacherPreview() {
    const access = findStudentAccessForClassroom(DEMO_CATALOG, selectedClassroomId);
    if (!access) {
      showNotice("Aucun accès élève de démonstration pour cette classe.");
      return;
    }
    setStudentSession(access);
    setStudentEntry("teacher-preview");
    setAppMode("student");
    setStudentCourseDayKey(null);
    setStudentHistoryOpen(false);
    resetAgendaFilters();
  }

  function enterStudentWithCode(code: string) {
    void (async () => {
      try {
        const session = await loginStudentApi(code);
        const access = resolveStudentAccess(DEMO_CATALOG, code.trim());
        if (!access) {
          showNotice("Code d'accès invalide. Utilisez un identifiant de démonstration.");
          return;
        }
        setStudentSession(access);
        setSelectedClassroomId(session.classroomId);
        setStudentEntry("code");
        setAppMode("student");
        setStudentCourseDayKey(null);
        setStudentHistoryOpen(false);
        setStudentCodeModalOpen(false);
        resetAgendaFilters();
        const loadedItems = await fetchAgendaItems(session.classroomId);
        setItems(loadedItems);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "Connexion élève impossible.");
      }
    })();
  }

  function exitStudentMode() {
    void (async () => {
      const wasPreview = studentEntry === "teacher-preview";
      if (wasPreview) {
        setAppMode("teacher");
        setStudentSession(null);
        setStudentEntry(null);
        setActiveSection("agenda");
        setAgendaView("class");
        return;
      }

      await logoutApiSession();
      setStudentSession(null);
      setStudentEntry(null);
      setAppMode("teacher");
      setTeacherAuthenticated(false);
    })();
  }

  function submitTeacherLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const teacherId = String(form.get("teacherId") || DEMO_CURRENT_TEACHER_ID);
    const password = String(form.get("password") || "");

    void (async () => {
      setLoginPending(true);
      setLoginError("");
      try {
        const session = await loginTeacherApi(teacherId, password);
        await applyTeacherSession(session);
      } catch (error) {
        setLoginError(error instanceof Error ? error.message : "Connexion enseignant impossible.");
      } finally {
        setLoginPending(false);
      }
    })();
  }

  function openAgenda(classroomId: string) {
    setSelectedClassroomId(classroomId);
    setActiveSection("agenda");
    setAgendaView(DEFAULT_TEACHER_AGENDA_VIEW);
    setClassPickerOpen(false);
    setSubjectFilter(ALL_SUBJECTS_FILTER);
    setTeacherFilter(ALL_FILTER);
    setDayFilter(ALL_FILTER);
    setSelectedSchoolWeekNumber(findSchoolWeekForDate(new Date(), schoolWeeksMemo).number);
  }

  function openSharedAgenda(classroomId: string) {
    setSelectedClassroomId(classroomId);
    setActiveSection("agenda");
    setAgendaView("class");
    setClassPickerOpen(false);
    setSubjectFilter(ALL_SUBJECTS_FILTER);
    setTeacherFilter(ALL_FILTER);
    setDayFilter(ALL_FILTER);
    setSelectedSchoolWeekNumber(findSchoolWeekForDate(new Date(), schoolWeeksMemo).number);
  }

  function navigate(section: TeacherNavSection) {
    setActiveSection(section);
    if (section === "agenda") {
      setAgendaView(DEFAULT_TEACHER_AGENDA_VIEW);
    }
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }

  function applySchoolCalendarWeeks(weeks: SchoolCalendarWeek[]) {
    setSchoolWeeks(buildSchoolWeeksFromEntries(weeks));
  }

  function openCreateModal(type: AgendaItemType) {
    setEditingItem(null);
    setModalType(type);
    setPublishSchoolWeekNumber(selectedSchoolWeekNumber);
    setAddMenuOpen(false);
  }

  function openEditModal(item: PrototypeAgendaItem) {
    setEditingItem(item);
    setModalType(item.type);
    setPublishSchoolWeekNumber(item.schoolWeekNumber);
  }

  function closeModal() {
    setModalType(null);
    setEditingItem(null);
    setControlAlert(null);
    setPendingPublish(null);
  }

  useEffect(() => {
    function closeModalOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (studentCodeModalOpen) setStudentCodeModalOpen(false);
      if (modalType) closeModal();
      if (controlAlert) {
        setControlAlert(null);
        setPendingPublish(null);
      }
      if (addMenuOpen) setAddMenuOpen(false);
      if (classPickerOpen) setClassPickerOpen(false);
    }
    window.addEventListener("keydown", closeModalOnEscape);
    return () => window.removeEventListener("keydown", closeModalOnEscape);
  }, [studentCodeModalOpen, modalType, addMenuOpen, classPickerOpen]);

  function logoutTeacher() {
    void (async () => {
      await logoutApiSession();
      setStudentSession(null);
      setStudentEntry(null);
      setAppMode("teacher");
      setTeacherAuthenticated(false);
      showNotice("Session réinitialisée.");
    })();
  }

  async function performPublish(input: {
    title: string;
    detail: string;
    subjectId: string;
    schoolWeekNumber: number;
    day: number;
    type: AgendaItemType;
    editing?: PrototypeAgendaItem | null;
  }) {
    const subject = getSubjectById(DEMO_CATALOG, input.subjectId);
    if (!subject || !teacherTeachesSubject(DEMO_CATALOG, currentTeacherId, selectedClassroomId, subject.id)) {
      return;
    }

    if (input.editing) {
      const updated = await updateAgendaItemApi(input.editing.id, {
        title: input.title,
        detail: input.detail,
        day: input.day,
        hour: 8,
        subjectId: subject.id,
        schoolWeekNumber: input.schoolWeekNumber,
      });
      setItems((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
      closeModal();
      showNotice(`${TYPE_LABELS[input.editing.type]} modifié.`);
      return;
    }

    const created = await createAgendaItemApi({
      classroomId: selectedClassroomId,
      subjectId: subject.id,
      day: input.day,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: input.schoolWeekNumber,
      type: input.type,
      title: input.title,
      detail: input.detail,
    });
    setItems((previous) => [...previous, created]);
    setSelectedSchoolWeekNumber(input.schoolWeekNumber);
    setAgendaView(DEFAULT_TEACHER_AGENDA_VIEW);
    closeModal();
    setActiveSection("agenda");
    showNotice(`${TYPE_LABELS[input.type]} ajouté à ${selectedClassroom.name}.`);
  }

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modalType) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;

    const subjectName = String(form.get("subject") || publishableSubjects[0]?.name || "Moteur");
    const subject = classroomSubjects.find((entry) => entry.name === subjectName) ?? publishableSubjects[0];
    if (!subject || !teacherTeachesSubject(DEMO_CATALOG, currentTeacherId, selectedClassroomId, subject.id)) {
      return;
    }

    const schoolWeekNumber = Number(form.get("schoolWeekNumber") || selectedSchoolWeekNumber);
    const day = Number(form.get("courseDay") || publishCourseDayOptions[0]?.dayIndex || 0);
    const detail = String(form.get("detail") || "").trim() || "Aucune précision";

    const publishInput = {
      title,
      detail,
      subjectId: subject.id,
      schoolWeekNumber,
      day,
      type: modalType,
      editing: editingItem,
    };

    if (modalType === "TEST") {
      const alert = evaluateThirdTestAlert(items, DEMO_CATALOG, {
        classroomId: selectedClassroomId,
        type: "TEST",
        courseDay: { schoolWeekNumber, dayIndex: day },
        excludeItemId: editingItem?.id,
      });
      if (alert.triggered) {
        setControlAlert(alert);
        setPendingPublish({ title, detail, subjectId: subject.id, schoolWeekNumber, day });
        return;
      }
    }

    void (async () => {
      try {
        await performPublish(publishInput);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "Publication impossible.");
      }
    })();
  }

  function confirmPublishDespiteAlert() {
    if (!modalType || !pendingPublish) return;
    void (async () => {
      try {
        await performPublish({
          ...pendingPublish,
          type: modalType,
          editing: editingItem,
        });
        setControlAlert(null);
        setPendingPublish(null);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "Publication impossible.");
      }
    })();
  }

  function mergeDeployedItems(created: PrototypeAgendaItem[]) {
    setItems((previous) => {
      const merged = new Map(previous.map((item) => [item.id, item]));
      for (const item of created) merged.set(item.id, item);
      return [...merged.values()].sort((left, right) => left.id - right.id);
    });
  }

  async function saveCurrentItemToLibrary() {
    if (!editingItem) return;
    try {
      const { template, item } = await savePublicationToLibrary(editingItem.id);
      setItems((previous) => previous.map((entry) => (entry.id === item.id ? item : entry)));
      setEditingItem(item);
      showNotice(`Modèle « ${template.title} » enregistré dans la bibliothèque.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Enregistrement impossible.");
    }
  }

  async function syncCurrentItemToTemplate() {
    if (!editingItem?.templateId) return;
    try {
      const template = await syncTemplateFromPublication(editingItem.id);
      showNotice(`Modèle « ${template.title} » mis à jour depuis cette publication.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Mise à jour du modèle impossible.");
    }
  }

  function removeItem(item: PrototypeAgendaItem) {
    if (!canModifyPublication(item, currentTeacherId)) {
      showNotice("Seul l'auteur peut supprimer cet élément.");
      return;
    }
    void (async () => {
      try {
        await deleteAgendaItemApi(item.id);
        setItems((previous) => previous.filter((entry) => entry.id !== item.id));
        showNotice(`${TYPE_LABELS[item.type]} supprimé.`);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "Suppression impossible.");
      }
    })();
  }

  const myItemCount = classroomItems.filter((item) => item.authorTeacherId === currentTeacherId).length;
  const showAgendaTools = !isStudentView && activeSection === "agenda";

  if (!authReady) {
    return (
      <div className="teacher-login-shell" id="main-content">
        <div className="teacher-login-loading" role="status" aria-live="polite">
          <BrandEmblem />
          <strong>CAMPUS AGENDA</strong>
          <span>Chargement de la session…</span>
        </div>
      </div>
    );
  }

  if (!teacherAuthenticated && !isStudentView) {
    return (
      <div className="teacher-login-shell">
        <main className="teacher-login" id="main-content">
          <div className="teacher-login-brand">
            <BrandEmblem />
            <span><strong>CAMPUS</strong><small>AGENDA</small></span>
          </div>
          <section className="teacher-login-card" aria-labelledby="teacher-login-title">
            <span className="eyebrow">ESPACE ENSEIGNANT</span>
            <h1 id="teacher-login-title">Connexion</h1>
            <p>Identifiez-vous pour accéder à l’agenda de démonstration.</p>
            <form onSubmit={submitTeacherLogin}>
              <label>
                Compte enseignant
                <select name="teacherId" defaultValue={DEMO_CURRENT_TEACHER_ID}>
                  {DEMO_CATALOG.teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>
                  ))}
                </select>
              </label>
              <label>
                Mot de passe
                <input name="password" type="password" autoComplete="current-password" required />
              </label>
              <p className="teacher-login-hint">Mot de passe de démonstration&nbsp;: <strong>campus-demo</strong></p>
              {loginError && <p className="teacher-login-error" role="alert">{loginError}</p>}
              <button type="submit" disabled={loginPending}>{loginPending ? "Connexion…" : "Se connecter"}</button>
            </form>
            <footer>
              <button type="button" className="student-entry-link" onClick={() => setStudentCodeModalOpen(true)}>
                Consulter l’agenda élève
              </button>
            </footer>
          </section>
          <p className="prototype-label">PROTOTYPE INTERACTIF · CAMPUS AGENDA 1.2</p>
        </main>

        {notice && <div className="technical-toast" role="status">✓ &nbsp;{notice}</div>}

        {studentCodeModalOpen && (
          <div className="technical-modal-backdrop">
            <section className="technical-modal" role="dialog" aria-modal="true" aria-labelledby="student-code-title">
              <header><div><span className="eyebrow">ESPACE ÉLÈVE</span><h2 id="student-code-title">Connexion anonyme</h2></div><button onClick={() => setStudentCodeModalOpen(false)}>×</button></header>
              <form onSubmit={(event) => { event.preventDefault(); enterStudentWithCode(String(new FormData(event.currentTarget).get("code") || "")); }}>
                <label>Identifiant de démonstration<input name="code" placeholder="eleve-test-001" required /></label>
                <p className="modal-hint">Codes fictifs : <strong>eleve-test-001</strong> (2e TMA) ou <strong>eleve-test-002</strong> (1re TMA).</p>
                <footer><button type="button" onClick={() => setStudentCodeModalOpen(false)}>Annuler</button><button type="submit">Consulter mon agenda</button></footer>
              </form>
            </section>
          </div>
        )}
      </div>
    );
  }

  if (isStudentView && studentSession) {
    return (
      <div className="mechanical-app student-app student-course-day-app">
        <main className="student-course-day-main" id="main-content">
          <header className="student-course-day-header">
            <div className="student-course-day-brand">
              <BrandEmblem />
              <span><strong>CAMPUS</strong><small>AGENDA</small></span>
            </div>
            <div className="student-course-day-actions">
              <div className="student-history-anchor">
                <button
                  type="button"
                  className="student-history-toggle"
                  aria-expanded={studentHistoryOpen}
                  aria-haspopup="menu"
                  onClick={() => setStudentHistoryOpen((open) => !open)}
                >
                  Cours précédents
                </button>
                {studentHistoryOpen && (
                  <menu className="student-history-menu" aria-label="Cours précédents">
                    {!studentFollowingCourseDay && (
                      <button
                        type="button"
                        onClick={() => {
                          setStudentCourseDayKey(null);
                          setStudentHistoryOpen(false);
                        }}
                      >
                        Revenir au prochain cours
                      </button>
                    )}
                    {studentPreviousCourseDays.map((slot) => (
                      <button
                        key={courseDayKey(slot)}
                        type="button"
                        onClick={() => {
                          setStudentCourseDayKey(courseDayKey(slot));
                          setStudentHistoryOpen(false);
                        }}
                      >
                        {formatCourseDayMenuLabel(slot)}
                      </button>
                    ))}
                  </menu>
                )}
              </div>
              <button className="student-signout" type="button" onClick={exitStudentMode}>
                {studentEntry === "teacher-preview" ? "Quitter l’aperçu" : "Se déconnecter"}
              </button>
            </div>
          </header>

          <section className="student-course-day-card" aria-labelledby="student-course-day-title">
            <p className="eyebrow">{selectedClassroom.name} · {studentSession.label}</p>
            <p className="student-week-label">{formatSchoolWeekLabel(studentDisplayCourseDay)}</p>
            <h1 id="student-course-day-title">{formatCourseDayHeading(studentDisplayCourseDay)}</h1>
            {!studentFollowingCourseDay && (
              <p className="student-course-day-note">Consultation d’un cours passé.</p>
            )}

            {studentCourseDayGroups.length ? (
              <div className="student-branch-list">
                {studentCourseDayGroups.map((group) => (
                  <section className="student-branch-block" key={group.subject.id} aria-label={group.subject.name}>
                    <h2>{group.subject.name}</h2>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item.id} className={`student-branch-item ${item.type.toLowerCase()}`}>
                          <span className="student-item-type">{TYPE_LABELS[item.type]}</span>
                          <strong>{item.title}</strong>
                          <p>{item.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <div className="student-course-day-empty">
                <strong>Aucun élément publié</strong>
                <small>Pas de devoir, contrôle ou information pour ce jour de cours.</small>
              </div>
            )}
          </section>

          <section className="student-upcoming-tests" aria-labelledby="student-upcoming-tests-title">
            <h2 id="student-upcoming-tests-title">Contrôles à venir</h2>
            {studentUpcomingTests.length ? (
              <ol className="student-upcoming-tests-list">
                {studentUpcomingTests.map((entry) => (
                  <li key={entry.item.id}>
                    <span className="student-upcoming-tests-date">
                      {formatSchoolWeekLabel(entry.slot)} · {formatCourseDayHeading(entry.slot)}
                    </span>
                    <strong>{entry.subjectName} — {entry.item.title}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="student-upcoming-tests-empty">Aucun contrôle planifié à venir pour votre classe.</p>
            )}
          </section>

          <p className="prototype-label">CONSULTATION ÉLÈVE · CAMPUS AGENDA 1.2</p>
        </main>

        {notice && <div className="technical-toast" role="status">✓ &nbsp;{notice}</div>}
      </div>
    );
  }

  return (
    <div className="mechanical-app">
      <aside className="technical-sidebar">
        <div className="brand-lockup">
          <BrandEmblem />
          <span><strong>CAMPUS</strong><small>AGENDA</small></span>
        </div>

        <nav aria-label="Navigation principale">
          {TEACHER_NAV_SECTIONS.map((section) => (
            <button
              key={section}
              className={activeSection === section ? "active" : ""}
              onClick={() => navigate(section)}
            >
              <span>{TEACHER_NAV_ICONS[section]}</span> {TEACHER_NAV_LABELS[section]}
            </button>
          ))}
        </nav>

        {(activeSection === "agenda" || activeSection === "classes") && (
          <div className="classroom-list" aria-label="Classes rattachées">
            {teacherClassrooms.map((classroom) => (
              <button
                key={classroom.id}
                className={classroom.id === selectedClassroomId ? "classroom-chip active" : "classroom-chip"}
                onClick={() => openAgenda(classroom.id)}
              >
                <strong>{classroom.name}</strong>
                <small>{classroom.programLabel}</small>
              </button>
            ))}
          </div>
        )}

        <div className="technical-note">
          <span>CODE CLASSE</span>
          <strong>{selectedClassroom.accessCodeHint}</strong>
          <small>Démonstration uniquement</small>
        </div>
        <button className="signout" onClick={() => setStudentCodeModalOpen(true)}><span>👤</span> Espace élève</button>
        <button className="signout" onClick={logoutTeacher}><span>↪</span> Déconnexion</button>
      </aside>

      <main className="technical-main" id="main-content">
        <header className="technical-header">
          <div className="mobile-lockup"><BrandEmblem /><strong>CAMPUS AGENDA</strong></div>
          <div className="class-identity">
            <span className="eyebrow">{selectedClassroom.programLabel}</span>
            <h1>{sectionTitle(activeSection, agendaView, selectedClassroom.name, false)}</h1>
            <p>{sectionDescription(activeSection, agendaView, selectedClassroom.name, false)}</p>
          </div>
          <div className="header-actions">
            {showAgendaTools && (
              <button className="student-preview" onClick={enterTeacherPreview}>Aperçu élève</button>
            )}
            {showAgendaTools && (
              <div className="add-anchor">
                <button className="navy-add" onClick={() => setAddMenuOpen((current) => !current)} aria-expanded={addMenuOpen} aria-haspopup="menu">＋ <span>Ajouter</span>⌄</button>
                {addMenuOpen && (
                  <div className="technical-add-menu" role="menu" aria-label="Types de publication">
                    {(["HOMEWORK", "TEST", "INFORMATION"] as AgendaItemType[]).map((type) => (
                      <button key={type} role="menuitem" onClick={() => openCreateModal(type)}>
                        <span className={`type-icon ${type.toLowerCase()}`}>{type === "HOMEWORK" ? "D" : type === "TEST" ? "C" : "i"}</span>
                        <span><strong>{TYPE_LABELS[type]}</strong><small>{type === "HOMEWORK" ? "Travail à réaliser" : type === "TEST" ? "Évaluation planifiée" : "Message pour la classe"}</small></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button className="round-action" aria-label="Notifications">♧<i /></button>
            <span className="profile-disc">{currentTeacher?.initials ?? "FC"}</span>
          </div>
        </header>

        {activeSection === "dashboard" && (
          <section className="teacher-workspace" aria-label="Tableau de bord enseignant">
            <div className="workspace-intro">
              <p className="eyebrow">ESPACE ENSEIGNANT</p>
              <h2>Bonjour, {currentTeacher?.displayName ?? "Professeur démo"}</h2>
              <p>Consultez vos classes, puis ouvrez l’agenda en vue <strong>Mes éléments</strong> par défaut.</p>
            </div>
            <div className="workspace-grid">
              {classSummaries.map((summary) => (
                <article className="workspace-card" key={summary.classroom.id}>
                  <header>
                    <span className="eyebrow">{summary.classroom.programLabel}</span>
                    <h3>{summary.classroom.name}</h3>
                  </header>
                  <dl className="workspace-stats">
                    <div><dt>Mes éléments</dt><dd>{summary.myItemCount}</dd></div>
                    <div><dt>Classe entière</dt><dd>{summary.classItemCount}</dd></div>
                    <div><dt>Branches</dt><dd>{summary.branchesTaught.length}</dd></div>
                  </dl>
                  <ul className="branch-tags">
                    {summary.branchesTaught.map((branch) => <li key={branch.id}>{branch.name}</li>)}
                  </ul>
                  <button className="workspace-action" onClick={() => openAgenda(summary.classroom.id)}>
                    Voir mes éléments
                  </button>
                  <button className="workspace-action secondary" onClick={() => openSharedAgenda(summary.classroom.id)}>
                    Toute la classe
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeSection === "classes" && (
          <section className="teacher-workspace" aria-label="Mes classes">
            <div className="workspace-grid workspace-grid-single">
              {classSummaries.map((summary) => (
                <article className="workspace-card workspace-card-wide" key={summary.classroom.id}>
                  <header>
                    <span className="eyebrow">CLASSE PARTAGÉE</span>
                    <h3>{summary.classroom.name}</h3>
                    <p>{summary.classroom.programLabel}</p>
                  </header>
                  <p className="workspace-code">Code démo : <strong>{summary.classroom.accessCodeHint}</strong></p>
                  <div className="workspace-detail-row">
                    <span><strong>{summary.myItemCount}</strong> mes publications</span>
                    <span><strong>{summary.classItemCount}</strong> éléments au total</span>
                    <span><strong>{countTeachersInClassroom(DEMO_CATALOG, summary.classroom.id)}</strong> enseignants</span>
                  </div>
                  <ul className="branch-tags">
                    {summary.branchesTaught.map((branch) => <li key={branch.id}>{branch.name}</li>)}
                  </ul>
                  <button className="workspace-action" onClick={() => openAgenda(summary.classroom.id)}>
                    Ouvrir l’agenda · Mes éléments
                  </button>
                  <button className="workspace-action secondary" onClick={() => openSharedAgenda(summary.classroom.id)}>
                    Charge globale · Toute la classe
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeSection === "settings" && (
          <>
            <SchoolYearAdminPanel onCalendarUpdated={applySchoolCalendarWeeks} onNotice={showNotice} />
            <MultiYearOperationsPanel
              isAdmin={teacherIsAdmin}
              defaultClassroomId={selectedClassroomId}
              onNotice={showNotice}
            />
            <TimetableImportPanel onNotice={showNotice} />
          </>
        )}

        {activeSection === "library" && (
          <PedagogicalLibraryPanel
            teacherId={currentTeacherId}
            defaultClassroomId={selectedClassroomId}
            schoolWeeks={schoolWeeksMemo}
            onNotice={showNotice}
            onItemsChanged={mergeDeployedItems}
          />
        )}

        {activeSection === "agenda" && (
          <>
            <section className="brand-showcase" aria-label="Identité visuelle Campus Agenda">
              <div className="showcase-copy">
                <div className="showcase-brand"><BrandEmblem /><span><strong>CAMPUS</strong><small>AGENDA</small></span></div>
                <p className="showcase-overline">{selectedClassroom.programLabel.toUpperCase()}</p>
                <h2>L’agenda scolaire<br />des passionnés<br />de mécanique</h2>
                <p className="showcase-text">Un calendrier commun, alimenté par toute l’équipe pédagogique et lisible d’un seul regard par les élèves.</p>
                <div className="showcase-specs">
                  <span><strong>{selectedClassroom.name}</strong>Classe active</span>
                  <span><strong>{countTeachersInClassroom(DEMO_CATALOG, selectedClassroomId)}</strong>Enseignants</span>
                  <span><strong>{countBranchesInClassroom(DEMO_CATALOG, selectedClassroomId)}</strong>Branches</span>
                </div>
              </div>
              <figure className="showcase-visual">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/og-v3.png" alt="Esquisses techniques d’un piston, de soupapes, d’un arbre à cames, d’un moteur et d’un véhicule électrifié" />
              </figure>
            </section>

            <div className="class-tabs" role="tablist" aria-label="Vues de l'agenda">
              <button type="button" role="tab" aria-selected={controlsPanel === null} className={controlsPanel === null ? "active" : ""} onClick={() => setControlsPanel(null)}>Calendrier</button>
              <button type="button" role="tab" aria-selected={controlsPanel === "class"} className={controlsPanel === "class" ? "active" : ""} onClick={() => { setControlsPanel("class"); setAgendaView("class"); setTypeFilter("TEST"); }}>Contrôles · classe</button>
              <button type="button" role="tab" aria-selected={controlsPanel === "mine"} className={controlsPanel === "mine" ? "active" : ""} onClick={() => { setControlsPanel("mine"); setAgendaView("mine"); }}>Mes contrôles</button>
              <button type="button" role="tab" onClick={() => navigate("library")}>Bibliothèque</button>
            </div>

            {controlsPanel === "class" && (
              <section className="controls-panel" aria-labelledby="class-controls-title">
                <header>
                  <h2 id="class-controls-title">Contrôles · {selectedClassroom.name}</h2>
                  <p>{formatSchoolWeekOptionLabel(selectedSchoolWeek)} — tous les enseignants et branches</p>
                </header>
                {classTestsForWeek.length ? (
                  <ul className="controls-list">
                    {classTestsForWeek.map((entry) => (
                      <li key={entry.item.id}>
                        <span className="controls-list-date">{formatCourseDayHeading(entry.slot)}</span>
                        <strong>{entry.subjectName} — {entry.item.title}</strong>
                        <small>{entry.teacherName}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="controls-empty">Aucun contrôle planifié pour cette semaine scolaire.</p>
                )}
              </section>
            )}

            {controlsPanel === "mine" && (
              <section className="controls-panel" aria-labelledby="my-controls-title">
                <header>
                  <h2 id="my-controls-title">Mes contrôles à venir</h2>
                  <p>Toutes vos classes confondues</p>
                </header>
                {myUpcomingTests.length ? (
                  <ul className="controls-list">
                    {myUpcomingTests.map((entry) => (
                      <li key={entry.item.id}>
                        <span className="controls-list-date">
                          {formatSchoolWeekLabel(entry.slot)} · {formatCourseDayHeading(entry.slot)}
                        </span>
                        <strong>{getClassroomById(DEMO_CATALOG, entry.item.classroomId)?.name ?? "Classe"} · {entry.subjectName} — {entry.item.title}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="controls-empty">Aucun contrôle à venir dans vos publications.</p>
                )}
              </section>
            )}

            {controlsPanel === null && (
            <section className="calendar-workbench">
              <aside className="calendar-tools">
                <div className="view-selector" aria-label="Choisir la vue">
                  <button className={agendaView === "mine" ? "active" : ""} onClick={() => { setAgendaView("mine"); setTeacherFilter(ALL_FILTER); setDayFilter(ALL_FILTER); }}>Mes éléments <span>{myItemCount}</span></button>
                  <button className={agendaView === "class" ? "active" : ""} onClick={() => { setAgendaView("class"); setTeacherFilter(ALL_FILTER); setDayFilter(ALL_FILTER); }}>Toute la classe <span>{filterItemsForSchoolWeek(classroomItems, selectedSchoolWeekNumber).length}</span></button>
                </div>

                {showSharedInsights && workload && (
                  <section className="workload-panel" aria-label="Charge globale de la classe">
                    <header>
                      <h2>CHARGE GLOBALE</h2>
                      <span className={`workload-badge ${workload.level}`}>{WORKLOAD_LEVEL_LABELS[workload.level]}</span>
                    </header>
                    <dl className="workload-totals">
                      <div><dt>Total</dt><dd>{workload.total}</dd></div>
                      <div><dt>Devoirs</dt><dd>{workload.homework}</dd></div>
                      <div><dt>Contrôles</dt><dd>{workload.test}</dd></div>
                      <div><dt>Infos</dt><dd>{workload.information}</dd></div>
                    </dl>
                    <ul className="workload-breakdown">
                      {workload.bySubject.slice(0, 4).map((entry) => (
                        <li key={entry.subjectId}><span>{entry.subjectName}</span><strong>{entry.count}</strong></li>
                      ))}
                    </ul>
                    {busyTestDays.length > 0 && (
                      <p className="workload-alert">Jours avec plusieurs contrôles repérés cette semaine.</p>
                    )}
                  </section>
                )}

                <section className="mini-calendar">
                  <header><strong>AOÛT 2026</strong><span>‹ &nbsp; ›</span></header>
                  <div className="mini-week"><b>L</b><b>M</b><b>M</b><b>J</b><b>V</b><b>S</b><b>D</b></div>
                  <div className="mini-days">
                    {[27,28,29,30,31,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30].map((day, index) => (
                      <span className={day === 11 && index > 10 ? "selected" : index < 5 ? "muted" : ""} key={`${day}-${index}`}>{day}</span>
                    ))}
                  </div>
                </section>

                <section className="filter-panel">
                  <h2>FILTRES</h2>
                  <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} aria-label="Filtrer par branche">
                    {subjectFilterOptions.map((subject) => <option key={subject}>{subject}</option>)}
                  </select>
                  {showSharedInsights && (
                    <>
                      <select value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value)} aria-label="Filtrer par enseignant">
                        <option value={ALL_FILTER}>Tous les enseignants</option>
                        {classroomTeachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
                      </select>
                      <select value={dayFilter} onChange={(event) => setDayFilter(event.target.value === ALL_FILTER ? ALL_FILTER : Number(event.target.value))} aria-label="Filtrer par jour">
                        <option value={ALL_FILTER}>Toute la semaine</option>
                        {days.map((date, index) => <option key={date.toISOString()} value={index}>{dayName(date)} {date.getDate()}</option>)}
                      </select>
                    </>
                  )}
                  <label><input type="checkbox" checked={typeFilter === "ALL" || typeFilter === "HOMEWORK"} onChange={() => setTypeFilter(typeFilter === "HOMEWORK" ? "ALL" : "HOMEWORK")} /> <span className="check blue" /> Devoirs</label>
                  <label><input type="checkbox" checked={typeFilter === "ALL" || typeFilter === "TEST"} onChange={() => setTypeFilter(typeFilter === "TEST" ? "ALL" : "TEST")} /> <span className="check navy" /> Contrôles</label>
                  <label><input type="checkbox" checked={typeFilter === "ALL" || typeFilter === "INFORMATION"} onChange={() => setTypeFilter(typeFilter === "INFORMATION" ? "ALL" : "INFORMATION")} /> <span className="check pale" /> Informations</label>
                </section>

                <div className="legend-note"><span>✓</span><p><strong>Données fictives</strong>Aucun élève réel n’est affiché.</p></div>
              </aside>

              <section className="week-calendar">
                <header className="week-toolbar">
                  <div>
                    <button type="button" onClick={() => setSelectedSchoolWeekNumber((current) => Math.max(1, current - 1))}>‹</button>
                    <button type="button" onClick={() => setSelectedSchoolWeekNumber(findSchoolWeekForDate(new Date(), schoolWeeksMemo).number)}>Aujourd’hui</button>
                    <button type="button" onClick={() => setSelectedSchoolWeekNumber((current) => Math.min(38, current + 1))}>›</button>
                  </div>
                  <h2>{formatSchoolWeekOptionLabel(selectedSchoolWeek)} · {shortDate(days[0])} — {shortDate(days[4])}</h2>
                  <div className="class-picker">
                    <button className="class-picker-trigger" onClick={() => setClassPickerOpen((current) => !current)} aria-expanded={classPickerOpen}>
                      {selectedClassroom.name} &nbsp;⌄
                    </button>
                    {classPickerOpen && (
                      <div className="class-picker-menu" role="listbox" aria-label="Choisir une classe">
                        {teacherClassrooms.map((classroom) => (
                          <button
                            key={classroom.id}
                            role="option"
                            aria-selected={classroom.id === selectedClassroomId}
                            className={classroom.id === selectedClassroomId ? "active" : ""}
                            onClick={() => openAgenda(classroom.id)}
                          >
                            <strong>{classroom.name}</strong>
                            <small>{classroom.programLabel}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </header>

                {showSharedInsights && workload && (
                  <div className="workload-strip" aria-label="Répartition hebdomadaire">
                    {workload.byDay.map((entry, index) => {
                      const isBusyTests = busyTestDays.some((day) => day.dayIndex === index);
                      return (
                      <div className={`workload-day${isBusyTests ? " busy-tests" : ""}${entry.test >= 2 ? " multi-tests" : ""}`} key={entry.day}>
                        <span>{dayName(days[index] ?? days[0])}</span>
                        <strong>{entry.test > 0 ? entry.test : entry.total}</strong>
                        <i style={{ width: `${Math.min(100, (entry.test || entry.total) * 20)}%` }} />
                      </div>
                      );
                    })}
                  </div>
                )}

                <div className="schedule-grid">
                  <div className="corner-cell" />
                  {days.map((date, index) => <div className={`day-head ${isTodayCourseColumn(date) ? "today" : ""}`} key={date.toISOString()}><span>{dayName(date)}</span><strong>{date.getDate()}</strong></div>)}
                  {HOURS.map((hour) => (
                    <div className="schedule-row" key={hour}>
                      <time>{String(hour).padStart(2, "0")}:00</time>
                      {days.map((date, dayIndex) => {
                        const slotItems = visibleItems.filter((item) => item.day === dayIndex && item.hour === hour);
                        return (
                          <div className="time-slot" key={`${date.toISOString()}-${hour}`}>
                            {slotItems.map((item) => {
                              const subjectName = getSubjectById(DEMO_CATALOG, item.subjectId)?.name ?? "Branche";
                              const isMine = item.authorTeacherId === currentTeacherId;
                              const authorLabel = teacherLabel(item.authorTeacherId, currentTeacherId);
                              const editable = canModifyPublication(item, currentTeacherId);
                              return (
                                <article className={`schedule-event ${item.type.toLowerCase()}${editable ? " editable" : ""}`} key={item.id}>
                                  {editable && (
                                    <div className="event-actions">
                                      <button type="button" aria-label={`Modifier ${item.title}`} onClick={() => openEditModal(item)}>✎</button>
                                      <button type="button" aria-label={`Supprimer ${item.title}`} onClick={() => removeItem(item)}>×</button>
                                    </div>
                                  )}
                                  <small>{TYPE_LABELS[item.type]} · {subjectName}</small>
                                  <strong>{item.title}</strong>
                                  <span>{item.detail}</span>
                                  <em>{isMine ? "Vous" : authorLabel.split(" · ")[0]}</em>
                                </article>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {!visibleItems.length && <div className="empty-week"><span>▱</span><strong>Semaine libre</strong><small>Aucun élément ne correspond aux filtres.</small></div>}
              </section>
            </section>
            )}
          </>
        )}

        <p className="prototype-label">PROTOTYPE INTERACTIF · CAMPUS AGENDA 1.2</p>
      </main>

      {notice && <div className="technical-toast" role="status">✓ &nbsp;{notice}</div>}

      {studentCodeModalOpen && (
        <div className="technical-modal-backdrop">
          <section className="technical-modal" role="dialog" aria-modal="true" aria-labelledby="student-code-title">
            <header><div><span className="eyebrow">ESPACE ÉLÈVE</span><h2 id="student-code-title">Connexion anonyme</h2></div><button onClick={() => setStudentCodeModalOpen(false)}>×</button></header>
            <form onSubmit={(event) => { event.preventDefault(); enterStudentWithCode(String(new FormData(event.currentTarget).get("code") || "")); }}>
              <label>Identifiant de démonstration<input name="code" placeholder="eleve-test-001" required /></label>
              <p className="modal-hint">Codes fictifs : <strong>eleve-test-001</strong> (2e TMA) ou <strong>eleve-test-002</strong> (1re TMA).</p>
              <footer><button type="button" onClick={() => setStudentCodeModalOpen(false)}>Annuler</button><button type="submit">Consulter mon agenda</button></footer>
            </form>
          </section>
        </div>
      )}

      {controlAlert && (
        <div className="technical-modal-backdrop">
          <section className="technical-modal control-alert-modal" role="dialog" aria-modal="true" aria-labelledby="control-alert-title">
            <header>
              <div>
                <span className="eyebrow">COORDINATION</span>
                <h2 id="control-alert-title">3 contrôles ce jour de cours</h2>
              </div>
              <button type="button" onClick={() => { setControlAlert(null); setPendingPublish(null); }}>×</button>
            </header>
            <p>Cette publication porterait à <strong>3 contrôles</strong> le même jour de cours pour la classe. Les collègues ont déjà planifié :</p>
            <ul className="control-alert-list">
              {controlAlert.existingTests.map((test) => (
                <li key={test.id}>
                  <strong>{test.subjectName}</strong> — {test.title}
                  <small>{test.teacherName}</small>
                </li>
              ))}
            </ul>
            <footer className="control-alert-actions">
              <button type="button" onClick={() => { setControlAlert(null); setPendingPublish(null); }}>Modifier la date</button>
              <button type="button" className="confirm-anyway" onClick={confirmPublishDespiteAlert}>Publier quand même</button>
            </footer>
          </section>
        </div>
      )}

      {modalType && (
        <div className="technical-modal-backdrop">
          <section className="technical-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <header><div><span className="eyebrow">{editingItem ? "MODIFIER" : "NOUVEL ÉLÉMENT"}</span><h2 id="modal-title">{editingItem ? `Modifier le ${TYPE_LABELS[modalType].toLowerCase()}` : `Ajouter un ${TYPE_LABELS[modalType].toLowerCase()}`}</h2></div><button onClick={closeModal}>×</button></header>
            <form key={editingItem?.id ?? `create-${modalType}-${publishSchoolWeekNumber}`} onSubmit={submitItem}>
              <label>Titre<input name="title" placeholder="Titre visible par la classe" defaultValue={editingItem?.title ?? ""} required /></label>
              <div className="modal-row">
                <label>
                  Semaine scolaire
                  <select
                    name="schoolWeekNumber"
                    value={publishSchoolWeekNumber}
                    onChange={(event) => setPublishSchoolWeekNumber(Number(event.target.value))}
                  >
                    {schoolWeeksMemo.map((week) => (
                      <option key={week.number} value={week.number}>{formatSchoolWeekOptionLabel(week)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Branche
                  <select name="subject" defaultValue={getSubjectById(DEMO_CATALOG, editingItem?.subjectId ?? publishableSubjects[0]?.id ?? "")?.name ?? publishableSubjects[0]?.name ?? "Moteur"}>
                    {publishableSubjects.map((subject) => <option key={subject.id}>{subject.name}</option>)}
                  </select>
                </label>
                <label>
                  Jour de cours
                  <select name="courseDay" defaultValue={String(editingItem?.day ?? publishCourseDayOptions[0]?.dayIndex ?? 0)}>
                    {publishCourseDayOptions.map((option) => (
                      <option key={option.dayIndex} value={option.dayIndex}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="modal-hint">Semaine A : lundi · Semaine B : lundi et jeudi.</p>
              <label>Consigne<textarea name="detail" rows={3} placeholder="Ajoutez une indication utile…" defaultValue={editingItem?.detail ?? ""} /></label>
              {editingItem && canModifyPublication(editingItem, currentTeacherId) ? (
                <div className="modal-library-actions">
                  {editingItem.templateId ? (
                    <button type="button" className="secondary-library-action" onClick={() => void syncCurrentItemToTemplate()}>
                      Mettre à jour le modèle
                    </button>
                  ) : (
                    <button type="button" className="secondary-library-action" onClick={() => void saveCurrentItemToLibrary()}>
                      Enregistrer dans la bibliothèque
                    </button>
                  )}
                  {editingItem.templateId ? (
                    <p className="modal-hint">Modifier cette publication n&apos;altère pas le modèle, sauf action explicite ci-dessus.</p>
                  ) : null}
                </div>
              ) : null}
              <footer><button type="button" onClick={closeModal}>Annuler</button><button type="submit">{editingItem ? "Enregistrer" : "Publier dans l’agenda"}</button></footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
