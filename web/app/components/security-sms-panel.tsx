"use client";

import { useCallback, useEffect, useState } from "react";
import type { SecuritySmsConfigView } from "@campus/features/security-notifications/config.ts";
import type { SecuritySmsActivity } from "@campus/features/security-notifications/notifier.ts";
import {
  SECURITY_SMS_DESCRIPTION,
  SECURITY_SMS_NO_RECENT_ALERT,
  SECURITY_SMS_PRIVACY,
  SECURITY_SMS_SCOPE,
  SECURITY_SMS_SERVER_CONFIG,
  SECURITY_SMS_STATE_ACTIVE,
  SECURITY_SMS_STATE_ACTIVE_LABEL,
  SECURITY_SMS_STATE_ENVIRONMENT,
  SECURITY_SMS_STATE_ENVIRONMENT_LABEL,
  SECURITY_SMS_STATE_INACTIVE,
  SECURITY_SMS_STATE_INACTIVE_LABEL,
  SECURITY_SMS_STATE_MISCONFIGURED,
  SECURITY_SMS_STATE_MISCONFIGURED_LABEL,
  SECURITY_SMS_TEST_BUTTON,
  SECURITY_SMS_TEST_CONFIRM_BODY,
  SECURITY_SMS_TEST_CONFIRM_TITLE,
  SECURITY_SMS_TITLE,
} from "@campus/features/security-notifications/ui-text.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";

interface SmsStatusPayload extends Partial<SecuritySmsConfigView> {
  ok: boolean;
  reason?: string;
  policy?: {
    criticalAlerts: boolean;
    cooldownMinutes: number;
    maxPerHour: number;
    maxPerDay: number;
    testCooldownMinutes: number;
  };
  activity?: SecuritySmsActivity;
}

const STATE_TEXT: Record<SecuritySmsConfigView["state"], { label: string; detail: string }> = {
  active: { label: SECURITY_SMS_STATE_ACTIVE_LABEL, detail: SECURITY_SMS_STATE_ACTIVE },
  "not-configured": { label: SECURITY_SMS_STATE_INACTIVE_LABEL, detail: SECURITY_SMS_STATE_INACTIVE },
  misconfigured: { label: SECURITY_SMS_STATE_MISCONFIGURED_LABEL, detail: SECURITY_SMS_STATE_MISCONFIGURED },
  "disabled-environment": { label: SECURITY_SMS_STATE_ENVIRONMENT_LABEL, detail: SECURITY_SMS_STATE_ENVIRONMENT },
};

function formatSentAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = date.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  return `${day} à ${time}`;
}

export function SecuritySmsPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [status, setStatus] = useState<SmsStatusPayload | null>(null);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testBlocked, setTestBlocked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/security/sms", { credentials: "include", cache: "no-store" });
      const payload = await response.json() as SmsStatusPayload;
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
      const response = await fetch("/api/admin/security/sms/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const payload = await response.json() as { ok: boolean; reason?: string };
      const message = payload.reason ?? (payload.ok ? "SMS de test envoyé." : "Envoi impossible.");
      setTestMessage(message);
      if (payload.ok) onNotice(message);
      await refresh();
    } catch {
      setTestMessage("Envoi impossible.");
    } finally {
      setPending(false);
    }
  }

  const state = status?.state ?? "not-configured";
  const stateText = STATE_TEXT[state];
  const policy = status?.policy;
  const activity = status?.activity;

  return (
    <div className="admin-panel-block security-sms">
      <header className="config-section-header">
        <div>
          <h3>{SECURITY_SMS_TITLE}</h3>
          <p>{SECURITY_SMS_DESCRIPTION}</p>
        </div>
      </header>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}

      {status ? (
        <>
          <div className={`security-sms-state is-${state}`} role="status">
            <span className="security-sms-dot" aria-hidden="true" />
            <div>
              <strong>{stateText.label}</strong>
              <span>{stateText.detail}</span>
            </div>
          </div>

          <dl className="security-sms-facts">
            {status.destination ? (
              <div>
                <dt>Destination</dt>
                <dd>{status.destination}</dd>
              </div>
            ) : null}
            <div>
              <dt>Alertes critiques</dt>
              <dd>{state === "active" ? "activées" : "inactives"}</dd>
            </div>
            {policy ? (
              <>
                <div>
                  <dt>Cooldown</dt>
                  <dd>{policy.cooldownMinutes} min</dd>
                </div>
                <div>
                  <dt>Limite</dt>
                  <dd>{policy.maxPerHour}/h – {policy.maxPerDay}/j</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Dernière alerte</dt>
              <dd>
                {activity?.lastAlertSentAt
                  ? `Dernière alerte SMS envoyée : ${formatSentAt(activity.lastAlertSentAt)}`
                  : SECURITY_SMS_NO_RECENT_ALERT}
              </dd>
            </div>
            {activity?.lastTestSentAt ? (
              <div>
                <dt>Dernier test</dt>
                <dd>{formatSentAt(activity.lastTestSentAt)}</dd>
              </div>
            ) : null}
            {activity && activity.last24h.suppressed + activity.last24h.failed > 0 ? (
              <div>
                <dt>Dernières 24 h</dt>
                <dd>
                  {activity.last24h.sent} envoyé(s) · {activity.last24h.failed} échec(s) ·{" "}
                  {activity.last24h.suppressed} retenu(s) par le cooldown ou la limite
                </dd>
              </div>
            ) : null}
          </dl>

          {state === "misconfigured" && status.invalidVariables?.length ? (
            <p className="security-sms-note">
              Variables à vérifier sur le serveur : {status.invalidVariables.join(", ")}.
            </p>
          ) : null}

          {state === "active" ? (
            <div className="security-sms-test">
              <button type="button" onClick={() => setConfirmOpen(true)} disabled={pending || testBlocked}>
                {pending ? "Envoi…" : SECURITY_SMS_TEST_BUTTON}
              </button>
              {testBlocked && policy ? (
                <span>Un seul test toutes les {policy.testCooldownMinutes} minutes.</span>
              ) : null}
              {testMessage ? <span role="status">{testMessage}</span> : null}
            </div>
          ) : null}

          <p className="security-sms-note">{SECURITY_SMS_PRIVACY}</p>
          <p className="security-sms-note">{SECURITY_SMS_SCOPE}</p>
          <p className="security-sms-note">{SECURITY_SMS_SERVER_CONFIG}</p>
        </>
      ) : error ? null : (
        <p className="admin-loading">Chargement…</p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={SECURITY_SMS_TEST_CONFIRM_TITLE}
        body={SECURITY_SMS_TEST_CONFIRM_BODY}
        confirmLabel="Envoyer"
        onConfirm={() => void sendTest()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
