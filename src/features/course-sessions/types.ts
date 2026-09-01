import type { CourseWeekday } from "../course-schedule/types.ts";
import type { SchoolWeekKind } from "../calendar/types.ts";

/**
 * Séance pédagogique **calculée**, jamais persistée.
 *
 * Chaîne :
 * Plan de formation (CTX = profession + année + branche)
 * → Classe + CTX + année scolaire → AnnualCourse
 * → CourseScheduleSlot (segments d’horaire, ex. lundi P2+P3)
 * → calendrier scolaire (A/B, vacances, fériés, exceptions)
 * → CourseSession (date réelle + numéro de séance).
 *
 * Identité pédagogique : `annualCourseId` / `contextId`.
 * Aucun `trainingYear` ici — l’année de formation vit dans le CTX.
 *
 * Distinct de `ReferenceSession` (parcours pédagogique, hors dates).
 */
export interface CourseSession {
  annualCourseId: string;
  contextId: string;
  date: string;
  dayOfWeek: CourseWeekday;
  schoolWeekNumber: number;
  weekKind: SchoolWeekKind;
  periodStart: number;
  periodEnd: number;
  sessionNumber: number;
  slotIds: string[];
}
