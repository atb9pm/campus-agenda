import {
  confirmationMatches,
  missingConfirmationReason,
  wrongConfirmationReason,
} from "../admin-catalog-delete/types.ts";

export {
  confirmationMatches,
  missingConfirmationReason,
  wrongConfirmationReason,
};

export const LAST_ADMIN_DELETE_REASON = "Impossible de supprimer le dernier administrateur.";
export const TEACHER_NOT_FOUND_REASON = "Compte enseignant introuvable.";

export const TEACHER_DELETE_IRREVERSIBLE = "Cette action ne peut pas être annulée.";

export const TEACHER_DELETE_WILL_REMOVE = [
  "le compte du professeur",
  "ses accès",
  "ses affectations aux cours",
] as const;

export const TEACHER_DELETE_WILL_KEEP =
  "Les devoirs, contrôles, informations et l'historique pédagogique seront conservés.";

export interface TeacherDeleteCounts {
  assignments: number;
  classes: number;
  publications: number;
  memberships: number;
  templates: number;
  personalNotes: number;
  setups: number;
  annualCourseNotes: number;
}

export interface TeacherDeleteTarget {
  id: string;
  displayName: string;
  initials: string;
}

export interface TeacherDeletePlan {
  target: TeacherDeleteTarget;
  confirmationText: string;
  lastAdminBlocked: boolean;
  counts: TeacherDeleteCounts;
  assignmentIds: string[];
  assignmentEventIds: string[];
  membershipIds: string[];
  publicationIds: number[];
  templateIds: string[];
  annualCourseNoteIds: string[];
  annualCourseIds: string[];
  classIds: string[];
}

export interface TeacherDeletePreview {
  ok: true;
  target: TeacherDeleteTarget;
  confirmationText: string;
  lastAdminBlocked: boolean;
  lastAdminReason?: string;
  warning: string;
  irreversible: string;
  willRemove: string[];
  willKeep: string;
  counts: TeacherDeleteCounts;
  lines: string[];
}

export function emptyTeacherDeleteCounts(): TeacherDeleteCounts {
  return {
    assignments: 0,
    classes: 0,
    publications: 0,
    memberships: 0,
    templates: 0,
    personalNotes: 0,
    setups: 0,
    annualCourseNotes: 0,
  };
}
