export {
  resolveCatalogClassroomId,
  resolveDefaultSubjectId,
  weekdayToCourseDayIndex,
  weekNotesKey,
} from "./resolve.ts";
export {
  appendWeekNote,
  classNotesStorageKey,
  clearNotesFromBrowser,
  createEmptyNotesDocument,
  isClassNotesPayload,
  loadNotesFromBrowser,
  listWeekNotes,
  moveWeekNote,
  normalizeClassNotes,
  parseStoredNotes,
  peekNotesFromBrowser,
  removeWeekNote,
  saveNotesToBrowser,
  serializeClassNotes,
} from "./notes-storage.ts";
export {
  clampWeekDisplayCount,
  formatWeekColumnLabel,
  formatWeekColumnSubtitle,
  visibleSchoolWeeks,
  type WeekDisplayCount,
} from "./week-window.ts";
export type { ClassNotesDocument, NotebookClipboard, TeacherWeekNote } from "./types.ts";
