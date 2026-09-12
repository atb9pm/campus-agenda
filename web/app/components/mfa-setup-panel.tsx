"use client";

import { FormEvent, useEffect, useState } from "react";

interface MfaSetupPanelProps {
  appVersion: string;
  displayName: string;
  initials: string;
  pending: boolean;
  error: string;
  qrDataUrl: string | null;
  manualKey: string | null;
  recoveryCodes: string[] | null;
  onStart: () => void;
  onConfirm: (code: string) => void;
  onContinue: () => void;
  onCancel: () => void;
}

export function MfaSetupPanel({
  appVersion,
  displayName,
  initials,
  pending,
  error,
  qrDataUrl,
  manualKey,
  recoveryCodes,
  onStart,
  onConfirm,
  onContinue,
  onCancel,
}: MfaSetupPanelProps) {
  const [code, setCode] = useState("");
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    onStart();
    // Démarrage unique de l'enrôlement à l'ouverture de l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    onConfirm(code.trim());
  }

  function copyCodes() {
    if (!recoveryCodes?.length) return;
    void navigator.clipboard.writeText(recoveryCodes.join("\n"));
  }

  function printCodes() {
    window.print();
  }

  return (
    <div className="teacher-login-shell">
      <main className="teacher-login" id="main-content">
        <div className="teacher-login-brand">
          <span className="brand-emblem-image" aria-hidden="true">CA</span>
          <span><strong>CAMPUS</strong><small>AGENDA</small></span>
        </div>

        <section className="teacher-login-card" aria-labelledby="mfa-setup-title">
          <span className="eyebrow">ESPACE ADMINISTRATEUR</span>
          {recoveryCodes ? (
            <>
              <h1 id="mfa-setup-title">Codes de récupération</h1>
              <p>
                Conservez-les dans un endroit sûr. Ils ne seront plus affichés.
                Chaque code ne peut servir qu’une fois.
              </p>
              <ol className="mfa-recovery-codes">
                {recoveryCodes.map((entry) => (
                  <li key={entry}><code>{entry}</code></li>
                ))}
              </ol>
              <div className="mfa-recovery-actions">
                <button type="button" onClick={copyCodes}>Copier</button>
                <button type="button" onClick={printCodes}>Imprimer</button>
              </div>
              <button type="button" className="mfa-continue" onClick={onContinue}>
                J’ai enregistré ces codes
              </button>
            </>
          ) : (
            <>
              <h1 id="mfa-setup-title">Configurer la double authentification</h1>
              <p>
                {displayName} ({initials}) — scannez le QR code avec Microsoft Authenticator,
                Google Authenticator, 1Password, Authy ou toute application TOTP.
              </p>
              {qrDataUrl ? (
                <div className="mfa-qr">
                  {/* QR généré localement (data URL), pas une ressource distante. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="QR code de configuration TOTP" width={220} height={220} />
                  <button type="button" className="login-secondary-action" onClick={() => setShowManual((current) => !current)}>
                    {showManual ? "Masquer la clé manuelle" : "Afficher la clé manuelle"}
                  </button>
                  {showManual && manualKey ? <p className="mfa-manual-key"><code>{manualKey}</code></p> : null}
                </div>
              ) : (
                <p className="teacher-login-hint">Préparation du QR code…</p>
              )}
              <form onSubmit={submit}>
                <label>
                  Premier code à 6 chiffres
                  <input
                    className="totp-code-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                  />
                </label>
                {error ? <p className="teacher-login-error" role="alert">{error}</p> : null}
                <button type="submit" disabled={pending || !qrDataUrl}>
                  {pending ? "Validation…" : "Valider"}
                </button>
              </form>
            </>
          )}
          <button type="button" className="login-secondary-action" onClick={onCancel}>
            Se déconnecter
          </button>
        </section>

        <p className="prototype-label">CAMPUS AGENDA {appVersion}</p>
      </main>
    </div>
  );
}
