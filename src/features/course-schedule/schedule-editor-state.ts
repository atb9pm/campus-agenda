import type { CourseWeekKind, CourseWeekday } from "./types.ts";

export interface AttendanceEditorDraft {
  primaryDay: CourseWeekday | "";
  additional: Array<{ dayOfWeek: CourseWeekday; weekKind: CourseWeekKind }>;
}

export const EMPTY_ATTENDANCE_EDITOR_DRAFT: AttendanceEditorDraft = {
  primaryDay: "",
  additional: [],
};

export interface ScheduleEditorYearChangeState {
  selectedYearId: string;
  selectedClassId: string;
  editingDays: boolean;
  attendanceDraft: AttendanceEditorDraft;
  slotDraft: null;
  error: string;
}

/**
 * Changer d’année scolaire doit abandonner tout brouillon (présence ou créneau)
 * pour ne jamais l’enregistrer sur une autre classe.
 */
export function scheduleEditorStateAfterYearChange(nextYearId: string): ScheduleEditorYearChangeState {
  return {
    selectedYearId: nextYearId,
    selectedClassId: "",
    editingDays: false,
    attendanceDraft: { primaryDay: "", additional: [] },
    slotDraft: null,
    error: "",
  };
}
