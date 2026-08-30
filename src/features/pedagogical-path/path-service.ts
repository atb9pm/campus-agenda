import { randomUUID } from "node:crypto";

import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type {
  AnnualCourseNotesStore,
  PedagogicalPathStore,
} from "../../lib/persistence/pedagogical-path-types.ts";
import {
  addItem,
  addSession,
  createEmptyPath,
  deleteItem,
  deleteSession,
  insertSession,
  moveItem,
  moveSession,
  updateItem,
  updateSession,
  type PathMutationResult,
  type ReferencePedagogicalPath,
} from "./index.ts";

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export type PathServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; status?: number };

export async function ensurePathForContext(options: {
  contextId: string;
  catalog: SchoolCatalogStore;
  pathStore: PedagogicalPathStore;
}): Promise<PathServiceResult<ReferencePedagogicalPath>> {
  const contextId = options.contextId.trim();
  if (!contextId) return { ok: false, reason: "contextId obligatoire.", status: 400 };

  await options.catalog.ensureSeeded();
  const contexts = await options.catalog.listContexts();
  const context = contexts.find((entry) => entry.id === contextId);
  if (!context) {
    return { ok: false, reason: "CTX introuvable.", status: 404 };
  }

  const existing = await options.pathStore.getPathByContextId(contextId);
  if (existing) return { ok: true, value: existing };

  const created = createEmptyPath({
    id: newId("path"),
    contextId,
  });
  const saved = await options.pathStore.savePath(created);
  return { ok: true, value: saved };
}

async function loadPath(
  pathStore: PedagogicalPathStore,
  contextId: string,
): Promise<PathServiceResult<ReferencePedagogicalPath>> {
  const path = await pathStore.getPathByContextId(contextId);
  if (!path) return { ok: false, reason: "Parcours introuvable pour ce CTX.", status: 404 };
  return { ok: true, value: path };
}

async function persistMutation(
  pathStore: PedagogicalPathStore,
  mutation: PathMutationResult<ReferencePedagogicalPath>,
): Promise<PathServiceResult<ReferencePedagogicalPath>> {
  if (!mutation.ok) return { ok: false, reason: mutation.reason, status: 400 };
  const saved = await pathStore.savePath(mutation.value);
  return { ok: true, value: saved };
}

export async function mutatePath(options: {
  contextId: string;
  catalog: SchoolCatalogStore;
  pathStore: PedagogicalPathStore;
  action:
    | { type: "addSession"; label?: string | null }
    | { type: "insertSession"; atPosition: number; label?: string | null }
    | { type: "moveSession"; sessionId: string; position: number }
    | { type: "updateSession"; sessionId: string; label?: string | null }
    | { type: "deleteSession"; sessionId: string }
    | {
        type: "addItem";
        sessionId: string;
        itemType: string;
        title: string;
        detail?: string;
      }
    | {
        type: "updateItem";
        itemId: string;
        itemType?: string;
        title?: string;
        detail?: string;
      }
    | {
        type: "moveItem";
        itemId: string;
        targetSessionId: string;
        position: number;
      }
    | { type: "deleteItem"; itemId: string };
}): Promise<PathServiceResult<ReferencePedagogicalPath>> {
  const ensured = await ensurePathForContext({
    contextId: options.contextId,
    catalog: options.catalog,
    pathStore: options.pathStore,
  });
  if (!ensured.ok) return ensured;

  const path = ensured.value;
  const { action } = options;

  switch (action.type) {
    case "addSession":
      return persistMutation(
        options.pathStore,
        addSession(path, { id: newId("session"), label: action.label }),
      );
    case "insertSession":
      return persistMutation(
        options.pathStore,
        insertSession(path, {
          id: newId("session"),
          atPosition: action.atPosition,
          label: action.label,
        }),
      );
    case "moveSession":
      return persistMutation(
        options.pathStore,
        moveSession(path, action.sessionId, action.position),
      );
    case "updateSession":
      return persistMutation(
        options.pathStore,
        updateSession(path, action.sessionId, { label: action.label }),
      );
    case "deleteSession":
      return persistMutation(options.pathStore, deleteSession(path, action.sessionId));
    case "addItem":
      return persistMutation(
        options.pathStore,
        addItem(path, action.sessionId, {
          id: newId("item"),
          type: action.itemType,
          title: action.title,
          detail: action.detail,
        }),
      );
    case "updateItem":
      return persistMutation(
        options.pathStore,
        updateItem(path, action.itemId, {
          type: action.itemType,
          title: action.title,
          detail: action.detail,
        }),
      );
    case "moveItem":
      return persistMutation(
        options.pathStore,
        moveItem(path, action.itemId, {
          targetSessionId: action.targetSessionId,
          position: action.position,
        }),
      );
    case "deleteItem":
      return persistMutation(options.pathStore, deleteItem(path, action.itemId));
    default:
      return { ok: false, reason: "Action inconnue.", status: 400 };
  }
}

/** Préparation structurelle notes annuelles — utilisé par les tests / futurs flux. */
export async function createCourseNoteForClass(options: {
  notesStore: AnnualCourseNotesStore;
  schoolYearId: string;
  classId: string;
  contextId: string;
  referenceSessionId?: string | null;
  authorTeacherId: string;
  text: string;
}) {
  return options.notesStore.createNote(newId("note"), {
    schoolYearId: options.schoolYearId,
    classId: options.classId,
    contextId: options.contextId,
    referenceSessionId: options.referenceSessionId,
    authorTeacherId: options.authorTeacherId,
    text: options.text,
  });
}

export { loadPath };
