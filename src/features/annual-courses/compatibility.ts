/**
 * Compatibilité Membership (legacy) ↔ TeacherCourseAssignment (cible).
 *
 * Principe
 * --------
 * Les données pédagogiques appartiennent à AnnualCourse (année + classe + CTX),
 * jamais à un professeur. TeacherCourseAssignment est un droit d'accès daté.
 *
 * Source de vérité progressive
 * ----------------------------
 * - Dès qu'un AnnualCourse structuré existe pour (classe catalogue + CTX),
 *   TeacherCourseAssignment est le garde-fou d'autorisation.
 * - Membership (teacherId + classroomId + subjectIds + validFrom/validTo)
 *   reste le repli pour les classes / publications Agenda non encore rattachées
 *   à un AnnualCourse. Aucune suppression de memberships existants.
 *
 * Agenda
 * ------
 * Les publications restent identifiées par classroomId + subjectId.
 * Résolution quand elle est unique (jamais le premier homonyme) :
 *   nom de classe → school_classes
 *   nom de sujet  → branche → CTX (profession + année de formation)
 *   → AnnualCourse → TeacherCourseAssignment
 * Si un AnnualCourse correspondant existe mais est archivé : publication refusée
 * (pas de fallback Membership). Membership seulement si aucun cours fiable.
 *
 * Remplacement
 * ------------
 * replaceTeacherMemberships (src/features/memberships/replacement.ts) reste
 * disponible pour le repli Membership. L’UI d’administration (#48) n’a plus
 * d’onglet « Gestion des accès » : les attributions structurées passent par
 * l’onglet « Attributions des cours ».
 * replaceTeacherOnAnnualCourse adapte la même idée (clôturer + créer) au cours
 * annuel, sans copier ni supprimer de données pédagogiques.
 * Les deux opérations restent distinctes (espaces d'IDs classroom ≠ school_class).
 *
 * teacher-setup
 * -------------
 * TeacherSetupConfig (classes / branches affichées) est une préférence d'UI.
 * Ce n'est PAS une autorisation. Seul l'administrateur attribue un cours.
 *
 * validTo / endedAt
 * -----------------
 * Membership : validTo exclusif (isMembershipActiveAt).
 * Assignment : validFrom inclusif, validTo inclusif, endedAt = clôture exclusive
 * (inactif à partir de cet instant). Un endedAt futur laisse l'attribution active.
 */

export const MEMBERSHIP_IS_LEGACY_FALLBACK = true as const;
export const TEACHER_SETUP_IS_NOT_AUTHORIZATION = true as const;
export const ASSIGNMENT_VALID_TO_IS_INCLUSIVE = true as const;
