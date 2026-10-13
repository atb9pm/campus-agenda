import type { CourseDaySlot } from "@campus/features/calendar";
import { courseDayKey, formatCourseDayHeading, formatCourseDayMenuLabel, formatSchoolWeekLabel } from "@campus/features/calendar";
import type { UpcomingTestEntry } from "@campus/features/evaluations";
import type {
  ControlPlanningWeek,
  StudentCourseDaySection,
} from "@campus/features/student";
import { BrandLogo } from "./brand-logo.tsx";
import { StudentControlsPanel } from "./student-controls-panel.tsx";
import { StudentHomeworkPanel } from "./student-homework-panel.tsx";

export type StudentDashboardTab = "tout" | "devoirs" | "controles" | "historique";

const TABS: { id: Exclude<StudentDashboardTab, "historique">; label: string }[] = [
  { id: "tout", label: "Tout" },
  { id: "devoirs", label: "Devoirs" },
  { id: "controles", label: "Contrôles" },
];

export function StudentDashboard({
  appVersion,
  classroomName,
  sessionLabel,
  displayCourseDay,
  followingCourseDay,
  historyOpen,
  previousCourseDays,
  tab,
  sections,
  futureTests,
  planning,
  today,
  signOutLabel,
  onToggleHistory,
  onSelectCourseDay,
  onBackToCurrent,
  onSignOut,
  onTabChange,
}: {
  appVersion: string;
  classroomName: string;
  sessionLabel: string;
  displayCourseDay: CourseDaySlot | null;
  followingCourseDay: boolean;
  historyOpen: boolean;
  previousCourseDays: CourseDaySlot[];
  tab: StudentDashboardTab;
  sections: StudentCourseDaySection[];
  futureTests: UpcomingTestEntry[];
  planning: ControlPlanningWeek[];
  today: Date;
  signOutLabel: string;
  onToggleHistory: () => void;
  onSelectCourseDay: (key: string) => void;
  onBackToCurrent: () => void;
  onSignOut: () => void;
  onTabChange: (tab: StudentDashboardTab) => void;
}) {
  const contentTab = tab === "historique" ? "tout" : tab;
  const showControlsPreview = followingCourseDay && contentTab === "tout";

  return (
    <div
      className="mechanical-app student-app student-course-day-app has-mobile-tabs"
      data-student-tab={tab}
      data-student-dashboard=""
    >
      <main className="student-course-day-main" id="main-content">
        <header className="student-course-day-header">
          <div className="student-course-day-brand">
            <BrandLogo />
          </div>
          <div className="student-course-day-actions">
            <div className="student-history-anchor">
              <button
                type="button"
                className="student-history-toggle"
                aria-expanded={historyOpen}
                aria-haspopup="menu"
                onClick={onToggleHistory}
              >
                Cours précédents
              </button>
              {historyOpen && (
                <menu className="student-history-menu" aria-label="Cours précédents">
                  {!followingCourseDay && (
                    <button type="button" onClick={onBackToCurrent}>
                      Revenir au prochain cours
                    </button>
                  )}
                  {previousCourseDays.map((slot) => (
                    <button
                      key={courseDayKey(slot)}
                      type="button"
                      onClick={() => onSelectCourseDay(courseDayKey(slot))}
                    >
                      {formatCourseDayMenuLabel(slot)}
                    </button>
                  ))}
                </menu>
              )}
            </div>
            <button className="student-signout desktop-only" type="button" onClick={onSignOut}>
              {signOutLabel}
            </button>
          </div>
        </header>

        <section className="student-course-day-card student-dashboard-hero" aria-labelledby="student-course-day-title">
          <div className="student-dashboard-hero-copy">
            <p className="eyebrow">
              {classroomName} · {sessionLabel}
            </p>
            {displayCourseDay ? (
              <>
                <p className="student-week-label">{formatSchoolWeekLabel(displayCourseDay)}</p>
                <h1 id="student-course-day-title">{formatCourseDayHeading(displayCourseDay)}</h1>
                {!followingCourseDay && (
                  <p className="student-course-day-note">Consultation d’un cours passé.</p>
                )}
              </>
            ) : (
              <h1 id="student-course-day-title">Agenda élève</h1>
            )}
          </div>

          <div className="student-view-tabs" role="tablist" aria-label="Vue élève">
            {TABS.map((entry) => {
              const selected = contentTab === entry.id && tab !== "historique";
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  id={`student-tab-${entry.id}`}
                  aria-selected={selected}
                  aria-controls={`student-panel-${entry.id}`}
                  className={selected ? "active" : ""}
                  onClick={() => onTabChange(entry.id)}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
        </section>

        {displayCourseDay ? (
          <>
            {tab !== "historique" && contentTab === "tout" ? (
              <div
                className="student-dashboard-grid"
                data-layout="tout"
                id="student-panel-tout"
                role="tabpanel"
                aria-labelledby="student-tab-tout"
              >
                <StudentHomeworkPanel sections={sections} mode="todo" />
                {showControlsPreview ? (
                  <StudentControlsPanel
                    mode="preview"
                    futureTests={futureTests}
                    planning={planning}
                    today={today}
                    onSeeAll={() => onTabChange("controles")}
                  />
                ) : null}
              </div>
            ) : null}

            {tab === "devoirs" ? (
              <div id="student-panel-devoirs" role="tabpanel" aria-labelledby="student-tab-devoirs">
                <StudentHomeworkPanel sections={sections} mode="homework" />
              </div>
            ) : null}

            {tab === "controles" ? (
              <div id="student-panel-controles" role="tabpanel" aria-labelledby="student-tab-controles">
                <StudentControlsPanel
                  mode="planning"
                  futureTests={futureTests}
                  planning={planning}
                  today={today}
                />
              </div>
            ) : null}
          </>
        ) : (
          <div className="student-course-day-empty">
            <strong>Aucune année scolaire configurée.</strong>
            <small>L’agenda élève sera disponible dès qu’une année scolaire sera active.</small>
          </div>
        )}

        <section
          className="student-history-panel student-mobile-panel"
          data-panel="historique"
          aria-labelledby="student-history-title"
          hidden={tab !== "historique"}
        >
          <h2 id="student-history-title">Cours précédents</h2>
          {!followingCourseDay && (
            <button type="button" className="student-history-current" onClick={onBackToCurrent}>
              Revenir au prochain cours
            </button>
          )}
          {previousCourseDays.length ? (
            <ul className="student-history-list">
              {previousCourseDays.map((slot) => (
                <li key={courseDayKey(slot)}>
                  <button type="button" onClick={() => onSelectCourseDay(courseDayKey(slot))}>
                    {formatCourseDayMenuLabel(slot)}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="student-history-empty">Aucun cours précédent disponible.</p>
          )}
        </section>

        <p className="prototype-label">CONSULTATION ÉLÈVE · CAMPUS AGENDA {appVersion}</p>
      </main>

      <nav className="mobile-tab-bar" aria-label="Navigation élève">
        <button
          type="button"
          className={tab === "historique" ? "active" : ""}
          onClick={() => onTabChange("historique")}
        >
          <span aria-hidden="true">↺</span>
          Passés
        </button>
        <button type="button" onClick={onSignOut}>
          <span aria-hidden="true">↪</span>
          {signOutLabel === "Quitter l’aperçu" ? "Quitter" : "Sortir"}
        </button>
      </nav>
    </div>
  );
}
