import { AGENDA_ITEM_TYPES, type AgendaItemType } from "../../types/agenda.ts";
import type { PrototypeAgendaItem } from "./demo-items.ts";

export interface PublicationInput {
  classroomId: string;
  subjectId: string;
  authorTeacherId: string;
  day: number;
  hour: number;
  weekOffset?: number;
  schoolWeekNumber: number;
  type: AgendaItemType;
  title: string;
  detail: string;
  templateId?: string | null;
  schoolYearId?: string | null;
  annualCourseId?: string | null;
  courseSessionKey?: string | null;
  courseSessionDate?: string | null;
  referenceSessionId?: string | null;
  referenceItemId?: string | null;
}

export type PublicationPatch = Partial<
  Pick<PublicationInput, "title" | "detail" | "day" | "hour" | "subjectId" | "schoolWeekNumber">
>;

export function isAllowedPublicationType(type: string): type is AgendaItemType {
  return (AGENDA_ITEM_TYPES as readonly string[]).includes(type);
}

export function isStructuredAgendaPublication(item: PrototypeAgendaItem): boolean {
  return Boolean(item.annualCourseId?.trim() && item.courseSessionKey?.trim());
}

export const STRUCTURED_AGENDA_PATCH_FORBIDDEN_REASON =
  "Les champs de provenance et de ciblage d’une publication structurée ne peuvent pas être modifiés.";

const STRUCTURED_PATCH_FORBIDDEN_KEYS = [
  "day",
  "hour",
  "schoolWeekNumber",
  "subjectId",
  "annualCourseId",
  "courseSessionKey",
  "courseSessionDate",
  "referenceSessionId",
  "referenceItemId",
] as const;

export function structuredAgendaPatchGuard(
  item: PrototypeAgendaItem,
  body: Record<string, unknown>,
): { ok: true } | { ok: false; reason: string } {
  if (!isStructuredAgendaPublication(item)) return { ok: true };
  if (STRUCTURED_PATCH_FORBIDDEN_KEYS.some((key) => body[key] !== undefined)) {
    return { ok: false, reason: STRUCTURED_AGENDA_PATCH_FORBIDDEN_REASON };
  }
  return { ok: true };
}

export function canModifyPublication(
  item: PrototypeAgendaItem,
  actorTeacherId: string,
  actorIsAdmin = false,
): boolean {
  if (actorIsAdmin) return true;
  return item.authorTeacherId === actorTeacherId;
}

export function findPublicationById(
  items: PrototypeAgendaItem[],
  itemId: number,
): PrototypeAgendaItem | undefined {
  return items.find((item) => item.id === itemId);
}

export function createPublication(
  items: PrototypeAgendaItem[],
  input: PublicationInput & { id: number },
): PrototypeAgendaItem[] {
  if (!isAllowedPublicationType(input.type)) {
    throw new Error("Type de publication non autorisé.");
  }

  const title = input.title.trim();
  if (!title) {
    throw new Error("Le titre est obligatoire.");
  }

  const publication: PrototypeAgendaItem = {
    id: input.id,
    classroomId: input.classroomId,
    subjectId: input.subjectId,
    authorTeacherId: input.authorTeacherId,
    day: input.day,
    hour: input.hour,
    weekOffset: input.weekOffset ?? 0,
    schoolWeekNumber: input.schoolWeekNumber,
    type: input.type,
    title,
    detail: input.detail.trim() || "Aucune précision",
    templateId: input.templateId ?? null,
    schoolYearId: input.schoolYearId ?? null,
    annualCourseId: input.annualCourseId ?? null,
    courseSessionKey: input.courseSessionKey ?? null,
    courseSessionDate: input.courseSessionDate ?? null,
    referenceSessionId: input.referenceSessionId ?? null,
    referenceItemId: input.referenceItemId ?? null,
  };

  return [...items, publication];
}

export function updatePublication(
  items: PrototypeAgendaItem[],
  itemId: number,
  actorTeacherId: string,
  patch: PublicationPatch,
  actorIsAdmin = false,
): { ok: true; items: PrototypeAgendaItem[] } | { ok: false; reason: string } {
  const existing = findPublicationById(items, itemId);
  if (!existing) {
    return { ok: false, reason: "Publication introuvable." };
  }
  if (!canModifyPublication(existing, actorTeacherId, actorIsAdmin)) {
    return { ok: false, reason: "Seul l'auteur peut modifier cette publication." };
  }

  const title = patch.title !== undefined ? patch.title.trim() : existing.title;
  if (!title) {
    return { ok: false, reason: "Le titre est obligatoire." };
  }

  const updated: PrototypeAgendaItem = {
    ...existing,
    title,
    detail: patch.detail !== undefined ? patch.detail.trim() || "Aucune précision" : existing.detail,
    day: patch.day ?? existing.day,
    hour: patch.hour ?? existing.hour,
    subjectId: patch.subjectId ?? existing.subjectId,
    schoolWeekNumber: patch.schoolWeekNumber ?? existing.schoolWeekNumber,
    templateId: existing.templateId ?? null,
    schoolYearId: existing.schoolYearId ?? null,
  };

  return {
    ok: true,
    items: items.map((item) => (item.id === itemId ? updated : item)),
  };
}

export function deletePublication(
  items: PrototypeAgendaItem[],
  itemId: number,
  actorTeacherId: string,
  actorIsAdmin = false,
): { ok: true; items: PrototypeAgendaItem[] } | { ok: false; reason: string } {
  const existing = findPublicationById(items, itemId);
  if (!existing) {
    return { ok: false, reason: "Publication introuvable." };
  }
  if (!canModifyPublication(existing, actorTeacherId, actorIsAdmin)) {
    return { ok: false, reason: "Seul l'auteur peut supprimer cette publication." };
  }

  return {
    ok: true,
    items: items.filter((item) => item.id !== itemId),
  };
}
