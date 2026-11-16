export const TEACHER_NAV_SECTIONS = [
  "ma-semaine",
  "mes-cours",
  "controles",
  "configuration",
  "administration",
] as const;

export type TeacherNavSection = (typeof TEACHER_NAV_SECTIONS)[number];

export const DEFAULT_TEACHER_NAV_SECTION: TeacherNavSection = "ma-semaine";

export const TEACHER_NAV_LABELS: Record<TeacherNavSection, string> = {
  "mes-cours": "Mes cours",
  controles: "Contrôles",
  "ma-semaine": "Ma semaine",
  configuration: "Préférences",
  administration: "Administration",
};

export const TEACHER_NAV_ICONS: Record<TeacherNavSection, string> = {
  "mes-cours": "▣",
  controles: "☑",
  "ma-semaine": "▦",
  configuration: "⚙",
  administration: "⛨",
};

export function teacherNavSectionsForRole(isAdmin: boolean): TeacherNavSection[] {
  if (isAdmin) return [...TEACHER_NAV_SECTIONS];
  return TEACHER_NAV_SECTIONS.filter((section) => section !== "administration");
}

/** « Ma semaine » ferme le Carnet ouvert, même lorsque la rubrique est déjà active. */
export function teacherNavClosesNotebook(section: TeacherNavSection): boolean {
  return section === "ma-semaine";
}

export interface TeacherMenuView {
  section: TeacherNavSection;
  notebookOpen: boolean;
  selectedSchoolWeekNumber: number;
}

/**
 * Navigation du menu principal.
 * Revenir à Ma semaine ferme le Carnet et conserve la semaine scolaire consultée.
 * Les autres rubriques ne changent pas l’état du Carnet.
 */
export function applyTeacherMenuNavigation(current: TeacherMenuView, section: TeacherNavSection): TeacherMenuView {
  return {
    section,
    notebookOpen: teacherNavClosesNotebook(section) ? false : current.notebookOpen,
    selectedSchoolWeekNumber: current.selectedSchoolWeekNumber,
  };
}
