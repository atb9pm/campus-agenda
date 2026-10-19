import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { ReferencePedagogicalPath } from "../pedagogical-path/types.ts";
import type {
  YearTransitionPreviewReason,
  YearTransitionPreviewWarning,
} from "./reasons.ts";

/**
 * Mapping explicite de classes. Jamais déduit du code, du label ou de l’année de formation.
 *
 * V1 :
 * - 1 → 1 : `sourceClassId` et `targetClassId` renseignés
 * - 1 → 0 : `targetClassId` null (pas de continuation)
 * - 0 → 1 : `sourceClassId` null (nouvelle classe, rien à importer)
 */
export interface YearTransitionClassMapping {
  sourceClassId: string | null;
  targetClassId: string | null;
}

export interface YearTransitionPreviewInput {
  sourceSchoolYearId: string;
  targetSchoolYearId: string;
  classMappings: readonly YearTransitionClassMapping[];
  sourceCourses: readonly AnnualCourse[];
  targetCourses: readonly AnnualCourse[];
  sourceItems: readonly PrototypeAgendaItem[];
  targetItems: readonly PrototypeAgendaItem[];
  /** Snapshots de parcours CTX utilisés pour ce PREVIEW (un par contextId attendu). */
  pathSnapshots: readonly ReferencePedagogicalPath[];
  /** CourseSession déjà calculées pour l’année cible — jamais recalculées ici. */
  targetCourseSessions: readonly CourseSession[];
}

/** Placement proposé : uniquement des champs de la CourseSession N+1. */
export interface YearTransitionProposedPlacement {
  schoolYearId: string;
  annualCourseId: string;
  courseSessionKey: string;
  courseSessionDate: string;
  schoolWeekNumber: number;
  day: number;
  hour: number;
  sequenceNumber: number;
}

/** Provenance temporelle de N — diagnostic uniquement, jamais une clé de placement. */
export interface YearTransitionSourceTemporal {
  schoolWeekNumber: number;
  day: number;
  hour: number;
  weekOffset: number;
  courseSessionDate: string | null;
  courseSessionKey: string | null;
}

export interface YearTransitionPreviewEntry {
  reason: YearTransitionPreviewReason;
  warnings: YearTransitionPreviewWarning[];
  sourceAgendaItemId: number;
  sourceAnnualCourseId: string | null;
  sourceClassId: string | null;
  targetClassId: string | null;
  targetAnnualCourseId: string | null;
  referenceItemId: string | null;
  sourceReferenceSessionId: string | null;
  resolvedReferenceSessionId: string | null;
  pedagogicalPosition: number | null;
  targetCourseSession: CourseSession | null;
  proposedPlacement: YearTransitionProposedPlacement | null;
  sourceTemporal: YearTransitionSourceTemporal;
}

export interface YearTransitionClassMappingSummary {
  oneToOne: Array<{ sourceClassId: string; targetClassId: string }>;
  noContinuation: string[];
  targetOnly: string[];
  conflicts: Array<{ targetClassId: string; sourceClassIds: string[] }>;
  unsupported: Array<{ sourceClassIds: string[]; targetClassIds: string[] }>;
}

export interface YearTransitionPreviewResult {
  sourceSchoolYearId: string;
  targetSchoolYearId: string;
  /**
   * Empreinte déterministe des données matérielles du PREVIEW.
   * Un APPLY futur doit exiger un PREVIEW recalculé si elle change (fail closed).
   */
  fingerprint: string;
  mappingSummary: YearTransitionClassMappingSummary;
  entries: YearTransitionPreviewEntry[];
}
