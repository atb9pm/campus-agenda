"use client";

import { FormEvent, useMemo, useState } from "react";

type ItemType = "HOMEWORK" | "TEST" | "INFORMATION";
type ViewMode = "mine" | "class";

type AgendaItem = {
  id: number;
  day: number;
  hour: number;
  type: ItemType;
  subject: string;
  title: string;
  detail: string;
  teacher: string;
  mine: boolean;
};

const TYPE_LABELS: Record<ItemType, string> = {
  HOMEWORK: "Devoir",
  TEST: "Contrôle",
  INFORMATION: "Information",
};

const SUBJECTS = ["Toutes les branches", "Moteur", "Électricité", "Châssis", "Mathématiques"];
const HOURS = Array.from({ length: 10 }, (_, index) => index + 8);

const INITIAL_ITEMS: AgendaItem[] = [
  { id: 1, day: 0, hour: 9, type: "HOMEWORK", subject: "Châssis", title: "Système de freinage", detail: "Exercices 12 à 18", teacher: "Mme Dupont · démo", mine: false },
  { id: 2, day: 1, hour: 11, type: "INFORMATION", subject: "Atelier", title: "Tenue de travail", detail: "Lunettes de protection", teacher: "M. Martin · démo", mine: false },
  { id: 3, day: 2, hour: 13, type: "TEST", subject: "Électricité", title: "Injection électronique", detail: "Capteurs et actionneurs", teacher: "Vous · compte démo", mine: true },
  { id: 4, day: 3, hour: 10, type: "HOMEWORK", subject: "Moteur", title: "Distribution", detail: "Compléter le schéma", teacher: "M. Martin · démo", mine: false },
  { id: 5, day: 4, hour: 14, type: "INFORMATION", subject: "Moteur", title: "Dossier technique", detail: "Document disponible", teacher: "Vous · compte démo", mine: true },
];

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

function MechanicalEmblem() {
  return (
    <span className="mechanical-emblem" aria-hidden="true">
      <span className="gear-glyph">⚙</span>
      <span className="piston-glyph"><i /><b /></span>
      <span className="disc-dots">•••</span>
    </span>
  );
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
    if (weekOffset !== 0 && item.id <= 5) return false;
    if (!studentPreview && view === "mine" && !item.mine) return false;
    if (typeFilter !== "ALL" && item.type !== typeFilter) return false;
    if (subjectFilter !== SUBJECTS[0] && item.subject !== subjectFilter) return false;
    return true;
  });

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modalType) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;
    setItems((current) => [...current, {
      id: Date.now(),
      day: Number(form.get("day") || 0),
      hour: Number(form.get("hour") || 8),
      type: modalType,
      subject: String(form.get("subject") || "Moteur"),
      title,
      detail: String(form.get("detail") || "").trim() || "Aucune précision",
      teacher: "Vous · compte démo",
      mine: true,
    }]);
    setWeekOffset(0);
    setView("mine");
    setStudentPreview(false);
    setModalType(null);
    setNotice(`${TYPE_LABELS[modalType]} ajouté à la démonstration.`);
    window.setTimeout(() => setNotice(""), 3200);
  }

  return (
    <div className="mechanical-app">
      <aside className="technical-sidebar">
        <div className="brand-lockup">
          <MechanicalEmblem />
          <span><strong>CAMPUS</strong><small>AGENDA</small></span>
        </div>

        <nav aria-label="Navigation principale">
          <button><span>⌂</span> Tableau de bord</button>
          <button><span>♙</span> Mes classes</button>
          <button className="active"><span>▣</span> Agenda partagé</button>
          <button><span>□</span> Documents</button>
          <button><span>⚙</span> Paramètres</button>
        </nav>

        <div className="technical-note">
          <span>CODE CLASSE</span>
          <strong>TMA 2A78</strong>
          <small>Démonstration uniquement</small>
        </div>
        <button className="signout"><span>↪</span> Déconnexion</button>
      </aside>

      <main className="technical-main">
        <div className="blueprint-watermark" />

        <header className="technical-header">
          <div className="mobile-lockup"><MechanicalEmblem /><strong>CAMPUS AGENDA</strong></div>
          <div className="class-identity">
            <span className="eyebrow">Technique Mécanique Automobile</span>
            <h1>{studentPreview ? "Mon agenda" : "Agenda partagé"}</h1>
            <p>{studentPreview ? "Tous les éléments publiés pour la classe 2e TMA." : "Planifiez la semaine et visualisez la charge globale de la classe."}</p>
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
                    {(["HOMEWORK", "TEST", "INFORMATION"] as ItemType[]).map((type) => (
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
            <span className="profile-disc">FC</span>
          </div>
        </header>

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
                <button className={view === "mine" ? "active" : ""} onClick={() => setView("mine")}>Mes éléments <span>{items.filter((item) => item.mine).length}</span></button>
                <button className={view === "class" ? "active" : ""} onClick={() => setView("class")}>Toute la classe <span>{items.length}</span></button>
              </div>
            )}

            <section className="mini-calendar">
              <header><strong>AOÛT 2026</strong><span>‹　›</span></header>
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
                {SUBJECTS.map((subject) => <option key={subject}>{subject}</option>)}
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
              <span>2e TMA　⌄</span>
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
                        {slotItems.map((item) => (
                          <article className={`schedule-event ${item.type.toLowerCase()}`} key={item.id}>
                            <small>{TYPE_LABELS[item.type]} · {item.subject}</small>
                            <strong>{item.title}</strong>
                            <span>{item.detail}</span>
                            <em>{item.mine ? "Vous" : item.teacher.split(" · ")[0]}</em>
                          </article>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {!visibleItems.length && <div className="empty-week"><span>▱</span><strong>Semaine libre</strong><small>Aucun élément ne correspond aux filtres.</small></div>}
          </section>
        </section>
        <p className="prototype-label">PROTOTYPE INTERACTIF · CAMPUS AGENDA 0.3</p>
      </main>

      {notice && <div className="technical-toast" role="status">✓　{notice}</div>}

      {modalType && (
        <div className="technical-modal-backdrop" onMouseDown={() => setModalType(null)}>
          <section className="technical-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span className="eyebrow">NOUVEL ÉLÉMENT</span><h2 id="modal-title">Ajouter un {TYPE_LABELS[modalType].toLowerCase()}</h2></div><button onClick={() => setModalType(null)}>×</button></header>
            <form onSubmit={submitItem}>
              <label>Titre<input name="title" placeholder="Titre visible par la classe" required autoFocus /></label>
              <div className="modal-row">
                <label>Branche<select name="subject" defaultValue="Moteur">{SUBJECTS.slice(1).map((subject) => <option key={subject}>{subject}</option>)}</select></label>
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
