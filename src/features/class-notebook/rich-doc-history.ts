import { sanitizeRichDoc, type CampusRichDoc } from "./rich-doc.ts";

export const RICH_DOC_HISTORY_LIMIT = 50;
export const RICH_DOC_HISTORY_COALESCE_MS = 800;

export type RichDocHistoryCaret = {
  blockIndex: number;
  itemIndex: number | null;
  offset: number;
};

export type RichDocHistoryEntry = {
  doc: CampusRichDoc;
  caret: RichDocHistoryCaret | null;
};

export type RichDocHistoryKind = "typing" | "action";

export type RichDocHistory = {
  undo: RichDocHistoryEntry[];
  redo: RichDocHistoryEntry[];
  lastKind: RichDocHistoryKind | null;
  lastAt: number;
};

function snapshotEntry(entry: RichDocHistoryEntry): RichDocHistoryEntry {
  return {
    doc: sanitizeRichDoc(JSON.parse(JSON.stringify(entry.doc)) as unknown),
    caret: entry.caret ? { ...entry.caret } : null,
  };
}

export function emptyRichDocHistory(): RichDocHistory {
  return { undo: [], redo: [], lastKind: null, lastAt: 0 };
}

export function pushRichDocHistory(
  history: RichDocHistory,
  before: RichDocHistoryEntry,
  kind: RichDocHistoryKind,
  now = Date.now(),
): RichDocHistory {
  if (
    kind === "typing" &&
    history.lastKind === "typing" &&
    now - history.lastAt <= RICH_DOC_HISTORY_COALESCE_MS &&
    history.undo.length
  ) {
    return { ...history, lastAt: now, redo: [] };
  }
  const undo = [...history.undo, snapshotEntry(before)];
  while (undo.length > RICH_DOC_HISTORY_LIMIT) undo.shift();
  return { undo, redo: [], lastKind: kind, lastAt: now };
}

export function undoRichDocHistory(
  history: RichDocHistory,
  current: RichDocHistoryEntry,
): { history: RichDocHistory; entry: RichDocHistoryEntry } | null {
  if (!history.undo.length) return null;
  const undo = history.undo.slice(0, -1);
  const entry = history.undo[history.undo.length - 1]!;
  return {
    history: {
      undo,
      redo: [...history.redo, snapshotEntry(current)],
      lastKind: null,
      lastAt: 0,
    },
    entry,
  };
}

export function redoRichDocHistory(
  history: RichDocHistory,
  current: RichDocHistoryEntry,
): { history: RichDocHistory; entry: RichDocHistoryEntry } | null {
  if (!history.redo.length) return null;
  const redo = history.redo.slice(0, -1);
  const entry = history.redo[history.redo.length - 1]!;
  return {
    history: {
      undo: [...history.undo, snapshotEntry(current)],
      redo,
      lastKind: null,
      lastAt: 0,
    },
    entry,
  };
}
