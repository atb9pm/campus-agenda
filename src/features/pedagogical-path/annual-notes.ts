/**
 * Notes de cours annuelles — architecture cible (préparation).
 *
 * IMPORTANT — séparation stricte :
 * - Le parcours de référence CTX porte Devoir / Contrôle / Information.
 * - Les notes NE sont PAS un 4ᵉ type Agenda.
 * - Les notes appartiennent au cours annuel réel :
 *   schoolYearId + classId + contextId (+ referenceSessionId) + authorTeacherId (provenance).
 *
 * Legacy actuel (`src/features/class-notebook`) :
 * - Document JSON par enseignant (`teacher_notes`), clés `${classSetupId}:${schoolWeekNumber}`.
 * - Conservé intact : aucune migration destructrice dans cette PR.
 * - L'UI carnet existante continue de fonctionner.
 *
 * Cible future :
 * - Table `annual_course_notes` (créée additivement ici).
 * - Plusieurs classes parallèles (MMA 1A/1B/1C) sur le même CTX → notes distinctes.
 * - Transmission au professeur suivant : consultation par cours, pas propriété exclusive auteur.
 * - Reprise année N+1 = copie (sourceNoteId / sourceSchoolYearId / inheritedAt), jamais lien vivant.
 */

export interface AnnualCourseNote {
  id: string;
  schoolYearId: string;
  /** Classe annuelle (school_classes.id), pas le classSetup enseignant. */
  classId: string;
  contextId: string;
  /** Séance de référence du parcours CTX — peut être null si non encore rattachée. */
  referenceSessionId: string | null;
  /** Provenance uniquement — ne confère pas l'exclusivité de consultation. */
  authorTeacherId: string;
  text: string;
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
  text: string;
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

  return {
    ok: true,
    value: {
      id,
      schoolYearId: input.schoolYearId,
      classId: input.classId,
      contextId: input.contextId,
      referenceSessionId: input.referenceSessionId ?? null,
      authorTeacherId: input.authorTeacherId,
      text,
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
 */
export function copyNoteToNewYear(
  source: AnnualCourseNote,
  input: {
    id: string;
    schoolYearId: string;
    classId: string;
    authorTeacherId: string;
    referenceSessionId?: string | null;
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
    text: source.text,
    sourceNoteId: source.id,
    sourceSchoolYearId: source.schoolYearId,
    inheritedAt,
    annualCourseId: null,
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
 * L'auteur n'est PAS le seul habilité — un professeur B qui reprend le cours doit voir les notes.
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
