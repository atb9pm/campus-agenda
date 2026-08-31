export const TEACHER_NAV_SECTIONS = ["mes-cours", "ma-semaine", "configuration", "administration"] as const;

export type TeacherNavSection = (typeof TEACHER_NAV_SECTIONS)[number];

export const DEFAULT_TEACHER_NAV_SECTION: TeacherNavSection = "mes-cours";

export const TEACHER_NAV_LABELS: Record<TeacherNavSection, string> = {
  "mes-cours": "Mes cours",
  "ma-semaine": "Ma semaine",
  configuration: "Préférences",
  administration: "Administration",
};

export const TEACHER_NAV_ICONS: Record<TeacherNavSection, string> = {
  "mes-cours": "▣",
  "ma-semaine": "▦",
  configuration: "⚙",
  administration: "⛨",
};

export function teacherNavSectionsForRole(isAdmin: boolean): TeacherNavSection[] {
  if (isAdmin) return [...TEACHER_NAV_SECTIONS];
  return TEACHER_NAV_SECTIONS.filter((section) => section !== "administration");
}
