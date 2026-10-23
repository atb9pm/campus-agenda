import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AnnualCourseMeetingDay } from "../annual-courses/meeting-days.ts";
import type { AnnualCourseNote } from "../pedagogical-path/annual-notes.ts";
import type { PrivateNotePreviewEntry } from "./private-notes.ts";
import type { YearTransitionPreviewReason } from "./reasons.ts";

export const YEAR_TRANSITION_APPLY_RESULTS = [
  "CREATED",
  "CREATED_UNPLACED",
  "ALREADY_PRESENT",
  "SKIPPED_NO_CONTINUATION",
  "SKIPPED_NO_REFERENCE",
  "SKIPPED_DEAD_REFERENCE",
  "SKIPPED_UNSCHEDULED",
] as const;

export type YearTransitionApplyResult = (typeof YEAR_TRANSITION_APPLY_RESULTS)[number];

export const YEAR_TRANSITION_APPLY_SUCCESS_CODES = ["APPLIED", "ALREADY_APPLIED"] as const;
export type YearTransitionApplySuccessCode = (typeof YEAR_TRANSITION_APPLY_SUCCESS_CODES)[number];

export const YEAR_TRANSITION_APPLY_FAILURE_CODES = [
  "TRANSITION_NOT_FOUND",
  "PREVIEW_CORRUPTED",
  "ENGINE_VERSION_MISMATCH",
  "SOURCE_YEAR_NOT_FOUND",
  "TARGET_YEAR_NOT_DRAFT",
  "PREVIEW_STALE",
  "APPLY_BLOCKED",
  "TARGET_CLASSROOM_MISSING",
  "TARGET_CLASSROOM_AMBIGUOUS",
  "TARGET_SUBJECT_MISSING",
  "TARGET_SUBJECT_AMBIGUOUS",
  "TARGET_SUBJECT_CLASSROOM_MISMATCH",
  "APPLY_LEDGER_DIVERGED",
  "APPLY_CONCURRENT_CONFLICT",
] as const;

export type YearTransitionApplyFailureCode = (typeof YEAR_TRANSITION_APPLY_FAILURE_CODES)[number];

export const YEAR_TRANSITION_APPLY_BLOCKING_REASONS = [
  "TARGET_EXISTING_DIVERGED",
  "SNAPSHOT_REFERENCE_CONFLICT",
  "INVALID_REFERENCE_SESSION_POSITION",
  "TARGET_SESSION_AMBIGUOUS",
  "SOURCE_COURSE_MISSING",
  "CLASS_MAPPING_MISSING",
  "CLASS_MAPPING_CONFLICT",
  "UNSUPPORTED_CLASS_MAPPING_CARDINALITY",
  "TARGET_COURSE_MISSING",
  "TARGET_COURSE_AMBIGUOUS",
  "TARGET_COURSE_ARCHIVED",
  "DUPLICATE_SOURCE_REFERENCE",
  "TARGET_REFERENCE_CONFLICT",
] as const;

export type YearTransitionApplyBlockingReason = (typeof YEAR_TRANSITION_APPLY_BLOCKING_REASONS)[number];

export interface PersistedYearTransitionApply {
  transitionId: string;
  fingerprint: string;
  engineVersion: number;
  appVersion: string;
  appliedAt: string;
}

export interface PersistedYearTransitionApplyEntry {
  transitionId: string;
  sourceAgendaItemId: number;
  previewReason: YearTransitionPreviewReason | string;
  applyResult: YearTransitionApplyResult | string;
  targetAnnualCourseId: string | null;
  referenceItemId: string | null;
  createdAt: string;
}

export interface YearTransitionApplyAgendaInsert {
  classroomId: string;
  subjectId: string;
  authorTeacherId: string | null;
  day: number;
  hour: number;
  weekOffset: number;
  schoolWeekNumber: number;
  type: PrototypeAgendaItem["type"];
  title: string;
  detail: string;
  templateId: null;
  schoolYearId: string;
  annualCourseId: string;
  courseSessionKey: string | null;
  courseSessionDate: string | null;
  referenceSessionId: string | null;
  referenceItemId: string | null;
  studentVisible: false;
  sourceTransitionId: string;
  sourceAgendaItemId: number;
}

export interface YearTransitionApplyNoteGuard {
  /**
   * Legacy : compare les notes d’un propriétaire.
   * Nouveau flux (`annualCourseIds`) : compare les notes des cours repris, tous propriétaires.
   */
  ownerTeacherId?: string;
  annualCourseIds?: readonly string[];
  sourceSchoolYearId: string;
  targetSchoolYearId: string;
  expected: readonly AnnualCourseNote[];
}

export function notesMatchingApplyGuard(
  notes: readonly AnnualCourseNote[],
  guard: YearTransitionApplyNoteGuard,
): AnnualCourseNote[] {
  const years = new Set([guard.sourceSchoolYearId, guard.targetSchoolYearId]);
  const courseIds = (guard.annualCourseIds ?? []).map((id) => id.trim()).filter(Boolean);
  return notes.filter((note) => {
    if (!years.has(note.schoolYearId)) return false;
    if (courseIds.length > 0) {
      return Boolean(note.annualCourseId && courseIds.includes(note.annualCourseId));
    }
    return Boolean(guard.ownerTeacherId && note.ownerTeacherId === guard.ownerTeacherId);
  });
}

/**
 * Réimportation d’un cours déjà importé : le contenu hérité actuel est retiré et le plan
 * de jours remplacé dans la même transaction que les nouvelles copies.
 * Le contenu manuel, les créneaux et les affectations ne sont jamais touchés.
 */
export interface YearTransitionApplyReimport {
  targetAnnualCourseIds: readonly string[];
  /** Exactement le contenu hérité de ces cours au moment de l’aperçu ; tout écart annule la transaction. */
  replacedItemIds: readonly number[];
  replacedNoteIds: readonly string[];
  meetingDays: readonly AnnualCourseMeetingDay[];
}

export const YEAR_TRANSITION_REIMPORT_CONTENT_CHANGED = "Inherited content changed during reimport";

export interface YearTransitionApplyPlan {
  noteGuard?: YearTransitionApplyNoteGuard;
  notes?: readonly AnnualCourseNote[];
  reimport?: YearTransitionApplyReimport;
  apply: PersistedYearTransitionApply;
  items: readonly YearTransitionApplyAgendaInsert[];
  entries: readonly PersistedYearTransitionApplyEntry[];
}

export interface YearTransitionApplyStore {
  getByTransitionId(transitionId: string): Promise<PersistedYearTransitionApply | null>;
  /** Registre complet, du plus ancien au plus récent. */
  listApplies(): Promise<PersistedYearTransitionApply[]>;
  listEntries(transitionId: string): Promise<PersistedYearTransitionApplyEntry[]>;
  applyAtomically(plan: YearTransitionApplyPlan): Promise<void>;
}

export interface YearTransitionApplySuccess {
  privateNotes?: {
    createdCount: number;
    toReclassifyCount: number;
    alreadyPresentCount: number;
    skippedCount: number;
    entries: PrivateNotePreviewEntry[];
  };
  ok: true;
  code: YearTransitionApplySuccessCode;
  transitionId: string;
  fingerprint: string;
  createdCount: number;
  toReclassifyCount: number;
  alreadyPresentCount: number;
  skippedCount: number;
  entries: PersistedYearTransitionApplyEntry[];
}

export interface YearTransitionApplyFailure {
  ok: false;
  code: YearTransitionApplyFailureCode;
  reason: string;
  persistedFingerprint?: string;
  currentFingerprint?: string;
  blockers?: Array<{ sourceAgendaItemId: number; reason: YearTransitionPreviewReason | string }>;
  noteBlockers?: Array<{ sourceNoteId: string; reason: string }>;
}

export type YearTransitionApplyOutcome = YearTransitionApplySuccess | YearTransitionApplyFailure;
