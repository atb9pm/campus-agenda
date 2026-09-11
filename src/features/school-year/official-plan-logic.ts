import type { SchoolDayException } from "../school-days/types.ts";
import type {
  OfficialCalendarEvent,
  OfficialCalendarEventKind,
  OfficialPlanWarning,
  OfficialSchoolPlanPreview,
} from "./official-plan-types.ts";

const DATE_RE = /\b(\d{2})\.(\d{2})\.(\d{4})\b/g;
const WEEKDAY_RE = /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i;
const TIME_HINT_RE = /\b(matin|soir)\b/gi;

const SCHOOL_YEAR_MONTHS = [
  { name: "Août", month: 8, yearOffset: 0 },
  { name: "Septembre", month: 9, yearOffset: 0 },
  { name: "Octobre", month: 10, yearOffset: 0 },
  { name: "Novembre", month: 11, yearOffset: 0 },
  { name: "Décembre", month: 12, yearOffset: 0 },
  { name: "Janvier", month: 1, yearOffset: 1 },
  { name: "Février", month: 2, yearOffset: 1 },
  { name: "Mars", month: 3, yearOffset: 1 },
  { name: "Avril", month: 4, yearOffset: 1 },
  { name: "Mai", month: 5, yearOffset: 1 },
  { name: "Juin", month: 6, yearOffset: 1 },
] as const;

const EVENT_KEYWORD_RE =
  /VACANCES|TOUSSAINT|IMMACULEE|CONCEPTION|SAINT-JOSEPH|SAINT JOSEPH|ASCENSION|PENTECOTE|FETE-DIEU|FETE DIEU|CONGE|INTERRUPTION|FERIE/;

export const MISSING_START_REASON = "Date de début des cours introuvable dans le document.";
export const MISSING_END_REASON = "Date de fin des cours introuvable dans le document.";
export const MISSING_YEAR_REASON = "Année scolaire introuvable dans le document.";
export const INCOHERENT_BOUNDS_REASON = "Les dates de début et de fin sont incohérentes.";

export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’'`]/g, "'")
    .replace(/[–—]/g, "-")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSchoolYearLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = normalizeForMatch(raw).replace(/\s+/g, "").match(/(\d{4})-(\d{4})/);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (!Number.isFinite(startYear) || endYear !== startYear + 1) return null;
  return `${startYear}-${endYear}`;
}

export function formatSchoolYearLabelFr(label: string): string {
  const normalized = normalizeSchoolYearLabel(label) ?? label;
  return normalized.replace("-", "–");
}

export function schoolYearAlreadyExistsMessage(label: string): string {
  return `L’année scolaire ${formatSchoolYearLabelFr(label)} existe déjà.`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function swissDateToIso(day: string, month: string, year: string): string | null {
  const iso = `${year}-${month}-${day}`;
  return isIsoDate(iso) ? iso : null;
}

export function extractSwissDates(text: string): { iso: string; raw: string }[] {
  const dates: { iso: string; raw: string }[] = [];
  const matcher = new RegExp(DATE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const iso = swissDateToIso(match[1], match[2], match[3]);
    if (iso) {
      dates.push({ iso, raw: match[0] });
    }
  }
  return dates;
}

export function eachIsoDateInclusive(from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return [];
  const dates: string[] = [];
  const cursor = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function looksLikeOfficialPlanText(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return (
    normalized.includes("PLAN DE SCOLARIT") ||
    normalized.includes("DEBUT DES COURS") ||
    normalized.includes("FIN DES COURS")
  );
}

function isMetadataLine(line: string): boolean {
  const normalized = normalizeForMatch(line);
  return (
    /PLAN DE SCOLARIT/.test(normalized) ||
    /DEBUT DES COURS/.test(normalized) ||
    /FIN DES COURS/.test(normalized) ||
    /^TOTAL\b/.test(normalized) ||
    /SERVICE DE LA FORMATION/.test(normalized) ||
    /DEPARTEMENT/.test(normalized) ||
    /DIENSTSTELLE/.test(normalized) ||
    /DIENSTELLE/.test(normalized)
  );
}

function titleCandidate(line: string): string {
  return line
    .replace(new RegExp(DATE_RE.source, "g"), " ")
    .replace(WEEKDAY_RE, " ")
    .replace(TIME_HINT_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeOfficialEventTitle(line: string): boolean {
  const title = titleCandidate(line);
  if (!title || isMetadataLine(title)) return false;
  const normalized = normalizeForMatch(title);
  if (EVENT_KEYWORD_RE.test(normalized)) return true;

  const letters = title.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length < 4 || letters.length > 48) return false;
  return title === title.toLocaleUpperCase("fr-CH");
}

export function classifyOfficialEvent(label: string, startsOn: string, endsOn: string): OfficialCalendarEventKind {
  const normalized = normalizeForMatch(label);
  if (normalized.includes("VACANCES")) return "VACATION";
  const singleDay = startsOn === endsOn;
  if (
    /TOUSSAINT|IMMACULEE|CONCEPTION|SAINT-JOSEPH|SAINT JOSEPH|PENTECOTE|FETE-DIEU|FETE DIEU/.test(
      normalized,
    )
  ) {
    return singleDay ? "PUBLIC_HOLIDAY" : "SCHOOL_CLOSED";
  }
  if (normalized.includes("ASCENSION")) {
    return singleDay ? "PUBLIC_HOLIDAY" : "SCHOOL_CLOSED";
  }
  return singleDay ? "OTHER" : "SCHOOL_CLOSED";
}

export function extractOfficialYearLabel(text: string): string | null {
  const normalized = text.replace(/[–—]/g, "-");
  const titled = normalized.match(/plan\s+de\s+scolarit[eé]\s+(\d{4})\s*-\s*(\d{4})/i);
  if (titled) return normalizeSchoolYearLabel(`${titled[1]}-${titled[2]}`);
  const loose = normalized.match(/\b(\d{4})\s*-\s*(\d{4})\b/);
  if (loose && looksLikeOfficialPlanText(text)) {
    return normalizeSchoolYearLabel(`${loose[1]}-${loose[2]}`);
  }
  return null;
}

function findSectionDate(lines: string[], heading: RegExp): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    if (!heading.test(normalizeForMatch(lines[index] ?? ""))) continue;
    for (let cursor = index; cursor < Math.min(lines.length, index + 4); cursor += 1) {
      const dates = extractSwissDates(lines[cursor] ?? "");
      if (dates[0]) return dates[0].iso;
    }
  }
  return null;
}

function extractControlTotal(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseOfficialPlanFromLines(
  lines: string[],
  pageCount = 1,
): import("./official-plan-types.ts").OfficialPlanParseResult {
  const compactLines = lines.map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const fullText = compactLines.join("\n");
  const looksLikeOfficialPlan = looksLikeOfficialPlanText(fullText);
  const warnings: OfficialPlanWarning[] = [];
  const errors: string[] = [];

  const label = extractOfficialYearLabel(fullText);
  const startsOn = findSectionDate(compactLines, /DEBUT DES COURS/);
  const endsOn = findSectionDate(compactLines, /FIN DES COURS/);

  if (!label) errors.push(MISSING_YEAR_REASON);
  if (!startsOn) errors.push(MISSING_START_REASON);
  if (!endsOn) errors.push(MISSING_END_REASON);
  if (startsOn && endsOn && startsOn > endsOn) errors.push(INCOHERENT_BOUNDS_REASON);

  if (label && startsOn && startsOn.slice(0, 4) !== label.slice(0, 4)) {
    errors.push(`Les dates ne correspondent pas à l’année scolaire ${formatSchoolYearLabelFr(label)}.`);
  }
  if (label && endsOn && endsOn.slice(0, 4) !== label.slice(5)) {
    errors.push(`Les dates ne correspondent pas à l’année scolaire ${formatSchoolYearLabelFr(label)}.`);
  }

  const events: OfficialCalendarEvent[] = [];
  for (let index = 0; index < compactLines.length; index += 1) {
    const line = compactLines[index] ?? "";
    if (!looksLikeOfficialEventTitle(line)) continue;

    const labelText = titleCandidate(line);
    const collected = extractSwissDates(line);
    let cursor = index + 1;
    while (cursor < compactLines.length && collected.length < 2) {
      const next = compactLines[cursor] ?? "";
      if (looksLikeOfficialEventTitle(next) || isMetadataLine(next)) break;
      const nextDates = extractSwissDates(next);
      if (nextDates.length === 0 && titleCandidate(next) && !WEEKDAY_RE.test(next) && !TIME_HINT_RE.test(next)) {
        break;
      }
      collected.push(...nextDates);
      cursor += 1;
    }

    const sourceText = [line, ...compactLines.slice(index + 1, cursor)].join(" ").trim();
    if (collected.length === 0) {
      warnings.push({
        sourceText,
        message: `« ${labelText} » n’a pas pu être interprété automatiquement.`,
      });
      continue;
    }
    if (collected.length > 2) {
      warnings.push({
        sourceText,
        message: `« ${labelText} » n’a pas pu être interprété automatiquement.`,
      });
      continue;
    }

    const eventStart = collected[0]!.iso;
    const eventEnd = collected[1]?.iso ?? collected[0]!.iso;
    if (eventStart > eventEnd) {
      warnings.push({
        sourceText,
        message: `« ${labelText} » n’a pas pu être interprété automatiquement.`,
      });
      continue;
    }

    events.push({
      label: labelText,
      startsOn: eventStart,
      endsOn: eventEnd,
      kind: classifyOfficialEvent(labelText, eventStart, eventEnd),
      sourceText,
    });
  }

  if (warnings.length > 0) {
    warnings.unshift({
      sourceText: "",
      message: `${warnings.length} événement${warnings.length > 1 ? "s" : ""} n’${warnings.length > 1 ? "ont" : "a"} pas pu être interprété${warnings.length > 1 ? "s" : ""} automatiquement.`,
    });
  }

  const previewBase = {
    sourceKind: "official-plan" as const,
    label: label ?? "",
    startsOn: startsOn ?? "",
    endsOn: endsOn ?? "",
    events,
    warnings,
    totalCourseDays: extractControlTotal(fullText, /total(?:\s+des)?\s+jours\s+de\s+cours\s*:?\s*(\d+)/i),
    totalCourseWeeks: extractControlTotal(fullText, /total(?:\s+des)?\s+semaines\s+de\s+cours\s*:?\s*(\d+)/i),
    pageCount,
  };

  if (errors.length > 0 || !looksLikeOfficialPlan || !label || !startsOn || !endsOn) {
    return {
      ok: false,
      looksLikeOfficialPlan,
      errors: looksLikeOfficialPlan ? errors : errors.length > 0 ? errors : ["Document officiel de plan de scolarité non reconnu."],
      warnings,
      preview: previewBase,
    };
  }

  return {
    ok: true,
    looksLikeOfficialPlan: true,
    preview: { ...previewBase, label, startsOn, endsOn },
  };
}

export function groupOfficialEventsByMonth(
  events: OfficialCalendarEvent[],
  startYear: number,
): { monthKey: string; title: string; events: OfficialCalendarEvent[] }[] {
  const groups = SCHOOL_YEAR_MONTHS.map((month) => {
    const year = startYear + month.yearOffset;
    const monthKey = `${year}-${String(month.month).padStart(2, "0")}`;
    return {
      monthKey,
      title: `${month.name} ${year}`,
      events: events.filter((event) => event.startsOn.slice(0, 7) === monthKey),
    };
  });
  return groups.filter((group) => group.events.length > 0);
}

export function officialEventsFromExceptions(exceptions: SchoolDayException[]): OfficialCalendarEvent[] {
  const sorted = [...exceptions].sort((left, right) => left.date.localeCompare(right.date));
  const events: OfficialCalendarEvent[] = [];
  for (const exception of sorted) {
    const label = exception.label?.trim() || "Interruption";
    const previous = events[events.length - 1];
    const previousDay = previous
      ? eachIsoDateInclusive(previous.endsOn, exception.date).length === 2
      : false;
    if (previous && previous.label === label && previousDay) {
      previous.endsOn = exception.date;
      previous.kind = classifyOfficialEvent(label, previous.startsOn, previous.endsOn);
      continue;
    }
    events.push({
      label,
      startsOn: exception.date,
      endsOn: exception.date,
      kind: classifyOfficialEvent(label, exception.date, exception.date),
      sourceText: label,
    });
  }
  return events;
}

export function expandOfficialEventsToExceptions(events: OfficialCalendarEvent[]): SchoolDayException[] {
  const byDate = new Map<string, SchoolDayException>();
  for (const event of events) {
    for (const date of eachIsoDateInclusive(event.startsOn, event.endsOn)) {
      const existing = byDate.get(date);
      if (existing && existing.label && existing.label !== event.label) {
        byDate.set(date, {
          date,
          state: "holiday",
          label: `${existing.label} / ${event.label}`,
        });
        continue;
      }
      byDate.set(date, { date, state: "holiday", label: event.label });
    }
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function validateOfficialPlanPreview(preview: OfficialSchoolPlanPreview): string[] {
  const errors: string[] = [];
  if (!normalizeSchoolYearLabel(preview.label)) errors.push(MISSING_YEAR_REASON);
  if (!isIsoDate(preview.startsOn)) errors.push(MISSING_START_REASON);
  if (!isIsoDate(preview.endsOn)) errors.push(MISSING_END_REASON);
  if (isIsoDate(preview.startsOn) && isIsoDate(preview.endsOn) && preview.startsOn > preview.endsOn) {
    errors.push(INCOHERENT_BOUNDS_REASON);
  }
  return errors;
}

export function formatOfficialDateFr(isoDate: string): string {
  if (!isIsoDate(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

export { SCHOOL_YEAR_MONTHS };
