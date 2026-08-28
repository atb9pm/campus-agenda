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
  DEFAULT_TEACHER_NAV_SECTION,
  teacherNavSectionsForRole,
  filterItemsForAgendaView,
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
import type { StudentAccess } from "@campus/types/student-access";
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
  changeTeacherPasswordApi,
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
import { APP_VERSION } from "@campus/lib/app-version";
import {
  LAST_STUDENT_CODE_KEY,
  LAST_TEACHER_INITIALS_KEY,
  writeStoredValue,
} from "@campus/features/auth-entry";
import {
  buildDefaultTeacherSetup,
  loadTeacherSetupFromBrowser,
  saveTeacherSetupToBrowser,
  type TeacherSetupConfig,
  type TeacherClassSetup,
} from "@campus/features/teacher-setup";
import {
  loadNotesFromBrowser,
  resolveCatalogClassroomId,
  resolveDefaultSubjectId,
  saveNotesToBrowser,
  weekdayToCourseDayIndex,
  type ClassNotesDocument,
} from "@campus/features/class-notebook";
import { ConfigurationPanel } from "./components/configuration-panel.tsx";
import { AdministrationPanel } from "./components/administration-panel.tsx";
import { LoginPanel } from "./components/login-panel.tsx";
import { PasswordChangePanel } from "./components/password-change-panel.tsx";
import { ClassNotebookPanel } from "./components/class-notebook-panel.tsx";
import { MaSemainePanel } from "./components/ma-semaine-panel.tsx";

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
  return <span className="brand-emblem-image" aria-hidden="true">CA</span>;
}

function teacherLabel(teacherId: string, currentTeacherId: string) {
  if (teacherId === currentTeacherId) return "Vous · compte démo";
  return getTeacherById(DEMO_CATALOG, teacherId)?.displayName ?? "Enseignant · démo";
}

function sectionTitle(activeSection: TeacherNavSection, isStudentView: boolean, notebookClassName?: string) {
  if (isStudentView) return "Mon agenda";
  if (notebookClassName) return `Carnet · ${notebookClassName}`;
  if (activeSection === "ma-semaine") return "Ma semaine";
  if (activeSection === "administration") return "Administration";
  return "Configuration";
}

function sectionDescription(activeSection: TeacherNavSection, isStudentView: boolean, notebookOpen: boolean) {
  if (isStudentView) return "Consultation anonyme — agenda complet de la classe, toutes branches confondues.";
  if (notebookOpen) {
    return "Contrôles, publications élèves et notes prof — semaine par semaine.";
  }
  if (activeSection === "ma-semaine") {
    return "Vos classes par jour de cours, avec les branches que vous avez définies.";
  }
  if (activeSection === "administration") {
    return "Référentiel école : classes, branches, accès et plan des semaines A/B.";
  }
  return "Affectations personnelles : classe, jour de cours et branche.";
}

export default function Home() {
  const [currentTeacherId, setCurrentTeacherId] = useState(DEMO_CURRENT_TEACHER_ID);
  const teacherClassrooms = useMemo(
    () => getClassroomsForTeacher(DEMO_CATALOG, currentTeacherId),
    [currentTeacherId],
  );
  const defaultClassroomId = teacherClassrooms[0]?.id ?? DEMO_CATALOG.classrooms[0].id;
  const currentTeacher = getTeacherById(DEMO_CATALOG, currentTeacherId);

  const [activeSection, setActiveSection] = useState<TeacherNavSection>(DEFAULT_TEACHER_NAV_SECTION);
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
  const [teacherAuthenticated, setTeacherAuthenticated] = useState(false);
  const [teacherIsAdmin, setTeacherIsAdmin] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [studentLoginError, setStudentLoginError] = useState("");
  const [passwordChange, setPasswordChange] = useState<ApiTeacherSession | null>(null);
  const [passwordChangeError, setPasswordChangeError] = useState("");
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
  const [teacherSetup, setTeacherSetup] = useState<TeacherSetupConfig>(() =>
    buildDefaultTeacherSetup(DEMO_CATALOG, currentTeacherId),
  );
  const [teacherSetupReady, setTeacherSetupReady] = useState(false);
  const [openNotebookClassId, setOpenNotebookClassId] = useState<string | null>(null);
  const [notebookCenterWeek, setNotebookCenterWeek] = useState(selectedSchoolWeekNumber);
  const [classNotesDocument, setClassNotesDocument] = useState<ClassNotesDocument>(() =>
    loadNotesFromBrowser(currentTeacherId),
  );
  const [pendingNotebookControl, setPendingNotebookControl] = useState<{
    classroomId: string;
    subjectId: string;
    schoolWeekNumber: number;
    day: number;
    title: string;
  } | null>(null);
  const [classNotesReady, setClassNotesReady] = useState(false);

  async function applyTeacherSession(session: ApiTeacherSession) {
    // Mot de passe provisoire : rien d'autre n'est accessible avant le changement.
    if (session.mustChangePassword) {
      setPasswordChange(session);
      setPasswordChangeError("");
      return;
    }
    setPasswordChange(null);
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
    const stored = loadTeacherSetupFromBrowser(currentTeacherId);
    setTeacherSetup(stored ?? buildDefaultTeacherSetup(DEMO_CATALOG, currentTeacherId));
    setTeacherSetupReady(true);
  }, [currentTeacherId]);

  useEffect(() => {
    if (!teacherSetupReady) return;
    saveTeacherSetupToBrowser(currentTeacherId, teacherSetup);
  }, [currentTeacherId, teacherSetup, teacherSetupReady]);

  useEffect(() => {
    setClassNotesDocument(loadNotesFromBrowser(currentTeacherId));
    setClassNotesReady(true);
  }, [currentTeacherId]);

  useEffect(() => {
    if (!classNotesReady) return;
    saveNotesToBrowser(currentTeacherId, classNotesDocument);
  }, [classNotesDocument, classNotesReady, currentTeacherId]);

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
  const openNotebookClass = useMemo(
    () => teacherSetup.classes.find((entry) => entry.id === openNotebookClassId) ?? null,
    [openNotebookClassId, teacherSetup.classes],
  );
  const notebookClassroomId = useMemo(
    () => (openNotebookClass ? resolveCatalogClassroomId(openNotebookClass, DEMO_CATALOG) : null),
    [openNotebookClass],
  );
  const notebookSubjectId = useMemo(
    () =>
      openNotebookClass && notebookClassroomId
        ? resolveDefaultSubjectId(
            DEMO_CATALOG,
            currentTeacherId,
            notebookClassroomId,
            openNotebookClass.branchNames,
          )
        : null,
    [currentTeacherId, notebookClassroomId, openNotebookClass],
  );
  const notebookItems = useMemo(() => {
    if (!notebookClassroomId) return [];
    return items.filter(
      (item) => item.classroomId === notebookClassroomId && item.authorTeacherId === currentTeacherId,
    );
  }, [currentTeacherId, items, notebookClassroomId]);
  const notebookCanPublish = Boolean(notebookClassroomId && notebookSubjectId);
  const notebookBlockedReason = !openNotebookClass
    ? undefined
    : !notebookClassroomId
      ? "Cette classe n'est pas reliée au catalogue — publications élèves indisponibles."
      : !notebookSubjectId
        ? "Aucune branche enseignée trouvée pour publier."
        : undefined;
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
      setLoginPending(true);
      setStudentLoginError("");
      try {
        const session = await loginStudentApi(code);
        const access = resolveStudentAccess(DEMO_CATALOG, code.trim());
        if (!access) {
          setStudentLoginError("Code de classe inconnu.");
          showNotice("Code d'accès invalide. Utilisez un identifiant de démonstration.");
          return;
        }
        writeStoredValue(LAST_STUDENT_CODE_KEY, code.trim().toLowerCase());
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
        const message = error instanceof Error ? error.message : "Connexion élève impossible.";
        setStudentLoginError(message);
        showNotice(message);
      } finally {
        setLoginPending(false);
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
        setActiveSection("ma-semaine");
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

  function submitTeacherLogin(initials: string, password: string, remember: boolean) {
    void (async () => {
      setLoginPending(true);
      setLoginError("");
      try {
        const session = await loginTeacherApi(initials.trim(), password.trim(), remember);
        writeStoredValue(LAST_TEACHER_INITIALS_KEY, session.initials);
        await applyTeacherSession(session);
      } catch (error) {
        setLoginError(error instanceof Error ? error.message : "Connexion enseignant impossible.");
      } finally {
        setLoginPending(false);
      }
    })();
  }

  function submitPasswordChange(currentPassword: string, nextPassword: string) {
    const pendingSession = passwordChange;
    if (!pendingSession) return;
    void (async () => {
      setLoginPending(true);
      setPasswordChangeError("");
      try {
        await changeTeacherPasswordApi(currentPassword, nextPassword);
        await applyTeacherSession({ ...pendingSession, mustChangePassword: false });
        showNotice("Mot de passe enregistré.");
      } catch (error) {
        setPasswordChangeError(
          error instanceof Error ? error.message : "Changement de mot de passe impossible.",
        );
      } finally {
        setLoginPending(false);
      }
    })();
  }

  function cancelPasswordChange() {
    void (async () => {
      await logoutApiSession();
      setPasswordChange(null);
      setPasswordChangeError("");
      setTeacherAuthenticated(false);
    })();
  }

  function openAgenda(classroomId: string) {
    setSelectedClassroomId(classroomId);
    setActiveSection("ma-semaine");
    setAgendaView(DEFAULT_TEACHER_AGENDA_VIEW);
    setClassPickerOpen(false);
    setSubjectFilter(ALL_SUBJECTS_FILTER);
    setTeacherFilter(ALL_FILTER);
    setDayFilter(ALL_FILTER);
    setSelectedSchoolWeekNumber(findSchoolWeekForDate(new Date(), schoolWeeksMemo).number);
  }

  function openSharedAgenda(classroomId: string) {
    setSelectedClassroomId(classroomId);
    setActiveSection("ma-semaine");
    setAgendaView("class");
    setClassPickerOpen(false);
    setSubjectFilter(ALL_SUBJECTS_FILTER);
    setTeacherFilter(ALL_FILTER);
    setDayFilter(ALL_FILTER);
    setSelectedSchoolWeekNumber(findSchoolWeekForDate(new Date(), schoolWeeksMemo).number);
  }

  function navigate(section: TeacherNavSection) {
    setActiveSection(section);
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }

  function resetTeacherSetup() {
    setTeacherSetup(buildDefaultTeacherSetup(DEMO_CATALOG, currentTeacherId));
    showNotice("Configuration réinitialisée depuis le catalogue.");
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
    setActiveSection("ma-semaine");
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
    if (pendingNotebookControl) {
      void (async () => {
        try {
          await performNotebookControl(pendingNotebookControl);
          setControlAlert(null);
          setPendingNotebookControl(null);
        } catch (error) {
          showNotice(error instanceof Error ? error.message : "Publication impossible.");
        }
      })();
      return;
    }
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

  function openClassNotebook(classSetup: TeacherClassSetup) {
    setOpenNotebookClassId(classSetup.id);
    setNotebookCenterWeek(selectedSchoolWeekNumber);
    const mappedClassroomId = resolveCatalogClassroomId(classSetup, DEMO_CATALOG);
    if (mappedClassroomId) {
      setSelectedClassroomId(mappedClassroomId);
    }
  }

  function closeClassNotebook() {
    setOpenNotebookClassId(null);
  }

  function shiftNotebookWeeks(direction: -1 | 1) {
    const index = schoolWeeksMemo.findIndex((week) => week.number === notebookCenterWeek);
    if (index < 0) return;
    const target = schoolWeeksMemo[index + direction];
    if (target) setNotebookCenterWeek(target.number);
  }

  async function performNotebookControl(input: {
    classroomId: string;
    subjectId: string;
    schoolWeekNumber: number;
    day: number;
    title: string;
  }) {
    const created = await createAgendaItemApi({
      classroomId: input.classroomId,
      subjectId: input.subjectId,
      day: input.day,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: input.schoolWeekNumber,
      type: "TEST",
      title: input.title.trim(),
      detail: "",
    });
    setItems((previous) => [...previous, created]);
    showNotice("Contrôle planifié.");
  }

  async function notebookCreatePublication(schoolWeekNumber: number, text: string) {
    if (!notebookClassroomId || !notebookSubjectId || !openNotebookClass) return;
    const created = await createAgendaItemApi({
      classroomId: notebookClassroomId,
      subjectId: notebookSubjectId,
      day: weekdayToCourseDayIndex(openNotebookClass.dayOfWeek),
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber,
      type: "HOMEWORK",
      title: text.trim(),
      detail: "",
    });
    setItems((previous) => [...previous, created]);
    showNotice("Publication ajoutée.");
  }

  async function notebookMovePublication(itemId: number, schoolWeekNumber: number) {
    const updated = await updateAgendaItemApi(itemId, { schoolWeekNumber });
    setItems((previous) => previous.map((item) => (item.id === itemId ? updated : item)));
  }

  async function notebookDeletePublication(itemId: number) {
    await deleteAgendaItemApi(itemId);
    setItems((previous) => previous.filter((item) => item.id !== itemId));
  }

  async function notebookSaveControl(input: { schoolWeekNumber: number; day: number; title: string }) {
    if (!notebookClassroomId || !notebookSubjectId) return;
    const alert = evaluateThirdTestAlert(items, DEMO_CATALOG, {
      classroomId: notebookClassroomId,
      type: "TEST",
      courseDay: { schoolWeekNumber: input.schoolWeekNumber, dayIndex: input.day },
    });
    if (alert.triggered) {
      setControlAlert(alert);
      setPendingNotebookControl({
        classroomId: notebookClassroomId,
        subjectId: notebookSubjectId,
        ...input,
      });
      return;
    }
    await performNotebookControl({
      classroomId: notebookClassroomId,
      subjectId: notebookSubjectId,
      ...input,
    });
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
  const showAgendaTools = false;

  if (passwordChange) {
    return (
      <>
        <PasswordChangePanel
          appVersion={APP_VERSION}
          displayName={passwordChange.displayName}
          initials={passwordChange.initials}
          pending={loginPending}
          error={passwordChangeError}
          onSubmit={submitPasswordChange}
          onCancel={cancelPasswordChange}
        />
        {notice && <div className="technical-toast" role="status">✓ &nbsp;{notice}</div>}
      </>
    );
  }

  if (!teacherAuthenticated && !isStudentView) {
    return (
      <>
        <LoginPanel
          appVersion={APP_VERSION}
          pending={loginPending}
          studentError={studentLoginError}
          teacherError={loginError}
          onStudentSubmit={enterStudentWithCode}
          onTeacherSubmit={submitTeacherLogin}
        />
        {notice && <div className="technical-toast" role="status">✓ &nbsp;{notice}</div>}
      </>
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
          {teacherNavSectionsForRole(teacherIsAdmin).map((section) => (
            <button
              key={section}
              className={activeSection === section ? "active" : ""}
              onClick={() => navigate(section)}
            >
              <span>{TEACHER_NAV_ICONS[section]}</span> {TEACHER_NAV_LABELS[section]}
            </button>
          ))}
        </nav>

        <div className="technical-note">
          <span>CLASSES CONFIGURÉES</span>
          <strong>{teacherSetup.classes.filter((entry) => entry.name.trim()).length}</strong>
          <small>Vue personnelle</small>
        </div>
        <button className="signout" onClick={() => setStudentCodeModalOpen(true)}><span>👤</span> Espace élève</button>
        <button className="signout" onClick={logoutTeacher}><span>↪</span> Déconnexion</button>
      </aside>

      <main className="technical-main" id="main-content">
        <header className="technical-header">
          <div className="mobile-lockup"><BrandEmblem /><strong>CAMPUS AGENDA</strong></div>
          <div className="class-identity">
            <span className="eyebrow">Espace enseignant</span>
            <h1>{sectionTitle(activeSection, false, openNotebookClass?.name)}</h1>
            <p>{sectionDescription(activeSection, false, Boolean(openNotebookClass))}</p>
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
            <button className="profile-disc" aria-label="Profil enseignant">{currentTeacher?.initials ?? "FC"}</button>
          </div>
        </header>

        {activeSection === "ma-semaine" && openNotebookClass && (
          <ClassNotebookPanel
            classSetup={openNotebookClass}
            schoolWeeks={schoolWeeksMemo}
            centerWeekNumber={notebookCenterWeek}
            items={notebookItems}
            notesDocument={classNotesDocument}
            canPublish={notebookCanPublish}
            publishBlockedReason={notebookBlockedReason}
            onBack={closeClassNotebook}
            onShiftWeeks={shiftNotebookWeeks}
            onCenterWeekChange={setNotebookCenterWeek}
            onNotesChange={setClassNotesDocument}
            onCreatePublication={notebookCreatePublication}
            onMovePublication={notebookMovePublication}
            onDeletePublication={notebookDeletePublication}
            onSaveControl={notebookSaveControl}
            onDeleteControl={notebookDeletePublication}
            onPreviewStudent={enterTeacherPreview}
          />
        )}

        {activeSection === "ma-semaine" && !openNotebookClass && (
          <MaSemainePanel
            config={teacherSetup}
            schoolWeeks={schoolWeeksMemo}
            selectedSchoolWeekNumber={selectedSchoolWeekNumber}
            onSelectSchoolWeek={setSelectedSchoolWeekNumber}
            onOpenClass={openClassNotebook}
          />
        )}

        {activeSection === "configuration" && (
          <ConfigurationPanel
            config={teacherSetup}
            onChange={setTeacherSetup}
            onReset={resetTeacherSetup}
            onNotice={showNotice}
          />
        )}

        {activeSection === "administration" && teacherIsAdmin && (
          <AdministrationPanel
            currentTeacherId={currentTeacherId}
            onCalendarUpdated={applySchoolCalendarWeeks}
            onNotice={showNotice}
          />
        )}

        <p className="prototype-label">PROTOTYPE INTERACTIF · CAMPUS AGENDA {APP_VERSION}</p>
      </main>

      {notice && <div className="technical-toast" role="status">✓ &nbsp;{notice}</div>}

      {studentCodeModalOpen && (
        <div className="technical-modal-backdrop">
          <section className="technical-modal" role="dialog" aria-modal="true" aria-labelledby="student-code-title">
            <header><div><span className="eyebrow">ESPACE ÉLÈVE</span><h2 id="student-code-title">Connexion anonyme</h2></div><button onClick={() => setStudentCodeModalOpen(false)}>×</button></header>
            <form onSubmit={(event) => { event.preventDefault(); enterStudentWithCode(String(new FormData(event.currentTarget).get("code") || "")); }}>
              <label>Identifiant élève<input name="code" placeholder="eleve-ma2" required /></label>
              <p className="modal-hint">Exemples&nbsp;: <strong>eleve-ma2</strong>, <strong>eleve-mma3a</strong>, <strong>eleve-pai</strong> (une classe de test par code).</p>
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
              <button type="button" onClick={() => { setControlAlert(null); setPendingPublish(null); setPendingNotebookControl(null); }}>×</button>
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
              <button type="button" onClick={() => { setControlAlert(null); setPendingPublish(null); setPendingNotebookControl(null); }}>Modifier la date</button>
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
