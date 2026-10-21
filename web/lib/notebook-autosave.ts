import type { ClassNotesDocument } from "../../src/features/class-notebook/types.ts";

/** Serializes autosaves in one browser; the server revision also protects other tabs. */
export class NotebookAutosave {
  private revision: string | undefined;
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();

  reset(revision?: string): void {
    this.generation++;
    this.revision = revision;
  }

  save(notes: ClassNotesDocument, send: (notes: ClassNotesDocument, revision?: string) => Promise<{
    notes: ClassNotesDocument; revision: string;
  }>): Promise<ClassNotesDocument> {
    const generation = this.generation;
    const snapshot = structuredClone(notes);
    const next = this.tail.catch(() => undefined).then(async () => {
      if (generation !== this.generation) throw new Error("La session du Carnet a changé.");
      if (!this.revision) throw new Error("Rechargez le Carnet avant d'enregistrer les notes.");
      const saved = await send(snapshot, this.revision);
      if (generation !== this.generation) throw new Error("La session du Carnet a changé.");
      this.revision = saved.revision;
      return saved.notes;
    });
    this.tail = next;
    return next;
  }
}
