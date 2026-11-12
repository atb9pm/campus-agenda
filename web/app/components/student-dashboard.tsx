import type { CourseDaySlot } from "@campus/features/calendar";
import { courseDayKey, formatCourseDayHeading, formatCourseDayMenuLabel, formatSchoolWeekLabel } from "@campus/features/calendar";
import type { UpcomingTestEntry } from "@campus/features/evaluations";
import { resolveProfessionColorTheme } from "@campus/features/school-catalog";
import type {
  ControlPlanningWeek,
  StudentCourseDaySection,
} from "@campus/features/student";
import { professionColorStyle } from "../../lib/profession-color-style.ts";
import { BrandLogo } from "./brand-logo.tsx";
import { StudentControlsPanel } from "./student-controls-panel.tsx";
import { StudentHomeworkPanel, type StudentHomeworkDoneControl } from "./student-homework-panel.tsx";
import { StudentInstallPrompt } from "./student-install-prompt.tsx";

export type StudentDashboardTab = "tout" | "devoirs" | "controles" | "historique";

const TABS: { id: Exclude<StudentDashboardTab, "historique">; label: string }[] = [
  { id: "tout", label: "Tout" },
  { id: "devoirs", label: "Devoirs" },
  { id: "controles", label: "Contrôles" },
];

function shortWeekBadge(slot: CourseDaySlot): string {
  const padded = String(slot.schoolWeekNumber).padStart(2, "0");
  if (slot.weekKind === "A" || slot.weekKind === "B") return `Sem ${padded}-${slot.weekKind}`;
  return `Sem ${padded}`;
}

function classBadgeName(classroomName: string, branchLabel: string): string {
  const branch = branchLabel.trim();
  const suffix = ` · ${branch}`;
  if (branch && classroomName.endsWith(suffix)) return classroomName.slice(0, -suffix.length);
  return classroomName;
}

export function StudentDashboard({
  appVersion,
  classroomName,
  displayCourseDay,
  followingCourseDay,
  historyOpen,
  previousCourseDays,
  tab,
  sections,
  doneControl,
  offerInstall = false,
  futureTests,
  planning,
  today,
  signOutLabel,
  branchPreview = false,
  branchLabel = "",
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
  /** Absent en aperçu enseignant : pas de coche « fait ». */
  doneControl?: StudentHomeworkDoneControl;
  /** Invitation « écran d’accueil » : élève connecté par code uniquement. */
  offerInstall?: boolean;
  futureTests: UpcomingTestEntry[];
  planning: ControlPlanningWeek[];
  today: Date;
  signOutLabel: string;
  /** Présentation validée de l’aperçu branche enseignant. */
  branchPreview?: boolean;
  branchLabel?: string;
  onToggleHistory: () => void;
  onSelectCourseDay: (key: string) => void;
  onBackToCurrent: () => void;
  onSignOut: () => void;
  onTabChange: (tab: StudentDashboardTab) => void;
}) {
  const contentTab = tab === "historique" ? "tout" : tab;
  const showControlsPreview = contentTab === "tout";
  const presentation = branchPreview ? "banner" : "default";
  const classBadge = classBadgeName(classroomName, branchLabel);
  const professionStyle = branchPreview
    ? professionColorStyle(resolveProfessionColorTheme(null, classBadge || classroomName))
    : undefined;

  return (
    <div
      className={`mechanical-app student-app student-course-day-app${branchPreview ? " branch-preview" : " has-mobile-tabs"}`}
      style={professionStyle}
      data-student-tab={tab}
      data-student-dashboard=""
      data-branch-preview={branchPreview ? "" : undefined}
    >
      <main className="student-course-day-main" id="main-content">
        {branchPreview ? (
          <header className="branch-preview-head">
            <div className="branch-preview-identity">
              <h1 id="student-course-day-title">
                {displayCourseDay ? formatCourseDayHeading(displayCourseDay) : "Agenda élève"}
              </h1>
              <div className="branch-preview-meta" aria-label="Classe, branche et semaine">
                {classBadge ? <span className="branch-preview-pill is-class">{classBadge}</span> : null}
                {branchLabel.trim() ? (
                  <>
                    <span className="branch-preview-dot" aria-hidden="true" />
                    <span className="branch-preview-pill is-branch">{branchLabel.trim()}</span>
                  </>
                ) : null}
                {displayCourseDay ? (
                  <>
                    <span className="branch-preview-dot" aria-hidden="true" />
                    <span className="branch-preview-pill is-week">{shortWeekBadge(displayCourseDay)}</span>
                  </>
                ) : null}
              </div>
            </div>
            <div className="branch-preview-menu">
              <div className="student-view-tabs" aria-label="Vue élève">
                {TABS.map((entry) => {
                  const selected = contentTab === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      aria-pressed={selected}
                      className={selected ? "active" : ""}
                      onClick={() => onTabChange(entry.id)}
                    >
                      {entry.label}
                    </button>
                  );
                })}
              </div>
              <button className="branch-preview-quit" type="button" onClick={onSignOut}>
                <span aria-hidden="true">×</span>
                {signOutLabel}
              </button>
            </div>
          </header>
        ) : null}
        {branchPreview ? null : (
        <header className="student-course-day-header">
          <div className="student-course-day-brand">
            <BrandLogo />
          </div>
          <div className="student-course-day-actions">
            <div className="student-history-anchor desktop-only">
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
        )}

        {branchPreview ? null : (
        <section className="student-course-day-card student-dashboard-hero" aria-labelledby="student-course-day-title">
          <div className="student-dashboard-hero-copy">
            <p className="eyebrow">{classroomName}</p>
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

          <div className="student-view-tabs" aria-label="Vue élève">
            {TABS.map((entry) => {
              const selected = contentTab === entry.id && tab !== "historique";
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={selected}
                  className={selected ? "active" : ""}
                  onClick={() => onTabChange(entry.id)}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
        </section>
        )}

        {offerInstall ? <StudentInstallPrompt /> : null}

        {displayCourseDay ? (
          <>
            {branchPreview && (contentTab === "tout" || tab === "controles") ? (
              <StudentControlsPanel
                mode={tab === "controles" ? "planning" : "preview"}
                futureTests={futureTests}
                planning={planning}
                today={today}
                presentation={presentation}
                branchLabel={branchLabel}
              />
            ) : null}

            {branchPreview && (contentTab === "tout" || tab === "devoirs") ? (
              <div id={tab === "devoirs" ? "student-panel-devoirs" : "student-panel-tout"}>
                <StudentHomeworkPanel
                  sections={sections}
                  mode={tab === "devoirs" ? "homework" : "todo"}
                  doneControl={doneControl}
                  presentation={presentation}
                />
              </div>
            ) : null}

            {!branchPreview && tab !== "historique" && contentTab === "tout" ? (
              <div
                className="student-dashboard-grid"
                data-layout="tout"
                id="student-panel-tout"
              >
                <StudentHomeworkPanel sections={sections} mode="todo" doneControl={doneControl} />
                {showControlsPreview ? (
                  <StudentControlsPanel
                    mode="preview"
                    futureTests={futureTests}
                    planning={planning}
                    today={today}
                  />
                ) : null}
              </div>
            ) : null}

            {!branchPreview && tab === "devoirs" ? (
              <div id="student-panel-devoirs">
                <StudentHomeworkPanel sections={sections} mode="homework" doneControl={doneControl} />
              </div>
            ) : null}

            {!branchPreview && tab === "controles" ? (
              <div id="student-panel-controles">
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

        {branchPreview ? null : (
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
        )}

        {branchPreview ? null : (
        <p className="prototype-label">CONSULTATION ÉLÈVE · CAMPUS AGENDA {appVersion}</p>
        )}
      </main>

      {branchPreview ? (
        <footer className="branch-preview-dock">
          <div className="branch-preview-brand">
            <BrandLogo className="branch-preview-logo" />
            <span>Aperçu branche – Élève</span>
          </div>
        </footer>
      ) : null}

      {branchPreview ? null : (
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
          {signOutLabel === "Se déconnecter" ? "Sortir" : "Quitter"}
        </button>
      </nav>
      )}
    </div>
  );
}
