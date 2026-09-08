"use client";

import { FormEvent, useEffect, useState } from "react";

import {
  DEFAULT_LOGIN_TAB,
  LAST_TEACHER_INITIALS_KEY,
  readStoredValue,
  type LoginTab,
} from "@campus/features/auth-entry";

interface LoginPanelProps {
  appVersion: string;
  pending: boolean;
  studentError: string;
  teacherError: string;
  onStudentSubmit: (code: string) => void;
  onTeacherSubmit: (initials: string, password: string, remember: boolean) => void;
}

const SHOW_DEMO_STUDENT_CODES = process.env.NODE_ENV === "development";

export function LoginPanel({
  appVersion,
  pending,
  studentError,
  teacherError,
  onStudentSubmit,
  onTeacherSubmit,
}: LoginPanelProps) {
  const [tab, setTab] = useState<LoginTab>(DEFAULT_LOGIN_TAB);
  const [studentCode, setStudentCode] = useState("");
  const [initials, setInitials] = useState("");
  const [remember, setRemember] = useState(true);

  // Le stockage local n'existe pas au rendu serveur : la reprise des initiales
  // enseignant ne peut se faire qu'après montage. Le code apprentis n'est jamais mémorisé.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setInitials(readStoredValue(LAST_TEACHER_INITIALS_KEY) ?? "");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function submitStudent(event: FormEvent) {
    event.preventDefault();
    onStudentSubmit(studentCode);
  }

  function submitTeacher(event: FormEvent) {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    onTeacherSubmit(initials, String(form.get("password") ?? ""), remember);
  }

  return (
    <div className="teacher-login-shell">
      <main className="teacher-login" id="main-content">
        <div className="teacher-login-brand">
          <span className="brand-emblem-image" aria-hidden="true">CA</span>
          <span><strong>CAMPUS</strong><small>AGENDA</small></span>
        </div>

        <section className="teacher-login-card" aria-labelledby="login-title">
          <div className="login-tabs" role="tablist" aria-label="Type de connexion">
            <button
              type="button"
              role="tab"
              id="login-tab-student"
              aria-selected={tab === "student"}
              aria-controls="login-panel-student"
              className={tab === "student" ? "active" : ""}
              onClick={() => setTab("student")}
            >
              Élève
            </button>
            <button
              type="button"
              role="tab"
              id="login-tab-teacher"
              aria-selected={tab === "teacher"}
              aria-controls="login-panel-teacher"
              className={tab === "teacher" ? "active" : ""}
              onClick={() => setTab("teacher")}
            >
              Enseignant
            </button>
          </div>

          {tab === "student" ? (
            <div id="login-panel-student" role="tabpanel" aria-labelledby="login-tab-student">
              <span className="eyebrow">ESPACE ÉLÈVE</span>
              <h1 id="login-title">Mon agenda de classe</h1>
              <p>Entrez le code de votre classe. Aucun nom, aucune donnée personnelle.</p>
              <form onSubmit={submitStudent}>
                <label>
                  Code de classe
                  <input
                    name="code"
                    value={studentCode}
                    onChange={(event) => setStudentCode(event.target.value)}
                    placeholder="MECAUTO3A-K7M4-R2P8"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    aria-invalid={studentError ? true : undefined}
                    aria-describedby={studentError ? "student-login-error" : undefined}
                  />
                </label>
                {SHOW_DEMO_STUDENT_CODES ? (
                  <p className="teacher-login-hint">
                    Environnement de développement : les codes se génèrent dans Administration → Classes.
                  </p>
                ) : null}
                {studentError && (
                  <p className="teacher-login-error" id="student-login-error" role="alert">
                    {studentError}
                  </p>
                )}
                <button type="submit" disabled={pending}>
                  {pending ? "Ouverture…" : "Voir mon agenda"}
                </button>
              </form>
            </div>
          ) : (
            <div id="login-panel-teacher" role="tabpanel" aria-labelledby="login-tab-teacher">
              <span className="eyebrow">ESPACE ENSEIGNANT</span>
              <h1 id="login-title">Connexion</h1>
              <p>Vos initiales et votre mot de passe.</p>
              <form onSubmit={submitTeacher}>
                <label>
                  Initiales
                  <input
                    name="initials"
                    value={initials}
                    onChange={(event) => setInitials(event.target.value)}
                    placeholder="ChF"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                  />
                </label>
                <label>
                  Mot de passe
                  <input name="password" type="password" autoComplete="current-password" required />
                </label>
                <label className="login-remember">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  <span>Rester connecté sur cet appareil</span>
                </label>
                <p className="teacher-login-hint">
                  Décochez la case sur un poste partagé. Mot de passe oublié&nbsp;? L’administrateur en
                  génère un nouveau, provisoire.
                </p>
                {teacherError && <p className="teacher-login-error" role="alert">{teacherError}</p>}
                <button type="submit" disabled={pending}>
                  {pending ? "Connexion…" : "Se connecter"}
                </button>
              </form>
            </div>
          )}
        </section>

        <p className="prototype-label">CAMPUS AGENDA {appVersion}</p>
      </main>
    </div>
  );
}
