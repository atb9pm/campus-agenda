import { isE164PhoneNumber, maskPhoneNumber } from "./phone.ts";
import type { SecuritySmsProvider } from "./provider.ts";
import {
  TWILIO_ACCOUNT_SID_PATTERN,
  TWILIO_ALPHANUMERIC_SENDER_PATTERN,
  TWILIO_MESSAGING_SERVICE_SID_PATTERN,
  TwilioSecuritySmsProvider,
  type TwilioSmsConfig,
} from "./twilio-provider.ts";

/** Variables serveur uniquement : jamais de préfixe `NEXT_PUBLIC_`, jamais en base ni dans GitHub. */
export const SECURITY_SMS_ENV = {
  enabled: "CAMPUS_SECURITY_SMS_ENABLED",
  to: "CAMPUS_SECURITY_SMS_TO",
  provider: "CAMPUS_SMS_PROVIDER",
  twilioAccountSid: "CAMPUS_SMS_TWILIO_ACCOUNT_SID",
  twilioAuthToken: "CAMPUS_SMS_TWILIO_AUTH_TOKEN",
  twilioFrom: "CAMPUS_SMS_TWILIO_FROM",
} as const;

export const SECURITY_SMS_PROVIDERS = ["twilio"] as const;
export type SecuritySmsProviderId = (typeof SECURITY_SMS_PROVIDERS)[number];

export type SecuritySmsConfig =
  | { status: "disabled"; reason: "not-enabled" | "non-production" }
  | { status: "misconfigured"; invalid: string[] }
  | {
      status: "enabled";
      to: string;
      provider: { id: "twilio"; twilio: TwilioSmsConfig };
    };

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string {
  return env[name]?.trim() ?? "";
}

/**
 * Production uniquement (`NODE_ENV=production`, hors CI) et seulement si
 * `CAMPUS_SECURITY_SMS_ENABLED=true`. Local, tests, CI et aperçu restent
 * désactivés par défaut. Une configuration incomplète ne lève jamais :
 * elle est signalée par le nom des variables, jamais par leur valeur.
 */
export function readSecuritySmsConfig(env: Env = process.env): SecuritySmsConfig {
  if (read(env, SECURITY_SMS_ENV.enabled).toLowerCase() !== "true") return { status: "disabled", reason: "not-enabled" };
  if (env.NODE_ENV !== "production" || env.CI === "true" || env.CI === "1") {
    return { status: "disabled", reason: "non-production" };
  }

  const invalid: string[] = [];
  const to = read(env, SECURITY_SMS_ENV.to);
  if (!isE164PhoneNumber(to)) invalid.push(SECURITY_SMS_ENV.to);
  const providerId = read(env, SECURITY_SMS_ENV.provider).toLowerCase() || "twilio";
  if (!(SECURITY_SMS_PROVIDERS as readonly string[]).includes(providerId)) {
    invalid.push(SECURITY_SMS_ENV.provider);
    return { status: "misconfigured", invalid };
  }

  const accountSid = read(env, SECURITY_SMS_ENV.twilioAccountSid);
  const authToken = read(env, SECURITY_SMS_ENV.twilioAuthToken);
  const from = read(env, SECURITY_SMS_ENV.twilioFrom);
  if (!TWILIO_ACCOUNT_SID_PATTERN.test(accountSid)) invalid.push(SECURITY_SMS_ENV.twilioAccountSid);
  if (authToken.length < 16 || /\s/.test(authToken)) invalid.push(SECURITY_SMS_ENV.twilioAuthToken);
  if (
    !isE164PhoneNumber(from)
    && !TWILIO_MESSAGING_SERVICE_SID_PATTERN.test(from)
    && !TWILIO_ALPHANUMERIC_SENDER_PATTERN.test(from)
  ) {
    invalid.push(SECURITY_SMS_ENV.twilioFrom);
  }
  if (invalid.length > 0) return { status: "misconfigured", invalid };
  return { status: "enabled", to, provider: { id: "twilio", twilio: { accountSid, authToken, from } } };
}

export function createSecuritySmsProvider(config: SecuritySmsConfig): SecuritySmsProvider | null {
  if (config.status !== "enabled") return null;
  return new TwilioSecuritySmsProvider(config.provider.twilio);
}

/** Vue publique (administrateur) : jamais le numéro complet ni un identifiant fournisseur. */
export interface SecuritySmsConfigView {
  state: "active" | "not-configured" | "misconfigured" | "disabled-environment";
  destination: string | null;
  providerLabel: string | null;
  invalidVariables: string[];
}

export function securitySmsConfigView(config: SecuritySmsConfig): SecuritySmsConfigView {
  if (config.status === "enabled") {
    return { state: "active", destination: maskPhoneNumber(config.to), providerLabel: "Twilio", invalidVariables: [] };
  }
  if (config.status === "misconfigured") {
    return { state: "misconfigured", destination: null, providerLabel: null, invalidVariables: [...config.invalid] };
  }
  return {
    state: config.reason === "non-production" ? "disabled-environment" : "not-configured",
    destination: null,
    providerLabel: null,
    invalidVariables: [],
  };
}
