import { AGENDA_ITEM_TYPES } from "../../types/agenda.ts";
import type {
  PathMutationResult,
  ReferenceItemType,
  ReferencePedagogicalItem,
  ReferencePedagogicalPath,
  ReferenceSession,
} from "./types.ts";
import { REFERENCE_ITEM_TYPES } from "./types.ts";

function nowIso(): string {
  return new Date().toISOString();
}

export function isReferenceItemType(value: string): value is ReferenceItemType {
  return (REFERENCE_ITEM_TYPES as readonly string[]).includes(value);
}

/** Garde-fou : les types Agenda élèves restent strictement Devoir / Contrôle / Information. */
export function assertNoNoteAgendaType(): boolean {
  return !(AGENDA_ITEM_TYPES as readonly string[]).includes("NOTE");
}

function sortSessions(sessions: ReferenceSession[]): ReferenceSession[] {
  return [...sessions]
    .sort((a, b) => a.position - b.position)
    .map((session, index) => ({
      ...session,
      position: index + 1,
      items: [...session.items]
        .sort((a, b) => a.position - b.position)
        .map((item, itemIndex) => ({ ...item, position: itemIndex + 1 })),
    }));
}

/** Renumérote selon l'ordre actuel du tableau (après insert/move). */
function renumberSessions(sessions: ReferenceSession[]): ReferenceSession[] {
  return sessions.map((session, index) => ({
    ...session,
    position: index + 1,
    items: session.items.map((item, itemIndex) => ({
      ...item,
      position: itemIndex + 1,
    })),
  }));
}

function touch(path: ReferencePedagogicalPath): ReferencePedagogicalPath {
  return { ...path, sessions: renumberSessions(path.sessions), updatedAt: nowIso() };
}

export function createEmptyPath(input: {
  id: string;
  contextId: string;
  createdAt?: string;
}): ReferencePedagogicalPath {
  const createdAt = input.createdAt ?? nowIso();
  return {
    id: input.id,
    contextId: input.contextId,
    sessions: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function addSession(
  path: ReferencePedagogicalPath,
  input: { id: string; label?: string | null },
): PathMutationResult<ReferencePedagogicalPath> {
  const position = path.sessions.length + 1;
  const session: ReferenceSession = {
    id: input.id,
    position,
    label: input.label?.trim() || null,
    items: [],
  };
  return { ok: true, value: touch({ ...path, sessions: [...path.sessions, session] }) };
}

/**
 * Insère une séance à la position demandée (1-based).
 * Les séances suivantes sont décalées ; leurs IDs restent stables.
 */
export function insertSession(
  path: ReferencePedagogicalPath,
  input: { id: string; atPosition: number; label?: string | null },
): PathMutationResult<ReferencePedagogicalPath> {
  if (!Number.isInteger(input.atPosition) || input.atPosition < 1) {
    return { ok: false, reason: "Position de séance invalide." };
  }
  const at = Math.min(input.atPosition, path.sessions.length + 1);
  const ordered = sortSessions(path.sessions);
  const session: ReferenceSession = {
    id: input.id,
    position: at,
    label: input.label?.trim() || null,
    items: [],
  };
  const next = [...ordered.slice(0, at - 1), session, ...ordered.slice(at - 1)];
  return { ok: true, value: touch({ ...path, sessions: next }) };
}

export function moveSession(
  path: ReferencePedagogicalPath,
  sessionId: string,
  newPosition: number,
): PathMutationResult<ReferencePedagogicalPath> {
  if (!Number.isInteger(newPosition) || newPosition < 1) {
    return { ok: false, reason: "Position de séance invalide." };
  }
  const ordered = sortSessions(path.sessions);
  const index = ordered.findIndex((entry) => entry.id === sessionId);
  if (index < 0) return { ok: false, reason: "Séance introuvable." };
  const target = Math.min(newPosition, ordered.length);
  const [session] = ordered.splice(index, 1);
  ordered.splice(target - 1, 0, session!);
  return { ok: true, value: touch({ ...path, sessions: ordered }) };
}

export function updateSession(
  path: ReferencePedagogicalPath,
  sessionId: string,
  patch: { label?: string | null },
): PathMutationResult<ReferencePedagogicalPath> {
  const sessions = path.sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return {
      ...session,
      label: patch.label === undefined ? session.label : patch.label?.trim() || null,
    };
  });
  if (!sessions.some((session) => session.id === sessionId)) {
    return { ok: false, reason: "Séance introuvable." };
  }
  return { ok: true, value: touch({ ...path, sessions }) };
}

/** Supprime une séance uniquement si elle n'a aucun élément. */
export function deleteSession(
  path: ReferencePedagogicalPath,
  sessionId: string,
): PathMutationResult<ReferencePedagogicalPath> {
  const session = path.sessions.find((entry) => entry.id === sessionId);
  if (!session) return { ok: false, reason: "Séance introuvable." };
  if (session.items.length > 0) {
    return {
      ok: false,
      reason: "Séance non vide : retirez d'abord les éléments pédagogiques.",
    };
  }
  return {
    ok: true,
    value: touch({
      ...path,
      sessions: path.sessions.filter((entry) => entry.id !== sessionId),
    }),
  };
}

export function addItem(
  path: ReferencePedagogicalPath,
  sessionId: string,
  input: {
    id: string;
    type: string;
    title: string;
    detail?: string;
  },
): PathMutationResult<ReferencePedagogicalPath> {
  if (!isReferenceItemType(input.type)) {
    return {
      ok: false,
      reason: "Type non autorisé. Utilisez Devoir, Contrôle ou Information (pas Note).",
    };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, reason: "Le titre est obligatoire." };

  const sessions = path.sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const item: ReferencePedagogicalItem = {
      id: input.id,
      type: input.type,
      title,
      detail: (input.detail ?? "").trim(),
      position: session.items.length + 1,
    };
    return { ...session, items: [...session.items, item] };
  });
  if (!sessions.some((session) => session.id === sessionId)) {
    return { ok: false, reason: "Séance introuvable." };
  }
  return { ok: true, value: touch({ ...path, sessions }) };
}

export function updateItem(
  path: ReferencePedagogicalPath,
  itemId: string,
  patch: { type?: string; title?: string; detail?: string },
): PathMutationResult<ReferencePedagogicalPath> {
  let found = false;
  const sessions = path.sessions.map((session) => ({
    ...session,
    items: session.items.map((item) => {
      if (item.id !== itemId) return item;
      found = true;
      if (patch.type !== undefined && !isReferenceItemType(patch.type)) {
        return item;
      }
      const nextType =
        patch.type !== undefined && isReferenceItemType(patch.type) ? patch.type : item.type;
      const nextTitle = patch.title !== undefined ? patch.title.trim() : item.title;
      return {
        ...item,
        type: nextType,
        title: nextTitle || item.title,
        detail: patch.detail !== undefined ? patch.detail.trim() : item.detail,
      };
    }),
  }));

  if (!found) return { ok: false, reason: "Élément introuvable." };
  if (patch.type !== undefined && !isReferenceItemType(patch.type)) {
    return {
      ok: false,
      reason: "Type non autorisé. Utilisez Devoir, Contrôle ou Information (pas Note).",
    };
  }
  if (patch.title !== undefined && !patch.title.trim()) {
    return { ok: false, reason: "Le titre est obligatoire." };
  }
  return { ok: true, value: touch({ ...path, sessions }) };
}

export function moveItem(
  path: ReferencePedagogicalPath,
  itemId: string,
  input: { targetSessionId: string; position: number },
): PathMutationResult<ReferencePedagogicalPath> {
  if (!Number.isInteger(input.position) || input.position < 1) {
    return { ok: false, reason: "Position d'élément invalide." };
  }

  let moved: ReferencePedagogicalItem | null = null;
  const without = path.sessions.map((session) => {
    const remaining = session.items.filter((item) => {
      if (item.id !== itemId) return true;
      moved = { ...item };
      return false;
    });
    return { ...session, items: remaining };
  });

  if (!moved) return { ok: false, reason: "Élément introuvable." };

  const target = without.find((session) => session.id === input.targetSessionId);
  if (!target) return { ok: false, reason: "Séance cible introuvable." };

  const sessions = without.map((session) => {
    if (session.id !== input.targetSessionId) return session;
    const ordered = [...session.items].sort((a, b) => a.position - b.position);
    const at = Math.min(input.position, ordered.length + 1);
    ordered.splice(at - 1, 0, moved!);
    return { ...session, items: ordered };
  });

  return { ok: true, value: touch({ ...path, sessions }) };
}

export function deleteItem(
  path: ReferencePedagogicalPath,
  itemId: string,
): PathMutationResult<ReferencePedagogicalPath> {
  let found = false;
  const sessions = path.sessions.map((session) => {
    const items = session.items.filter((item) => {
      if (item.id !== itemId) return true;
      found = true;
      return false;
    });
    return { ...session, items };
  });
  if (!found) return { ok: false, reason: "Élément introuvable." };
  return { ok: true, value: touch({ ...path, sessions }) };
}

export function findSession(
  path: ReferencePedagogicalPath,
  sessionId: string,
): ReferenceSession | undefined {
  return path.sessions.find((session) => session.id === sessionId);
}

export function findItem(
  path: ReferencePedagogicalPath,
  itemId: string,
): { session: ReferenceSession; item: ReferencePedagogicalItem } | undefined {
  for (const session of path.sessions) {
    const item = session.items.find((entry) => entry.id === itemId);
    if (item) return { session, item };
  }
  return undefined;
}

export function listSessionIds(path: ReferencePedagogicalPath): string[] {
  return sortSessions(path.sessions).map((session) => session.id);
}
