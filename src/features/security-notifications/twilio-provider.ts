import {
  classifyProviderError,
  classifyProviderHttpStatus,
  type SecuritySmsMessage,
  type SecuritySmsProvider,
  type SecuritySmsSendResult,
} from "./provider.ts";

export const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
export const TWILIO_ACCOUNT_SID_PATTERN = /^AC[0-9a-fA-F]{32}$/;
export const TWILIO_MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-fA-F]{32}$/;
/** Identifiant d'expéditeur alphanumérique : 1 à 11 caractères, au moins une lettre. */
export const TWILIO_ALPHANUMERIC_SENDER_PATTERN = /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/;
const TWILIO_MESSAGE_SID_PATTERN = /^(SM|MM)[0-9a-fA-F]{32}$/;

export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  /** Numéro E.164, expéditeur alphanumérique ou Messaging Service SID (`MG…`). */
  from: string;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Twilio Messages API (`POST /Accounts/{AccountSid}/Messages.json`), via `fetch`
 * natif : aucune dépendance npm. Seul le SID du message est lu dans la réponse ;
 * le corps (qui reprend numéro et texte) n'est ni conservé ni journalisé.
 */
export class TwilioSecuritySmsProvider implements SecuritySmsProvider {
  readonly id = "twilio";
  readonly label = "Twilio";
  private readonly config: TwilioSmsConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: TwilioSmsConfig, fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async sendSecurityAlert(message: SecuritySmsMessage, options: { timeoutMs: number }): Promise<SecuritySmsSendResult> {
    const body = new URLSearchParams({ To: message.to, Body: message.text });
    if (TWILIO_MESSAGING_SERVICE_SID_PATTERN.test(this.config.from)) body.set("MessagingServiceSid", this.config.from);
    else body.set("From", this.config.from);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException("SMS provider timeout", "TimeoutError")),
      options.timeoutMs,
    );
    try {
      const response = await this.fetchImpl(
        `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${this.config.accountSid}:${this.config.authToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: body.toString(),
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, failure: classifyProviderHttpStatus(response.status) };
      }
      let providerMessageId: string | null = null;
      try {
        const payload = await response.json() as { sid?: unknown };
        if (typeof payload.sid === "string" && TWILIO_MESSAGE_SID_PATTERN.test(payload.sid)) {
          providerMessageId = payload.sid;
        }
      } catch {
        // Réponse illisible : l'envoi a été accepté, seul l'identifiant manque.
      }
      return { ok: true, providerMessageId };
    } catch (error) {
      return { ok: false, failure: classifyProviderError(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}
