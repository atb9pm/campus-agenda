import { DEFAULT_TEACHER_NAV_SECTION } from "./navigation.ts";

export const TEACHER_AGENDA_VIEWS = ["mine", "class"] as const;

export type TeacherAgendaView = (typeof TEACHER_AGENDA_VIEWS)[number];

/** Vue par défaut de l'espace enseignant : ses propres publications. */
export const DEFAULT_TEACHER_AGENDA_VIEW: TeacherAgendaView = "mine";

export interface TeacherWorkspaceState {
  teacherId: string;
  selectedClassroomId: string;
  activeSection: import("./navigation.ts").TeacherNavSection;
  agendaView: TeacherAgendaView;
}

export function createDefaultWorkspace(teacherId: string, defaultClassroomId: string): TeacherWorkspaceState {
  return {
    teacherId,
    selectedClassroomId: defaultClassroomId,
    activeSection: DEFAULT_TEACHER_NAV_SECTION,
    agendaView: DEFAULT_TEACHER_AGENDA_VIEW,
  };
}

export function openClassAgenda(
  workspace: TeacherWorkspaceState,
  classroomId: string,
): TeacherWorkspaceState {
  return {
    ...workspace,
    selectedClassroomId: classroomId,
    activeSection: "ma-semaine",
    agendaView: DEFAULT_TEACHER_AGENDA_VIEW,
  };
}

export function switchAgendaView(
  workspace: TeacherWorkspaceState,
  agendaView: TeacherAgendaView,
): TeacherWorkspaceState {
  return { ...workspace, agendaView };
}

export function navigateToSection(
  workspace: TeacherWorkspaceState,
  section: import("./navigation.ts").TeacherNavSection,
): TeacherWorkspaceState {
  return { ...workspace, activeSection: section };
}
