import type { SecurityNotificationFailureCategory } from "./types.ts";

export interface SecuritySmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
}

export interface SecurityEmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

export type SecurityEmailSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; failure: SecurityNotificationFailureCategory };

/**
 * Canal e-mail isolé : seul le transport SMTP parle au serveur de messagerie.
 * Un autre fournisseur pourrait implémenter la même interface plus tard.
 */
export interface SecurityEmailTransport {
  sendSecurityAlert(
    message: SecurityEmailMessage,
    options: { timeoutMs: number },
  ): Promise<SecurityEmailSendResult>;
}

export function classifySmtpError(error: unknown): SecurityNotificationFailureCategory {
  const name = error instanceof Error ? error.name : "";
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
  const responseCode =
    error && typeof error === "object" && "responseCode" in error
      ? Number((error as { responseCode?: unknown }).responseCode)
      : NaN;
  if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT" || code === "ESOCKET") return "timeout";
  if (code === "ECONNECTION" || code === "ECONNRESET" || code === "ENOTFOUND" || name === "TypeError") return "network";
  if (code === "EAUTH" || responseCode === 535) return "auth";
  if (responseCode >= 400 && responseCode < 500) return "rejected";
  if (code === "EENVELOPE") return "rejected";
  return "unexpected";
}
