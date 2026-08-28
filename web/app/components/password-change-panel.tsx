"use client";

import { FormEvent, useState } from "react";

import { MIN_PASSWORD_LENGTH } from "@campus/features/teacher-accounts";

interface PasswordChangePanelProps {
  appVersion: string;
  displayName: string;
  initials: string;
  pending: boolean;
  error: string;
  onSubmit: (currentPassword: string, nextPassword: string) => void;
  onCancel: () => void;
}

export function PasswordChangePanel({
  appVersion,
  displayName,
  initials,
  pending,
  error,
  onSubmit,
  onCancel,
}: PasswordChangePanelProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (nextPassword !== confirmation) {
      setLocalError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }
    setLocalError("");
    onSubmit(currentPassword, nextPassword);
  }

  return (
    <div className="teacher-login-shell">
      <main className="teacher-login" id="main-content">
        <div className="teacher-login-brand">
          <span className="brand-emblem-image" aria-hidden="true">CA</span>
          <span><strong>CAMPUS</strong><small>AGENDA</small></span>
        </div>

        <section className="teacher-login-card" aria-labelledby="password-change-title">
          <span className="eyebrow">PREMIÈRE CONNEXION</span>
          <h1 id="password-change-title">Choisissez votre mot de passe</h1>
          <p>
            {displayName} ({initials}) — votre mot de passe provisoire doit être remplacé avant d’accéder à
            Campus Agenda.
          </p>
          <form onSubmit={submit}>
            <label>
              Mot de passe provisoire
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              Nouveau mot de passe
              <input
                type="password"
                value={nextPassword}
                onChange={(event) => setNextPassword(event.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </label>
            <label>
              Confirmation
              <input
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </label>
            <p className="teacher-login-hint">
              Au moins {MIN_PASSWORD_LENGTH} caractères, avec une lettre et un chiffre.
            </p>
            {(localError || error) && (
              <p className="teacher-login-error" role="alert">{localError || error}</p>
            )}
            <button type="submit" disabled={pending}>
              {pending ? "Enregistrement…" : "Enregistrer et continuer"}
            </button>
          </form>
          <button type="button" className="login-secondary-action" onClick={onCancel}>
            Se déconnecter
          </button>
        </section>

        <p className="prototype-label">CAMPUS AGENDA {appVersion}</p>
      </main>
    </div>
  );
}
