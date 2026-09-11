import { isStructuredAgendaPublication } from "../agenda/publications.ts";
import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import {
  decodeRichDetail,
  emptyRichDoc,
  encodeRichDetail,
  fromPlainLines,
  fromPlainText,
  isEmptyRichDoc,
  isPlaceholderDetail,
  publicationTitleForDoc,
  sanitizeRichDoc,
  type CampusRichDoc,
} from "./rich-doc.ts";

export function isPublicationLine(item: Pick<PrototypeAgendaItem, "type">): boolean {
  return item.type === "HOMEWORK" || item.type === "INFORMATION";
}

/** Publication saisie dans le Carnet : pas un contrôle, pas une publication structurée. */
export function isCarnetOwnedPublication(item: PrototypeAgendaItem): boolean {
  return isPublicationLine(item) && !isStructuredAgendaPublication(item);
}

export function composeWeekPublicationDoc(items: readonly PrototypeAgendaItem[]): CampusRichDoc {
  const publications = items.filter(isPublicationLine);
  const rich = publications
    .map((item) => decodeRichDetail(item.detail))
    .find((doc) => doc && !isEmptyRichDoc(doc));
  if (rich) return sanitizeRichDoc(rich);

  const lines: string[] = [];
  for (const item of publications) {
    if (item.title.trim()) lines.push(item.title);
    if (!isPlaceholderDetail(item.detail) && !decodeRichDetail(item.detail)) {
      lines.push(item.detail.trim());
    }
  }
  return fromPlainLines(lines);
}

export function findCarnetPublicationItem(
  items: readonly PrototypeAgendaItem[],
): PrototypeAgendaItem | undefined {
  return items.find((item) => isCarnetOwnedPublication(item) && decodeRichDetail(item.detail));
}

export function listFoldableCarnetPublications(
  items: readonly PrototypeAgendaItem[],
): PrototypeAgendaItem[] {
  return items.filter(isCarnetOwnedPublication);
}

export function previousSchoolWeekNumber(
  weeks: readonly { number: number }[],
  current: number,
): number | null {
  const numbers = weeks.map((week) => week.number).filter((number) => number < current);
  if (!numbers.length) return null;
  return Math.max(...numbers);
}

export function buildPublicationPayload(doc: CampusRichDoc): { title: string; detail: string } | null {
  const clean = sanitizeRichDoc(doc);
  if (isEmptyRichDoc(clean)) return null;
  return {
    title: publicationTitleForDoc(clean),
    detail: encodeRichDetail(clean),
  };
}

export function cloneRichDoc(doc: CampusRichDoc): CampusRichDoc {
  return sanitizeRichDoc(JSON.parse(JSON.stringify(sanitizeRichDoc(doc))) as unknown);
}

export function composePlainOrRichNote(texts: readonly string[], body?: CampusRichDoc | null): CampusRichDoc {
  if (body && !isEmptyRichDoc(body)) return sanitizeRichDoc(body);
  return fromPlainLines(texts);
}

export function noteBodyOrPlain(text: string, body?: CampusRichDoc | null): CampusRichDoc {
  if (body && !isEmptyRichDoc(body)) return sanitizeRichDoc(body);
  return fromPlainText(text);
}
