"use client";

import {
  formatTeacherCourseClassMeta,
  groupTeacherCoursesByClass,
  TEACHER_COURSES_EMPTY_MESSAGE,
  WORKSPACE_ASSIGNMENT_ROLE_LABELS,
  type TeacherCourseWorkspaceEntry,
} from "@campus/features/teacher-workspace";
import type { TeacherClassSetup } from "@campus/features/teacher-setup";

interface MesCoursPanelProps {
  courses: TeacherCourseWorkspaceEntry[];
  schoolYearLabel?: string | null;
  loading?: boolean;
  onOpenClass?: (classSetup: TeacherClassSetup) => void;
  displaySetups?: TeacherClassSetup[];
}

export function MesCoursPanel({
  courses,
  schoolYearLabel,
  loading = false,
  onOpenClass,
  displaySetups = [],
}: MesCoursPanelProps) {
  const groups = groupTeacherCoursesByClass(courses);

  return (
    <section className="teacher-workspace" aria-label="Mes cours">
      <div className="workspace-intro">
        <p className="eyebrow">ESPACE ENSEIGNANT</p>
        <h2>Mes cours</h2>
        <p>
          Cours qui vous sont attribués
          {schoolYearLabel ? ` pour ${schoolYearLabel}` : " pour l’année scolaire active"}.
        </p>
      </div>

      {loading ? (
        <p className="ma-semaine-empty">Chargement de vos cours…</p>
      ) : !courses.length ? (
        <p className="ma-semaine-empty">{TEACHER_COURSES_EMPTY_MESSAGE}</p>
      ) : (
        <div className="mes-cours-groups">
          {groups.map((group) => {
            const meta = formatTeacherCourseClassMeta(group);
            const setup = displaySetups.find((entry) => entry.id === group.classId || entry.name === group.classCode);
            return (
              <article className="workspace-card mes-cours-class" key={group.classId}>
                <header>
                  <p className="eyebrow">{group.professionLabel ?? group.classLabel}</p>
                  <h3>{group.classCode}</h3>
                  {meta ? <p>{meta}</p> : null}
                </header>
                <ul className="mes-cours-branches">
                  {group.courses.map((course) => (
                    <li key={course.annualCourseId}>
                      <div>
                        <strong>{course.branchLabel}</strong>
                        <span className="mes-cours-role">{WORKSPACE_ASSIGNMENT_ROLE_LABELS[course.role]}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {onOpenClass && setup ? (
                  <button
                    type="button"
                    className="workspace-action secondary"
                    onClick={() => onOpenClass(setup)}
                  >
                    Ouvrir le carnet
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
