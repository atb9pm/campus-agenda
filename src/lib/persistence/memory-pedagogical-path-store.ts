import {
  isCarnetManagedNote,
  preserveNotebookMetadata,
  validateCourseNotebookNotes,
  validateOwnedNotes,
} from "./notebook-state.ts";
import {
  createAnnualCourseNote,
  type AnnualCourseNote,
  type AnnualCourseNoteFilter,
  type AnnualCourseNoteInput,
  type ReferencePedagogicalPath,
} from "../../features/pedagogical-path/index.ts";
import type {
  AnnualCourseNotesStore,
  PedagogicalPathStore,
} from "./pedagogical-path-types.ts";

export class MemoryPedagogicalPathStore implements PedagogicalPathStore {
  private readonly byContext = new Map<string, ReferencePedagogicalPath>();

  async getPathByContextId(contextId: string): Promise<ReferencePedagogicalPath | null> {
    const path = this.byContext.get(contextId);
    return path ? structuredClone(path) : null;
  }

  async listPaths(): Promise<ReferencePedagogicalPath[]> {
    return [...this.byContext.values()]
      .map((path) => structuredClone(path))
      .sort((a, b) => a.contextId.localeCompare(b.contextId));
  }

  async savePath(path: ReferencePedagogicalPath): Promise<ReferencePedagogicalPath> {
    const stored = structuredClone(path);
    this.byContext.set(path.contextId, stored);
    return structuredClone(stored);
  }

  async deletePathByContextId(contextId: string): Promise<boolean> {
    return this.byContext.delete(contextId);
  }

  replaceAll(paths: ReferencePedagogicalPath[]): void {
    this.byContext.clear();
    for (const path of paths) this.byContext.set(path.contextId, structuredClone(path));
  }
}

export class MemoryAnnualCourseNotesStore implements AnnualCourseNotesStore {
  private notes = new Map<string, AnnualCourseNote>();

  async listNotes(filter: AnnualCourseNoteFilter): Promise<AnnualCourseNote[]> {
    return [...this.notes.values()]
      .filter((note) => {
        if (note.schoolYearId !== filter.schoolYearId) return false;
        if (note.classId !== filter.classId) return false;
        if (note.contextId !== filter.contextId) return false;
        if (
          filter.referenceSessionId !== undefined &&
          note.referenceSessionId !== filter.referenceSessionId
        ) {
          return false;
        }
        return true;
      })
      .map((note) => structuredClone(note))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getNote(id: string): Promise<AnnualCourseNote | null> {
    const note = this.notes.get(id);
    return note ? structuredClone(note) : null;
  }

  async createNote(id: string, input: AnnualCourseNoteInput): Promise<AnnualCourseNote> {
    const created = createAnnualCourseNote(id, input);
    if (!created.ok) throw new Error(created.reason);
    this.notes.set(id, structuredClone(created.value));
    return structuredClone(created.value);
  }

  async deleteNote(id: string): Promise<boolean> {
    return this.notes.delete(id);
  }

  async deleteInheritedNotes(filter: AnnualCourseNoteFilter): Promise<number> {
    const matches = await this.listNotes(filter);
    let deleted = 0;
    for (const note of matches) {
      if (note.sourceNoteId === null && note.inheritedAt === null) continue;
      this.notes.delete(note.id);
      deleted += 1;
    }
    return deleted;
  }

  async countByContextId(contextId: string): Promise<number> {
    return [...this.notes.values()].filter((note) => note.contextId === contextId).length;
  }

  async countByClassId(classId: string): Promise<number> {
    return [...this.notes.values()].filter((note) => note.classId === classId).length;
  }

  async attachAnnualCourseId(filter: AnnualCourseNoteFilter, annualCourseId: string): Promise<number> {
    let updated = 0;
    for (const note of this.notes.values()) {
      if (note.schoolYearId !== filter.schoolYearId) continue;
      if (note.classId !== filter.classId) continue;
      if (note.contextId !== filter.contextId) continue;
      if (note.annualCourseId) continue;
      note.annualCourseId = annualCourseId;
      updated += 1;
    }
    return updated;
  }

  async listNotesByOwner(ownerTeacherId: string): Promise<AnnualCourseNote[]> {
    return [...this.notes.values()]
      .filter((note) => note.ownerTeacherId === ownerTeacherId)
      .map((note) => structuredClone(note))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async listNotesByAnnualCourse(annualCourseId: string): Promise<AnnualCourseNote[]> {
    return [...this.notes.values()]
      .filter((note) => note.annualCourseId === annualCourseId)
      .map((note) => structuredClone(note))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async findByOwnerLegacyNote(ownerTeacherId: string, legacyNoteId: string): Promise<AnnualCourseNote | null> {
    for (const note of this.notes.values()) {
      if (note.ownerTeacherId === ownerTeacherId && note.legacyNoteId === legacyNoteId) {
        return structuredClone(note);
      }
    }
    return null;
  }

  /** Stage without writes; the commit is synchronous and cannot yield. */
  stageOwnedNotebookNotes(owner: string, notes: readonly AnnualCourseNote[]): () => void {
    validateOwnedNotes(owner, notes);
    const next = new Map(this.notes);
    for (const [id, note] of next) if (note.ownerTeacherId === owner) next.delete(id);
    for (const note of notes) {
      if (next.has(note.id)) throw new Error("Notebook id belongs to another owner");
      next.set(note.id, structuredClone(note));
    }
    return () => { this.notes = next; };
  }

  /** Stage Carnet notes for the given courses; other courses and structural notes stay. */
  stageCourseNotebookNotes(annualCourseIds: readonly string[], notes: readonly AnnualCourseNote[]): () => void {
    const allowed = new Set(annualCourseIds);
    const byCourse = new Map<string, AnnualCourseNote[]>();
    for (const courseId of annualCourseIds) byCourse.set(courseId, []);
    for (const note of notes) {
      if (!note.annualCourseId || !allowed.has(note.annualCourseId)) {
        throw new Error("Invalid notebook course identity");
      }
      byCourse.get(note.annualCourseId)!.push(note);
    }
    const next = new Map(this.notes);
    for (const courseId of annualCourseIds) {
      const courseNotes = byCourse.get(courseId) ?? [];
      validateCourseNotebookNotes(courseId, courseNotes);
      for (const [id, note] of next) {
        if (note.annualCourseId === courseId && isCarnetManagedNote(note)) next.delete(id);
      }
      for (const note of courseNotes) {
        if (!isCarnetManagedNote(note)) throw new Error("Invalid notebook course identity");
        if (next.has(note.id)) throw new Error("Notebook id belongs to another course");
        next.set(note.id, structuredClone(note));
      }
    }
    return () => {
      this.notes = next;
    };
  }

  async replaceOwnedNotebookNotes(owner: string, notes: readonly AnnualCourseNote[]): Promise<void> {
    const current = [...this.notes.values()];
    const next = notes.map(note => preserveNotebookMetadata(note,
      current.find(row => row.ownerTeacherId === owner && row.legacyNoteId !== null && row.legacyNoteId === note.legacyNoteId)));
    this.stageOwnedNotebookNotes(owner, next)();
  }

  async replaceNotebookNotesForAnnualCourse(
    annualCourseId: string,
    notes: readonly AnnualCourseNote[],
  ): Promise<void> {
    const current = await this.listNotesByAnnualCourse(annualCourseId);
    const next = notes.map((note) =>
      preserveNotebookMetadata(
        note,
        current.find((row) => row.legacyNoteId !== null && row.legacyNoteId === note.legacyNoteId),
      ),
    );
    this.stageCourseNotebookNotes([annualCourseId], next)();
  }

  async updateNoteCourseSession(id: string, courseSessionKey: string): Promise<AnnualCourseNote | null> {
    const current = this.notes.get(id);
    if (!current) return null;
    const updated: AnnualCourseNote = {
      ...current,
      courseSessionKey,
      updatedAt: new Date().toISOString(),
    };
    this.notes.set(id, updated);
    return structuredClone(updated);
  }

  exportAllNotes(): AnnualCourseNote[] {
    return [...this.notes.values()].map((note) => structuredClone(note));
  }

  /** Stage inherited copies before publishing the transition's other tables. */
  stageInsertedNotes(notes: readonly AnnualCourseNote[], removedIds: readonly string[] = []): () => void {
    const next = new Map(this.notes);
    for (const id of removedIds) next.delete(id);
    for (const note of notes) {
      if (next.has(note.id)) throw new Error("UNIQUE constraint failed: annual_course_notes.id");
      next.set(note.id, structuredClone(note));
    }
    return () => { this.notes = next; };
  }

  replaceAllNotes(notes: AnnualCourseNote[]): void {
    this.notes.clear();
    for (const note of notes) this.notes.set(note.id, structuredClone(note));
  }
}

let memoryPathStore: MemoryPedagogicalPathStore | null = null;
let memoryAnnualNotesStore: MemoryAnnualCourseNotesStore | null = null;

export function getMemoryPedagogicalPathStore(): MemoryPedagogicalPathStore {
  memoryPathStore ??= new MemoryPedagogicalPathStore();
  return memoryPathStore;
}

export function getMemoryAnnualCourseNotesStore(): MemoryAnnualCourseNotesStore {
  memoryAnnualNotesStore ??= new MemoryAnnualCourseNotesStore();
  return memoryAnnualNotesStore;
}

export function resetMemoryPedagogicalPathStore(): void {
  memoryPathStore = null;
  memoryAnnualNotesStore = null;
}
