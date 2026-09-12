"use client";

import { FormEvent, useState } from "react";

interface MfaChallengePanelProps {
  appVersion: string;
  displayName: string;
  initials: string;
  pending: boolean;
  error: string;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}

export function MfaChallengePanel({
  appVersion,
  displayName,
  initials,
  pending,
  error,
  onSubmit,
  onCancel,
}: MfaChallengePanelProps) {
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(code.trim());
  }

  return (
    <div className="teacher-login-shell">
      <main className="teacher-login" id="main-content">
        <div className="teacher-login-brand">
          <span className="brand-emblem-image" aria-hidden="true">CA</span>
          <span><strong>CAMPUS</strong><small>AGENDA</small></span>
        </div>

        <section className="teacher-login-card" aria-labelledby="mfa-challenge-title">
          <span className="eyebrow">ESPACE ADMINISTRATEUR</span>
          <h1 id="mfa-challenge-title">Double authentification</h1>
          <p>
            {displayName} ({initials}) — saisissez {useRecovery ? "un code de récupération" : "le code à 6 chiffres"}
            {" "}de votre application d’authentification.
          </p>
          <form onSubmit={submit}>
            <label>
              {useRecovery ? "Code de récupération" : "Code à 6 chiffres"}
              <input
                className={useRecovery ? undefined : "totp-code-input"}
                inputMode={useRecovery ? "text" : "numeric"}
                autoComplete={useRecovery ? "off" : "one-time-code"}
                pattern={useRecovery ? undefined : "[0-9]{6}"}
                maxLength={useRecovery ? 12 : 6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
            {error ? <p className="teacher-login-error" role="alert">{error}</p> : null}
            <button type="submit" disabled={pending}>
              {pending ? "Vérification…" : "Valider"}
            </button>
          </form>
          <button
            type="button"
            className="login-secondary-action"
            onClick={() => {
              setUseRecovery((current) => !current);
              setCode("");
            }}
          >
            {useRecovery ? "Utiliser un code à 6 chiffres" : "Utiliser un code de récupération"}
          </button>
          <button type="button" className="login-secondary-action" onClick={onCancel}>
            Se déconnecter
          </button>
        </section>

        <p className="prototype-label">CAMPUS AGENDA {appVersion}</p>
      </main>
    </div>
  );
}
