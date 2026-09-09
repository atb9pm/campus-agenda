"use client";

import { useState } from "react";

import {
  formatTeacherCourseClassMeta,
  groupTeacherCoursesByClass,
  TEACHER_COURSES_EMPTY_MESSAGE,
  WORKSPACE_ASSIGNMENT_ROLE_LABELS,
  type TeacherCourseWorkspaceEntry,
} from "@campus/features/teacher-workspace";
import type { TeacherClassAccessView } from "@campus/types/student-access";
import type { TeacherClassSetup } from "@campus/features/teacher-setup";

interface MesCoursPanelProps {
  courses: TeacherCourseWorkspaceEntry[];
  classAccesses?: Record<string, TeacherClassAccessView>;
  schoolYearLabel?: string | null;
  loading?: boolean;
  onOpenClass?: (classSetup: TeacherClassSetup) => void;
  onOpenCourse?: (course: TeacherCourseWorkspaceEntry) => void;
  displaySetups?: TeacherClassSetup[];
}

function accessHint(view: TeacherClassAccessView | undefined): string {
  if (!view || view.status === "none") {
    return "Aucun accès — l’administrateur peut générer un code.";
  }
  if (view.status === "revoked") return "Accès désactivé par l’administrateur.";
  if (view.status === "needs_admin") {
    return "L’administrateur doit régénérer le code pour l’afficher ici.";
  }
  return "À communiquer aux apprentis. Seul l’administrateur peut le changer.";
}

async function copyAccessCode(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    return false;
  }
}

function ClassAccessReadonly({ view }: { view: TeacherClassAccessView | undefined }) {
  const [copied, setCopied] = useState(false);
  const code = view?.status === "active" ? view.code : null;

  return (
    <div className="mes-cours-access">
      <p className="mes-cours-access-title">Code d’accès classe</p>
      {code ? (
        <div className="mes-cours-access-row">
          <p className="mes-cours-access-code">{code}</p>
          <button
            type="button"
            className="workspace-action secondary"
            aria-label={`Copier le code d’accès de la classe`}
            onClick={() => {
              void copyAccessCode(code).then((ok) => {
                if (!ok) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "Copié" : "Copier"}
          </button>
        </div>
      ) : (
        <p className="mes-cours-access-empty">Pas de code affiché</p>
      )}
      <p className="mes-cours-access-hint">{accessHint(view)}</p>
    </div>
  );
}

export function MesCoursPanel({
  courses,
  classAccesses = {},
  schoolYearLabel,
  loading = false,
  onOpenClass,
  onOpenCourse,
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
                <ClassAccessReadonly view={classAccesses[group.classId]} />
                <ul className="mes-cours-branches">
                  {group.courses.map((course) => (
                    <li key={course.annualCourseId}>
                      <div>
                        <strong>{course.branchLabel}</strong>
                        <span className="mes-cours-role">{WORKSPACE_ASSIGNMENT_ROLE_LABELS[course.role]}</span>
                      </div>
                      {onOpenCourse ? (
                        <button
                          type="button"
                          className="workspace-action secondary"
                          onClick={() => onOpenCourse(course)}
                        >
                          Voir le déroulement
                        </button>
                      ) : null}
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
