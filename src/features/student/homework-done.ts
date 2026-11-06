import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";

/**
 * « Devoir fait » côté élève : mémorisé uniquement dans le navigateur (localStorage),
 * une entrée par publication. Rien n’est envoyé au serveur.
 */
export const STUDENT_HOMEWORK_DONE_STORAGE_PREFIX = "campus-agenda:student-done:v1:";
export const STUDENT_HOMEWORK_DONE_MAX_AGE_DAYS = 120;

export interface StudentHomeworkDoneEntry {
  /** Empreinte du contenu au moment de la coche : une modification du texte remet à « non fait ». */
  fp: string;
  at: number;
}

export type StudentHomeworkDoneStore = Record<string, StudentHomeworkDoneEntry>;

type DonePublication = Pick<PrototypeAgendaItem, "id" | "type" | "title" | "detail">;

export function studentHomeworkDoneStorageKey(classroomId: string): string {
  return `${STUDENT_HOMEWORK_DONE_STORAGE_PREFIX}${classroomId}`;
}

/** FNV-1a 32 bits — suffisant pour détecter une modification, pas une donnée sensible. */
export function publicationFingerprint(item: DonePublication): string {
  const source = `${item.type}\u0000${item.title}\u0000${item.detail}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseHomeworkDoneStore(raw: string | null | undefined): StudentHomeworkDoneStore {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const store: StudentHomeworkDoneStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const { fp, at } = value as Partial<StudentHomeworkDoneEntry>;
      if (typeof fp === "string" && typeof at === "number" && Number.isFinite(at)) store[key] = { fp, at };
    }
    return store;
  } catch {
    return {};
  }
}

export function isPublicationDone(store: StudentHomeworkDoneStore, item: DonePublication): boolean {
  const entry = store[String(item.id)];
  return Boolean(entry && entry.fp === publicationFingerprint(item));
}

export function toggleHomeworkDone(
  store: StudentHomeworkDoneStore,
  item: DonePublication,
  nowMs: number,
): StudentHomeworkDoneStore {
  const key = String(item.id);
  const next = { ...store };
  if (isPublicationDone(store, item)) {
    delete next[key];
  } else {
    next[key] = { fp: publicationFingerprint(item), at: nowMs };
  }
  return next;
}

/**
 * Retire les coches des publications modifiées et les plus anciennes. Une publication absente
 * (masquée puis republiée, ou supprimée) garde sa coche jusqu’à expiration. Une liste vide ne purge rien.
 */
export function pruneHomeworkDoneStore(
  store: StudentHomeworkDoneStore,
  items: readonly DonePublication[],
  nowMs: number,
  maxAgeDays = STUDENT_HOMEWORK_DONE_MAX_AGE_DAYS,
): StudentHomeworkDoneStore {
  if (!items.length) return store;
  const byId = new Map(items.map((item) => [String(item.id), item]));
  const maxAgeMs = maxAgeDays * 86_400_000;
  const next: StudentHomeworkDoneStore = {};
  for (const [key, entry] of Object.entries(store)) {
    const item = byId.get(key);
    if (item && entry.fp !== publicationFingerprint(item)) continue;
    if (nowMs - entry.at > maxAgeMs) continue;
    next[key] = entry;
  }
  return next;
}

export function sameHomeworkDoneStore(left: StudentHomeworkDoneStore, right: StudentHomeworkDoneStore): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => right[key]?.fp === left[key]!.fp && right[key]?.at === left[key]!.at);
}

export function readHomeworkDoneStore(
  storage: Pick<Storage, "getItem"> | null | undefined,
  classroomId: string,
): StudentHomeworkDoneStore {
  if (!storage) return {};
  try {
    return parseHomeworkDoneStore(storage.getItem(studentHomeworkDoneStorageKey(classroomId)));
  } catch {
    return {};
  }
}

/** Navigation privée ou stockage plein : la coche reste visible pour la session, sans erreur. */
export function writeHomeworkDoneStore(
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined,
  classroomId: string,
  store: StudentHomeworkDoneStore,
): void {
  if (!storage) return;
  try {
    const key = studentHomeworkDoneStorageKey(classroomId);
    if (Object.keys(store).length) storage.setItem(key, JSON.stringify(store));
    else storage.removeItem(key);
  } catch {
    // stockage indisponible
  }
}
