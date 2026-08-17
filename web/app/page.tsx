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
import type { AgendaItemType } from "@campus/types/agenda";

type ViewMode = "mine" | "class";

const TYPE_LABELS: Record<AgendaItemType, string> = {
  HOMEWORK: "Devoir",
  TEST: "Contrôle",
  INFORMATION: "Information",
};

const ALL_SUBJECTS_FILTER = "Toutes les branches";
const HOURS = Array.from({ length: 10 }, (_, index) => index + 8);

const TEACHER_CLASSROOMS = getClassroomsForTeacher(DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID);
const DEFAULT_CLASSROOM_ID = TEACHER_CLASSROOMS[0]?.id ?? DEMO_CATALOG.classrooms[0].id;

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

export default function Home() {
  const [selectedClassroomId, setSelectedClassroomId] = useState(DEFAULT_CLASSROOM_ID);
  const [classPickerOpen, setClassPickerOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("mine");
  const [studentPreview, setStudentPreview] = useState(false);
  const [typeFilter, setTypeFilter] = useState<AgendaItemType | "ALL">("ALL");
  const [subjectFilter, setSubjectFilter] = useState(ALL_SUBJECTS_FILTER);
  const [weekOffset, setWeekOffset] = useState(0);
  const [items, setItems] = useState<PrototypeAgendaItem[]>(DEMO_PROTOTYPE_ITEMS);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [modalType, setModalType] = useState<AgendaItemType | null>(null);
  const [notice, setNotice] = useState("");

  const selectedClassroom = getClassroomById(DEMO_CATALOG, selectedClassroomId) ?? DEMO_CATALOG.classrooms[0];
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

  const classroomItems = items.filter((item) => item.classroomId === selectedClassroomId);

  const visibleItems = classroomItems.filter((item) => {
    if (weekOffset !== 0 && item.id <= 5) return false;
    if (!studentPreview && view === "mine" && item.authorTeacherId !== DEMO_CURRENT_TEACHER_ID) return false;
    if (typeFilter !== "ALL" && item.type !== typeFilter) return false;
    if (subjectFilter !== ALL_SUBJECTS_FILTER) {
      const subject = getSubjectById(DEMO_CATALOG, item.subjectId);
      if (subject?.name !== subjectFilter) return false;
    }
    return true;
  });

  function selectClassroom(classroomId: string) {
    setSelectedClassroomId(classroomId);
    setClassPickerOpen(false);
    setSubjectFilter(ALL_SUBJECTS_FILTER);
    setWeekOffset(0);
    setView("mine");
    setStudentPreview(false);
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
    setView("mine");
    setStudentPreview(false);
    setModalType(null);
    setNotice(`${TYPE_LABELS[modalType]} ajouté à ${selectedClassroom.name}.`);
    window.setTimeout(() => setNotice(""), 3200);
  }

  const myItemCount = classroomItems.filter((item) => item.authorTeacherId === DEMO_CURRENT_TEACHER_ID).length;

  return (
    <div className="mechanical-app">
      <aside className="technical-sidebar">
        <div className="brand-lockup">
          <BrandEmblem />
          <span><strong>CAMPUS</strong><small>AGENDA</small></span>
        </div>

        <nav aria-label="Navigation principale">
          <button><span>⌂</span> Tableau de bord</button>
          <button className="active"><span>♙</span> Mes classes</button>
          <button><span>▣</span> Agenda partagé</button>
          <button><span>□</span> Documents</button>
          <button><span>⚙</span> Paramètres</button>
        </nav>

        <div className="classroom-list" aria-label="Classes rattachées">
          {TEACHER_CLASSROOMS.map((classroom) => (
            <button
              key={classroom.id}
              className={classroom.id === selectedClassroomId ? "classroom-chip active" : "classroom-chip"}
              onClick={() => selectClassroom(classroom.id)}
            >
              <strong>{classroom.name}</strong>
              <small>{classroom.programLabel}</small>
            </button>
          ))}
        </div>

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
            <h1>{studentPreview ? "Mon agenda" : "Agenda partagé"}</h1>
            <p>
              {studentPreview
                ? `Tous les éléments publiés pour la classe ${selectedClassroom.name}.`
                : "Planifiez la semaine et visualisez la charge globale de la classe."}
            </p>
          </div>
          <div className="header-actions">
            <button className="student-preview" onClick={() => setStudentPreview((current) => !current)}>
              {studentPreview ? "Quitter l’aperçu" : "Aperçu élève"}
            </button>
            {!studentPreview && (
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
            <span className="profile-disc">{getTeacherById(DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID)?.initials ?? "FC"}</span>
          </div>
        </header>

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
          <button>Devoirs</button>
          <button>Élèves</button>
          <button>Documents</button>
        </div>

        <section className="calendar-workbench">
          <aside className="calendar-tools">
            {!studentPreview && (
              <div className="view-selector" aria-label="Choisir la vue">
                <button className={view === "mine" ? "active" : ""} onClick={() => setView("mine")}>Mes éléments <span>{myItemCount}</span></button>
                <button className={view === "class" ? "active" : ""} onClick={() => setView("class")}>Toute la classe <span>{classroomItems.length}</span></button>
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
                        onClick={() => selectClassroom(classroom.id)}
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
        <p className="prototype-label">PROTOTYPE INTERACTIF · CAMPUS AGENDA 0.5</p>
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
