import type { SecuritySmsFailureCategory } from "./types.ts";

/** Seules données transmises au fournisseur : destinataire et texte fixe. */
export interface SecuritySmsMessage {
  to: string;
  text: string;
}

export type SecuritySmsSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; failure: SecuritySmsFailureCategory };

/**
 * Abstraction fournisseur : la politique, le cooldown et les quotas n'en
 * dépendent pas. Une implémentation ne lève pas et ne journalise rien.
 */
export interface SecuritySmsProvider {
  readonly id: string;
  readonly label: string;
  sendSecurityAlert(message: SecuritySmsMessage, options: { timeoutMs: number }): Promise<SecuritySmsSendResult>;
}

export function classifyProviderHttpStatus(status: number): SecuritySmsFailureCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "provider-rate-limited";
  if (status >= 400 && status < 500) return "rejected";
  return "provider-error";
}

export function classifyProviderError(error: unknown): SecuritySmsFailureCategory {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (name === "TypeError") return "network";
  return "unexpected";
}
