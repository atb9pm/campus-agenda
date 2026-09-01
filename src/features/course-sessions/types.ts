import type { CourseWeekday } from "../course-schedule/types.ts";
import type { SchoolWeekKind } from "../calendar/types.ts";

/**
 * Segment horaire d’une séance : un `CourseScheduleSlot` projeté sur une date.
 * L’identité du créneau n’est pas fusionnée ; plusieurs segments peuvent
 * partager la même CourseSession (même AnnualCourse, même date).
 */
export interface CourseSessionSegment {
  scheduleSlotId: string;
  periodStart: number;
  periodEnd: number;
}

/**
 * Séance pédagogique **calculée**, jamais persistée.
 *
 * Règle d’identité :
 * même AnnualCourse + même date = une seule CourseSession,
 * quel que soit le nombre de segments horaires (P2+P3, P4+P6, etc.).
 *
 * Chaîne :
 * Plan de formation (CTX = profession + année + branche)
 * → Classe + CTX + année scolaire → AnnualCourse
 * → CourseScheduleSlot (segments d’horaire)
 * → calendrier scolaire (A/B, vacances, fériés, exceptions)
 * → CourseSession (date réelle + numéro de séance + segments).
 *
 * Identité pédagogique : `annualCourseId` / `contextId`.
 * L’enseignant n’entre pas dans la clé ; il se dérive via TeacherCourseAssignment.
 * Aucun `trainingYear` ici — l’année de formation vit dans le CTX.
 *
 * Distinct de `ReferenceSession` (parcours pédagogique, hors dates).
 */
export interface CourseSession {
  /** Clé déterministe : `schoolYearId|annualCourseId|date`. */
  key: string;
  schoolYearId: string;
  annualCourseId: string;
  classId: string;
  contextId: string;
  date: string;
  schoolWeekNumber: number;
  weekKind: SchoolWeekKind;
  dayOfWeek: CourseWeekday;
  sequenceNumber: number;
  segments: CourseSessionSegment[];
}
