/**
 * Notes de cours annuelles.
 *
 * IMPORTANT — séparation stricte :
 * - Le parcours de référence CTX porte Devoir / Contrôle / Information.
 * - Les notes NE sont PAS un 4ᵉ type Agenda.
 *
 * Confidentialité PR3.4 :
 * - `ownerTeacherId` = propriétaire / visibilité Carnet (équivalent teacher_notes.teacher_id).
 * - `authorTeacherId` = provenance de création (nullable en SQL si le compte est supprimé).
 * - PR3.4 ne partage PAS une note entre enseignants du même cours.
 * - Les élèves n'ont jamais accès aux notes.
 *
 * Identité d'héritage N→N+1 (`sourceNoteId` / `sourceSchoolYearId` / `inheritedAt`)
 * n'est PAS la provenance du JSON legacy. Celle-ci est `legacyNoteId`.
 *
 * Legacy (`teacher_notes`) : document JSON par enseignant. Les notes non résolues
 * (V1, pendingWeeks, orphanedSessions, CourseSession invalide) y restent.
 */

import type { CampusRichDoc } from "../class-notebook/rich-doc.ts";

export interface AnnualCourseNote {
  id: string;
  schoolYearId: string;
  /** Classe annuelle (school_classes.id), pas le classSetup enseignant. */
  classId: string;
  contextId: string;
  /** Séance de référence du parcours CTX — null si non déterminable avec certitude. */
  referenceSessionId: string | null;
  /** Provenance de création — ne confère pas l'exclusivité de consultation future. */
  authorTeacherId: string;
  /**
   * Propriétaire Carnet PR3.4 (visibilité). Distinct de l'auteur.
   * Null = note structurelle hors document Carnet (tests / données préparatoires).
   */
  ownerTeacherId: string | null;
  text: string;
  /** Document riche complet. Null = texte brut uniquement. */
  body: CampusRichDoc | null;
  /**
   * Emplacement calendaire courant (`schoolYearId|annualCourseId|date`).
   * Identité d'affichage dans l'année, jamais une identité cross-year.
   */
  courseSessionKey: string | null;
  /** Id `TeacherWeekNote.id` dans le document legacy — pas un héritage N→N+1. */
  legacyNoteId: string | null;
  /** Métadonnées d'héritage (copie année précédente). */
  sourceNoteId: string | null;
  sourceSchoolYearId: string | null;
  inheritedAt: string | null;
  /**
   * Résolution additive vers AnnualCourse lorsque le cours existe.
   * Null = pas encore rattaché (compatibilité PR46).
   */
  annualCourseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnualCourseNoteInput {
  schoolYearId: string;
  classId: string;
  contextId: string;
  referenceSessionId?: string | null;
  authorTeacherId: string;
  ownerTeacherId?: string | null;
  text: string;
  body?: CampusRichDoc | null;
  courseSessionKey?: string | null;
  legacyNoteId?: string | null;
  sourceNoteId?: string | null;
  sourceSchoolYearId?: string | null;
  inheritedAt?: string | null;
  annualCourseId?: string | null;
}

export interface AnnualCourseNoteFilter {
  schoolYearId: string;
  classId: string;
  contextId: string;
  referenceSessionId?: string | null;
}

export type AnnualNoteMutationOk<T> = { ok: true; value: T };
export type AnnualNoteMutationErr = { ok: false; reason: string };
export type AnnualNoteMutationResult<T> = AnnualNoteMutationOk<T> | AnnualNoteMutationErr;

/** Clé conceptuelle d'un cours annuel (notes indépendantes entre classes). */
export function annualCourseKey(parts: {
  schoolYearId: string;
  classId: string;
  contextId: string;
}): string {
  return `${parts.schoolYearId}:${parts.classId}:${parts.contextId}`;
}

export function serializeAnnualNoteBody(body: CampusRichDoc | null | undefined): string | null {
  if (!body) return null;
  return JSON.stringify(body);
}

export function parseAnnualNoteBody(raw: string | null | undefined): CampusRichDoc | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CampusRichDoc;
    if (parsed?.format === "campus-rich-v1" && Array.isArray(parsed.blocks)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function createAnnualCourseNote(
  id: string,
  input: AnnualCourseNoteInput,
  createdAt = new Date().toISOString(),
): AnnualNoteMutationResult<AnnualCourseNote> {
  const text = input.text.trim();
  if (!text) return { ok: false, reason: "Le texte de la note est obligatoire." };
  if (!input.schoolYearId.trim() || !input.classId.trim() || !input.contextId.trim()) {
    return { ok: false, reason: "schoolYearId, classId et contextId sont obligatoires." };
  }
  if (!input.authorTeacherId.trim()) {
    return { ok: false, reason: "authorTeacherId (provenance) est obligatoire." };
  }

  const owner = input.ownerTeacherId?.trim() ? input.ownerTeacherId.trim() : null;
  const legacy = input.legacyNoteId?.trim() ? input.legacyNoteId.trim() : null;
  const sessionKey = input.courseSessionKey?.trim() ? input.courseSessionKey.trim() : null;

  return {
    ok: true,
    value: {
      id,
      schoolYearId: input.schoolYearId,
      classId: input.classId,
      contextId: input.contextId,
      referenceSessionId: input.referenceSessionId ?? null,
      authorTeacherId: input.authorTeacherId,
      ownerTeacherId: owner,
      text,
      body: input.body ?? null,
      courseSessionKey: sessionKey,
      legacyNoteId: legacy,
      sourceNoteId: input.sourceNoteId ?? null,
      sourceSchoolYearId: input.sourceSchoolYearId ?? null,
      inheritedAt: input.inheritedAt ?? null,
      annualCourseId: input.annualCourseId ?? null,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

/**
 * Copie vers une nouvelle année — jamais un lien vivant.
 * La note source reste intacte.
 * `courseSessionKey` n'est pas recopié (identité calendaire d'une seule année).
 * `legacyNoteId` n'est pas recopié (provenance JSON, pas héritage annuel).
 */
export function copyNoteToNewYear(
  source: AnnualCourseNote,
  input: {
    id: string;
    schoolYearId: string;
    classId: string;
    authorTeacherId: string;
    ownerTeacherId?: string | null;
    referenceSessionId?: string | null;
    annualCourseId?: string | null;
  },
  inheritedAt = new Date().toISOString(),
): AnnualCourseNote {
  return {
    id: input.id,
    schoolYearId: input.schoolYearId,
    classId: input.classId,
    contextId: source.contextId,
    referenceSessionId:
      input.referenceSessionId === undefined
        ? source.referenceSessionId
        : input.referenceSessionId,
    authorTeacherId: input.authorTeacherId,
    ownerTeacherId:
      input.ownerTeacherId === undefined ? source.ownerTeacherId : input.ownerTeacherId,
    text: source.text,
    body: source.body,
    courseSessionKey: null,
    legacyNoteId: null,
    sourceNoteId: source.id,
    sourceSchoolYearId: source.schoolYearId,
    inheritedAt,
    annualCourseId: input.annualCourseId ?? null,
    createdAt: inheritedAt,
    updatedAt: inheritedAt,
  };
}

/** Filtre les copies héritées (pour « Effacer les notes importées »). */
export function filterInheritedNotes(notes: AnnualCourseNote[]): AnnualCourseNote[] {
  return notes.filter((note) => note.sourceNoteId !== null || note.inheritedAt !== null);
}

/**
 * Droit de consultation futur : réservé aux enseignants autorisés sur le cours.
 * PR3.4 applique encore ownerTeacherId pour le Carnet (pas de partage silencieux).
 */
export function teacherMayConsultCourseNotes(options: {
  isTeacher: boolean;
  isStudent: boolean;
}): boolean {
  if (options.isStudent) return false;
  return options.isTeacher;
}

/** Les élèves n'ont jamais accès aux notes de cours. */
export function studentMayAccessCourseNotes(): false {
  return false;
}

/** Les notes ne sont pas un type Agenda. */
export const NOTES_ARE_NOT_AGENDA_TYPE = true as const;
