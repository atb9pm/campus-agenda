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
}

export class MemoryAnnualCourseNotesStore implements AnnualCourseNotesStore {
  private readonly notes = new Map<string, AnnualCourseNote>();

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
