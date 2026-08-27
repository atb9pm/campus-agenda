export {
  resolveCatalogClassroomId,
  resolveDefaultSubjectId,
  weekdayToCourseDayIndex,
  weekNotesKey,
} from "./resolve.ts";
export {
  appendWeekNote,
  classNotesStorageKey,
  createEmptyNotesDocument,
  loadNotesFromBrowser,
  listWeekNotes,
  moveWeekNote,
  removeWeekNote,
  saveNotesToBrowser,
} from "./notes-storage.ts";
export {
  clampWeekDisplayCount,
  formatWeekColumnLabel,
  formatWeekColumnSubtitle,
  visibleSchoolWeeks,
  type WeekDisplayCount,
} from "./week-window.ts";
export type { ClassNotesDocument, NotebookClipboard, TeacherWeekNote } from "./types.ts";
