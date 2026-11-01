import { maskEmailAddress } from "./email-address.ts";
import type { SecurityEmailTransport, SecuritySmtpSettings } from "./email-transport.ts";
import { NodemailerSecurityEmailTransport } from "./smtp-transport.ts";

/** Variables serveur uniquement : jamais exposées au navigateur, jamais en base ni dans GitHub. */
export const SECURITY_EMAIL_ENV = {
  enabled: "CAMPUS_SECURITY_EMAIL_ENABLED",
  to: "CAMPUS_SECURITY_EMAIL_TO",
  from: "CAMPUS_SECURITY_EMAIL_FROM",
  host: "CAMPUS_SMTP_HOST",
  port: "CAMPUS_SMTP_PORT",
  user: "CAMPUS_SMTP_USER",
  password: "CAMPUS_SMTP_PASSWORD",
} as const;

export const SECURITY_EMAIL_DEFAULT_HOST = "mail.infomaniak.com";
export const SECURITY_EMAIL_DEFAULT_PORT = 587;

export type SecurityEmailConfig =
  | { status: "disabled"; reason: "not-enabled" | "non-production" }
  | { status: "misconfigured"; invalid: string[] }
  | {
      status: "enabled";
      to: string;
      from: string;
      smtp: SecuritySmtpSettings;
    };

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string {
  return env[name]?.trim() ?? "";
}

/** Adresse e-mail minimale : un local, un @, un domaine avec un point. */
export function isSecurityEmailAddress(value: string): boolean {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/.test(value) && !/\s/.test(value) && value.length <= 254;
}

function parsePort(value: string): number | null {
  if (!value) return SECURITY_EMAIL_DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || (port !== 587 && port !== 465)) return null;
  return port;
}

/**
 * Production uniquement (`NODE_ENV=production`, hors CI) et seulement si
 * `CAMPUS_SECURITY_EMAIL_ENABLED=true`. Local, tests et CI restent désactivés
 * par défaut. Une configuration incomplète ne lève jamais.
 */
export function readSecurityEmailConfig(env: Env = process.env): SecurityEmailConfig {
  if (read(env, SECURITY_EMAIL_ENV.enabled).toLowerCase() !== "true") {
    return { status: "disabled", reason: "not-enabled" };
  }
  if (env.NODE_ENV !== "production" || env.CI === "true" || env.CI === "1") {
    return { status: "disabled", reason: "non-production" };
  }

  const invalid: string[] = [];
  const to = read(env, SECURITY_EMAIL_ENV.to);
  const from = read(env, SECURITY_EMAIL_ENV.from);
  const host = read(env, SECURITY_EMAIL_ENV.host) || SECURITY_EMAIL_DEFAULT_HOST;
  const port = parsePort(read(env, SECURITY_EMAIL_ENV.port));
  const user = read(env, SECURITY_EMAIL_ENV.user);
  const password = read(env, SECURITY_EMAIL_ENV.password);

  if (!isSecurityEmailAddress(to)) invalid.push(SECURITY_EMAIL_ENV.to);
  if (!isSecurityEmailAddress(from)) invalid.push(SECURITY_EMAIL_ENV.from);
  if (!host) invalid.push(SECURITY_EMAIL_ENV.host);
  if (port === null) invalid.push(SECURITY_EMAIL_ENV.port);
  if (!user || !isSecurityEmailAddress(user)) invalid.push(SECURITY_EMAIL_ENV.user);
  if (password.length < 8 || /\s/.test(password)) invalid.push(SECURITY_EMAIL_ENV.password);
  if (invalid.length > 0 || port === null) return { status: "misconfigured", invalid };
  return {
    status: "enabled",
    to,
    from,
    smtp: {
      host,
      port,
      user,
      password,
      secure: port === 465,
    },
  };
}

export function createSecurityEmailTransport(config: SecurityEmailConfig): SecurityEmailTransport | null {
  if (config.status !== "enabled") return null;
  return new NodemailerSecurityEmailTransport(config.smtp);
}

export interface SecurityEmailConfigView {
  state: "active" | "not-configured" | "misconfigured" | "disabled-environment";
  destination: string | null;
  invalidVariables: string[];
}

export function securityEmailConfigView(config: SecurityEmailConfig): SecurityEmailConfigView {
  if (config.status === "enabled") {
    return { state: "active", destination: maskEmailAddress(config.to), invalidVariables: [] };
  }
  if (config.status === "misconfigured") {
    return { state: "misconfigured", destination: null, invalidVariables: [...config.invalid] };
  }
  return {
    state: config.reason === "non-production" ? "disabled-environment" : "not-configured",
    destination: null,
    invalidVariables: [],
  };
}
