import type { AgendaItemType } from "../../types/agenda.ts";

/**
 * Types Agenda visibles élèves — les notes professeur n'en font PAS partie.
 * Réutilise les mêmes littéraux que les publications Agenda.
 */
export const REFERENCE_ITEM_TYPES = ["HOMEWORK", "TEST", "INFORMATION"] as const;

export type ReferenceItemType = (typeof REFERENCE_ITEM_TYPES)[number] & AgendaItemType;

export const REFERENCE_ITEM_TYPE_LABELS: Record<ReferenceItemType, string> = {
  HOMEWORK: "Devoir",
  TEST: "Contrôle",
  INFORMATION: "Information",
};

/** Élément pédagogique de référence (pas une publication datée). */
export interface ReferencePedagogicalItem {
  /** Identité technique stable — indépendante de la position. */
  id: string;
  type: ReferenceItemType;
  title: string;
  detail: string;
  /** Position 1-based dans la séance. */
  position: number;
}

/** Séance pédagogique de référence rattachée à un parcours CTX. */
export interface ReferenceSession {
  /** Identité technique stable — le numéro de séance n'est PAS l'identité. */
  id: string;
  /** Position 1-based affichée (réordonnable sans changer l'id). */
  position: number;
  /** Libellé court optionnel. */
  label: string | null;
  items: ReferencePedagogicalItem[];
}

/**
 * Parcours pédagogique de référence pour un CTX
 * (profession + année de formation + branche).
 *
 * Indépendant d'une classe, d'une année scolaire, d'un professeur et des dates.
 */
export interface ReferencePedagogicalPath {
  id: string;
  contextId: string;
  sessions: ReferenceSession[];
  createdAt: string;
  updatedAt: string;
}

export type PathMutationOk<T> = { ok: true; value: T };
export type PathMutationErr = { ok: false; reason: string };
export type PathMutationResult<T> = PathMutationOk<T> | PathMutationErr;

/**
 * Provenance future publication annuelle ← élément de référence.
 *
 * Analyse `templateId` (existant sur les publications Agenda) :
 * - `templateId` pointe vers un modèle de la bibliothèque pédagogique.
 * - Ce n'est PAS la même notion qu'un élément de parcours CTX.
 * - On n'ajoute PAS de second champ concurrent dans cette PR.
 * - La projection annuelle future créera un snapshot Agenda indépendant et pourra
 *   soit matérialiser un modèle bibliothèque (réutiliser `templateId`), soit
 *   conserver l'id d'élément de référence dans un champ dédié ultérieur —
 *   sans jamais modifier rétroactivement une publication historique.
 */
export interface ReferencePublicationProvenanceNote {
  /** Intention documentée — pas encore stockée sur les publications. */
  referenceItemId?: string;
  /** Réutilise le mécanisme snapshot existant si un modèle est matérialisé. */
  templateId?: string | null;
}
