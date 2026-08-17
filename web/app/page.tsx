"use client";

import { FormEvent, useMemo, useState } from "react";
import { DEMO_PROTOTYPE_ITEMS, type PrototypeAgendaItem } from "@campus/features/agenda";
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
import type { AgendaItemType } from "@campus/types/agenda";

const TYPE_LABELS: Record<AgendaItemType, string> = {
  HOMEWORK: "Devoir",
  TEST: "Contrôle",
  INFORMATION: "Information",
};

const ALL_SUBJECTS_FILTER = "Toutes les branches";
const HOURS = Array.from({ length: 10 }, (_, index) => index + 8);

const TEACHER_CLASSROOMS = getClassroomsForTeacher(DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID);
const DEFAULT_CLASSROOM_ID = TEACHER_CLASSROOMS[0]?.id ?? DEMO_CATALOG.classrooms[0].id;
const CURRENT_TEACHER = getTeacherById(DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID);

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

function teacherLabel(teacherId: string) {
  if (teacherId === DEMO_CURRENT_TEACHER_ID) return "Vous · compte démo";
  return getTeacherById(DEMO_CATALOG, teacherId)?.displayName ?? "Enseignant · démo";
}

function sectionTitle(activeSection: TeacherNavSection, agendaView: TeacherAgendaView, classroomName: string, studentPreview: boolean) {
  if (studentPreview) return "Mon agenda";
  if (activeSection === "dashboard") return "Tableau de bord";
  if (activeSection === "classes") return "Mes classes";
  return getAgendaSectionTitle(agendaView, classroomName);
}

function sectionDescription(activeSection: TeacherNavSection, agendaView: TeacherAgendaView, classroomName: string, studentPreview: boolean) {
  if (studentPreview) return `Tous les éléments publiés pour la classe ${classroomName}.`;
  if (activeSection === "dashboard") return "Vue d’ensemble de vos classes et de vos publications.";
  if (activeSection === "classes") return "Classes auxquelles vous êtes rattaché et branches enseignées.";
  return getAgendaSectionDescription(agendaView, classroomName);
}

export default function Home() {
  const [activeSection, setActiveSection] = useState<TeacherNavSection>("dashboard");
  const [selectedClassroomId, setSelectedClassroomId] = useState(DEFAULT_CLASSROOM_ID);
  const [classPickerOpen, setClassPickerOpen] = useState(false);
  const [agendaView, setAgendaView] = useState<TeacherAgendaView>(DEFAULT_TEACHER_AGENDA_VIEW);
  const [studentPreview, setStudentPreview] = useState(false);
  const [typeFilter, setTypeFilter] = useState<AgendaItemType | "ALL">("ALL");
  const [subjectFilter, setSubjectFilter] = useState(ALL_SUBJECTS_FILTER);
  const [weekOffset, setWeekOffset] = useState(0);
  const [items, setItems] = useState<PrototypeAgendaItem[]>(DEMO_PROTOTYPE_ITEMS);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [modalType, setModalType] = useState<AgendaItemType | null>(null);
  const [notice, setNotice] = useState("");

  const selectedClassroom = getClassroomById(DEMO_CATALOG, selectedClassroomId) ?? DEMO_CATALOG.classrooms[0];
  const classSummaries = useMemo(
    () => getTeacherClassSummaries(DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID, items),
    [items],
  );
  const classroomSubjects = useMemo(
    () => getSubjectsForClassroom(DEMO_CATALOG, selectedClassroomId),
    [selectedClassroomId],
  );
  const publishableSubjects = useMemo(
    () => getSubjectsForTeacherInClassroom(DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID, selectedClassroomId),
    [selectedClassroomId],
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
    selectedClassroomId,
    DEMO_CURRENT_TEACHER_ID,
    studentPreview ? "class" : agendaView,
  );
  const classroomItems = items.filter((item) => item.classroomId === selectedClassroomId);

  const visibleItems = agendaBaseItems.filter((item) => {
    if (weekOffset !== 0 && item.id <= 5) return false;
    if (typeFilter !== "ALL" && item.type !== typeFilter) return false;
    if (subjectFilter !== ALL_SUBJECTS_FILTER) {
      const subject = getSubjectById(DEMO_CATALOG, item.subjectId);
      if (subject?.name !== subjectFilter) return false;
    }
    return true;
  });

  function openAgenda(classroomId: string) {
    setSelectedClassroomId(classroomId);
    setActiveSection("agenda");
    setAgendaView(DEFAULT_TEACHER_AGENDA_VIEW);
    setClassPickerOpen(false);
    setSubjectFilter(ALL_SUBJECTS_FILTER);
    setWeekOffset(0);
    setStudentPreview(false);
  }

  function navigate(section: TeacherNavSection) {
    setActiveSection(section);
    if (section === "agenda") {
      setAgendaView(DEFAULT_TEACHER_AGENDA_VIEW);
      setStudentPreview(false);
    }
  }

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modalType) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;

    const subjectName = String(form.get("subject") || publishableSubjects[0]?.name || "Moteur");
    const subject = classroomSubjects.find((entry) => entry.name === subjectName) ?? publishableSubjects[0];
    if (!subject || !teacherTeachesSubject(DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID, selectedClassroomId, subject.id)) {
      return;
    }

    setItems((current) => [...current, {
      id: Date.now(),
      classroomId: selectedClassroomId,
      subjectId: subject.id,
      authorTeacherId: DEMO_CURRENT_TEACHER_ID,
      day: Number(form.get("day") || 0),
      hour: Number(form.get("hour") || 8),
      type: modalType,
      title,
      detail: String(form.get("detail") || "").trim() || "Aucune précision",
    }]);
    setWeekOffset(0);
    setAgendaView(DEFAULT_TEACHER_AGENDA_VIEW);
    setStudentPreview(false);
    setModalType(null);
    setActiveSection("agenda");
    setNotice(`${TYPE_LABELS[modalType]} ajouté à ${selectedClassroom.name}.`);
    window.setTimeout(() => setNotice(""), 3200);
  }

  const myItemCount = classroomItems.filter((item) => item.authorTeacherId === DEMO_CURRENT_TEACHER_ID).length;
  const showAgendaTools = activeSection === "agenda";

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
            {TEACHER_CLASSROOMS.map((classroom) => (
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
        <button className="signout"><span>↪</span> Déconnexion</button>
      </aside>

      <main className="technical-main">
        <header className="technical-header">
          <div className="mobile-lockup"><BrandEmblem /><strong>CAMPUS AGENDA</strong></div>
          <div className="class-identity">
            <span className="eyebrow">{selectedClassroom.programLabel}</span>
            <h1>{sectionTitle(activeSection, agendaView, selectedClassroom.name, studentPreview)}</h1>
            <p>{sectionDescription(activeSection, agendaView, selectedClassroom.name, studentPreview)}</p>
          </div>
          <div className="header-actions">
            {showAgendaTools && (
              <button className="student-preview" onClick={() => setStudentPreview((current) => !current)}>
                {studentPreview ? "Quitter l’aperçu" : "Aperçu élève"}
              </button>
            )}
            {showAgendaTools && !studentPreview && (
              <div className="add-anchor">
                <button className="navy-add" onClick={() => setAddMenuOpen((current) => !current)} aria-expanded={addMenuOpen}>＋ <span>Ajouter</span>⌄</button>
                {addMenuOpen && (
                  <div className="technical-add-menu">
                    {(["HOMEWORK", "TEST", "INFORMATION"] as AgendaItemType[]).map((type) => (
                      <button key={type} onClick={() => { setModalType(type); setAddMenuOpen(false); }}>
                        <span className={`type-icon ${type.toLowerCase()}`}>{type === "HOMEWORK" ? "D" : type === "TEST" ? "C" : "i"}</span>
                        <span><strong>{TYPE_LABELS[type]}</strong><small>{type === "HOMEWORK" ? "Travail à réaliser" : type === "TEST" ? "Évaluation planifiée" : "Message pour la classe"}</small></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button className="round-action" aria-label="Notifications">♧<i /></button>
            <span className="profile-disc">{CURRENT_TEACHER?.initials ?? "FC"}</span>
          </div>
        </header>

        {activeSection === "dashboard" && (
          <section className="teacher-workspace" aria-label="Tableau de bord enseignant">
            <div className="workspace-intro">
              <p className="eyebrow">ESPACE ENSEIGNANT</p>
              <h2>Bonjour, {CURRENT_TEACHER?.displayName ?? "Professeur démo"}</h2>
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
                {!studentPreview && (
                  <div className="view-selector" aria-label="Choisir la vue">
                    <button className={agendaView === "mine" ? "active" : ""} onClick={() => setAgendaView("mine")}>Mes éléments <span>{myItemCount}</span></button>
                    <button className={agendaView === "class" ? "active" : ""} onClick={() => setAgendaView("class")}>Toute la classe <span>{classroomItems.length}</span></button>
                  </div>
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
                        {TEACHER_CLASSROOMS.map((classroom) => (
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
                              const isMine = item.authorTeacherId === DEMO_CURRENT_TEACHER_ID;
                              const authorLabel = teacherLabel(item.authorTeacherId);
                              return (
                                <article className={`schedule-event ${item.type.toLowerCase()}`} key={item.id}>
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

        <p className="prototype-label">PROTOTYPE INTERACTIF · CAMPUS AGENDA 0.6</p>
      </main>

      {notice && <div className="technical-toast" role="status">✓ &nbsp;{notice}</div>}

      {modalType && (
        <div className="technical-modal-backdrop">
          <section className="technical-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <header><div><span className="eyebrow">NOUVEL ÉLÉMENT</span><h2 id="modal-title">Ajouter un {TYPE_LABELS[modalType].toLowerCase()}</h2></div><button onClick={() => setModalType(null)}>×</button></header>
            <form onSubmit={submitItem}>
              <label>Titre<input name="title" placeholder="Titre visible par la classe" required /></label>
              <div className="modal-row">
                <label>Branche<select name="subject" defaultValue={publishableSubjects[0]?.name ?? "Moteur"}>{publishableSubjects.map((subject) => <option key={subject.id}>{subject.name}</option>)}</select></label>
                <label>Jour<select name="day" defaultValue="1">{days.map((date, index) => <option key={date.toISOString()} value={index}>{dayName(date)} {date.getDate()}</option>)}</select></label>
                <label>Heure<select name="hour" defaultValue="8">{HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></label>
              </div>
              <label>Consigne<textarea name="detail" rows={3} placeholder="Ajoutez une indication utile…" /></label>
              <footer><button type="button" onClick={() => setModalType(null)}>Annuler</button><button type="submit">Publier dans l’agenda</button></footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
