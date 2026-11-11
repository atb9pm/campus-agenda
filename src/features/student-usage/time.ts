/** Calendrier de l'établissement. La date statistique ne suit ni UTC ni l'horloge de l'appareil. */
export const STUDENT_USAGE_TIME_ZONE = "Europe/Zurich";

const zurichDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: STUDENT_USAGE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` à Zurich pour l'instant donné. */
export function schoolCalendarDateIso(now: Date): string {
  const parts = zurichDateFormatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Arithmétique de dates civiles, sans heure d'été : `days` peut être négatif. */
export function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function isoDatesFrom(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  let cursor = startIso;
  while (cursor <= endIso) {
    dates.push(cursor);
    cursor = addIsoDays(cursor, 1);
  }
  return dates;
}
