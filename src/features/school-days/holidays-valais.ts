import type { PublicHoliday } from "./types.ts";

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12);
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function easterOffset(year: number, days: number): string {
  const date = easterSunday(year);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/**
 * Jours fériés du canton du Valais pour une année civile.
 * Les fêtes mobiles se déduisent de Pâques ; les fixes sont posées directement.
 * Liste proposée à l'administrateur, qui reste libre de corriger chaque jour.
 */
export function valaisHolidaysForCalendarYear(year: number): PublicHoliday[] {
  return [
    { date: `${year}-01-01`, label: "Nouvel An" },
    { date: `${year}-03-19`, label: "Saint-Joseph" },
    { date: easterOffset(year, 1), label: "Lundi de Pâques" },
    { date: easterOffset(year, 39), label: "Ascension" },
    { date: easterOffset(year, 50), label: "Lundi de Pentecôte" },
    { date: easterOffset(year, 60), label: "Fête-Dieu" },
    { date: `${year}-08-01`, label: "Fête nationale" },
    { date: `${year}-08-15`, label: "Assomption" },
    { date: `${year}-11-01`, label: "Toussaint" },
    { date: `${year}-12-08`, label: "Immaculée Conception" },
    { date: `${year}-12-25`, label: "Noël" },
  ];
}

/** Fêtes couvrant une année scolaire « 2026-2027 » : deux années civiles. */
export function valaisHolidaysForSchoolYear(label: string): PublicHoliday[] {
  const startYear = Number(label.split("-")[0]);
  if (!Number.isFinite(startYear)) return [];
  return [
    ...valaisHolidaysForCalendarYear(startYear),
    ...valaisHolidaysForCalendarYear(startYear + 1),
  ].sort((left, right) => left.date.localeCompare(right.date));
}
