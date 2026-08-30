import type { CourseMutationResult } from "./types.ts";

export const OPEN_ENDED_INSTANT = "9999-12-31T23:59:59.999Z";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

export type AssignmentDateKind = "start" | "end" | "instant";

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

function utcIso(year: number, month: number, day: number, hours: number, minutes: number, seconds: number, ms: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hours
    || date.getUTCMinutes() !== minutes
    || date.getUTCSeconds() !== seconds
    || date.getUTCMilliseconds() !== ms
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}Z`;
}

export function parseAssignmentDate(
  value: string | null | undefined,
  kind: AssignmentDateKind,
): CourseMutationResult<string | null> {
  if (value === undefined || value === null || value.trim() === "") {
    return kind === "end" ? { ok: true, value: null } : { ok: false, reason: "Date obligatoire.", status: 400 };
  }
  const raw = value.trim();
  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const iso = kind === "end"
      ? utcIso(year, month, day, 23, 59, 59, 999)
      : utcIso(year, month, day, 0, 0, 0, 0);
    if (!iso) return { ok: false, reason: "Date invalide.", status: 400 };
    return { ok: true, value: iso };
  }

  const isoMatch = ISO_UTC.exec(raw);
  if (!isoMatch) {
    return { ok: false, reason: "Date invalide.", status: 400 };
  }
  const year = Number(isoMatch[1]);
  const month = Number(isoMatch[2]);
  const day = Number(isoMatch[3]);
  const hours = Number(isoMatch[4]);
  const minutes = Number(isoMatch[5]);
  const seconds = Number(isoMatch[6]);
  const ms = Number((isoMatch[7] ?? "0").padEnd(3, "0"));
  const iso = utcIso(year, month, day, hours, minutes, seconds, ms);
  if (!iso) return { ok: false, reason: "Date invalide.", status: 400 };
  return { ok: true, value: iso };
}

export function validateAssignmentPeriod(
  validFrom: string,
  validTo: string | null,
): CourseMutationResult<true> {
  if (validTo !== null && validTo < validFrom) {
    return { ok: false, reason: "La fin de l'attribution doit être postérieure ou égale au début.", status: 400 };
  }
  return { ok: true, value: true };
}

export function requireOverrideReason(
  forceIncompatible: boolean | undefined,
  reason: string | null | undefined,
): CourseMutationResult<string | null> {
  if (!forceIncompatible) return { ok: true, value: null };
  const trimmed = reason?.trim() ?? "";
  if (!trimmed) {
    return { ok: false, reason: "Une raison de forçage est obligatoire.", status: 400 };
  }
  return { ok: true, value: trimmed };
}
