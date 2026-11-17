import { normalizeClassNotes } from "../../src/features/class-notebook/notes-storage.ts";
import type { ClassNotesDocument } from "../../src/features/class-notebook/types.ts";

/** L’enregistrement automatique attend une lecture réussie, sans conflit en cours. */
export function shouldPersistNotebookNotes(input: {
  hydrated: boolean;
  conflict: boolean;
  adminConsult: boolean;
}): boolean {
  return input.hydrated && !input.conflict && !input.adminConsult;
}

/** Le serveur a refusé la révision envoyée (HTTP 409). */
export class NotesSaveConflictError extends Error {}

/** Le serveur n’a pas répondu ou a échoué : un nouvel envoi peut réussir sans rien changer. */
export class NotesSaveUnreachableError extends Error {}

export const NOTES_SAVE_UNREACHABLE_MESSAGE =
  "Connexion au serveur interrompue. Les notes prof restent à l’écran et seront renvoyées automatiquement.";

/** Délais des nouveaux envois après une coupure, en millisecondes. */
export const NOTES_RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000] as const;

export function notesRetryDelay(attempt: number): number {
  return NOTES_RETRY_DELAYS_MS[Math.min(attempt, NOTES_RETRY_DELAYS_MS.length - 1)];
}

export type NotesSaveFailureKind = "conflict" | "unreachable" | "other";

export function notesSaveFailureKind(error: unknown): NotesSaveFailureKind {
  if (error instanceof NotesSaveConflictError) return "conflict";
  if (error instanceof NotesSaveUnreachableError) return "unreachable";
  if (error instanceof Error && error.message.includes("Les notes ont changé")) return "conflict";
  return "other";
}

function canonicalNotes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalNotes);
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, canonicalNotes(entry)] as const)
      .filter(([, entry]) => !(Array.isArray(entry) && entry.length === 0))
      .filter(([, entry]) => !(entry && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length === 0))
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries);
  }
  return value;
}

/** Même contenu de notes, quel que soit l’ordre des clés ou la présence de listes vides. */
export function notesContentKey(notes: ClassNotesDocument | null | undefined): string {
  return JSON.stringify(canonicalNotes(notes ?? { version: 2, sessions: {} }));
}

const MAX_UNCONFIRMED_SNAPSHOTS = 50;

/** Serializes autosaves in one browser; the server revision also protects other tabs. */
export class NotebookAutosave {
  private revision: string | undefined;
  private generation = 0;
  private saveEpoch = 0;
  private pending = 0;
  private tail: Promise<unknown> = Promise.resolve();
  /** Contenus envoyés par cet onglet depuis la dernière révision confirmée. */
  private unconfirmed: string[] = [];

  reset(revision?: string): void {
    this.generation++;
    this.saveEpoch++;
    this.revision = revision;
    this.unconfirmed = [];
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
    this.unconfirmed = [];
  }

  /**
   * Relecture en arrière-plan : la version du serveur n’est reprise que si aucun envoi n’a eu lieu
   * pendant la lecture et si `apply` confirme, dans le même tour, que l’écran n’a rien de non enregistré.
   */
  adoptServerIfIdle(
    seenEpoch: number,
    revision: string | undefined,
    apply: () => boolean,
  ): "applied" | "unchanged" | "busy" {
    if (!revision || revision === this.revision) return "unchanged";
    if (this.saveEpoch !== seenEpoch || this.pending !== 0) return "busy";
    if (!apply()) return "busy";
    this.revision = revision;
    this.unconfirmed = [];
    return "applied";
  }

  private remember(snapshot: ClassNotesDocument) {
    const keys = new Set([notesContentKey(snapshot), notesContentKey(normalizeClassNotes(snapshot))]);
    for (const key of keys) {
      if (!this.unconfirmed.includes(key)) this.unconfirmed.push(key);
    }
    while (this.unconfirmed.length > MAX_UNCONFIRMED_SNAPSHOTS) this.unconfirmed.shift();
  }

  /**
   * Après un 409, la version du serveur n’est reprise que si elle est l’un des contenus
   * envoyés par cet onglet : l’écran en descend, le renvoyer n’efface le travail de personne.
   */
  private serverHoldsOwnSnapshot(notes: ClassNotesDocument | null): boolean {
    return this.unconfirmed.includes(notesContentKey(notes));
  }

  save(
    notes: ClassNotesDocument,
    send: (notes: ClassNotesDocument, revision?: string) => Promise<{ notes: ClassNotesDocument; revision: string }>,
    readServer?: () => Promise<{ notes: ClassNotesDocument | null; revision: string }>,
  ): Promise<ClassNotesDocument> {
    const generation = this.generation;
    const snapshot = structuredClone(notes);
    this.pending++;
    const next = this.tail.catch(() => undefined).then(async () => {
      try {
        if (generation !== this.generation) throw new Error("La session du Carnet a changé.");
        if (!this.revision) throw new Error("Rechargez le Carnet avant d'enregistrer les notes.");
        this.remember(snapshot);
        let saved: { notes: ClassNotesDocument; revision: string };
        try {
          saved = await send(snapshot, this.revision);
        } catch (error) {
          if (!(error instanceof NotesSaveConflictError) || !readServer) throw error;
          const server = await readServer();
          if (generation !== this.generation) throw new Error("La session du Carnet a changé.");
          if (!this.serverHoldsOwnSnapshot(server.notes)) throw error;
          this.revision = server.revision;
          this.unconfirmed = [];
          this.remember(snapshot);
          saved = await send(snapshot, this.revision);
        }
        if (generation !== this.generation) throw new Error("La session du Carnet a changé.");
        this.revision = saved.revision;
        this.unconfirmed = [];
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
