import { SECURITY_EVENT_CATALOG, isSecurityEventType } from "../security-events/catalog.ts";
import { formatSourceFingerprint } from "../security-events/fingerprint.ts";
import { securityEventLabel } from "../security-events/present.ts";
import { SECURITY_SEVERITY_LABELS } from "../security-events/ui-text.ts";
import type { SecurityEvent } from "../security-events/types.ts";

export const SECURITY_EMAIL_TIME_ZONE = "Europe/Zurich";

export const SECURITY_EMAIL_SUBJECT_WARNING = "🟠 Campus Agenda – Activité de sécurité à surveiller";
export const SECURITY_EMAIL_SUBJECT_CRITICAL = "🔴 Campus Agenda – Alerte sécurité critique";
export const SECURITY_EMAIL_SUBJECT_TEST = "Campus Agenda – Test des alertes de sécurité";

export const SECURITY_EMAIL_INTRO_WARNING =
  "Campus Agenda a détecté une activité de sécurité nécessitant votre attention.";
export const SECURITY_EMAIL_INTRO_CRITICAL =
  "Campus Agenda a détecté une activité de sécurité critique nécessitant une vérification.";
export const SECURITY_EMAIL_TEST_BODY = "La configuration des alertes de sécurité fonctionne correctement.";
export const SECURITY_EMAIL_DISCLAIMER =
  "Cette alerte ne signifie pas nécessairement qu'une intrusion ou une fuite de données a eu lieu.";
export const SECURITY_EMAIL_FOLLOW_UP =
  "Consultez Administration → Sécurité → Activité de sécurité pour analyser cet événement.";
export const SECURITY_EMAIL_CRITICAL_FOLLOW_UP =
  "Une vérification rapide du journal de sécurité est recommandée.";

export const SECURITY_EMAIL_FORBIDDEN_CLAIMS = [
  /une intrusion a eu lieu/i,
  /des données ont été volées/i,
  /intrusion réussie/i,
  /aucune fuite/i,
] as const;

export interface SecurityEmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface SecurityEmailContext {
  actorLabel: string;
}

function formatZurich(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = new Intl.DateTimeFormat("fr-CH", {
    timeZone: SECURITY_EMAIL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("fr-CH", {
    timeZone: SECURITY_EMAIL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${day} – ${time}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function securityEmailActorLabel(
  event: SecurityEvent,
  teacherInitials: string | null | undefined,
): string {
  if (event.actorType === "TEACHER") return teacherInitials?.trim() || "Non identifié";
  if (event.actorType === "STUDENT") return "Apprenti";
  if (event.actorType === "SYSTEM") return "Système";
  return "Anonyme";
}

export function securityEmailEventLabel(event: SecurityEvent): string {
  if (isSecurityEventType(event.eventType)) {
    return securityEventLabel(event) || SECURITY_EVENT_CATALOG[event.eventType].label;
  }
  return "Événement de sécurité";
}

function linesFor(event: SecurityEvent, actorLabel: string): string[] {
  const lines = [
    event.severity === "CRITICAL" ? SECURITY_EMAIL_INTRO_CRITICAL : SECURITY_EMAIL_INTRO_WARNING,
    "",
    `Niveau : ${SECURITY_SEVERITY_LABELS[event.severity]}`,
    `Événement : ${securityEmailEventLabel(event)}`,
    `Date : ${formatZurich(event.occurredAt)}`,
    `Compte/acteur : ${actorLabel}`,
    `Source : ${formatSourceFingerprint(event.sourceFingerprint) ?? "Non identifiée"}`,
  ];
  if (event.route) {
    lines.push(`Route : ${event.httpMethod ? `${event.httpMethod} ${event.route}` : event.route}`);
  }
  if (event.httpStatus !== null) lines.push(`Statut HTTP : ${event.httpStatus}`);
  if (event.occurrenceCount > 1) lines.push(`Occurrences : ${event.occurrenceCount}`);
  if (event.requestId) lines.push(`Référence : ${event.requestId}`);
  lines.push("", SECURITY_EMAIL_FOLLOW_UP);
  if (event.severity === "CRITICAL") lines.push(SECURITY_EMAIL_CRITICAL_FOLLOW_UP);
  lines.push("", SECURITY_EMAIL_DISCLAIMER);
  return lines;
}

function toHtml(lines: string[]): string {
  const paragraphs = lines
    .join("\n")
    .split("\n\n")
    .map((block) => `<p>${escapeHtml(block).replaceAll("\n", "<br>")}</p>`)
    .join("");
  return `<!DOCTYPE html><html><body>${paragraphs}</body></html>`;
}

export function formatSecurityAlertEmail(event: SecurityEvent, context: SecurityEmailContext): SecurityEmailContent {
  const lines = linesFor(event, context.actorLabel);
  return {
    subject: event.severity === "CRITICAL" ? SECURITY_EMAIL_SUBJECT_CRITICAL : SECURITY_EMAIL_SUBJECT_WARNING,
    text: lines.join("\n"),
    html: toHtml(lines),
  };
}

export function formatSecurityTestEmail(): SecurityEmailContent {
  return {
    subject: SECURITY_EMAIL_SUBJECT_TEST,
    text: SECURITY_EMAIL_TEST_BODY,
    html: `<!DOCTYPE html><html><body><p>${escapeHtml(SECURITY_EMAIL_TEST_BODY)}</p></body></html>`,
  };
}
