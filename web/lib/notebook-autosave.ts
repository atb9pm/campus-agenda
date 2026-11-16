import type { ClassNotesDocument } from "../../src/features/class-notebook/types.ts";

/** L’enregistrement automatique attend une lecture réussie, sans conflit en cours. */
export function shouldPersistNotebookNotes(input: {
  hydrated: boolean;
  conflict: boolean;
  adminConsult: boolean;
}): boolean {
  return input.hydrated && !input.conflict && !input.adminConsult;
}

/** Serializes autosaves in one browser; the server revision also protects other tabs. */
export class NotebookAutosave {
  private revision: string | undefined;
  private generation = 0;
  private saveEpoch = 0;
  private pending = 0;
  private tail: Promise<unknown> = Promise.resolve();

  reset(revision?: string): void {
    this.generation++;
    this.saveEpoch++;
    this.revision = revision;
  }

  epoch(): number {
    return this.saveEpoch;
  }

  hasRevision(): boolean {
    return Boolean(this.revision);
  }

  /**
   * Adopte la révision lue seulement si aucune sauvegarde n’a abouti pendant la lecture.
   * Une réponse plus ancienne ne remplace pas la révision d’un enregistrement plus récent.
   */
  adoptIfCurrent(seenEpoch: number, revision: string | undefined): void {
    if (this.saveEpoch !== seenEpoch || this.pending !== 0) return;
    this.revision = revision;
  }

  save(notes: ClassNotesDocument, send: (notes: ClassNotesDocument, revision?: string) => Promise<{
    notes: ClassNotesDocument; revision: string;
  }>): Promise<ClassNotesDocument> {
    const generation = this.generation;
    const snapshot = structuredClone(notes);
    this.pending++;
    const next = this.tail.catch(() => undefined).then(async () => {
      try {
        if (generation !== this.generation) throw new Error("La session du Carnet a changé.");
        if (!this.revision) throw new Error("Rechargez le Carnet avant d'enregistrer les notes.");
        const saved = await send(snapshot, this.revision);
        if (generation !== this.generation) throw new Error("La session du Carnet a changé.");
        this.revision = saved.revision;
        this.saveEpoch++;
        return saved.notes;
      } finally {
        this.pending--;
      }
    });
    this.tail = next;
    return next;
  }
}
