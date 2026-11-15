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

function studentHeaderWeekPill(slot: CourseDaySlot): string {
  const number = String(slot.schoolWeekNumber);
  if (slot.weekKind === "A" || slot.weekKind === "B") return `Sem ${number}-${slot.weekKind}`;
  return `Sem ${number}`;
}

function StudentNavIcon({ name }: { name: "tout" | "devoirs" | "controles" | "historique" }) {
  const paths = {
    tout: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z",
    devoirs: "M7 3.5h7.2L19 8.2V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z M14 3.8V8h4.2 M8.5 12.5h7 M8.5 16h5",
    controles: "M8 4.5h8a2 2 0 0 1 2 2V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V6.5a2 2 0 0 1 2-2Z M9 12.2 11 14.2 15.2 10",
    historique: "M12 6.5V12l3.5 2 M12 20a8 8 0 1 0-7.2-4.5 M5 12.5H2.5V15",
  };
  return (
    <span className="student-nav-icon" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d={paths[name]} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
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
          <div className="student-hero-title-row">
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
            <button className="student-signout-mobile" type="button" onClick={onSignOut}>
              {signOutLabel === "Se déconnecter" ? "Sortir" : "Quitter"}
            </button>
          </div>
          {displayCourseDay ? (
            <div className="student-context-pills" aria-label="Classe et semaine">
              <span className="student-context-pill">{classBadge || classroomName}</span>
              <span className="student-context-pill">{studentHeaderWeekPill(displayCourseDay)}</span>
            </div>
          ) : null}

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
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? "active" : ""}
            aria-current={tab === entry.id ? "page" : undefined}
            onClick={() => onTabChange(entry.id)}
          >
            <StudentNavIcon name={entry.id} />
            {entry.label}
          </button>
        ))}
        <button
          type="button"
          className={tab === "historique" ? "active" : ""}
          aria-current={tab === "historique" ? "page" : undefined}
          onClick={() => onTabChange("historique")}
        >
          <StudentNavIcon name="historique" />
          Cours précédents
        </button>
      </nav>
      )}
    </div>
  );
}
