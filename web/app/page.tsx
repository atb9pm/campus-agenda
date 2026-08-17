"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ALL_FILTER, applySharedAgendaFilters, buildClassWorkloadSummary, canModifyPublication, DEMO_PROTOTYPE_ITEMS, WORKLOAD_LEVEL_LABELS, type PrototypeAgendaItem } from "@campus/features/agenda";
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
  anonymizeAuthorForStudent,
  buildStudentAgendaSummary,
  findStudentAccessForClassroom,
  getStudentAgendaItems,
  getStudentClassroom,
  resolveStudentAccess,
} from "@campus/features/student";
import type { StudentAccess } from "@campus/types/student-access";
import type { AgendaItemType } from "@campus/types/agenda";
import { DEMO_TEACHER_PASSWORD } from "@campus/lib/auth/config.ts";
import {
  createAgendaItemApi,
  deleteAgendaItemApi,
  fetchAgendaItems,
  fetchApiSession,
  loginStudentApi,
  loginTeacherApi,
  logoutApiSession,
  updateAgendaItemApi,
} from "../lib/api-client.ts";

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

function mondayForOffset(offset: number) {
  const date = new Date(2026, 7, 10, 12);
  date.setDate(date.getDate() + offset * 7);
  return date;
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
  return getAgendaSectionTitle(agendaView, classroomName);
}

function sectionDescription(activeSection: TeacherNavSection, agendaView: TeacherAgendaView, classroomName: string, isStudentView: boolean) {
  if (isStudentView) return `Consultation anonyme — agenda complet de la classe ${classroomName}, toutes branches confondues.`;
  if (activeSection === "dashboard") return "Vue d’ensemble de vos classes et de vos publications.";
  if (activeSection === "classes") return "Classes auxquelles vous êtes rattaché et branches enseignées.";
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
  const [weekOffset, setWeekOffset] = useState(0);
  const [items, setItems] = useState<PrototypeAgendaItem[]>(DEMO_PROTOTYPE_ITEMS);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [modalType, setModalType] = useState<AgendaItemType | null>(null);
  const [editingItem, setEditingItem] = useState<PrototypeAgendaItem | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSession() {
      try {
        let session = await fetchApiSession();
        if (!session) {
          session = await loginTeacherApi(DEMO_CURRENT_TEACHER_ID, DEMO_TEACHER_PASSWORD);
        }
        if (cancelled) return;

        if (session.kind === "teacher") {
          setCurrentTeacherId(session.teacherId);
          setAppMode("teacher");
          const classroomIds = getClassroomsForTeacher(DEMO_CATALOG, session.teacherId).map((classroom) => classroom.id);
          const loadedItems = await loadTeacherAgendaItems(classroomIds);
          if (!cancelled) setItems(loadedItems);
          return;
        }

        const access = resolveStudentAccess(DEMO_CATALOG, session.label);
        if (!access) return;
        setStudentSession(access);
        setSelectedClassroomId(session.classroomId);
        setStudentEntry("code");
        setAppMode("student");
        const loadedItems = await fetchAgendaItems(session.classroomId);
        if (!cancelled) setItems(loadedItems);
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

  const days = useMemo(() => {
    const monday = mondayForOffset(weekOffset);
    return Array.from({ length: 5 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return date;
    });
  }, [weekOffset]);

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

  const studentVisibleItems = useMemo(() => {
    if (!studentSession) return [];
    return applySharedAgendaFilters(
      getStudentAgendaItems(items, studentSession.classroomId),
      DEMO_CATALOG,
      {
        subjectName: subjectFilter === ALL_SUBJECTS_FILTER ? ALL_FILTER : subjectFilter,
        type: typeFilter,
        teacherId: ALL_FILTER,
        day: dayFilter,
        weekOffset,
      },
    );
  }, [studentSession, items, subjectFilter, typeFilter, dayFilter, weekOffset]);

  const studentSummary = useMemo(
    () => buildStudentAgendaSummary(studentVisibleItems),
    [studentVisibleItems],
  );

  const teacherVisibleItems = useMemo(
    () => applySharedAgendaFilters(agendaBaseItems, DEMO_CATALOG, {
      subjectName: subjectFilter === ALL_SUBJECTS_FILTER ? ALL_FILTER : subjectFilter,
      type: typeFilter,
      teacherId: teacherFilter,
      day: dayFilter,
      weekOffset,
    }),
    [agendaBaseItems, subjectFilter, typeFilter, teacherFilter, dayFilter, weekOffset],
  );

  const visibleItems = isStudentView ? studentVisibleItems : teacherVisibleItems;

  const workload = useMemo(
    () => (showSharedInsights ? buildClassWorkloadSummary(items, DEMO_CATALOG, activeClassroomId, weekOffset) : null),
    [showSharedInsights, items, activeClassroomId, weekOffset],
  );

  function resetAgendaFilters() {
    setSubjectFilter(ALL_SUBJECTS_FILTER);
    setTeacherFilter(ALL_FILTER);
    setDayFilter(ALL_FILTER);
    setTypeFilter("ALL");
    setWeekOffset(0);
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
      await logoutApiSession();
      const teacherSession = await loginTeacherApi(DEMO_CURRENT_TEACHER_ID, DEMO_TEACHER_PASSWORD);
      setCurrentTeacherId(teacherSession.teacherId);
      setAppMode("teacher");
      setStudentSession(null);
      setStudentEntry(null);
      const classroomIds = getClassroomsForTeacher(DEMO_CATALOG, teacherSession.teacherId).map((classroom) => classroom.id);
      const loadedItems = await loadTeacherAgendaItems(classroomIds);
      setItems(loadedItems);
      if (wasPreview) {
        setActiveSection("agenda");
        setAgendaView("class");
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
    setWeekOffset(0);
  }

  function openSharedAgenda(classroomId: string) {
    setSelectedClassroomId(classroomId);
    setActiveSection("agenda");
    setAgendaView("class");
    setClassPickerOpen(false);
    setSubjectFilter(ALL_SUBJECTS_FILTER);
    setTeacherFilter(ALL_FILTER);
    setDayFilter(ALL_FILTER);
    setWeekOffset(0);
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

  function openCreateModal(type: AgendaItemType) {
    setEditingItem(null);
    setModalType(type);
    setAddMenuOpen(false);
  }

  function openEditModal(item: PrototypeAgendaItem) {
    setEditingItem(item);
    setModalType(item.type);
  }

  function closeModal() {
    setModalType(null);
    setEditingItem(null);
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

    const day = Number(form.get("day") || 0);
    const hour = Number(form.get("hour") || 8);
    const detail = String(form.get("detail") || "").trim() || "Aucune précision";

    void (async () => {
      try {
        if (editingItem) {
          const updated = await updateAgendaItemApi(editingItem.id, {
            title,
            detail,
            day,
            hour,
            subjectId: subject.id,
          });
          setItems((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
          closeModal();
          showNotice(`${TYPE_LABELS[editingItem.type]} modifié.`);
          return;
        }

        const created = await createAgendaItemApi({
          classroomId: selectedClassroomId,
          subjectId: subject.id,
          day,
          hour,
          weekOffset,
          type: modalType,
          title,
          detail,
        });
        setItems((previous) => [...previous, created]);
        setWeekOffset(0);
        setAgendaView(DEFAULT_TEACHER_AGENDA_VIEW);
        closeModal();
        setActiveSection("agenda");
        showNotice(`${TYPE_LABELS[modalType]} ajouté à ${selectedClassroom.name}.`);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "Publication impossible.");
      }
    })();
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

  if (isStudentView && studentSession) {
    return (
      <div className="mechanical-app student-app">
        <aside className="technical-sidebar student-sidebar">
          <div className="brand-lockup">
            <BrandEmblem />
            <span><strong>CAMPUS</strong><small>AGENDA</small></span>
          </div>
          <div className="student-access-note">
            <span>ESPACE ÉLÈVE</span>
            <strong>{studentSession.label}</strong>
            <small>Consultation anonyme · démonstration</small>
          </div>
          <div className="technical-note">
            <span>CLASSE</span>
            <strong>{selectedClassroom.name}</strong>
            <small>{selectedClassroom.programLabel}</small>
          </div>
          <button className="signout" onClick={exitStudentMode}>
            <span>↪</span> {studentEntry === "teacher-preview" ? "Quitter l’aperçu" : "Se déconnecter"}
          </button>
        </aside>

        <main className="technical-main">
          <header className="technical-header">
            <div className="mobile-lockup"><BrandEmblem /><strong>CAMPUS AGENDA</strong></div>
            <div className="class-identity">
              <span className="eyebrow">{selectedClassroom.programLabel}</span>
              <h1>Mon agenda</h1>
              <p>Consultation anonyme — agenda complet de la classe {selectedClassroom.name}, toutes branches confondues.</p>
            </div>
          </header>

          <section className="student-summary" aria-label="Résumé de la semaine">
            <div><span>Total</span><strong>{studentSummary.total}</strong></div>
            <div><span>Devoirs</span><strong>{studentSummary.homework}</strong></div>
            <div><span>Contrôles</span><strong>{studentSummary.test}</strong></div>
            <div><span>Infos</span><strong>{studentSummary.information}</strong></div>
            <div><span>Branches</span><strong>{studentSummary.branches}</strong></div>
          </section>

          <section className="calendar-workbench">
            <aside className="calendar-tools">
              <section className="filter-panel">
                <h2>FILTRES</h2>
                <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} aria-label="Filtrer par branche">
                  {subjectFilterOptions.map((subject) => <option key={subject}>{subject}</option>)}
                </select>
                <select value={dayFilter} onChange={(event) => setDayFilter(event.target.value === ALL_FILTER ? ALL_FILTER : Number(event.target.value))} aria-label="Filtrer par jour">
                  <option value={ALL_FILTER}>Toute la semaine</option>
                  {days.map((date, index) => <option key={date.toISOString()} value={index}>{dayName(date)} {date.getDate()}</option>)}
                </select>
                <label><input type="checkbox" checked={typeFilter === "ALL" || typeFilter === "HOMEWORK"} onChange={() => setTypeFilter(typeFilter === "HOMEWORK" ? "ALL" : "HOMEWORK")} /> <span className="check blue" /> Devoirs</label>
                <label><input type="checkbox" checked={typeFilter === "ALL" || typeFilter === "TEST"} onChange={() => setTypeFilter(typeFilter === "TEST" ? "ALL" : "TEST")} /> <span className="check navy" /> Contrôles</label>
                <label><input type="checkbox" checked={typeFilter === "ALL" || typeFilter === "INFORMATION"} onChange={() => setTypeFilter(typeFilter === "INFORMATION" ? "ALL" : "INFORMATION")} /> <span className="check pale" /> Informations</label>
              </section>
              <div className="legend-note"><span>✓</span><p><strong>Lecture seule</strong>Aucune modification possible.</p></div>
            </aside>

            <section className="week-calendar">
              <header className="week-toolbar">
                <div><button onClick={() => setWeekOffset((current) => current - 1)}>‹</button><button onClick={() => setWeekOffset(0)}>Aujourd’hui</button><button onClick={() => setWeekOffset((current) => current + 1)}>›</button></div>
                <h2>{shortDate(days[0])} — {shortDate(days[4])} 2026</h2>
                <span className="student-class-label">{selectedClassroom.name}</span>
              </header>

              <div className="schedule-grid">
                <div className="corner-cell" />
                {days.map((date, index) => <div className={`day-head ${index === 1 && weekOffset === 0 ? "today" : ""}`} key={date.toISOString()}><span>{dayName(date)}</span><strong>{date.getDate()}</strong></div>)}
                {HOURS.map((hour) => (
                  <div className="schedule-row" key={hour}>
                    <time>{String(hour).padStart(2, "0")}:00</time>
                    {days.map((date, dayIndex) => {
                      const slotItems = visibleItems.filter((item) => item.day === dayIndex && item.hour === hour);
                      return (
                        <div className="time-slot" key={`${date.toISOString()}-${hour}`}>
                          {slotItems.map((item) => {
                            const subjectName = getSubjectById(DEMO_CATALOG, item.subjectId)?.name ?? "Branche";
                            return (
                              <article className={`schedule-event ${item.type.toLowerCase()}`} key={item.id}>
                                <small>{TYPE_LABELS[item.type]} · {subjectName}</small>
                                <strong>{item.title}</strong>
                                <span>{item.detail}</span>
                                <em>{anonymizeAuthorForStudent(item.authorTeacherId)}</em>
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

          <p className="prototype-label">CONSULTATION ÉLÈVE · CAMPUS AGENDA 0.10</p>
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
          <button disabled><span>□</span> Documents</button>
          <button disabled><span>⚙</span> Paramètres</button>
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
        <button className="signout"><span>↪</span> Déconnexion</button>
      </aside>

      <main className="technical-main">
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
                <button className="navy-add" onClick={() => setAddMenuOpen((current) => !current)} aria-expanded={addMenuOpen}>＋ <span>Ajouter</span>⌄</button>
                {addMenuOpen && (
                  <div className="technical-add-menu">
                    {(["HOMEWORK", "TEST", "INFORMATION"] as AgendaItemType[]).map((type) => (
                      <button key={type} onClick={() => openCreateModal(type)}>
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

            <div className="class-tabs">
              <button className="active">Calendrier</button>
              <button disabled>Devoirs</button>
              <button disabled>Élèves</button>
              <button disabled>Documents</button>
            </div>

            <section className="calendar-workbench">
              <aside className="calendar-tools">
                <div className="view-selector" aria-label="Choisir la vue">
                  <button className={agendaView === "mine" ? "active" : ""} onClick={() => { setAgendaView("mine"); setTeacherFilter(ALL_FILTER); setDayFilter(ALL_FILTER); }}>Mes éléments <span>{myItemCount}</span></button>
                  <button className={agendaView === "class" ? "active" : ""} onClick={() => { setAgendaView("class"); setTeacherFilter(ALL_FILTER); setDayFilter(ALL_FILTER); }}>Toute la classe <span>{classroomItems.filter((item) => (item.weekOffset ?? 0) === weekOffset).length}</span></button>
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
                  <div><button onClick={() => setWeekOffset((current) => current - 1)}>‹</button><button onClick={() => setWeekOffset(0)}>Aujourd’hui</button><button onClick={() => setWeekOffset((current) => current + 1)}>›</button></div>
                  <h2>{shortDate(days[0])} — {shortDate(days[4])} 2026</h2>
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
                    {workload.byDay.map((entry, index) => (
                      <div className="workload-day" key={entry.day}>
                        <span>{dayName(days[index] ?? days[0])}</span>
                        <strong>{entry.total}</strong>
                        <i style={{ width: `${Math.min(100, entry.total * 20)}%` }} />
                      </div>
                    ))}
                  </div>
                )}

                <div className="schedule-grid">
                  <div className="corner-cell" />
                  {days.map((date, index) => <div className={`day-head ${index === 1 && weekOffset === 0 ? "today" : ""}`} key={date.toISOString()}><span>{dayName(date)}</span><strong>{date.getDate()}</strong></div>)}
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
          </>
        )}

        <p className="prototype-label">PROTOTYPE INTERACTIF · CAMPUS AGENDA 0.10</p>
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

      {modalType && (
        <div className="technical-modal-backdrop">
          <section className="technical-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <header><div><span className="eyebrow">{editingItem ? "MODIFIER" : "NOUVEL ÉLÉMENT"}</span><h2 id="modal-title">{editingItem ? `Modifier le ${TYPE_LABELS[modalType].toLowerCase()}` : `Ajouter un ${TYPE_LABELS[modalType].toLowerCase()}`}</h2></div><button onClick={closeModal}>×</button></header>
            <form key={editingItem?.id ?? `create-${modalType}`} onSubmit={submitItem}>
              <label>Titre<input name="title" placeholder="Titre visible par la classe" defaultValue={editingItem?.title ?? ""} required /></label>
              <div className="modal-row">
                <label>Branche<select name="subject" defaultValue={getSubjectById(DEMO_CATALOG, editingItem?.subjectId ?? publishableSubjects[0]?.id ?? "")?.name ?? publishableSubjects[0]?.name ?? "Moteur"}>{publishableSubjects.map((subject) => <option key={subject.id}>{subject.name}</option>)}</select></label>
                <label>Jour<select name="day" defaultValue={String(editingItem?.day ?? 1)}>{days.map((date, index) => <option key={date.toISOString()} value={index}>{dayName(date)} {date.getDate()}</option>)}</select></label>
                <label>Heure<select name="hour" defaultValue={String(editingItem?.hour ?? 8)}>{HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></label>
              </div>
              <label>Consigne<textarea name="detail" rows={3} placeholder="Ajoutez une indication utile…" defaultValue={editingItem?.detail ?? ""} /></label>
              <footer><button type="button" onClick={closeModal}>Annuler</button><button type="submit">{editingItem ? "Enregistrer" : "Publier dans l’agenda"}</button></footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
