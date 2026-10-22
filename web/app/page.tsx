"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type PrototypeAgendaItem } from "@campus/features/agenda";
import type { ClassroomCatalog } from "@campus/features/classes";
import {
  TEACHER_NAV_ICONS,
  TEACHER_NAV_LABELS,
  DEFAULT_TEACHER_NAV_SECTION,
  teacherNavSectionsForRole,
  type TeacherNavSection,
} from "@campus/features/teacher";
import {
  buildStudentCourseDaySections,
  filterItemsForCourseDay,
  getStudentAgendaItems,
  groupControlPlanning,
  msUntilNextLocalMidnight,
  studentAccessFromApiSession,
  studentCalendarDateNeedsRefresh,
  type StudentDayScheduleSlot,
} from "@campus/features/student";
import type { StudentAccess, TeacherClassAccessView } from "@campus/types/student-access";
import {
  buildSchoolWeeksFromEntries,
  courseDayKey,
  findSchoolWeekForDate,
  listPreviousAttendanceCourseDays,
  listPreviousCourseDays,
  resolveDisplayCourseDay,
  resolveDisplayCourseDayFromAttendance,
  type CourseDaySlot,
  type SchoolWeek,
} from "@campus/features/calendar";
import {
  listFutureTestsForClass,
  type ThirdTestAlert,
} from "@campus/features/evaluations";
import {
  changeTeacherPasswordApi,
  createNotebookPublicationApi,
  createTeacherControlApi,
  ControlCoordinationRequiredError,
  updateTeacherControlApi,
  deleteAgendaItemApi,
  fetchAgendaItems,
  fetchApiSession,
  fetchOfficialSchoolCalendar,
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
  type AgendaSubjectLabel,
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
} from "@campus/features/teacher-setup";
import {
  displaySetupsFromAssignedCourses,
  teacherCoursesForClass,
  type TeacherCourseWorkspaceEntry,
} from "@campus/features/teacher-workspace";
import {
  clearNotesFromBrowser,
  createEmptyNotesDocument,
  filterNotebookItemsForSubject,
  loadNotesFromBrowser,
  notebookContextFromCourse,
  NOTEBOOK_PUBLISH_SELECT_COURSE,
  notebookPublishBlockedReason,
  openCourseInWeekTarget,
  peekNotesFromBrowser,
  resolveNotebookClassroomId,
  resolveNotebookSubjectId,
  workspaceAllowsNotebookPublish,
  weekdayToCourseDayIndex,
  collectClassAnnualCourseIds,
  isCarnetOwnedPublication,
  planCarnetWeekPublicationSave,
  type CampusRichDoc,
  type ClassNotesDocument,
  type NotebookCourseContext,
  type NotebookRuntimeClassroom,
} from "@campus/features/class-notebook";
import { ConfigurationPanel } from "./components/configuration-panel.tsx";
import { AdministrationPanel } from "./components/administration-panel.tsx";
import { BrandLogo } from "./components/brand-logo.tsx";
import { LoginPanel } from "./components/login-panel.tsx";
import { PasswordChangePanel } from "./components/password-change-panel.tsx";
import { MfaChallengePanel } from "./components/mfa-challenge-panel.tsx";
import { MfaSetupPanel } from "./components/mfa-setup-panel.tsx";
import { ClassNotebookPanel } from "./components/class-notebook-panel.tsx";
import { MaSemainePanel } from "./components/ma-semaine-panel.tsx";
import { MesCoursPanel } from "./components/mes-cours-panel.tsx";
import { ControlPlanningPanel } from "./components/control-planning-panel.tsx";
import { StudentDashboard, type StudentDashboardTab } from "./components/student-dashboard.tsx";

type AppMode = "teacher" | "student";
type StudentEntry = "code" | "teacher-preview";

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

function attendanceDaysFromAgendaView(
  days: Array<{ dayOfWeek: number; weekKind: "all" | "A" | "B"; role: string }>,
) {
  return days.map((day) => ({
    dayOfWeek: day.dayOfWeek as 1 | 2 | 3 | 4 | 5,
    weekKind: day.weekKind,
    role: day.role === "PRIMARY" ? "PRIMARY" as const : "ADDITIONAL" as const,
  }));
}

function scheduleSlotsFromAgendaView(
  slots: Array<{
    annualCourseId: string;
    dayOfWeek: number;
    periodStart: number;
    periodEnd: number;
    weekKind: "all" | "A" | "B";
    validFrom: string | null;
    validTo: string | null;
  }>,
): StudentDayScheduleSlot[] {
  return slots.flatMap((slot) => {
    if (slot.dayOfWeek < 1 || slot.dayOfWeek > 5) return [];
    return [{
      ...slot,
      dayOfWeek: slot.dayOfWeek as 1 | 2 | 3 | 4 | 5,
    }];
  });
}

async function loadTeacherAgendaItems(classroomIds: string[]): Promise<PrototypeAgendaItem[]> {
  const batches = await Promise.all(classroomIds.map((classroomId) => fetchAgendaItems(classroomId)));
  const merged = new Map<number, PrototypeAgendaItem>();
  for (const batch of batches) {
    for (const item of batch) merged.set(item.id, item);
  }
  return [...merged.values()].sort((left, right) => left.id - right.id);
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

function sectionDescription(
  activeSection: TeacherNavSection,
  isStudentView: boolean,
  notebookOpen: boolean,
  schoolYearLabel?: string | null,
) {
  if (isStudentView) return "Consultation anonyme — agenda complet de la classe, toutes branches confondues.";
  if (notebookOpen) {
    return "Contrôles, publications élèves et notes prof — semaine par semaine.";
  }
  if (activeSection === "mes-cours") {
    return schoolYearLabel
      ? `Cours qui vous sont attribués pour ${schoolYearLabel}.`
      : "Cours qui vous sont attribués pour l’année scolaire active.";
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
  return "Préférences d’affichage : jour visible dans Ma semaine. Ce n’est pas une attribution.";
}

export default function Home() {
  const [currentTeacherId, setCurrentTeacherId] = useState("");
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
  const [agendaSubjects, setAgendaSubjects] = useState<AgendaSubjectLabel[]>([]);
  const [studentScheduleSlots, setStudentScheduleSlots] = useState<StudentDayScheduleSlot[]>([]);
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
  /** Onglet élève : Tout / Devoirs / Contrôles, plus historique mobile. */
  const [studentMobileTab, setStudentMobileTab] = useState<StudentDashboardTab>("tout");
  const [schoolWeeks, setSchoolWeeks] = useState<SchoolWeek[]>([]);
  const [controlAlert, setControlAlert] = useState<ThirdTestAlert | null>(null);
  const [teacherSetup, setTeacherSetup] = useState<TeacherSetupConfig>(() => emptyTeacherSetup());
  const [teacherSetupReady, setTeacherSetupReady] = useState(false);
  const [teacherCourses, setTeacherCourses] = useState<TeacherCourseWorkspaceEntry[]>([]);
  const [teacherClassAccesses, setTeacherClassAccesses] = useState<Record<string, TeacherClassAccessView>>({});
  const [teacherCoursesYearLabel, setTeacherCoursesYearLabel] = useState<string | null>(null);
  const [viewedSchoolYearId, setViewedSchoolYearId] = useState<string | null>(null);
  const [viewedSchoolYearStatus, setViewedSchoolYearStatus] = useState<"draft" | "active" | "archived" | null>(null);
  const [adminYearConsult, setAdminYearConsult] = useState(false);
  const [activeSchoolYearLabel, setActiveSchoolYearLabel] = useState<string | null>(null);
  const pendingOpenCourseRef = useRef<{
    schoolYearId: string;
    annualCourseId: string;
    classId: string;
  } | null>(null);
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
    annualCourseId: string;
    courseSessionKey: string;
    schoolWeekNumber: number;
    day: number;
    title: string;
    detail: string;
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
        const payload = await fetchTeacherCoursesApi(
          adminYearConsult ? viewedSchoolYearId : null,
          { adminConsult: adminYearConsult },
        );
        if (cancelled) return;
        setTeacherCourses(payload.courses);
        setTeacherClassAccesses(payload.classAccesses);
        setTeacherCoursesYearLabel(payload.courses[0]?.schoolYearLabel ?? null);
        setTeacherCoursesError("");
        setTeacherCoursesReady(true);
        try {
          const accesses = await fetchTeacherClassAccessesApi(
            adminYearConsult ? viewedSchoolYearId : null,
            { adminConsult: adminYearConsult },
          );
          if (cancelled) return;
          setTeacherClassAccesses(accesses.classAccesses);
        } catch {
          // Conservez les codes déjà reçus avec les cours.
        }
        if (!adminYearConsult && payload.courses[0]?.schoolYearLabel) {
          setActiveSchoolYearLabel(payload.courses[0].schoolYearLabel);
        }
        if (adminYearConsult && viewedSchoolYearId) {
          try {
            const calendar = await fetchOfficialSchoolCalendar(viewedSchoolYearId);
            if (cancelled) return;
            const status = calendar.year.status;
            setViewedSchoolYearStatus(
              status === "draft" || status === "active" || status === "archived" ? status : "draft",
            );
            if (calendar.weeks.length) {
              setSchoolWeeks(buildSchoolWeeksFromEntries(calendar.weeks));
            }
          } catch {
            if (!cancelled) setViewedSchoolYearStatus("draft");
          }
          try {
            const runtime = await fetchTeacherClassroomsApi(viewedSchoolYearId, { adminConsult: true });
            if (cancelled) return;
            setRuntimeClassrooms(runtime);
            const classroomIds = runtime.map((entry) => entry.id);
            const loadedItems = await loadTeacherAgendaItems(classroomIds);
            if (cancelled) return;
            setItems(loadedItems);
            loadedAgendaClassroomIdsRef.current = new Set(classroomIds);
          } catch {
            // Conservez les classes déjà chargées.
          }
        } else {
          setViewedSchoolYearStatus(null);
          try {
            const calendar = await fetchSchoolCalendar();
            if (cancelled) return;
            if (calendar.configured && calendar.weeks.length) {
              setSchoolWeeks(buildSchoolWeeksFromEntries(calendar.weeks));
            }
            const runtime = await fetchTeacherClassroomsApi();
            if (cancelled) return;
            setRuntimeClassrooms(runtime);
          } catch {
            // Conservez le calendrier déjà chargé.
          }
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
  }, [currentTeacherId, teacherAuthenticated, viewedSchoolYearId, adminYearConsult]);

  // Ouverture différée après rechargement des cours de l’année cible.
  useEffect(() => {
    const pending = pendingOpenCourseRef.current;
    if (!pending || !teacherCoursesReady || !adminYearConsult || viewedSchoolYearId !== pending.schoolYearId) return;
    const course = teacherCourses.find((entry) => entry.annualCourseId === pending.annualCourseId);
    pendingOpenCourseRef.current = null;
    if (!course) {
      setNotice("Ce cours cible ne vous est pas attribué ; le Carnet n’est ouvert qu’aux enseignants du cours.");
      return;
    }
    openCourseInWeek(course);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherCourses, teacherCoursesReady, viewedSchoolYearId, adminYearConsult]);

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
      void saveTeacherNotesApi(classNotesDocument).catch((error: unknown) => {
        // Keep the editor contents available when the server refuses a stale save.
        setNotice(error instanceof Error ? error.message : "Enregistrement des notes impossible.");
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
                setAgendaSubjects(view.subjects);
                setAttendanceDays(attendanceDaysFromAgendaView(view.attendanceDays));
                setStudentScheduleSlots(scheduleSlotsFromAgendaView(view.scheduleSlots));
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
    ? {
        id: studentSession.classroomId,
        name:
          studentClassroomName
          || runtimeClassrooms.find((entry) => entry.id === studentSession.classroomId)?.name
          || studentSession.classroomId,
        programLabel: "",
        accessCodeHint: "",
      }
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
  const notebookPublishAnnualCourseId = openNotebookCourse?.annualCourseId?.trim() || null;
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
  const notebookCanPublish =
    !adminYearConsult && workspaceAllowsNotebookPublish(teacherCourses, notebookPublishAnnualCourseId);
  const notebookClassAnnualCourseIds = useMemo(
    () =>
      collectClassAnnualCourseIds(
        teacherCoursesForClass(
          teacherCourses,
          openNotebookCourse?.classId ?? openNotebookClass?.id,
        ).map((course) => course.annualCourseId),
        (notebookRuntimeSubjects ?? []).map((subject) => subject.annualCourseId),
        openNotebookCourse?.annualCourseId,
      ),
    [notebookRuntimeSubjects, openNotebookClass?.id, openNotebookCourse, teacherCourses],
  );
  const notebookBlockedReason = adminYearConsult
    ? "Consultation administrative en lecture seule. Les enseignants et les élèves utilisent toujours l’année active."
    : notebookPublishBlockedReason({
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

  const [studentToday, setStudentToday] = useState(() => new Date());

  useEffect(() => {
    function refreshIfNeeded() {
      const now = new Date();
      setStudentToday((current) => (studentCalendarDateNeedsRefresh(current, now) ? now : current));
    }

    function scheduleMidnight() {
      return window.setTimeout(() => {
        refreshIfNeeded();
        timeoutId = scheduleMidnight();
      }, msUntilNextLocalMidnight(new Date()));
    }

    window.addEventListener("focus", refreshIfNeeded);
    document.addEventListener("visibilitychange", refreshIfNeeded);
    let timeoutId = scheduleMidnight();
    return () => {
      window.removeEventListener("focus", refreshIfNeeded);
      document.removeEventListener("visibilitychange", refreshIfNeeded);
      window.clearTimeout(timeoutId);
    };
  }, []);

  const studentAutoCourseDay = useMemo(() => {
    if (!schoolWeeksMemo.length) return null;
    return (
      (attendanceDays.length
        ? resolveDisplayCourseDayFromAttendance(studentToday, schoolWeeksMemo, attendanceDays)
        : null) ?? resolveDisplayCourseDay(studentToday, schoolWeeksMemo)
    );
  }, [attendanceDays, schoolWeeksMemo, studentToday]);

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

  const studentClassroomSubjects = useMemo(() => {
    if (!studentSession) return [];
    const labeled = agendaSubjects.filter((subject) => subject.classroomId === studentSession.classroomId);
    const runtimeSubjects = runtimeClassrooms.find((entry) => entry.id === studentSession.classroomId)?.subjects ?? [];
    if (labeled.length) {
      return labeled.map((subject) => ({
        id: subject.id,
        name: subject.name,
        classroomId: studentSession.classroomId,
        annualCourseId: subject.annualCourseId ?? null,
      }));
    }
    if (runtimeSubjects.length) {
      return runtimeSubjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        classroomId: studentSession.classroomId,
        annualCourseId: subject.annualCourseId ?? null,
      }));
    }
    return [];
  }, [studentSession, runtimeClassrooms, agendaSubjects]);

  const studentControlCatalog = useMemo((): ClassroomCatalog => {
    if (!studentSession) return EMPTY_CLASSROOM_CATALOG;
    if (studentClassroomSubjects.length) {
      return {
        classrooms: [{
          id: studentSession.classroomId,
          name: studentClassroomName || studentSession.classroomId,
          programLabel: "",
          accessCodeHint: "",
        }],
        subjects: studentClassroomSubjects,
        memberships: [],
        teachers: [],
      };
    }
    return catalogFromRuntime(runtimeClassrooms).classrooms.length
      ? catalogFromRuntime(runtimeClassrooms)
      : EMPTY_CLASSROOM_CATALOG;
  }, [studentSession, studentClassroomSubjects, studentClassroomName, runtimeClassrooms]);

  const studentFutureTests = useMemo(() => {
    if (!studentSession || !schoolWeeksMemo.length) return [];
    return listFutureTestsForClass(
      items,
      studentControlCatalog,
      studentSession.classroomId,
      studentToday,
      schoolWeeksMemo,
    );
  }, [studentSession, items, studentControlCatalog, studentToday, schoolWeeksMemo]);

  const studentFollowingCourseDay = useMemo(() => {
    if (!studentDisplayCourseDay || !studentAutoCourseDay) return true;
    return courseDayKey(studentDisplayCourseDay) === courseDayKey(studentAutoCourseDay);
  }, [studentDisplayCourseDay, studentAutoCourseDay]);

  const studentCourseDaySections = useMemo(() => {
    if (!studentSession || !studentDisplayCourseDay) return [];
    const classroomItems = getStudentAgendaItems(items, studentSession.classroomId);
    const dayItems = filterItemsForCourseDay(classroomItems, studentDisplayCourseDay);
    return buildStudentCourseDaySections(
      dayItems,
      studentClassroomSubjects,
      studentFutureTests,
      {
        includeNextControls: studentFollowingCourseDay,
        scheduleSlots: studentScheduleSlots,
        courseDay: studentDisplayCourseDay,
      },
    );
  }, [
    studentSession,
    items,
    studentDisplayCourseDay,
    studentClassroomSubjects,
    studentFutureTests,
    studentFollowingCourseDay,
    studentScheduleSlots,
  ]);

  const studentControlPlanning = useMemo(
    () => groupControlPlanning(studentFutureTests),
    [studentFutureTests],
  );

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
    const classroomId = notebookClassroomId || selectedClassroomId;
    const classroom =
      runtimeClassrooms.find((entry) => entry.id === classroomId)
      ?? teacherClassrooms.find((entry) => entry.id === classroomId)
      ?? null;
    if (!classroom) {
      showNotice("Aucune classe.");
      return;
    }
    const access = {
      id: `preview:${classroom.id}`,
      classroomId: classroom.id,
      label: "aperçu",
    };
    setStudentSession(access);
    setStudentClassroomName(classroom.name);
    setStudentEntry("teacher-preview");
    setAppMode("student");
    setStudentCourseDayKey(null);
    setStudentHistoryOpen(false);
    resetSelectedWeek();
    void fetchAgendaView(access.classroomId)
      .then((view) => {
        setItems(view.items);
        setAgendaSubjects(view.subjects);
        setAttendanceDays(attendanceDaysFromAgendaView(view.attendanceDays));
        setStudentScheduleSlots(scheduleSlotsFromAgendaView(view.scheduleSlots));
      })
      .catch(() => undefined);
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
        setAgendaSubjects(view.subjects);
        setAttendanceDays(attendanceDaysFromAgendaView(view.attendanceDays));
        setStudentScheduleSlots(scheduleSlotsFromAgendaView(view.scheduleSlots));
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
        if (error instanceof Error && (error as Error & { mfaSetupRequired?: boolean }).mfaSetupRequired) {
          const nextSession = await fetchApiSession().catch(() => null);
          if (nextSession?.kind === "teacher") {
            await applyTeacherSession(nextSession);
          }
        }
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
    if (section === "ma-semaine" || section === "mes-cours" || section === "controles" || section === "configuration") {
      setAdminYearConsult(false);
      setViewedSchoolYearId(null);
      setViewedSchoolYearStatus(null);
      pendingOpenCourseRef.current = null;
    }
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

  function requireNotebookAnnualCourseId(): string | null {
    const id = openNotebookCourse?.annualCourseId?.trim() || "";
    if (!id) {
      showNotice(NOTEBOOK_PUBLISH_SELECT_COURSE);
      return null;
    }
    return id;
  }

  function openAssignedCourseInYear(target: {
    schoolYearId: string;
    annualCourseId: string;
    classId: string;
    courseLabel: string;
    classLabel: string;
  }) {
    pendingOpenCourseRef.current = {
      schoolYearId: target.schoolYearId,
      annualCourseId: target.annualCourseId,
      classId: target.classId,
    };
    setAdminYearConsult(true);
    setViewedSchoolYearId(target.schoolYearId);
    setActiveSection("mes-cours");
    showNotice(`Consultation administrative de ${target.courseLabel}. L’année active n’est pas changée.`);
  }

  function consultPreparedYear(schoolYearId: string) {
    pendingOpenCourseRef.current = null;
    setAdminYearConsult(true);
    setViewedSchoolYearId(schoolYearId);
    setActiveSection("mes-cours");
    showNotice("Consultation administrative de l’année préparée. L’année active n’est pas changée.");
  }

  function returnToActiveSchoolYear() {
    pendingOpenCourseRef.current = null;
    setAdminYearConsult(false);
    setViewedSchoolYearId(null);
    setViewedSchoolYearStatus(null);
    closeClassNotebook();
    setActiveSection("mes-cours");
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
      annualCourseId: string;
      courseSessionKey: string;
      schoolWeekNumber: number;
      day: number;
      title: string;
      detail?: string;
    },
    confirmCoordination = false,
  ) {
    const created = await createTeacherControlApi({
      annualCourseId: input.annualCourseId,
      courseSessionKey: input.courseSessionKey,
      title: input.title.trim(),
      detail: input.detail ?? "",
      confirmCoordination,
    });
    setItems((previous) => upsertAgendaItem(previous, created.item));
    showNotice("Contrôle planifié.");
  }

  async function notebookCreatePublication(
    schoolWeekNumber: number,
    text: string,
    day?: number,
    session?: { key: string; date: string; schoolWeekNumber: number; dayOfWeek: number },
  ) {
    const annualCourseId = requireNotebookAnnualCourseId();
    if (!annualCourseId || !openNotebookClass) return;
    const publicationDay = session ? session.dayOfWeek - 1 : (day ?? weekdayToCourseDayIndex(openNotebookClass.dayOfWeek));
    const created = await createNotebookPublicationApi({
      annualCourseId,
      schoolWeekNumber: session?.schoolWeekNumber ?? schoolWeekNumber,
      day: publicationDay,
      type: "HOMEWORK",
      title: text.trim(),
      detail: "",
      courseSessionKey: session?.key,
      courseSessionDate: session?.date,
    });
    setItems((previous) => upsertAgendaItem(previous, created));
    showNotice("Publication ajoutée.");
  }

  async function notebookSaveWeekPublication(
    schoolWeekNumber: number,
    doc: CampusRichDoc,
    options?: {
      studentVisible?: boolean;
      day?: number;
      courseSessionKey?: string;
      courseSessionDate?: string;
    },
  ) {
    const annualCourseId = requireNotebookAnnualCourseId();
    if (!annualCourseId || !openNotebookClass) return;
    const sessionKey = options?.courseSessionKey?.trim() || "";
    const weekItems = notebookItems.filter((item) => {
      if (sessionKey) {
        return item.courseSessionKey === sessionKey || (
          !item.courseSessionKey &&
          item.schoolWeekNumber === schoolWeekNumber &&
          (options?.day == null || item.day === options.day)
        );
      }
      return item.schoolWeekNumber === schoolWeekNumber;
    });
    const plan = planCarnetWeekPublicationSave(weekItems, doc);
    const publicationDay = options?.day ?? weekdayToCourseDayIndex(openNotebookClass.dayOfWeek);
    const sessionPatch = {
      ...(options?.day != null ? { day: options.day } : {}),
      ...(sessionKey ? { courseSessionKey: sessionKey } : {}),
      ...(options?.courseSessionDate ? { courseSessionDate: options.courseSessionDate } : {}),
      schoolWeekNumber,
    };

    if (plan.action === "clear") {
      for (const itemId of plan.deleteIds) {
        await deleteAgendaItemApi(itemId);
        setItems((previous) => previous.filter((entry) => entry.id !== itemId));
      }
      showNotice("Publication retirée.");
      return;
    }

    if (plan.action === "update") {
      const payload = {
        ...plan.payload,
        ...sessionPatch,
        ...(options?.studentVisible === undefined ? {} : { studentVisible: options.studentVisible }),
      };
      const updated = await updateAgendaItemApi(plan.updateId, payload);
      setItems((previous) => previous.map((item) => (item.id === plan.updateId ? updated : item)));
      for (const extraId of plan.deleteIds) {
        await deleteAgendaItemApi(extraId);
        setItems((previous) => previous.filter((entry) => entry.id !== extraId));
      }
    } else {
      const created = await createNotebookPublicationApi({
        annualCourseId,
        schoolWeekNumber,
        day: publicationDay,
        type: "HOMEWORK",
        title: plan.payload.title,
        detail: plan.payload.detail,
        studentVisible: options?.studentVisible ?? false,
        courseSessionKey: sessionKey || undefined,
        courseSessionDate: options?.courseSessionDate,
      });
      setItems((previous) => upsertAgendaItem(previous, created));
    }
    showNotice(
      options?.studentVisible === true
        ? "Publication visible aux élèves."
        : options?.studentVisible === false
          ? "Brouillon enregistré."
          : "Publication enregistrée.",
    );
  }

  async function notebookSetWeekPublicationVisibility(
    schoolWeekNumber: number,
    studentVisible: boolean,
    sessionKey?: string,
  ) {
    if (!requireNotebookAnnualCourseId()) return;
    const weekItems = notebookItems.filter((item) => {
      if (!isCarnetOwnedPublication(item)) return false;
      if (sessionKey) {
        return item.courseSessionKey === sessionKey;
      }
      return item.schoolWeekNumber === schoolWeekNumber;
    });
    for (const item of weekItems) {
      if ((item.studentVisible !== false) === studentVisible) continue;
      const updated = await updateAgendaItemApi(item.id, { studentVisible });
      setItems((previous) => previous.map((entry) => (entry.id === item.id ? updated : entry)));
    }
    showNotice(studentVisible ? "Visible aux élèves." : "Repassé en brouillon.");
  }

  async function notebookMovePublication(
    itemId: number,
    schoolWeekNumber: number,
    day?: number,
    session?: { key: string; date: string; schoolWeekNumber: number; dayOfWeek: number },
  ) {
    if (!requireNotebookAnnualCourseId()) return;
    const updated = await updateAgendaItemApi(itemId, {
      schoolWeekNumber: session?.schoolWeekNumber ?? schoolWeekNumber,
      ...(session
        ? {
            day: session.dayOfWeek - 1,
            courseSessionKey: session.key,
            courseSessionDate: session.date,
          }
        : day != null
          ? { day }
          : {}),
    });
    setItems((previous) => previous.map((item) => (item.id === itemId ? updated : item)));
  }

  async function notebookDeletePublication(itemId: number) {
    if (!requireNotebookAnnualCourseId()) return;
    await deleteAgendaItemApi(itemId);
    setItems((previous) => previous.filter((item) => item.id !== itemId));
  }

  async function notebookSaveControl(input: {
    schoolWeekNumber: number;
    day: number;
    title: string;
    detail?: string;
    courseSessionKey?: string;
    annualCourseId?: string;
    confirmCoordination?: boolean;
  }) {
    const annualCourseId = input.annualCourseId?.trim() || requireNotebookAnnualCourseId();
    if (!annualCourseId) return;
    const courseSessionKey = input.courseSessionKey?.trim() ?? "";
    if (!courseSessionKey) {
      showNotice("Ce cours n’a pas de séance à cette date.");
      throw new Error("Ce cours n’a pas de séance à cette date.");
    }
    try {
      await performNotebookControl(
        {
          annualCourseId,
          courseSessionKey,
          schoolWeekNumber: input.schoolWeekNumber,
          day: input.day,
          title: input.title,
          detail: input.detail ?? "",
        },
        input.confirmCoordination === true,
      );
    } catch (error) {
      if (error instanceof ControlCoordinationRequiredError) {
        throw error;
      }
      showNotice(error instanceof Error ? error.message : "Publication impossible.");
      throw error;
    }
  }

  async function notebookUpdateControl(itemId: number, input: { title: string; detail: string }) {
    const updated = await updateTeacherControlApi(itemId, {
      title: input.title.trim(),
      detail: input.detail,
    });
    setItems((previous) => previous.map((item) => (item.id === itemId ? updated.item : item)));
    showNotice("Contrôle enregistré.");
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
      <>
        <StudentDashboard
          appVersion={APP_VERSION}
          classroomName={selectedClassroom?.name ?? studentClassroomName}
          sessionLabel={studentSession.label}
          displayCourseDay={studentDisplayCourseDay}
          followingCourseDay={studentFollowingCourseDay}
          historyOpen={studentHistoryOpen}
          previousCourseDays={studentPreviousCourseDays}
          tab={studentMobileTab}
          sections={studentCourseDaySections}
          futureTests={studentFutureTests}
          planning={studentControlPlanning}
          today={studentToday}
          signOutLabel={studentEntry === "teacher-preview" ? "Quitter l’aperçu" : "Se déconnecter"}
          onToggleHistory={() => setStudentHistoryOpen((open) => !open)}
          onSelectCourseDay={(key) => {
            setStudentCourseDayKey(key);
            setStudentHistoryOpen(false);
            setStudentMobileTab("tout");
          }}
          onBackToCurrent={() => {
            setStudentCourseDayKey(null);
            setStudentHistoryOpen(false);
            setStudentMobileTab("tout");
          }}
          onSignOut={exitStudentMode}
          onTabChange={setStudentMobileTab}
        />
        {notice && <div className="technical-toast" role="status">✓ &nbsp;{notice}</div>}
      </>
    );
  }

  return (
    <div className="mechanical-app has-mobile-tabs">
      <aside className="technical-sidebar">
        <div className="brand-lockup">
          <BrandLogo />
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
          <small>{adminYearConsult ? "Consultation admin" : "Année active"}</small>
        </div>
        <button className="signout" onClick={() => setStudentCodeModalOpen(true)}><span>👤</span> Espace élève</button>
        <button className="signout" onClick={logoutTeacher}><span>↪</span> Déconnexion</button>
      </aside>

      <main className="technical-main" id="main-content">
        <header className="technical-header">
          <div className="mobile-lockup"><BrandLogo compact /></div>
          <div className="class-identity">
            <span className="eyebrow">Espace enseignant</span>
            <h1>{sectionTitle(activeSection, false, openNotebookClass?.name, teacherCoursesYearLabel)}</h1>
            <p>{sectionDescription(activeSection, false, Boolean(openNotebookClass), teacherCoursesYearLabel)}</p>
          </div>
          <div className="header-actions">
            <button className="profile-disc" aria-label="Profil enseignant">
              {profileDiscInitials(authenticatedTeacher)}
            </button>
          </div>
        </header>

        {adminYearConsult ? (
          <p className="year-transition-consult-banner" role="status">
            Vous consultez <strong>{teacherCoursesYearLabel ?? "cette année"}</strong>
            {" — "}
            {viewedSchoolYearStatus === "archived"
              ? "Archivée"
              : viewedSchoolYearStatus === "active"
                ? "Active"
                : "Préparation"}
            . Les enseignants et les élèves utilisent toujours{" "}
            <strong>{activeSchoolYearLabel ?? "l’année active"}</strong>.
            <button type="button" className="workspace-action secondary" onClick={returnToActiveSchoolYear}>
              Revenir à l’année active
            </button>
          </p>
        ) : null}

        {activeSection === "mes-cours" && (
          <MesCoursPanel
            courses={teacherCourses}
            classAccesses={teacherClassAccesses}
            schoolYearLabel={teacherCoursesYearLabel}
            loading={!teacherCoursesReady}
            error={teacherCoursesError || null}
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

        {activeSection === "ma-semaine" && openNotebookClass && openNotebookCourse && (
          <ClassNotebookPanel
            classSetup={openNotebookClass}
            branchLabel={openNotebookCourse.branchLabel}
            annualCourseId={openNotebookCourse.annualCourseId}
            schoolYearId={adminYearConsult ? viewedSchoolYearId : null}
            adminConsult={adminYearConsult}
            schoolYearLabel={teacherCoursesYearLabel}
            schoolYearStatus={viewedSchoolYearStatus}
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
            onSetWeekPublicationVisibility={notebookSetWeekPublicationVisibility}
            onMovePublication={notebookMovePublication}
            classroomId={notebookClassroomId}
            classAnnualCourseIds={notebookClassAnnualCourseIds}
            onSaveControl={notebookSaveControl}
            onUpdateControl={notebookUpdateControl}
            onDeleteControl={notebookDeletePublication}
            onPreviewStudent={enterTeacherPreview}
          />
        )}

        {activeSection === "ma-semaine" && !(openNotebookClass && openNotebookCourse) && (
          <MaSemainePanel
            classes={assignedDisplaySetups}
            courses={teacherCourses}
            schoolWeeks={schoolWeeksMemo}
            selectedSchoolWeekNumber={selectedSchoolWeekNumber}
            onSelectSchoolWeek={setSelectedSchoolWeekNumber}
            onOpenCourse={openCourseInWeek}
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
            onOpenTargetCourse={openAssignedCourseInYear}
            onConsultPreparedYear={consultPreparedYear}
          />
        )}

        <p className="prototype-label">CAMPUS AGENDA {APP_VERSION}</p>
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
