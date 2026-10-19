import { normalizeClassNotes } from "../../features/class-notebook/notes-storage.ts";
import type { ClassNotesDocument } from "../../features/class-notebook/types.ts";
import type { TeacherNotesBackupEntry, TeacherNotesStore } from "./teacher-notes-types.ts";
import { NotebookConflictError, type NotebookState } from "./teacher-notes-types.ts";
import type { AnnualCourseNotesStore } from "./pedagogical-path-types.ts";
import type { AnnualCourseNote } from "../../features/pedagogical-path/annual-notes.ts";
import { MemoryAnnualCourseNotesStore } from "./memory-pedagogical-path-store.ts";

export class MemoryTeacherNotesStore implements TeacherNotesStore {
  private readonly notes = new Map<string, ClassNotesDocument>();

  private snapshot(teacherId: string, courseNotes: AnnualCourseNotesStore): NotebookState {
    if (!(courseNotes instanceof MemoryAnnualCourseNotesStore)) throw new Error("Incompatible notebook stores");
    const leftover = structuredClone(this.notes.get(teacherId) ?? null);
    const owned = courseNotes.exportAllNotes().filter(note => note.ownerTeacherId === teacherId)
      .sort((a, b) => a.id.localeCompare(b.id));
    return { leftover, owned, token: JSON.stringify([leftover, owned]) };
  }

  async readNotebook(teacherId: string, courseNotes: AnnualCourseNotesStore): Promise<NotebookState> {
    return this.snapshot(teacherId, courseNotes);
  }

  async commitNotebook(teacherId: string, expected: NotebookState, leftover: ClassNotesDocument,
    owned: readonly AnnualCourseNote[], courseNotes: AnnualCourseNotesStore): Promise<void> {
    if (!(courseNotes instanceof MemoryAnnualCourseNotesStore)) throw new Error("Incompatible notebook stores");
    if (this.snapshot(teacherId, courseNotes).token !== expected.token) throw new NotebookConflictError();
    const preparedLeftover = structuredClone(normalizeClassNotes(leftover));
    const publishNotes = courseNotes.stageOwnedNotebookNotes(teacherId, owned);
    // No await and no fallible transformations after staging: readers see both halves together.
    publishNotes();
    this.notes.set(teacherId, preparedLeftover);
  }

  async getNotes(teacherId: string): Promise<ClassNotesDocument | null> {
    const stored = this.notes.get(teacherId);
    return stored ? structuredClone(stored) : null;
  }

  async saveNotes(teacherId: string, document: ClassNotesDocument): Promise<ClassNotesDocument> {
    const normalized = normalizeClassNotes(document);
    this.notes.set(teacherId, structuredClone(normalized));
    return structuredClone(normalized);
  }

  async exportAllNotes(): Promise<TeacherNotesBackupEntry[]> {
    return [...this.notes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([teacherId, document]) => ({
        teacherId,
        document: structuredClone(document),
      }));
  }

  async replaceAllNotes(entries: TeacherNotesBackupEntry[]): Promise<void> {
    this.notes.clear();
    for (const entry of entries) {
      this.notes.set(entry.teacherId, structuredClone(normalizeClassNotes(entry.document)));
    }
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
