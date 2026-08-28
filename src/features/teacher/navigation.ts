export const TEACHER_NAV_SECTIONS = ["ma-semaine", "configuration", "administration"] as const;

export type TeacherNavSection = (typeof TEACHER_NAV_SECTIONS)[number];

export const DEFAULT_TEACHER_NAV_SECTION: TeacherNavSection = "ma-semaine";

export const TEACHER_NAV_LABELS: Record<TeacherNavSection, string> = {
  "ma-semaine": "Ma semaine",
  configuration: "Configuration",
  administration: "Administration",
};

export const TEACHER_NAV_ICONS: Record<TeacherNavSection, string> = {
  "ma-semaine": "▣",
  configuration: "⚙",
  administration: "⛨",
};

export function teacherNavSectionsForRole(isAdmin: boolean): TeacherNavSection[] {
  if (isAdmin) return [...TEACHER_NAV_SECTIONS];
  return TEACHER_NAV_SECTIONS.filter((section) => section !== "administration");
}
