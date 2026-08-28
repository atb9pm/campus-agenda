"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEMO_PROTOTYPE_ITEMS, type PrototypeAgendaItem } from "@campus/features/agenda";
import {
  DEMO_CATALOG,
  DEMO_CURRENT_TEACHER_ID,
  getClassroomById,
  getClassroomsForTeacher,
  getSubjectsForClassroom,
  getTeacherById,
} from "@campus/features/classes";
import {
  TEACHER_NAV_ICONS,
  TEACHER_NAV_LABELS,
  DEFAULT_TEACHER_NAV_SECTION,
  teacherNavSectionsForRole,
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
  findSchoolWeekForDate,
  formatCourseDayHeading,
  formatCourseDayMenuLabel,
  formatSchoolWeekLabel,
  listPreviousCourseDays,
  resolveDisplayCourseDay,
  type CourseDaySlot,
  type SchoolWeek,
} from "@campus/features/calendar";
import {
  evaluateThirdTestAlert,
  listUpcomingTestsForClass,
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
  fetchTeacherNotesApi,
  fetchTeacherSetupApi,
  loginStudentApi,
  loginTeacherApi,
  logoutApiSession,
  saveTeacherNotesApi,
  saveTeacherSetupApi,
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
  clearTeacherSetupFromBrowser,
  loadTeacherSetupFromBrowser,
  type TeacherSetupConfig,
  type TeacherClassSetup,
} from "@campus/features/teacher-setup";
import {
  clearNotesFromBrowser,
  createEmptyNotesDocument,
  loadNotesFromBrowser,
  peekNotesFromBrowser,
  resolveCatalogClassroomId,
  resolveDefaultSubjectId,
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

async function loadTeacherAgendaItems(classroomIds: string[]): Promise<PrototypeAgendaItem[]> {
  const batches = await Promise.all(classroomIds.map((classroomId) => fetchAgendaItems(classroomId)));
  const merged = new Map<number, PrototypeAgendaItem>();
  for (const batch of batches) {
    for (const item of batch) merged.set(item.id, item);
  }
  return [...merged.values()].sort((left, right) => left.id - right.id);
}

function BrandEmblem() {
  return <span className="brand-emblem-image" aria-hidden="true">CA</span>;
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
  const [appMode, setAppMode] = useState<AppMode>("teacher");
  const [studentSession, setStudentSession] = useState<StudentAccess | null>(null);
  const [studentEntry, setStudentEntry] = useState<StudentEntry | null>(null);
  const [studentCodeModalOpen, setStudentCodeModalOpen] = useState(false);
  const [selectedSchoolWeekNumber, setSelectedSchoolWeekNumber] = useState(
    () => findSchoolWeekForDate(new Date()).number,
  );
  const [items, setItems] = useState<PrototypeAgendaItem[]>(DEMO_PROTOTYPE_ITEMS);
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
  /** Onglet mobile élève : cours du jour, contrôles, historique. */
  const [studentMobileTab, setStudentMobileTab] = useState<"cours" | "controles" | "historique">("cours");
  const [schoolWeeks, setSchoolWeeks] = useState<SchoolWeek[]>(() => buildSchoolWeeks());
  const [controlAlert, setControlAlert] = useState<ThirdTestAlert | null>(null);
  const [teacherSetup, setTeacherSetup] = useState<TeacherSetupConfig>(() =>
    buildDefaultTeacherSetup(DEMO_CATALOG, currentTeacherId),
  );
  const [teacherSetupReady, setTeacherSetupReady] = useState(false);
  /** Évite d'écrire sur le serveur juste après un chargement / une migration. */
  const skipTeacherSetupSaveRef = useRef(false);
  const [openNotebookClassId, setOpenNotebookClassId] = useState<string | null>(null);
  const [notebookCenterWeek, setNotebookCenterWeek] = useState(selectedSchoolWeekNumber);
  const [classNotesDocument, setClassNotesDocument] = useState<ClassNotesDocument>(() =>
    createEmptyNotesDocument(),
  );
  const [pendingNotebookControl, setPendingNotebookControl] = useState<{
    classroomId: string;
    subjectId: string;
    schoolWeekNumber: number;
    day: number;
    title: string;
  } | null>(null);
  const [classNotesReady, setClassNotesReady] = useState(false);
  /** Évite d'écrire sur le serveur juste après un chargement / une migration. */
  const skipClassNotesSaveRef = useRef(false);

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

  // Le stockage local n'existe pas au rendu serveur : la configuration et les
  // notes ne peuvent être relues qu'après montage, donc dans un effet.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!teacherAuthenticated) {
      setTeacherSetupReady(false);
      return;
    }

    let cancelled = false;
    setTeacherSetupReady(false);

    async function loadTeacherSetup() {
      const fallback = () =>
        loadTeacherSetupFromBrowser(currentTeacherId) ??
        buildDefaultTeacherSetup(DEMO_CATALOG, currentTeacherId);

      try {
        const remote = await fetchTeacherSetupApi();
        if (cancelled) return;

        if (remote) {
          skipTeacherSetupSaveRef.current = true;
          setTeacherSetup(remote);
          clearTeacherSetupFromBrowser(currentTeacherId);
          setTeacherSetupReady(true);
          return;
        }

        const local = loadTeacherSetupFromBrowser(currentTeacherId);
        if (local) {
          const saved = await saveTeacherSetupApi(local);
          if (cancelled) return;
          skipTeacherSetupSaveRef.current = true;
          setTeacherSetup(saved);
          clearTeacherSetupFromBrowser(currentTeacherId);
          setTeacherSetupReady(true);
          return;
        }

        skipTeacherSetupSaveRef.current = true;
        setTeacherSetup(buildDefaultTeacherSetup(DEMO_CATALOG, currentTeacherId));
        setTeacherSetupReady(true);
      } catch {
        if (cancelled) return;
        skipTeacherSetupSaveRef.current = true;
        setTeacherSetup(fallback());
        setTeacherSetupReady(true);
      }
    }

    void loadTeacherSetup();
    return () => {
      cancelled = true;
    };
  }, [currentTeacherId, teacherAuthenticated]);

  useEffect(() => {
    if (!teacherAuthenticated || !teacherSetupReady) return;
    if (skipTeacherSetupSaveRef.current) {
      skipTeacherSetupSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void saveTeacherSetupApi(teacherSetup).catch(() => {
        // La config reste en mémoire ; nouvel essai au prochain changement.
      });
    }, 400);

    return () => window.clearTimeout(timer);
  }, [currentTeacherId, teacherAuthenticated, teacherSetup, teacherSetupReady]);

  useEffect(() => {
    if (!teacherAuthenticated) {
      setClassNotesReady(false);
      return;
    }

    let cancelled = false;
    setClassNotesReady(false);

    async function loadClassNotes() {
      const fallback = () =>
        peekNotesFromBrowser(currentTeacherId) ??
        loadNotesFromBrowser(currentTeacherId);

      try {
        const remote = await fetchTeacherNotesApi();
        if (cancelled) return;

        if (remote) {
          skipClassNotesSaveRef.current = true;
          setClassNotesDocument(remote);
          clearNotesFromBrowser(currentTeacherId);
          setClassNotesReady(true);
          return;
        }

        const local = peekNotesFromBrowser(currentTeacherId);
        if (local) {
          const saved = await saveTeacherNotesApi(local);
          if (cancelled) return;
          skipClassNotesSaveRef.current = true;
          setClassNotesDocument(saved);
          clearNotesFromBrowser(currentTeacherId);
          setClassNotesReady(true);
          return;
        }

        skipClassNotesSaveRef.current = true;
        setClassNotesDocument(createEmptyNotesDocument());
        setClassNotesReady(true);
      } catch {
        if (cancelled) return;
        skipClassNotesSaveRef.current = true;
        setClassNotesDocument(fallback());
        setClassNotesReady(true);
      }
    }

    void loadClassNotes();
    return () => {
      cancelled = true;
    };
  }, [currentTeacherId, teacherAuthenticated]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!teacherAuthenticated || !classNotesReady) return;
    if (skipClassNotesSaveRef.current) {
      skipClassNotesSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void saveTeacherNotesApi(classNotesDocument).catch(() => {
        // Les notes restent en mémoire ; nouvel essai au prochain changement.
      });
    }, 400);

    return () => window.clearTimeout(timer);
  }, [classNotesDocument, classNotesReady, currentTeacherId, teacherAuthenticated]);

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

  const selectedClassroom = (isStudentView ? studentClassroom : getClassroomById(DEMO_CATALOG, selectedClassroomId)) ?? DEMO_CATALOG.classrooms[0];

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

  function resetSelectedWeek() {
    setSelectedSchoolWeekNumber(findSchoolWeekForDate(new Date(), schoolWeeksMemo).number);
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
    resetSelectedWeek();
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
        resetSelectedWeek();
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

  function dismissControlAlert() {
    setControlAlert(null);
    setPendingNotebookControl(null);
  }

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (studentCodeModalOpen) setStudentCodeModalOpen(false);
      if (controlAlert) dismissControlAlert();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [studentCodeModalOpen, controlAlert]);

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

  function confirmControlDespiteAlert() {
    if (!pendingNotebookControl) return;
    void (async () => {
      try {
        await performNotebookControl(pendingNotebookControl);
        dismissControlAlert();
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
      <div className="mechanical-app student-app student-course-day-app has-mobile-tabs" data-student-tab={studentMobileTab}>
        <main className="student-course-day-main" id="main-content">
          <header className="student-course-day-header">
            <div className="student-course-day-brand">
              <BrandEmblem />
              <span><strong>CAMPUS</strong><small>AGENDA</small></span>
            </div>
            <div className="student-course-day-actions desktop-only">
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

          <section
            className="student-course-day-card student-mobile-panel"
            data-panel="cours"
            aria-labelledby="student-course-day-title"
          >
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

          <section
            className="student-upcoming-tests student-mobile-panel"
            data-panel="controles"
            aria-labelledby="student-upcoming-tests-title"
          >
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

          <section
            className="student-history-panel student-mobile-panel mobile-only"
            data-panel="historique"
            aria-labelledby="student-history-title"
          >
            <h2 id="student-history-title">Cours précédents</h2>
            {!studentFollowingCourseDay && (
              <button
                type="button"
                className="student-history-current"
                onClick={() => {
                  setStudentCourseDayKey(null);
                  setStudentMobileTab("cours");
                }}
              >
                Revenir au prochain cours
              </button>
            )}
            {studentPreviousCourseDays.length ? (
              <ul className="student-history-list">
                {studentPreviousCourseDays.map((slot) => (
                  <li key={courseDayKey(slot)}>
                    <button
                      type="button"
                      onClick={() => {
                        setStudentCourseDayKey(courseDayKey(slot));
                        setStudentMobileTab("cours");
                      }}
                    >
                      {formatCourseDayMenuLabel(slot)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="student-history-empty">Aucun cours précédent disponible.</p>
            )}
          </section>

          <p className="prototype-label">CONSULTATION ÉLÈVE · CAMPUS AGENDA {APP_VERSION}</p>
        </main>

        <nav className="mobile-tab-bar" aria-label="Navigation élève">
          <button
            type="button"
            className={studentMobileTab === "cours" ? "active" : ""}
            onClick={() => setStudentMobileTab("cours")}
          >
            <span aria-hidden="true">▣</span>
            Cours
          </button>
          <button
            type="button"
            className={studentMobileTab === "controles" ? "active" : ""}
            onClick={() => setStudentMobileTab("controles")}
          >
            <span aria-hidden="true">✓</span>
            Contrôles
          </button>
          <button
            type="button"
            className={studentMobileTab === "historique" ? "active" : ""}
            onClick={() => setStudentMobileTab("historique")}
          >
            <span aria-hidden="true">↺</span>
            Passés
          </button>
          <button type="button" onClick={exitStudentMode}>
            <span aria-hidden="true">↪</span>
            {studentEntry === "teacher-preview" ? "Quitter" : "Sortir"}
          </button>
        </nav>

        {notice && <div className="technical-toast" role="status">✓ &nbsp;{notice}</div>}
      </div>
    );
  }

  return (
    <div className="mechanical-app has-mobile-tabs">
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

      
      <nav className="mobile-tab-bar" aria-label="Navigation enseignant">
        {teacherNavSectionsForRole(teacherIsAdmin).map((section) => (
          <button
            key={section}
            type="button"
            className={activeSection === section ? "active" : ""}
            onClick={() => navigate(section)}
          >
            <span aria-hidden="true">{TEACHER_NAV_ICONS[section]}</span>
            {TEACHER_NAV_LABELS[section]}
          </button>
        ))}
        <button type="button" onClick={() => setStudentCodeModalOpen(true)}>
          <span aria-hidden="true">👤</span>
          Élève
        </button>
        <button type="button" onClick={logoutTeacher}>
          <span aria-hidden="true">↪</span>
          Sortir
        </button>
      </nav>

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
              <button type="button" onClick={dismissControlAlert}>×</button>
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
              <button type="button" onClick={dismissControlAlert}>Modifier la date</button>
              <button type="button" className="confirm-anyway" onClick={confirmControlDespiteAlert}>Publier quand même</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
