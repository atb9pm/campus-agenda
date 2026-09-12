"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type PrototypeAgendaItem } from "@campus/features/agenda";
import {
  DEMO_CATALOG,
  DEMO_CURRENT_TEACHER_ID,
  getSubjectsForClassroom,
  type ClassroomCatalog,
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
  studentAccessFromApiSession,
} from "@campus/features/student";
import type { StudentAccess, TeacherClassAccessView } from "@campus/types/student-access";
import {
  buildSchoolWeeksFromEntries,
  courseDayKey,
  findSchoolWeekForDate,
  formatCourseDayHeading,
  formatCourseDayMenuLabel,
  formatSchoolWeekLabel,
  listPreviousAttendanceCourseDays,
  listPreviousCourseDays,
  resolveDisplayCourseDay,
  resolveDisplayCourseDayFromAttendance,
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
  createNotebookPublicationApi,
  ensureNotebookRuntimeApi,
  ControlCoordinationRequiredError,
  deleteAgendaItemApi,
  fetchAgendaItems,
  fetchApiSession,
  fetchSchoolCalendar,
  fetchTeacherClassroomsApi,
  fetchTeacherClassAccessesApi,
  fetchTeacherCoursesApi,
  fetchTeacherNotesApi,
  fetchTeacherSetupApi,
  loginStudentApi,
  loginTeacherApi,
  logoutApiSession,
  startAdminMfaSetupApi,
  confirmAdminMfaSetupApi,
  verifyAdminMfaApi,
  fetchAgendaView,
  saveTeacherNotesApi,
  saveTeacherSetupApi,
  updateAgendaItemApi,
  type ApiTeacherSession,
  type SchoolCalendarWeek,
} from "../lib/api-client.ts";
import { APP_VERSION } from "@campus/lib/app-version";
import {
  acknowledgeMfaRecoveryCodes,
  shouldShowMfaEnrollmentScreen,
} from "@campus/features/admin-mfa/recovery-continue.ts";
import {
  LAST_TEACHER_INITIALS_KEY,
  authenticatedTeacherFromSession,
  profileDiscInitials,
  writeStoredValue,
  type AuthenticatedTeacherIdentity,
} from "@campus/features/auth-entry";
import {
  clearTeacherSetupFromBrowser,
  emptyTeacherSetup,
  loadTeacherSetupFromBrowser,
  type TeacherSetupConfig,
  type TeacherClassSetup,
} from "@campus/features/teacher-setup";
import {
  displaySetupsFromAssignedCourses,
  type TeacherCourseWorkspaceEntry,
} from "@campus/features/teacher-workspace";
import {
  clearNotesFromBrowser,
  createEmptyNotesDocument,
  filterNotebookItemsForSubject,
  implicitNotebookPublishCourse,
  loadNotesFromBrowser,
  notebookContextFromCourse,
  notebookPublishBlockedReason,
  openCourseInWeekTarget,
  peekNotesFromBrowser,
  resolveNotebookClassroomId,
  resolveNotebookSubjectId,
  workspaceAllowsNotebookPublish,
  weekdayToCourseDayIndex,
  cloneRichDoc,
  composeWeekPublicationDoc,
  decodeRichDetail,
  isCarnetOwnedPublication,
  isPlaceholderDetail,
  planCarnetWeekPublicationSave,
  previousSchoolWeekNumber,
  type CampusRichDoc,
  type ClassNotesDocument,
  type NotebookCourseContext,
  type NotebookRuntimeClassroom,
} from "@campus/features/class-notebook";
import { RichDocView } from "./components/rich-doc-view.tsx";
import { ConfigurationPanel } from "./components/configuration-panel.tsx";
import { AdministrationPanel } from "./components/administration-panel.tsx";
import { LoginPanel } from "./components/login-panel.tsx";
import { PasswordChangePanel } from "./components/password-change-panel.tsx";
import { MfaChallengePanel } from "./components/mfa-challenge-panel.tsx";
import { MfaSetupPanel } from "./components/mfa-setup-panel.tsx";
import { ClassNotebookPanel } from "./components/class-notebook-panel.tsx";
import { MaSemainePanel } from "./components/ma-semaine-panel.tsx";
import { MesCoursPanel } from "./components/mes-cours-panel.tsx";
import { ControlPlanningPanel } from "./components/control-planning-panel.tsx";

type AppMode = "teacher" | "student";
type StudentEntry = "code" | "teacher-preview";

const TYPE_LABELS: Record<AgendaItemType, string> = {
  HOMEWORK: "Devoir",
  TEST: "Contrôle",
  INFORMATION: "Information",
};

const EMPTY_CLASSROOM_CATALOG: ClassroomCatalog = {
  classrooms: [],
  subjects: [],
  memberships: [],
  teachers: [],
};

function catalogFromRuntime(runtime: NotebookRuntimeClassroom[]): ClassroomCatalog {
  return {
    classrooms: runtime.map((classroom) => ({
      id: classroom.id,
      name: classroom.name,
      programLabel: "",
      accessCodeHint: "",
    })),
    subjects: runtime.flatMap((classroom) =>
      (classroom.subjects ?? []).map((subject) => ({
        id: subject.id,
        name: subject.name,
        classroomId: classroom.id,
        annualCourseId: subject.annualCourseId ?? null,
      })),
    ),
    memberships: [],
    teachers: [],
  };
}

function upsertAgendaItem(previous: PrototypeAgendaItem[], item: PrototypeAgendaItem): PrototypeAgendaItem[] {
  const index = previous.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    const next = previous.slice();
    next[index] = item;
    return next;
  }
  return [...previous, item];
}

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

function formatTeacherYearHeading(label: string): string {
  return label.replace(/^(\d{4})-(\d{4})$/, "$1–$2");
}

function sectionTitle(
  activeSection: TeacherNavSection,
  isStudentView: boolean,
  notebookClassName?: string,
  schoolYearLabel?: string | null,
) {
  if (isStudentView) return "Mon agenda";
  if (notebookClassName) return `Carnet · ${notebookClassName}`;
  if (activeSection === "mes-cours") return "Mes cours";
  if (activeSection === "controles") {
    return schoolYearLabel ? `Contrôles — ${formatTeacherYearHeading(schoolYearLabel)}` : "Contrôles";
  }
  if (activeSection === "ma-semaine") return "Ma semaine";
  if (activeSection === "administration") return "Administration";
  return "Préférences";
}

function sectionDescription(activeSection: TeacherNavSection, isStudentView: boolean, notebookOpen: boolean) {
  if (isStudentView) return "Consultation anonyme — agenda complet de la classe, toutes branches confondues.";
  if (notebookOpen) {
    return "Contrôles, publications élèves et notes prof — semaine par semaine.";
  }
  if (activeSection === "mes-cours") {
    return "Cours qui vous sont attribués pour l’année scolaire active.";
  }
  if (activeSection === "controles") {
    return "Planification des contrôles publiés dans l’agenda.";
  }
  if (activeSection === "ma-semaine") {
    return "Vos cours attribués, organisés selon vos préférences d’affichage.";
  }
  if (activeSection === "administration") {
    return "Référentiel école : classes, branches, accès et année scolaire.";
  }
  return "Préférences d’affichage : jour visible et icône. Ce n’est pas une attribution.";
}

export default function Home() {
  const [currentTeacherId, setCurrentTeacherId] = useState(DEMO_CURRENT_TEACHER_ID);
  const [authenticatedTeacher, setAuthenticatedTeacher] = useState<AuthenticatedTeacherIdentity | null>(null);
  const [runtimeClassrooms, setRuntimeClassrooms] = useState<NotebookRuntimeClassroom[]>([]);
  const teacherClassrooms = useMemo(() => {
    return runtimeClassrooms.map((classroom) => ({
      id: classroom.id,
      name: classroom.name,
      programLabel: "",
      accessCodeHint: "",
    }));
  }, [runtimeClassrooms]);
  const defaultClassroomId = teacherClassrooms[0]?.id ?? "";

  const [activeSection, setActiveSection] = useState<TeacherNavSection>(DEFAULT_TEACHER_NAV_SECTION);
  const [selectedClassroomId, setSelectedClassroomId] = useState(defaultClassroomId);
  const [appMode, setAppMode] = useState<AppMode>("teacher");
  const [studentSession, setStudentSession] = useState<StudentAccess | null>(null);
  const [studentClassroomName, setStudentClassroomName] = useState("");
  const [attendanceDays, setAttendanceDays] = useState<Array<{
    dayOfWeek: 1 | 2 | 3 | 4 | 5;
    weekKind: "all" | "A" | "B";
    role: "PRIMARY" | "ADDITIONAL";
  }>>([]);
  const [studentEntry, setStudentEntry] = useState<StudentEntry | null>(null);
  const [studentCodeModalOpen, setStudentCodeModalOpen] = useState(false);
  const [selectedSchoolWeekNumber, setSelectedSchoolWeekNumber] = useState(1);
  const [items, setItems] = useState<PrototypeAgendaItem[]>([]);
  const [notice, setNotice] = useState("");
  const [teacherAuthenticated, setTeacherAuthenticated] = useState(false);
  const [teacherIsAdmin, setTeacherIsAdmin] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [studentLoginError, setStudentLoginError] = useState("");
  const [passwordChange, setPasswordChange] = useState<ApiTeacherSession | null>(null);
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [mfaGate, setMfaGate] = useState<ApiTeacherSession | null>(null);
  const [mfaError, setMfaError] = useState("");
  const [mfaQrDataUrl, setMfaQrDataUrl] = useState<string | null>(null);
  const [mfaManualKey, setMfaManualKey] = useState<string | null>(null);
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[] | null>(null);
  const [studentCourseDayKey, setStudentCourseDayKey] = useState<string | null>(null);
  const [studentHistoryOpen, setStudentHistoryOpen] = useState(false);
  /** Onglet mobile élève : cours du jour, contrôles, historique. */
  const [studentMobileTab, setStudentMobileTab] = useState<"cours" | "controles" | "historique">("cours");
  const [schoolWeeks, setSchoolWeeks] = useState<SchoolWeek[]>([]);
  const [controlAlert, setControlAlert] = useState<ThirdTestAlert | null>(null);
  const [teacherSetup, setTeacherSetup] = useState<TeacherSetupConfig>(() => emptyTeacherSetup());
  const [teacherSetupReady, setTeacherSetupReady] = useState(false);
  const [teacherCourses, setTeacherCourses] = useState<TeacherCourseWorkspaceEntry[]>([]);
  const [teacherClassAccesses, setTeacherClassAccesses] = useState<Record<string, TeacherClassAccessView>>({});
  const [teacherCoursesYearLabel, setTeacherCoursesYearLabel] = useState<string | null>(null);
  const [teacherCoursesReady, setTeacherCoursesReady] = useState(false);
  const [teacherCoursesError, setTeacherCoursesError] = useState("");
  /** Évite d'écrire sur le serveur juste après un chargement / une migration. */
  const skipTeacherSetupSaveRef = useRef(false);
  const [openNotebookClassId, setOpenNotebookClassId] = useState<string | null>(null);
  const [openNotebookCourse, setOpenNotebookCourse] = useState<NotebookCourseContext | null>(null);
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
  const loadedAgendaClassroomIdsRef = useRef<Set<string>>(new Set());

  async function applyTeacherSession(session: ApiTeacherSession) {
    // Mot de passe provisoire : rien d'autre n'est accessible avant le changement.
    if (session.mustChangePassword) {
      setPasswordChange(session);
      setPasswordChangeError("");
      setMfaGate(null);
      return;
    }
    if (session.isAdmin && (session.mfaSetupRequired || session.mfaChallengeRequired)) {
      setPasswordChange(null);
      setMfaGate(session);
      setMfaError("");
      if (session.mfaChallengeRequired) {
        setMfaQrDataUrl(null);
        setMfaManualKey(null);
        setMfaRecoveryCodes(null);
      }
      return;
    }
    setPasswordChange(null);
    setMfaGate(null);
    setAuthenticatedTeacher(authenticatedTeacherFromSession(session));
    setCurrentTeacherId(session.teacherId);
    setTeacherIsAdmin(Boolean(session.isAdmin));
    setAppMode("teacher");
    setTeacherAuthenticated(true);
    setStudentSession(null);
    setStudentEntry(null);
    setOpenNotebookCourse(null);
    setLoginError("");
    const fallbackIds: string[] = [];
    let classroomIds = fallbackIds;
    try {
      const runtime = await fetchTeacherClassroomsApi();
      setRuntimeClassrooms(runtime);
      classroomIds = runtime.map((entry) => entry.id);
    } catch (loadError) {
      setRuntimeClassrooms([]);
      classroomIds = [];
      setNotice(loadError instanceof Error ? loadError.message : "Chargement des classes impossible.");
    }
    const loadedItems = await loadTeacherAgendaItems(classroomIds);
    setItems(loadedItems);
    loadedAgendaClassroomIdsRef.current = new Set(classroomIds);
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
        loadTeacherSetupFromBrowser(currentTeacherId) ?? emptyTeacherSetup();

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
        setTeacherSetup(emptyTeacherSetup());
        setTeacherSetupReady(true);
      } catch {
        if (cancelled) return;
        skipTeacherSetupSaveRef.current = true;
        setTeacherSetup(fallback());
        setTeacherSetupReady(true);
        setNotice("Chargement de la configuration impossible.");
      }
    }

    void loadTeacherSetup();
    return () => {
      cancelled = true;
    };
  }, [currentTeacherId, teacherAuthenticated]);

  useEffect(() => {
    if (!teacherAuthenticated) {
      setTeacherCoursesReady(false);
      setTeacherCoursesError("");
      setTeacherCourses([]);
      setTeacherClassAccesses({});
      setTeacherCoursesYearLabel(null);
      return;
    }

    let cancelled = false;
    setTeacherCoursesReady(false);
    setTeacherCoursesError("");

    async function loadTeacherCourses() {
      try {
        const payload = await fetchTeacherCoursesApi();
        if (cancelled) return;
        setTeacherCourses(payload.courses);
        setTeacherClassAccesses(payload.classAccesses);
        setTeacherCoursesYearLabel(payload.courses[0]?.schoolYearLabel ?? null);
        setTeacherCoursesError("");
        setTeacherCoursesReady(true);
        try {
          const accesses = await fetchTeacherClassAccessesApi();
          if (cancelled) return;
          setTeacherClassAccesses(accesses.classAccesses);
        } catch {
          // Conservez les codes déjà reçus avec les cours.
        }
      } catch (loadError) {
        if (cancelled) return;
        setTeacherCourses([]);
        setTeacherClassAccesses({});
        setTeacherCoursesYearLabel(null);
        setTeacherCoursesError(
          loadError instanceof Error ? loadError.message : "Chargement des cours impossible.",
        );
        setTeacherCoursesReady(true);
      }
    }

    void loadTeacherCourses();
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
            if (cancelled) return;
            if (calendar.configured && calendar.weeks.length) {
              const weeks = buildSchoolWeeksFromEntries(calendar.weeks);
              setSchoolWeeks(weeks);
              try {
                setSelectedSchoolWeekNumber(findSchoolWeekForDate(new Date(), weeks).number);
              } catch {
                setSelectedSchoolWeekNumber(weeks[0]?.number ?? 1);
              }
            } else {
              setSchoolWeeks([]);
            }
          })
          .catch(() => {
            if (!cancelled) setSchoolWeeks([]);
          });

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
          const access = studentAccessFromApiSession(session);
          setStudentSession(access);
          setStudentClassroomName(session.classroomName ?? "");
          setSelectedClassroomId(session.classroomId);
          setStudentEntry("code");
          setAppMode("student");
          void fetchAgendaView(session.classroomId)
            .then((view) => {
              if (!cancelled) {
                setItems(view.items);
                setAttendanceDays(view.attendanceDays.map((day) => ({
                  dayOfWeek: day.dayOfWeek as 1 | 2 | 3 | 4 | 5,
                  weekKind: day.weekKind,
                  role: day.role === "PRIMARY" ? "PRIMARY" : "ADDITIONAL",
                })));
              }
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
  const studentClassroom = studentSession
    ? (getStudentClassroom(DEMO_CATALOG, studentSession) ?? {
        id: studentSession.classroomId,
        name: studentClassroomName || studentSession.classroomId,
        programLabel: "",
        accessCodeHint: "",
      })
    : null;

  const selectedClassroom = isStudentView
    ? studentClassroom
    : (teacherClassrooms.find((classroom) => classroom.id === selectedClassroomId)
      ?? teacherClassrooms[0]
      ?? null);

  const schoolWeeksMemo = schoolWeeks;
  const assignedDisplaySetups = useMemo(
    () => displaySetupsFromAssignedCourses(teacherCourses, teacherSetup),
    [teacherCourses, teacherSetup],
  );
  const openNotebookClass = useMemo(
    () => assignedDisplaySetups.find((entry) => entry.id === openNotebookClassId) ?? null,
    [openNotebookClassId, assignedDisplaySetups],
  );
  const notebookClassroomId = useMemo(
    () =>
      openNotebookClass
        ? resolveNotebookClassroomId(
            openNotebookClass,
            runtimeClassrooms,
            EMPTY_CLASSROOM_CATALOG,
            openNotebookCourse?.classId ?? openNotebookClass.id,
          )
        : null,
    [openNotebookClass, openNotebookCourse, runtimeClassrooms],
  );
  const notebookRuntimeSubjects = useMemo(
    () => runtimeClassrooms.find((entry) => entry.id === notebookClassroomId)?.subjects,
    [notebookClassroomId, runtimeClassrooms],
  );
  const notebookSubjectId = useMemo(
    () =>
      openNotebookClass && notebookClassroomId
        ? resolveNotebookSubjectId({
            catalog: catalogFromRuntime(runtimeClassrooms),
            teacherId: currentTeacherId,
            classroomId: notebookClassroomId,
            branchLabel: openNotebookCourse?.branchLabel ?? openNotebookClass.branchNames[0] ?? null,
            annualCourseId: openNotebookCourse?.annualCourseId ?? null,
            runtimeSubjects: notebookRuntimeSubjects,
            strict: Boolean(openNotebookCourse),
          })
        : null,
    [
      currentTeacherId,
      notebookClassroomId,
      notebookRuntimeSubjects,
      openNotebookClass,
      openNotebookCourse,
      runtimeClassrooms,
    ],
  );
  const implicitNotebookCourse = useMemo(
    () => implicitNotebookPublishCourse(teacherCourses, openNotebookClass?.id),
    [openNotebookClass, teacherCourses],
  );
  const notebookPublishAnnualCourseId =
    openNotebookCourse?.annualCourseId ?? implicitNotebookCourse?.annualCourseId ?? null;
  const notebookItems = useMemo(() => {
    if (!notebookClassroomId) return [];
    return filterNotebookItemsForSubject(items, {
      classroomId: notebookClassroomId,
      teacherId: currentTeacherId,
      subjectId: notebookSubjectId,
      annualCourseId: openNotebookCourse?.annualCourseId ?? null,
      restrictToSubject: Boolean(openNotebookCourse),
    });
  }, [currentTeacherId, items, notebookClassroomId, notebookSubjectId, openNotebookCourse]);
  const notebookCanPublish = notebookPublishAnnualCourseId
    ? workspaceAllowsNotebookPublish(teacherCourses, notebookPublishAnnualCourseId)
    : Boolean(notebookClassroomId && notebookSubjectId);
  const notebookBlockedReason = notebookPublishBlockedReason({
    hasOpenClass: Boolean(openNotebookClass),
    annualCourseId: notebookPublishAnnualCourseId,
    assignedToCourse: notebookCanPublish,
    classroomId: notebookClassroomId,
    subjectId: notebookSubjectId,
  });

  useEffect(() => {
    if (!teacherAuthenticated || !notebookClassroomId) return;
    if (loadedAgendaClassroomIdsRef.current.has(notebookClassroomId)) return;
    loadedAgendaClassroomIdsRef.current.add(notebookClassroomId);
    let cancelled = false;
    void fetchAgendaItems(notebookClassroomId)
      .then((batch) => {
        if (cancelled) return;
        setItems((previous) => {
          const merged = new Map(previous.map((item) => [item.id, item]));
          for (const item of batch) merged.set(item.id, item);
          return [...merged.values()].sort((left, right) => left.id - right.id);
        });
      })
      .catch(() => {
        loadedAgendaClassroomIdsRef.current.delete(notebookClassroomId);
      });
    return () => {
      cancelled = true;
    };
  }, [notebookClassroomId, teacherAuthenticated]);

  const studentAutoCourseDay = useMemo(() => {
    if (!schoolWeeksMemo.length) return null;
    return (
      (attendanceDays.length
        ? resolveDisplayCourseDayFromAttendance(new Date(), schoolWeeksMemo, attendanceDays)
        : null) ?? resolveDisplayCourseDay(new Date(), schoolWeeksMemo)
    );
  }, [attendanceDays, schoolWeeksMemo]);

  const studentCourseDayCatalog = useMemo(() => {
    const unique = new Map<string, CourseDaySlot>();
    if (!studentAutoCourseDay || !schoolWeeksMemo.length) return unique;
    const previous = attendanceDays.length
      ? listPreviousAttendanceCourseDays(studentAutoCourseDay.date, 20, schoolWeeksMemo, attendanceDays)
      : listPreviousCourseDays(studentAutoCourseDay.date, 20, schoolWeeksMemo);
    const all = [studentAutoCourseDay, ...previous];
    for (const slot of all) {
      unique.set(courseDayKey(slot), slot);
    }
    return unique;
  }, [studentAutoCourseDay, schoolWeeksMemo, attendanceDays]);

  const studentDisplayCourseDay = useMemo(() => {
    if (studentCourseDayKey && studentCourseDayCatalog.has(studentCourseDayKey)) {
      return studentCourseDayCatalog.get(studentCourseDayKey)!;
    }
    return studentAutoCourseDay;
  }, [studentAutoCourseDay, studentCourseDayCatalog, studentCourseDayKey]);

  const studentPreviousCourseDays = useMemo(() => {
    if (!studentDisplayCourseDay || !schoolWeeksMemo.length) return [];
    return attendanceDays.length
      ? listPreviousAttendanceCourseDays(studentDisplayCourseDay.date, 12, schoolWeeksMemo, attendanceDays)
      : listPreviousCourseDays(studentDisplayCourseDay.date, 12, schoolWeeksMemo);
  }, [attendanceDays, studentDisplayCourseDay, schoolWeeksMemo]);

  const studentCourseDayGroups = useMemo(() => {
    if (!studentSession || !studentDisplayCourseDay) return [];
    const classroomItems = getStudentAgendaItems(items, studentSession.classroomId);
    const dayItems = filterItemsForCourseDay(classroomItems, studentDisplayCourseDay);
    const runtimeSubjects = runtimeClassrooms.find((entry) => entry.id === studentSession.classroomId)?.subjects ?? [];
    const subjects = runtimeSubjects.length
      ? runtimeSubjects.map((subject) => ({
          id: subject.id,
          name: subject.name,
          classroomId: studentSession.classroomId,
          annualCourseId: subject.annualCourseId ?? null,
        }))
      : getSubjectsForClassroom(DEMO_CATALOG, studentSession.classroomId);
    return groupItemsBySubject(dayItems, subjects);
  }, [studentSession, items, studentDisplayCourseDay, runtimeClassrooms]);

  const studentFollowingCourseDay = useMemo(() => {
    if (!studentDisplayCourseDay || !studentAutoCourseDay) return true;
    return courseDayKey(studentDisplayCourseDay) === courseDayKey(studentAutoCourseDay);
  }, [studentDisplayCourseDay, studentAutoCourseDay]);

  const studentUpcomingTests = useMemo(() => {
    if (!studentSession || !studentAutoCourseDay) return [];
    return listUpcomingTestsForClass(
      items,
      catalogFromRuntime(runtimeClassrooms).classrooms.length
        ? catalogFromRuntime(runtimeClassrooms)
        : DEMO_CATALOG,
      studentSession.classroomId,
      studentAutoCourseDay,
      schoolWeeksMemo,
    );
  }, [studentSession, items, studentAutoCourseDay, schoolWeeksMemo, runtimeClassrooms]);

  function resetSelectedWeek() {
    if (!schoolWeeksMemo.length) {
      setSelectedSchoolWeekNumber(1);
      return;
    }
    try {
      setSelectedSchoolWeekNumber(findSchoolWeekForDate(new Date(), schoolWeeksMemo).number);
    } catch {
      setSelectedSchoolWeekNumber(schoolWeeksMemo[0]?.number ?? 1);
    }
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
        const access = studentAccessFromApiSession(session);
        setStudentSession(access);
        setStudentClassroomName(session.classroomName ?? "");
        setSelectedClassroomId(session.classroomId);
        setStudentEntry("code");
        setAppMode("student");
        setStudentCourseDayKey(null);
        setStudentHistoryOpen(false);
        setStudentCodeModalOpen(false);
        resetSelectedWeek();
        const view = await fetchAgendaView(session.classroomId);
        setItems(view.items);
        setAttendanceDays(view.attendanceDays.map((day) => ({
          dayOfWeek: day.dayOfWeek as 1 | 2 | 3 | 4 | 5,
          weekKind: day.weekKind,
          role: day.role === "PRIMARY" ? "PRIMARY" : "ADDITIONAL",
        })));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Connexion élève impossible.";
        setStudentLoginError(message);
        showNotice(message);
      } finally {
        setLoginPending(false);
      }
    })();
  }

  function clearTeacherAuthIdentity() {
    setAuthenticatedTeacher(null);
    setTeacherAuthenticated(false);
    setTeacherIsAdmin(false);
    setOpenNotebookCourse(null);
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
      clearTeacherAuthIdentity();
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
        const nextSession = await fetchApiSession();
        if (nextSession?.kind === "teacher") {
          await applyTeacherSession(nextSession);
        } else {
          await applyTeacherSession({ ...pendingSession, mustChangePassword: false });
        }
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
      setMfaGate(null);
      clearTeacherAuthIdentity();
    })();
  }

  function startAdminMfaSetup() {
    void (async () => {
      setLoginPending(true);
      setMfaError("");
      try {
        const setup = await startAdminMfaSetupApi();
        setMfaQrDataUrl(setup.qrDataUrl);
        setMfaManualKey(setup.manualKey);
      } catch (error) {
        setMfaError(error instanceof Error ? error.message : "Configuration 2FA impossible.");
      } finally {
        setLoginPending(false);
      }
    })();
  }

  function submitAdminMfaSetup(code: string) {
    void (async () => {
      setLoginPending(true);
      setMfaError("");
      try {
        const result = await confirmAdminMfaSetupApi(code);
        setMfaRecoveryCodes(result.recoveryCodes);
        setMfaGate(result.session);
        setMfaQrDataUrl(null);
        setMfaManualKey(null);
      } catch (error) {
        setMfaError(error instanceof Error ? error.message : "Code incorrect.");
      } finally {
        setLoginPending(false);
      }
    })();
  }

  function continueAfterMfaRecovery() {
    if (!mfaGate) return;
    const cleared = acknowledgeMfaRecoveryCodes();
    setMfaRecoveryCodes(cleared.recoveryCodes);
    setMfaQrDataUrl(cleared.qrDataUrl);
    setMfaManualKey(cleared.manualKey);
    void applyTeacherSession({
      ...mfaGate,
      mfaPending: cleared.mfaPending,
      mfaSetupRequired: cleared.mfaSetupRequired,
      mfaChallengeRequired: cleared.mfaChallengeRequired,
    });
  }

  function submitAdminMfaChallenge(code: string) {
    void (async () => {
      setLoginPending(true);
      setMfaError("");
      try {
        const session = await verifyAdminMfaApi(code);
        await applyTeacherSession(session);
      } catch (error) {
        setMfaError(error instanceof Error ? error.message : "Code incorrect.");
      } finally {
        setLoginPending(false);
      }
    })();
  }

  function cancelMfaGate() {
    void (async () => {
      await logoutApiSession();
      setMfaGate(null);
      setMfaError("");
      setMfaQrDataUrl(null);
      setMfaManualKey(null);
      setMfaRecoveryCodes(null);
      clearTeacherAuthIdentity();
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
    setTeacherSetup({
      version: 1,
      classes: displaySetupsFromAssignedCourses(teacherCourses, null),
    });
    showNotice("Préférences d’affichage réinitialisées.");
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
      clearTeacherAuthIdentity();
      showNotice("Session réinitialisée.");
    })();
  }

  function confirmControlDespiteAlert() {
    if (!pendingNotebookControl) return;
    void (async () => {
      try {
        await performNotebookControl(pendingNotebookControl, true);
        dismissControlAlert();
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "Publication impossible.");
      }
    })();
  }

  function openClassNotebook(classSetup: TeacherClassSetup) {
    setOpenNotebookCourse(null);
    setOpenNotebookClassId(classSetup.id);
    setActiveSection("ma-semaine");
    setNotebookCenterWeek(selectedSchoolWeekNumber);
    const mappedClassroomId = resolveNotebookClassroomId(classSetup, runtimeClassrooms, EMPTY_CLASSROOM_CATALOG);
    if (mappedClassroomId) {
      setSelectedClassroomId(mappedClassroomId);
    }
  }

  function openCourseInWeek(course: TeacherCourseWorkspaceEntry) {
    const target = openCourseInWeekTarget(course, selectedSchoolWeekNumber);
    setOpenNotebookCourse(notebookContextFromCourse(course));
    setOpenNotebookClassId(target.classId);
    setActiveSection(target.section);
    setNotebookCenterWeek(target.schoolWeekNumber);
    const setup = assignedDisplaySetups.find((entry) => entry.id === target.classId) ?? {
      id: target.classId,
      name: course.classCode,
    };
    const mappedClassroomId = resolveNotebookClassroomId(
      setup,
      runtimeClassrooms,
      EMPTY_CLASSROOM_CATALOG,
      target.classId,
    );
    if (mappedClassroomId) {
      setSelectedClassroomId(mappedClassroomId);
    }
    window.scrollTo(0, 0);
  }

  function closeClassNotebook() {
    setOpenNotebookClassId(null);
    setOpenNotebookCourse(null);
  }

  function shiftNotebookWeeks(direction: -1 | 1) {
    const index = schoolWeeksMemo.findIndex((week) => week.number === notebookCenterWeek);
    if (index < 0) return;
    const target = schoolWeeksMemo[index + direction];
    if (target) setNotebookCenterWeek(target.number);
  }

  async function performNotebookControl(
    input: {
      classroomId: string;
      subjectId: string;
      schoolWeekNumber: number;
      day: number;
      title: string;
    },
    confirmCoordination = false,
  ) {
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
      confirmCoordination,
    });
    setItems((previous) => upsertAgendaItem(previous, created));
    showNotice("Contrôle planifié.");
  }

  async function notebookCreatePublication(schoolWeekNumber: number, text: string) {
    if (!openNotebookClass) return;
    const created = notebookPublishAnnualCourseId
      ? await createNotebookPublicationApi({
          annualCourseId: notebookPublishAnnualCourseId,
          schoolWeekNumber,
          day: weekdayToCourseDayIndex(openNotebookClass.dayOfWeek),
          type: "HOMEWORK",
          title: text.trim(),
          detail: "",
        })
      : notebookClassroomId && notebookSubjectId
        ? await createAgendaItemApi({
            classroomId: notebookClassroomId,
            subjectId: notebookSubjectId,
            day: weekdayToCourseDayIndex(openNotebookClass.dayOfWeek),
            hour: 8,
            weekOffset: 0,
            schoolWeekNumber,
            type: "HOMEWORK",
            title: text.trim(),
            detail: "",
          })
        : null;
    if (!created) return;
    setItems((previous) => upsertAgendaItem(previous, created));
    showNotice("Publication ajoutée.");
  }

  async function notebookSaveWeekPublication(schoolWeekNumber: number, doc: CampusRichDoc) {
    if (!openNotebookClass) return;
    if (!notebookPublishAnnualCourseId && (!notebookClassroomId || !notebookSubjectId)) return;
    const weekItems = notebookItems.filter((item) => item.schoolWeekNumber === schoolWeekNumber);
    const plan = planCarnetWeekPublicationSave(weekItems, doc);

    if (plan.action === "clear") {
      for (const itemId of plan.deleteIds) {
        await deleteAgendaItemApi(itemId);
        setItems((previous) => previous.filter((entry) => entry.id !== itemId));
      }
      showNotice("Publication retirée.");
      return;
    }

    if (plan.action === "update") {
      const updated = await updateAgendaItemApi(plan.updateId, plan.payload);
      setItems((previous) => previous.map((item) => (item.id === plan.updateId ? updated : item)));
      for (const extraId of plan.deleteIds) {
        await deleteAgendaItemApi(extraId);
        setItems((previous) => previous.filter((entry) => entry.id !== extraId));
      }
    } else if (notebookPublishAnnualCourseId) {
      const created = await createNotebookPublicationApi({
        annualCourseId: notebookPublishAnnualCourseId,
        schoolWeekNumber,
        day: weekdayToCourseDayIndex(openNotebookClass.dayOfWeek),
        type: "HOMEWORK",
        title: plan.payload.title,
        detail: plan.payload.detail,
      });
      setItems((previous) => upsertAgendaItem(previous, created));
    } else if (notebookClassroomId && notebookSubjectId) {
      const created = await createAgendaItemApi({
        classroomId: notebookClassroomId,
        subjectId: notebookSubjectId,
        day: weekdayToCourseDayIndex(openNotebookClass.dayOfWeek),
        hour: 8,
        weekOffset: 0,
        schoolWeekNumber,
        type: "HOMEWORK",
        title: plan.payload.title,
        detail: plan.payload.detail,
      });
      setItems((previous) => upsertAgendaItem(previous, created));
    }
    showNotice("Publication enregistrée.");
  }

  async function notebookCopyPreviousPublication(schoolWeekNumber: number) {
    const previous = previousSchoolWeekNumber(schoolWeeksMemo, schoolWeekNumber);
    if (previous == null) return;
    const source = composeWeekPublicationDoc(
      notebookItems.filter((item) => item.schoolWeekNumber === previous && isCarnetOwnedPublication(item)),
    );
    await notebookSaveWeekPublication(schoolWeekNumber, cloneRichDoc(source));
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
    let classroomId = notebookClassroomId;
    let subjectId = notebookSubjectId;
    try {
      if (notebookPublishAnnualCourseId) {
        const ensured = await ensureNotebookRuntimeApi(notebookPublishAnnualCourseId);
        classroomId = ensured.classroomId;
        subjectId = ensured.subjectId;
      }
      if (!classroomId || !subjectId) return;
      const alert = evaluateThirdTestAlert(items, catalogFromRuntime(runtimeClassrooms), {
        classroomId,
        type: "TEST",
        courseDay: { schoolWeekNumber: input.schoolWeekNumber, dayIndex: input.day },
      });
      if (alert.triggered) {
        setControlAlert(alert);
        setPendingNotebookControl({
          classroomId,
          subjectId,
          ...input,
        });
        return;
      }
      await performNotebookControl({
        classroomId,
        subjectId,
        ...input,
      });
    } catch (error) {
      if (error instanceof ControlCoordinationRequiredError) {
        setControlAlert({
          triggered: true,
          courseDay: { schoolWeekNumber: input.schoolWeekNumber, dayIndex: input.day },
          existingTests: error.coordination.classDayControls.map((entry) => ({
            id: entry.agendaItemId,
            title: entry.title,
            subjectName: entry.branchLabel,
            teacherName: entry.teacherName,
          })),
        });
        if (classroomId && subjectId) {
          setPendingNotebookControl({
            classroomId,
            subjectId,
            ...input,
          });
        }
        return;
      }
      showNotice(error instanceof Error ? error.message : "Publication impossible.");
    }
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

  if (shouldShowMfaEnrollmentScreen({
    mfaSetupRequired: mfaGate?.mfaSetupRequired,
    recoveryCodes: mfaRecoveryCodes,
  })) {
    return (
      <>
        <MfaSetupPanel
          appVersion={APP_VERSION}
          displayName={mfaGate?.displayName ?? ""}
          initials={mfaGate?.initials ?? ""}
          pending={loginPending}
          error={mfaError}
          qrDataUrl={mfaQrDataUrl}
          manualKey={mfaManualKey}
          recoveryCodes={mfaRecoveryCodes}
          onStart={startAdminMfaSetup}
          onConfirm={submitAdminMfaSetup}
          onContinue={continueAfterMfaRecovery}
          onCancel={cancelMfaGate}
        />
        {notice && <div className="technical-toast" role="status">✓ &nbsp;{notice}</div>}
      </>
    );
  }

  if (mfaGate?.mfaChallengeRequired) {
    return (
      <>
        <MfaChallengePanel
          appVersion={APP_VERSION}
          displayName={mfaGate.displayName}
          initials={mfaGate.initials}
          pending={loginPending}
          error={mfaError}
          onSubmit={submitAdminMfaChallenge}
          onCancel={cancelMfaGate}
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
            <p className="eyebrow">{selectedClassroom?.name ?? studentClassroomName} · {studentSession.label}</p>
            {studentDisplayCourseDay ? (
              <>
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
                              {decodeRichDetail(item.detail) ? (
                                <RichDocView doc={decodeRichDetail(item.detail)!} />
                              ) : (
                                <>
                                  <strong>{item.title}</strong>
                                  {!isPlaceholderDetail(item.detail) ? <p>{item.detail}</p> : null}
                                </>
                              )}
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
              </>
            ) : (
              <div className="student-course-day-empty">
                <strong>Aucune année scolaire configurée.</strong>
                <small>L’agenda élève sera disponible dès qu’une année scolaire sera active.</small>
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
          <span>COURS ATTRIBUÉS</span>
          <strong>{teacherCourses.length}</strong>
          <small>Année active</small>
        </div>
        <button className="signout" onClick={() => setStudentCodeModalOpen(true)}><span>👤</span> Espace élève</button>
        <button className="signout" onClick={logoutTeacher}><span>↪</span> Déconnexion</button>
      </aside>

      <main className="technical-main" id="main-content">
        <header className="technical-header">
          <div className="mobile-lockup"><BrandEmblem /><strong>CAMPUS AGENDA</strong></div>
          <div className="class-identity">
            <span className="eyebrow">Espace enseignant</span>
            <h1>{sectionTitle(activeSection, false, openNotebookClass?.name, teacherCoursesYearLabel)}</h1>
            <p>{sectionDescription(activeSection, false, Boolean(openNotebookClass))}</p>
          </div>
          <div className="header-actions">
            <button className="profile-disc" aria-label="Profil enseignant">
              {profileDiscInitials(authenticatedTeacher)}
            </button>
          </div>
        </header>

        {activeSection === "mes-cours" && (
          <MesCoursPanel
            courses={teacherCourses}
            classAccesses={teacherClassAccesses}
            schoolYearLabel={teacherCoursesYearLabel}
            loading={!teacherCoursesReady}
            error={teacherCoursesError || null}
            displaySetups={assignedDisplaySetups}
            onOpenClass={openClassNotebook}
            onOpenCourse={openCourseInWeek}
          />
        )}

        {activeSection === "controles" && (
          <ControlPlanningPanel
            onPublicationCreated={(item) => {
              setItems((previous) => upsertAgendaItem(previous, item));
            }}
          />
        )}

        {activeSection === "ma-semaine" && openNotebookClass && (
          <ClassNotebookPanel
            classSetup={openNotebookClass}
            branchLabel={openNotebookCourse?.branchLabel}
            annualCourseId={openNotebookCourse?.annualCourseId}
            subjectId={notebookSubjectId}
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
            onSaveWeekPublication={notebookSaveWeekPublication}
            onCopyPreviousPublication={notebookCopyPreviousPublication}
            onMovePublication={notebookMovePublication}
            onSaveControl={notebookSaveControl}
            onDeleteControl={notebookDeletePublication}
            onPreviewStudent={enterTeacherPreview}
          />
        )}

        {activeSection === "ma-semaine" && !openNotebookClass && (
          <MaSemainePanel
            classes={assignedDisplaySetups}
            schoolWeeks={schoolWeeksMemo}
            selectedSchoolWeekNumber={selectedSchoolWeekNumber}
            onSelectSchoolWeek={setSelectedSchoolWeekNumber}
            onOpenClass={openClassNotebook}
          />
        )}

        {activeSection === "configuration" && (
          <ConfigurationPanel
            config={teacherSetup}
            courses={teacherCourses}
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
              <label>Code de classe<input name="code" placeholder="MECAUTO3A-K7M4-R2P8" required autoComplete="off" /></label>
              {process.env.NODE_ENV === "development" ? (
                <p className="modal-hint">Les codes apprentis se génèrent dans Administration → Classes.</p>
              ) : (
                <p className="modal-hint">Saisissez le code communiqué par l’administrateur. Il n’est jamais enregistré sur cet appareil.</p>
              )}
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
