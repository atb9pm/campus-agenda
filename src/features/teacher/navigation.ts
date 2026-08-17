export const TEACHER_NAV_SECTIONS = ["dashboard", "classes", "agenda"] as const;

export type TeacherNavSection = (typeof TEACHER_NAV_SECTIONS)[number];

export const DEFAULT_TEACHER_NAV_SECTION: TeacherNavSection = "dashboard";

export const TEACHER_NAV_LABELS: Record<TeacherNavSection, string> = {
  dashboard: "Tableau de bord",
  classes: "Mes classes",
  agenda: "Agenda partagé",
};

export const TEACHER_NAV_ICONS: Record<TeacherNavSection, string> = {
  dashboard: "⌂",
  classes: "♙",
  agenda: "▣",
};
