"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ADMIN_SECURITY_ACK_CODES,
  ADMIN_SECURITY_APP_CONFIGURED,
  ADMIN_SECURITY_BACK,
  ADMIN_SECURITY_HELP_TEXT,
  ADMIN_SECURITY_HELP_TITLE,
  ADMIN_SECURITY_LOST_BUTTON,
  ADMIN_SECURITY_LOST_HINT,
  ADMIN_SECURITY_LOST_RECENT_HINT,
  ADMIN_SECURITY_LOST_TITLE,
  ADMIN_SECURITY_LOST_WARNING,
  ADMIN_SECURITY_RECONFIGURE_BUTTON,
  ADMIN_SECURITY_RECONFIGURE_HINT,
  ADMIN_SECURITY_RECONFIGURE_TITLE,
  ADMIN_SECURITY_REGEN_BUTTON,
  ADMIN_SECURITY_REGEN_HINT,
  ADMIN_SECURITY_REGEN_WARNING,
  ADMIN_SECURITY_REGEN_TITLE,
  ADMIN_SECURITY_STATE_ENABLED,
  ADMIN_SECURITY_TITLE,
} from "@campus/features/admin-mfa/security-screen.ts";

interface MfaStatusPayload {
  ok: boolean;
  status?: string;
  enabled?: boolean;
  recoveryRemaining?: number;
  recoveryRecentlyVerified?: boolean;
  reason?: string;
}

type SecurityMode = "idle" | "reconfigure" | "lost" | "regen";

export function AdminSecurityPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [status, setStatus] = useState<MfaStatusPayload | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<SecurityMode>("idle");
  const [password, setPassword] = useState("");
  const [proof, setProof] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [confirmCode, setConfirmCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/security/mfa", { credentials: "include" });
    const payload = await response.json() as MfaStatusPayload;
    if (!response.ok || !payload.ok) {
      setError(payload.reason ?? "Chargement impossible.");
      return;
    }
    setStatus(payload);
    setError("");
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  function resetDraft() {
    setPassword("");
    setProof("");
    setConfirmCode("");
    setQrDataUrl(null);
    setManualKey(null);
    setShowManual(false);
    setError("");
  }

  function backToMain() {
    resetDraft();
    setRecoveryCodes(null);
    setMode("idle");
  }

  async function startReconfigure(event: FormEvent, kind: "totp" | "recovery") {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/security/mfa/reconfigure", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "recovery"
            ? status?.recoveryRecentlyVerified
              ? { password }
              : { password, recoveryCode: proof.trim() }
            : { password, totp: proof.trim() },
        ),
      });
      const payload = await response.json() as {
        ok: boolean;
        reason?: string;
        qrDataUrl?: string;
        manualKey?: string;
      };
      if (!response.ok || !payload.ok) {
        setError(payload.reason ?? "Reconfiguration impossible.");
        return;
      }
      setQrDataUrl(payload.qrDataUrl ?? null);
      setManualKey(payload.manualKey ?? null);
      setPassword("");
      setProof("");
    } finally {
      setPending(false);
    }
  }

  async function confirmReconfigure(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/security/mfa/reconfigure/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: confirmCode.trim() }),
      });
      const payload = await response.json() as { ok: boolean; reason?: string; recoveryCodes?: string[] };
      if (!response.ok || !payload.ok) {
        setError(payload.reason ?? "Validation impossible.");
        return;
      }
      setRecoveryCodes(payload.recoveryCodes ?? []);
      setQrDataUrl(null);
      setManualKey(null);
      setConfirmCode("");
      onNotice("Double authentification reconfigurée.");
      await refresh();
    } finally {
      setPending(false);
    }
  }

  async function regenerate(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/security/mfa/recovery", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, totp: proof.trim() }),
      });
      const payload = await response.json() as { ok: boolean; reason?: string; recoveryCodes?: string[] };
      if (!response.ok || !payload.ok) {
        setError(payload.reason ?? "Régénération impossible.");
        return;
      }
      setRecoveryCodes(payload.recoveryCodes ?? []);
      resetDraft();
      setMode("idle");
      onNotice("Nouveaux codes de récupération générés.");
      await refresh();
    } finally {
      setPending(false);
    }
  }

  function acknowledgeCodes() {
    setRecoveryCodes(null);
    resetDraft();
    setMode("idle");
  }

  if (recoveryCodes) {
    return (
      <div className="admin-panel-block">
        <header className="config-section-header">
          <div>
            <h3>Sécurité</h3>
            <p>Conservez ces codes maintenant. Ils ne seront plus affichés.</p>
          </div>
        </header>
        <ol className="mfa-recovery-codes">
          {recoveryCodes.map((entry) => (
            <li key={entry}><code>{entry}</code></li>
          ))}
        </ol>
        <div className="mfa-recovery-actions">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(recoveryCodes.join("\n"));
            }}
          >
            Copier
          </button>
          <button type="button" onClick={() => window.print()}>Imprimer</button>
        </div>
        <button type="button" className="mfa-continue" onClick={acknowledgeCodes}>
          {ADMIN_SECURITY_ACK_CODES}
        </button>
      </div>
    );
  }

  if (qrDataUrl) {
    return (
      <div className="admin-panel-block">
        <header className="config-section-header">
          <div>
            <h3>Sécurité</h3>
            <p>Scannez le QR code avec la nouvelle application, puis saisissez le premier code.</p>
          </div>
        </header>
        <form className="admin-security-form" onSubmit={(event) => void confirmReconfigure(event)}>
          <div className="mfa-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="Nouveau QR code TOTP" width={220} height={220} />
            <button type="button" className="login-secondary-action" onClick={() => setShowManual((current) => !current)}>
              {showManual ? "Masquer la clé manuelle" : "Afficher la clé manuelle"}
            </button>
            {showManual && manualKey ? <p className="mfa-manual-key"><code>{manualKey}</code></p> : null}
          </div>
          <label>
            Premier code de la nouvelle application
            <input
              className="totp-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={confirmCode}
              onChange={(event) => setConfirmCode(event.target.value)}
              required
            />
          </label>
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <div className="admin-security-form-actions">
            <button type="submit" disabled={pending}>{pending ? "Validation…" : "Valider"}</button>
            <button type="button" onClick={backToMain}>{ADMIN_SECURITY_BACK}</button>
          </div>
        </form>
      </div>
    );
  }

  if (mode === "reconfigure") {
    return (
      <div className="admin-panel-block">
        <header className="config-section-header">
          <div>
            <h3>{ADMIN_SECURITY_RECONFIGURE_TITLE}</h3>
            <p>{ADMIN_SECURITY_RECONFIGURE_HINT}</p>
          </div>
        </header>
        <form className="admin-security-form" onSubmit={(event) => void startReconfigure(event, "totp")}>
          <label>
            Mot de passe administrateur
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label>
            Code TOTP actuel
            <input
              className="totp-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={proof}
              onChange={(event) => setProof(event.target.value)}
              required
            />
          </label>
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <div className="admin-security-form-actions">
            <button type="submit" disabled={pending}>{pending ? "Vérification…" : "Continuer"}</button>
            <button type="button" onClick={backToMain}>{ADMIN_SECURITY_BACK}</button>
          </div>
        </form>
      </div>
    );
  }

  if (mode === "lost") {
    return (
      <div className="admin-panel-block">
        <header className="config-section-header">
          <div>
            <h3>{ADMIN_SECURITY_LOST_TITLE}</h3>
            <p>{status?.recoveryRecentlyVerified ? ADMIN_SECURITY_LOST_RECENT_HINT : ADMIN_SECURITY_LOST_HINT}</p>
          </div>
        </header>
        <p className="admin-security-warning">{ADMIN_SECURITY_LOST_WARNING}</p>
        <form className="admin-security-form" onSubmit={(event) => void startReconfigure(event, "recovery")}>
          <label>
            Mot de passe administrateur
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {status?.recoveryRecentlyVerified ? null : (
            <label>
              Code de récupération
              <input
                autoComplete="off"
                spellCheck={false}
                value={proof}
                onChange={(event) => setProof(event.target.value)}
                required
              />
            </label>
          )}
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <div className="admin-security-form-actions">
            <button type="submit" disabled={pending}>{pending ? "Vérification…" : "Continuer"}</button>
            <button type="button" onClick={backToMain}>{ADMIN_SECURITY_BACK}</button>
          </div>
        </form>
      </div>
    );
  }

  if (mode === "regen") {
    return (
      <div className="admin-panel-block">
        <header className="config-section-header">
          <div>
            <h3>{ADMIN_SECURITY_REGEN_TITLE}</h3>
            <p>{ADMIN_SECURITY_REGEN_HINT}</p>
          </div>
        </header>
        <form className="admin-security-form" onSubmit={(event) => void regenerate(event)}>
          <p className="admin-security-warning">{ADMIN_SECURITY_REGEN_WARNING}</p>
          <label>
            Mot de passe administrateur
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label>
            Code TOTP actuel
            <input
              className="totp-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={proof}
              onChange={(event) => setProof(event.target.value)}
              required
            />
          </label>
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <div className="admin-security-form-actions">
            <button type="submit" disabled={pending}>{pending ? "Régénération…" : "Régénérer les codes"}</button>
            <button type="button" onClick={backToMain}>{ADMIN_SECURITY_BACK}</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-panel-block">
      <header className="config-section-header">
        <div>
          <h3>Sécurité</h3>
          <p>Double authentification obligatoire pour les administrateurs.</p>
        </div>
      </header>

      <section className="admin-security-card" aria-labelledby="admin-security-status-title">
        <h4 id="admin-security-status-title">{ADMIN_SECURITY_TITLE}</h4>
        <p>État : <strong>{status?.enabled ? ADMIN_SECURITY_STATE_ENABLED : "Non activée"}</strong></p>
        <p>Application d’authentification : {status?.enabled ? ADMIN_SECURITY_APP_CONFIGURED : "—"}</p>
        <p>
          Codes de récupération :{" "}
          {status?.enabled ? `${status.recoveryRemaining ?? 0} codes disponibles` : "—"}
        </p>
      </section>

      <section className="admin-security-action">
        <h4>{ADMIN_SECURITY_RECONFIGURE_TITLE}</h4>
        <p>{ADMIN_SECURITY_RECONFIGURE_HINT}</p>
        <button type="button" onClick={() => { resetDraft(); setMode("reconfigure"); }}>
          {ADMIN_SECURITY_RECONFIGURE_BUTTON}
        </button>
      </section>

      <section className="admin-security-action">
        <h4>{ADMIN_SECURITY_LOST_TITLE}</h4>
        <p>{ADMIN_SECURITY_LOST_HINT}</p>
        <button type="button" onClick={() => { resetDraft(); setMode("lost"); }}>
          {ADMIN_SECURITY_LOST_BUTTON}
        </button>
      </section>

      <section className="admin-security-action">
        <h4>{ADMIN_SECURITY_REGEN_TITLE}</h4>
        <p>{ADMIN_SECURITY_REGEN_HINT}</p>
        <button type="button" onClick={() => { resetDraft(); setMode("regen"); }}>
          {ADMIN_SECURITY_REGEN_BUTTON}
        </button>
      </section>

      <aside className="admin-security-help">
        <h4>{ADMIN_SECURITY_HELP_TITLE}</h4>
        <p>{ADMIN_SECURITY_HELP_TEXT}</p>
      </aside>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}
    </div>
  );
}
