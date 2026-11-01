"use client";

import { useCallback, useEffect, useState } from "react";
import type { SecurityEmailConfigView } from "@campus/features/security-notifications/email-config.ts";
import type { SecurityEmailActivity } from "@campus/features/security-notifications/email-notifier.ts";
import {
  SECURITY_EMAIL_DESCRIPTION,
  SECURITY_EMAIL_DETAIL,
  SECURITY_EMAIL_PRIVACY,
  SECURITY_EMAIL_STATE_ACTIVE,
  SECURITY_EMAIL_STATE_ENVIRONMENT,
  SECURITY_EMAIL_STATE_INACTIVE,
  SECURITY_EMAIL_STATE_MISCONFIGURED,
  SECURITY_EMAIL_TEST_BUTTON,
  SECURITY_EMAIL_TEST_CONFIRM_BODY,
  SECURITY_EMAIL_TEST_CONFIRM_TITLE,
  SECURITY_EMAIL_TITLE,
} from "@campus/features/security-notifications/ui-text.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";

interface EmailStatusPayload extends Partial<SecurityEmailConfigView> {
  ok: boolean;
  reason?: string;
  policy?: {
    warningCooldownMinutes: number;
    criticalCooldownMinutes: number;
    testCooldownMinutes: number;
  };
  activity?: SecurityEmailActivity;
}

const STATE_DETAIL: Record<SecurityEmailConfigView["state"], string> = {
  active: SECURITY_EMAIL_STATE_ACTIVE,
  "not-configured": SECURITY_EMAIL_STATE_INACTIVE,
  misconfigured: SECURITY_EMAIL_STATE_MISCONFIGURED,
  "disabled-environment": SECURITY_EMAIL_STATE_ENVIRONMENT,
};

export function SecurityEmailStatus({ onNotice }: { onNotice?: (message: string) => void }) {
  const [status, setStatus] = useState<EmailStatusPayload | null>(null);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testBlocked, setTestBlocked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/security/email", { credentials: "include", cache: "no-store" });
      const payload = await response.json() as EmailStatusPayload;
      if (!response.ok || !payload.ok) {
        setError(payload.reason ?? "Chargement impossible.");
        return;
      }
      setStatus(payload);
      const availableAt = payload.activity?.testAvailableAt;
      setTestBlocked(Boolean(availableAt && Date.parse(availableAt) > Date.now()));
      setError("");
    } catch {
      setError("Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  async function sendTest() {
    setConfirmOpen(false);
    setPending(true);
    setTestMessage("");
    try {
      const response = await fetch("/api/admin/security/email/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const payload = await response.json() as { ok: boolean; reason?: string };
      const message = payload.reason ?? (payload.ok ? "E-mail de test envoyé." : "Envoi impossible.");
      setTestMessage(message);
      if (payload.ok) onNotice?.(message);
      await refresh();
    } catch {
      setTestMessage("Envoi impossible.");
    } finally {
      setPending(false);
    }
  }

  const state = status?.state ?? "not-configured";
  const policy = status?.policy;

  return (
    <section className="security-email-status" aria-labelledby="security-email-title">
      <h4 id="security-email-title">{SECURITY_EMAIL_TITLE}</h4>
      <p>{SECURITY_EMAIL_DESCRIPTION}</p>
      {error ? <p className="admin-error" role="alert">{error}</p> : null}
      {status ? (
        <>
          <p className={`security-email-state is-${state}`} role="status">
            <span className="security-email-dot" aria-hidden="true" />
            <strong>{state === "active" ? "Activées" : "Désactivées"}</strong>
            <span>{STATE_DETAIL[state]}</span>
          </p>
          {state === "active" && status.destination ? (
            <p className="security-email-meta">Destination : {status.destination}</p>
          ) : null}
          {policy ? (
            <p className="security-email-meta">
              {SECURITY_EMAIL_DETAIL} Cooldown : {policy.warningCooldownMinutes} min (À surveiller),{" "}
              {policy.criticalCooldownMinutes} min (Critique).
            </p>
          ) : null}
          {state === "misconfigured" && status.invalidVariables?.length ? (
            <p className="security-email-meta">
              Variables à vérifier sur le serveur : {status.invalidVariables.join(", ")}.
            </p>
          ) : null}
          {state === "active" ? (
            <div className="security-email-test">
              <button type="button" onClick={() => setConfirmOpen(true)} disabled={pending || testBlocked}>
                {pending ? "Envoi…" : SECURITY_EMAIL_TEST_BUTTON}
              </button>
              {testBlocked && policy ? (
                <span>Un seul test toutes les {policy.testCooldownMinutes} minutes.</span>
              ) : null}
              {testMessage ? <span role="status">{testMessage}</span> : null}
            </div>
          ) : null}
          <p className="security-email-meta">{SECURITY_EMAIL_PRIVACY}</p>
        </>
      ) : error ? null : (
        <p className="admin-loading">Chargement…</p>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={SECURITY_EMAIL_TEST_CONFIRM_TITLE}
        body={SECURITY_EMAIL_TEST_CONFIRM_BODY}
        confirmLabel="Envoyer"
        onConfirm={() => void sendTest()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
