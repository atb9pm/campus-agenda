import { normalizeClassNotes } from "../../features/class-notebook/notes-storage.ts";
import type { ClassNotesDocument } from "../../features/class-notebook/types.ts";
import type { TeacherNotesStore } from "./teacher-notes-types.ts";

export class MemoryTeacherNotesStore implements TeacherNotesStore {
  private readonly notes = new Map<string, ClassNotesDocument>();

  async getNotes(teacherId: string): Promise<ClassNotesDocument | null> {
    const stored = this.notes.get(teacherId);
    return stored ? structuredClone(stored) : null;
  }

  async saveNotes(teacherId: string, document: ClassNotesDocument): Promise<ClassNotesDocument> {
    const normalized = normalizeClassNotes(document);
    this.notes.set(teacherId, structuredClone(normalized));
    return structuredClone(normalized);
  }
}

let memoryTeacherNotesStore: MemoryTeacherNotesStore | null = null;

export function getMemoryTeacherNotesStore(): MemoryTeacherNotesStore {
  memoryTeacherNotesStore ??= new MemoryTeacherNotesStore();
  return memoryTeacherNotesStore;
}

export function resetMemoryTeacherNotesStore(): void {
  memoryTeacherNotesStore = null;
}
