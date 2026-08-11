"use client";

import { FormEvent, useMemo, useState } from "react";

type ItemType = "HOMEWORK" | "TEST" | "INFORMATION";
type ViewMode = "mine" | "class";

type AgendaItem = {
  id: number;
  day: number;
  type: ItemType;
  subject: string;
  title: string;
  detail: string;
  teacher: string;
  mine: boolean;
  time?: string;
};

const TYPE_LABELS: Record<ItemType, string> = {
  HOMEWORK: "Devoir",
  TEST: "Contrôle",
  INFORMATION: "Information",
};

const SUBJECTS = ["Toutes les branches", "Français", "Mathématiques", "Sciences", "Atelier"];

const INITIAL_ITEMS: AgendaItem[] = [
  {
    id: 1,
    day: 0,
    type: "HOMEWORK",
    subject: "Mathématiques",
    title: "Exercices sur les fractions",
    detail: "Exercices 12 à 18, page 46",
    teacher: "Mme Dupont · démo",
    mine: false,
  },
  {
    id: 2,
    day: 0,
    type: "INFORMATION",
    subject: "Atelier",
    title: "Tenue de travail complète",
    detail: "Apporter les lunettes de protection",
    teacher: "M. Martin · démo",
    mine: false,
  },
  {
    id: 3,
    day: 1,
    type: "HOMEWORK",
    subject: "Français",
    title: "Lecture du chapitre 4",
    detail: "Préparer trois questions pour le cours",
    teacher: "Vous · compte démo",
    mine: true,
  },
  {
    id: 4,
    day: 2,
    type: "TEST",
    subject: "Sciences",
    title: "Circuits électriques",
    detail: "Réviser les fiches 2 et 3",
    teacher: "Mme Dupont · démo",
    mine: false,
    time: "08:15",
  },
  {
    id: 5,
    day: 3,
    type: "HOMEWORK",
    subject: "Atelier",
    title: "Système d’injection",
    detail: "Compléter le schéma fonctionnel",
    teacher: "M. Martin · démo",
    mine: false,
  },
  {
    id: 6,
    day: 4,
    type: "INFORMATION",
    subject: "Français",
    title: "Dossier d’orientation",
    detail: "Document disponible dans l’espace classe",
    teacher: "Vous · compte démo",
    mine: true,
  },
];

function mondayForOffset(offset: number) {
  const date = new Date(2026, 7, 10, 12);
  date.setDate(date.getDate() + offset * 7);
  return date;
}

function shortDate(date: Date) {
  return new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "short" })
    .format(date)
    .replace(".", "");
}

function dayName(date: Date) {
  const value = new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function Home() {
  const [view, setView] = useState<ViewMode>("mine");
  const [studentPreview, setStudentPreview] = useState(false);
  const [typeFilter, setTypeFilter] = useState<ItemType | "ALL">("ALL");
  const [subjectFilter, setSubjectFilter] = useState(SUBJECTS[0]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [items, setItems] = useState(INITIAL_ITEMS);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [modalType, setModalType] = useState<ItemType | null>(null);
  const [notice, setNotice] = useState("");

  const days = useMemo(() => {
    const monday = mondayForOffset(weekOffset);
    return Array.from({ length: 5 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return date;
    });
  }, [weekOffset]);

  const visibleItems = items.filter((item) => {
    if (weekOffset !== 0 && item.id <= 6) return false;
    if (!studentPreview && view === "mine" && !item.mine) return false;
    if (typeFilter !== "ALL" && item.type !== typeFilter) return false;
    if (subjectFilter !== SUBJECTS[0] && item.subject !== subjectFilter) return false;
    return true;
  });

  const totalClassItems = weekOffset === 0 ? items.filter((item) => item.id <= 6).length : 0;
  const testsCount = weekOffset === 0 ? items.filter((item) => item.type === "TEST" && item.id <= 6).length : 0;
  const busyDay = weekOffset === 0 ? "Lundi" : "Aucune surcharge";

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modalType) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const detail = String(form.get("detail") || "").trim();
    const subject = String(form.get("subject") || "Français");
    const day = Number(form.get("day") || 0);
    if (!title) return;

    setItems((current) => [
      ...current,
      {
        id: Date.now(),
        day,
        type: modalType,
        subject,
        title,
        detail: detail || "Aucune précision supplémentaire",
        teacher: "Vous · compte démo",
        mine: true,
      },
    ]);
    setView("mine");
    setStudentPreview(false);
    setWeekOffset(0);
    setModalType(null);
    setNotice(`${TYPE_LABELS[modalType]} ajouté à l’agenda de démonstration.`);
    window.setTimeout(() => setNotice(""), 3500);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">CA</span>
          <span>
            <strong>Campus</strong>
            <small>Agenda</small>
          </span>
        </div>

        <nav className="main-nav" aria-label="Navigation principale">
          <button className="nav-item active"><span>▦</span> Agenda</button>
          <button className="nav-item"><span>◇</span> Mes classes</button>
          <button className="nav-item"><span>◉</span> Branches</button>
          <button className="nav-item"><span>⌁</span> Équipe pédagogique</button>
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-note">
            <span className="privacy-icon">✓</span>
            <div>
              <strong>Données de démonstration</strong>
              <small>Aucun élève réel</small>
            </div>
          </div>
          <button className="profile-card">
            <span className="avatar">FC</span>
            <span><strong>François</strong><small>Enseignant</small></span>
            <span className="more">•••</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-brand" aria-label="Ouvrir le menu">CA</button>
          <div className="class-switcher">
            <span className="eyebrow">Classe active</span>
            <button>2e TMA <span>⌄</span></button>
          </div>
          <div className="top-actions">
            <button className="student-toggle" onClick={() => setStudentPreview((value) => !value)}>
              <span>◌</span> {studentPreview ? "Quitter l’aperçu élève" : "Aperçu élève"}
            </button>
            <button className="notification" aria-label="Notifications">●<span /></button>
          </div>
        </header>

        <section className="workspace">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Agenda partagé · 2e TMA</p>
              <h1>{studentPreview ? "Agenda de ma classe" : "Bonjour François"}</h1>
              <p>{studentPreview ? "Tous les devoirs et informations de la semaine." : "Voici la charge de travail prévue pour votre classe."}</p>
            </div>
            {!studentPreview && (
              <div className="add-wrap">
                <button className="primary-add" onClick={() => setAddMenuOpen((value) => !value)} aria-expanded={addMenuOpen}>
                  <span>＋</span> Ajouter
                </button>
                {addMenuOpen && (
                  <div className="add-menu">
                    {(["HOMEWORK", "TEST", "INFORMATION"] as ItemType[]).map((type) => (
                      <button key={type} onClick={() => { setModalType(type); setAddMenuOpen(false); }}>
                        <span className={`menu-dot ${type.toLowerCase()}`} />
                        <span><strong>{TYPE_LABELS[type]}</strong><small>{type === "HOMEWORK" ? "Travail à réaliser" : type === "TEST" ? "Évaluation planifiée" : "Message pour la classe"}</small></span>
                        <span>›</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {!studentPreview && (
            <div className="view-tabs" role="tablist" aria-label="Choisir la vue">
              <button className={view === "mine" ? "active" : ""} onClick={() => setView("mine")}>Mes éléments <span>{items.filter((item) => item.mine).length}</span></button>
              <button className={view === "class" ? "active" : ""} onClick={() => setView("class")}>Toute la classe <span>{items.length}</span></button>
            </div>
          )}

          <section className="summary-grid" aria-label="Résumé de la semaine">
            <article><span className="summary-icon teal">▦</span><div><small>Éléments prévus</small><strong>{totalClassItems}</strong></div><em>Cette semaine</em></article>
            <article><span className="summary-icon coral">!</span><div><small>Contrôles</small><strong>{testsCount}</strong></div><em>{testsCount ? "À anticiper" : "Aucun"}</em></article>
            <article><span className="summary-icon blue">≈</span><div><small>Jour le plus chargé</small><strong className="word-value">{busyDay}</strong></div><em>{totalClassItems ? "2 éléments" : "—"}</em></article>
          </section>

          <section className="calendar-panel">
            <div className="calendar-toolbar">
              <div className="week-navigation">
                <button onClick={() => setWeekOffset((value) => value - 1)} aria-label="Semaine précédente">‹</button>
                <button className="today" onClick={() => setWeekOffset(0)}>Aujourd’hui</button>
                <button onClick={() => setWeekOffset((value) => value + 1)} aria-label="Semaine suivante">›</button>
                <h2>{shortDate(days[0])} — {shortDate(days[4])} 2026</h2>
              </div>
              <div className="filters">
                <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} aria-label="Filtrer par branche">
                  {SUBJECTS.map((subject) => <option key={subject}>{subject}</option>)}
                </select>
                <div className="type-filters" aria-label="Filtrer par type">
                  <button className={typeFilter === "ALL" ? "active" : ""} onClick={() => setTypeFilter("ALL")}>Tout</button>
                  <button className={typeFilter === "HOMEWORK" ? "active" : ""} onClick={() => setTypeFilter("HOMEWORK")}>Devoirs</button>
                  <button className={typeFilter === "TEST" ? "active" : ""} onClick={() => setTypeFilter("TEST")}>Contrôles</button>
                  <button className={typeFilter === "INFORMATION" ? "active" : ""} onClick={() => setTypeFilter("INFORMATION")}>Infos</button>
                </div>
              </div>
            </div>

            <div className="week-grid">
              {days.map((date, dayIndex) => {
                const dayItems = visibleItems.filter((item) => item.day === dayIndex);
                const isToday = weekOffset === 0 && dayIndex === 1;
                return (
                  <section className={`day-column ${isToday ? "today-column" : ""}`} key={date.toISOString()}>
                    <header>
                      <span>{dayName(date)}</span>
                      <strong className={isToday ? "today-number" : ""}>{date.getDate()}</strong>
                      <small>{dayItems.length ? `${dayItems.length} élément${dayItems.length > 1 ? "s" : ""}` : "Libre"}</small>
                    </header>
                    <div className="day-items">
                      {dayItems.map((item) => (
                        <article className={`agenda-card ${item.type.toLowerCase()}`} key={item.id}>
                          <div className="card-meta">
                            <span>{TYPE_LABELS[item.type]}</span>
                            {item.time && <time>{item.time}</time>}
                          </div>
                          <small className="subject">{item.subject}</small>
                          <h3>{item.title}</h3>
                          <p>{item.detail}</p>
                          <footer><span className="mini-avatar">{item.mine ? "VO" : item.teacher.charAt(0)}</span>{item.teacher}</footer>
                        </article>
                      ))}
                      {!dayItems.length && (
                        <div className="empty-day"><span>＋</span><p>Aucun élément</p></div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>

          <p className="demo-caption">Prototype interactif · Les changements ajoutés ici restent uniquement dans cette démonstration.</p>
        </section>
      </main>

      {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}

      {modalType && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalType(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">Nouvel élément</p><h2 id="modal-title">Ajouter un {TYPE_LABELS[modalType].toLowerCase()}</h2></div>
              <button onClick={() => setModalType(null)} aria-label="Fermer">×</button>
            </div>
            <form onSubmit={submitItem}>
              <label>Titre<input name="title" placeholder={modalType === "TEST" ? "Sujet du contrôle" : "Titre visible par la classe"} autoFocus required /></label>
              <div className="form-row">
                <label>Branche<select name="subject" defaultValue="Français">{SUBJECTS.slice(1).map((subject) => <option key={subject}>{subject}</option>)}</select></label>
                <label>Jour<select name="day" defaultValue="1">{days.map((date, index) => <option value={index} key={date.toISOString()}>{dayName(date)} {date.getDate()}</option>)}</select></label>
              </div>
              <label>Consigne ou précision<textarea name="detail" placeholder="Ajoutez une indication utile…" rows={3} /></label>
              <div className="modal-actions"><button type="button" onClick={() => setModalType(null)}>Annuler</button><button type="submit">Publier dans l’agenda</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
