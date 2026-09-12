"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

interface MfaStatusPayload {
  ok: boolean;
  status?: string;
  enabled?: boolean;
  recoveryRemaining?: number;
  reason?: string;
}

export function AdminSecurityPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [status, setStatus] = useState<MfaStatusPayload | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [proof, setProof] = useState("");
  const [mode, setMode] = useState<"idle" | "reconfigure" | "regen">("idle");
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

  async function startReconfigure(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/security/mfa/reconfigure", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totp: proof.trim() }),
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
        body: JSON.stringify({ totp: proof.trim() }),
      });
      const payload = await response.json() as { ok: boolean; reason?: string; recoveryCodes?: string[] };
      if (!response.ok || !payload.ok) {
        setError(payload.reason ?? "Régénération impossible.");
        return;
      }
      setRecoveryCodes(payload.recoveryCodes ?? []);
      setProof("");
      onNotice("Nouveaux codes de récupération générés.");
      await refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="admin-panel-block">
      <header className="config-section-header">
        <div>
          <h3>Sécurité</h3>
          <p>Double authentification obligatoire pour les administrateurs.</p>
        </div>
      </header>

      <section className="admin-security-card">
        <h4>Double authentification</h4>
        <p>État : <strong>{status?.enabled ? "Activée" : "Non activée"}</strong></p>
        <p>Application d’authentification</p>
        {mode === "idle" ? (
          <button type="button" onClick={() => { setMode("reconfigure"); setRecoveryCodes(null); }}>
            Reconfigurer
          </button>
        ) : null}

        <p>
          Codes de récupération
          {status?.enabled ? ` : ${status.recoveryRemaining ?? 0} codes disponibles` : ""}
        </p>
        {mode === "idle" ? (
          <button type="button" onClick={() => { setMode("regen"); setRecoveryCodes(null); }}>
            Régénérer
          </button>
        ) : null}
      </section>

      {mode === "reconfigure" && !qrDataUrl && !recoveryCodes ? (
        <form className="admin-inline-form" onSubmit={(event) => void startReconfigure(event)}>
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
          <button type="submit" disabled={pending}>Continuer</button>
          <button type="button" onClick={() => setMode("idle")}>Annuler</button>
        </form>
      ) : null}

      {qrDataUrl ? (
        <form className="admin-inline-form" onSubmit={(event) => void confirmReconfigure(event)}>
          <div className="mfa-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="Nouveau QR code TOTP" width={220} height={220} />
            <button type="button" className="login-secondary-action" onClick={() => setShowManual((current) => !current)}>
              {showManual ? "Masquer la clé manuelle" : "Afficher la clé manuelle"}
            </button>
            {showManual && manualKey ? <p className="mfa-manual-key"><code>{manualKey}</code></p> : null}
          </div>
          <label>
            Premier code du nouvel appareil
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
          <button type="submit" disabled={pending}>Valider</button>
        </form>
      ) : null}

      {mode === "regen" && !recoveryCodes ? (
        <form className="admin-inline-form" onSubmit={(event) => void regenerate(event)}>
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
          <button type="submit" disabled={pending}>Régénérer les codes</button>
          <button type="button" onClick={() => setMode("idle")}>Annuler</button>
        </form>
      ) : null}

      {recoveryCodes ? (
        <div>
          <p>Conservez ces codes maintenant. Ils ne seront plus affichés.</p>
          <ol className="mfa-recovery-codes">
            {recoveryCodes.map((entry) => (
              <li key={entry}><code>{entry}</code></li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(recoveryCodes.join("\n"));
            }}
          >
            Copier
          </button>
          <button type="button" onClick={() => window.print()}>Imprimer</button>
          <button type="button" onClick={() => { setRecoveryCodes(null); setMode("idle"); }}>
            Fermer
          </button>
        </div>
      ) : null}

      {error ? <p className="admin-error">{error}</p> : null}
    </div>
  );
}
