"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  QUICK_BLOCK_KINDS,
  QUICK_BLOCK_LABELS,
  RICH_HIGHLIGHT_HEX,
  RICH_TEXT_COLOR_HEX,
  RICH_TEXT_COLOR_IDS,
  RICH_TEXT_COLOR_LABELS,
  applyMarkToRange,
  applyStructureToLine,
  copyLineAsClip,
  decodeRichClip,
  encodeRichClip,
  emptyRichDoc,
  emptyRichDocHistory,
  inlinesPlainText,
  insertQuickBlock,
  insertTextAt,
  lastRememberedRichClip,
  marksAtOffset,
  marksEqual,
  marksInRange,
  parseInlinesFromHtml,
  pastePlainText,
  pasteRichClip,
  pushRichDocHistory,
  redoRichDocHistory,
  rememberRichClip,
  removeLine,
  deleteLine,
  resolveLinkRange,
  richDocLines,
  sanitizeHref,
  sanitizeRichDoc,
  setChecklistChecked,
  setLineInlines,
  sliceInlines,
  splitInlinesAt,
  splitLine,
  undoRichDocHistory,
  withMark,
  type CampusRichDoc,
  type QuickBlockKind,
  type RichDocHistory,
  type RichDocHistoryEntry,
  type RichDocLine,
  type RichClip,
  type RichInline,
  type RichLinePosition,
  type RichMarkName,
  type RichMarks,
  type RichStructureType,
  type RichTextColorId,
} from "@campus/features/class-notebook";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isPaddingBr(node: Node): boolean {
  return node.nodeName === "BR" && node instanceof HTMLElement && node.dataset.padding === "1";
}

function inlinesToHtml(inlines: readonly RichInline[]): string {
  if (!inlines.length) return "";
  const html = inlines
    .map((inline) => {
      let html = escapeHtml(inline.text).replace(/\n/g, "<br>");
      const marks = inline.marks;
      if (!marks) return html;
      if (marks.bold) html = `<strong>${html}</strong>`;
      if (marks.italic) html = `<em>${html}</em>`;
      if (marks.underline) html = `<u>${html}</u>`;
      if (marks.highlight) html = `<mark style="background:${RICH_HIGHLIGHT_HEX}">${html}</mark>`;
      if (marks.color) {
        html = `<span data-color="${marks.color}" style="color:${RICH_TEXT_COLOR_HEX[marks.color]}">${html}</span>`;
      }
      if (marks.href) {
        html = `<a href="${escapeHtml(marks.href)}">${html}</a>`;
      }
      return html;
    })
    .join("");
  // Un <br> final est avalé par contentEditable : sans ce br de calage, Maj+Entrée
  // en fin de ligne n’affiche le saut qu’au deuxième appui.
  if (html.endsWith("<br>")) return `${html}<br data-padding="1">`;
  return html;
}

function nodeCharLength(node: Node): number {
  if (isPaddingBr(node)) return 0;
  if (node.nodeName === "BR") return 1;
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.length;
  let total = 0;
  for (const child of node.childNodes) total += nodeCharLength(child);
  return total;
}

function lineKey(blockIndex: number, itemIndex: number | null): string {
  return `${blockIndex}:${itemIndex ?? "-"}`;
}

function textNodesOf(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

/** Position d'un point DOM exprimée en nombre de caractères depuis le début de la ligne. */
function characterOffset(root: HTMLElement, container: Node, domOffset: number): number | null {
  if (container === root) {
    let total = 0;
    for (let index = 0; index < domOffset && index < root.childNodes.length; index += 1) {
      total += nodeCharLength(root.childNodes[index]!);
    }
    return total;
  }
  if (!root.contains(container)) return null;

  if (container.nodeType === Node.TEXT_NODE) {
    let offset = 0;
    let found = false;
    function walk(node: Node): boolean {
      if (node === container) {
        offset += domOffset;
        found = true;
        return true;
      }
      if (node.nodeName === "BR") {
        offset += isPaddingBr(node) ? 0 : 1;
        return false;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        offset += (node as Text).data.length;
        return false;
      }
      for (const child of node.childNodes) {
        if (walk(child)) return true;
      }
      return false;
    }
    walk(root);
    return found ? offset : null;
  }

  let offset = 0;
  function walk(node: Node): boolean {
    if (node === container) {
      for (let index = 0; index < domOffset && index < node.childNodes.length; index += 1) {
        offset += nodeCharLength(node.childNodes[index]!);
      }
      return true;
    }
    if (node.nodeName === "BR") {
      offset += isPaddingBr(node) ? 0 : 1;
      return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += (node as Text).data.length;
      return false;
    }
    for (const child of node.childNodes) {
      if (walk(child)) return true;
    }
    return false;
  }
  return walk(root) ? offset : null;
}

function caretPointAt(root: HTMLElement, target: number): { node: Node; offset: number } {
  let pos = 0;
  const atoms: Array<{ kind: "text"; node: Text } | { kind: "br"; node: Element }> = [];
  function collect(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) atoms.push({ kind: "text", node: node as Text });
    else if (node.nodeName === "BR" && !isPaddingBr(node)) atoms.push({ kind: "br", node: node as Element });
    else if (node.nodeName !== "BR") for (const child of node.childNodes) collect(child);
  }
  collect(root);
  if (!atoms.length) return { node: root, offset: 0 };

  for (const atom of atoms) {
    const length = atom.kind === "br" ? 1 : atom.node.data.length;
    if (target <= pos + length) {
      const local = target - pos;
      if (atom.kind === "text") {
        return { node: atom.node, offset: Math.max(0, Math.min(atom.node.data.length, local)) };
      }
      const parent = atom.node.parentNode ?? root;
      const index = Array.prototype.indexOf.call(parent.childNodes, atom.node);
      return { node: parent, offset: local <= 0 ? index : index + 1 };
    }
    pos += length;
  }

  const last = atoms[atoms.length - 1]!;
  if (last.kind === "text") return { node: last.node, offset: last.node.data.length };
  const parent = last.node.parentNode ?? root;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, last.node) + 1 };
}

function setCharacterSelection(root: HTMLElement, start: number, end: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const from = caretPointAt(root, Math.max(0, Math.min(start, end)));
  const to = caretPointAt(root, Math.max(start, end));
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Clic à droite du texte : placer le curseur après la dernière lettre, pas au début du premier nœud. */
function snapCaretToClick(root: HTMLElement, clientX: number, clientY: number): void {
  const nodes = textNodesOf(root).filter((node) => node.data.length > 0);
  const length = nodeCharLength(root);
  if (!length) {
    setCharacterSelection(root, 0, 0);
    return;
  }
  const last = nodes[nodes.length - 1];
  if (!last) {
    setCharacterSelection(root, length, length);
    return;
  }
  const probe = document.createRange();
  probe.setStart(last, Math.max(0, last.data.length - 1));
  probe.setEnd(last, last.data.length);
  const rect = probe.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    setCharacterSelection(root, length, length);
    return;
  }
  const afterLastLetter = clientX >= rect.right - 1 && clientY >= rect.top - 4 && clientY <= rect.bottom + 4;
  if (afterLastLetter) setCharacterSelection(root, length, length);
}

interface EditorSelection {
  blockIndex: number;
  itemIndex: number | null;
  start: number;
  end: number;
}

export function RichDocEditor({
  value,
  variant,
  onChange,
}: {
  value: CampusRichDoc;
  variant: "publication" | "notes";
  onChange: (doc: CampusRichDoc) => void;
}) {
  const [doc, setDoc] = useState<CampusRichDoc>(() => sanitizeRichDoc(value));
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [typingMarks, setTypingMarks] = useState<RichMarks>({});
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [syncToken, setSyncToken] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const docRef = useRef(doc);
  const lineRefs = useRef(new Map<string, HTMLElement>());
  const pendingCaret = useRef<RichLinePosition | null>(null);
  const localEdit = useRef(false);
  const historyRef = useRef<RichDocHistory>(emptyRichDocHistory());
  const selectionRef = useRef<EditorSelection | null>(null);
  const typingMarksRef = useRef<RichMarks>({});
  const pendingTyping = useRef(false);
  const softBreakLock = useRef(false);
  const pasteLock = useRef(false);
  const linkTargetRef = useRef<EditorSelection | null>(null);
  const copyCurrentRef = useRef<() => void>(() => undefined);
  const cutCurrentRef = useRef<() => void>(() => undefined);
  const pasteCurrentRef = useRef<(line?: RichDocLine, element?: HTMLElement) => void>(() => undefined);

  function setTypingMarksBoth(marks: RichMarks) {
    typingMarksRef.current = marks;
    setTypingMarks(marks);
  }

  function rememberSelection(next: EditorSelection | null) {
    selectionRef.current = next;
    setSelection(next);
  }

  function syncHistoryButtons() {
    setCanUndo(historyRef.current.undo.length > 0);
    setCanRedo(historyRef.current.redo.length > 0);
  }

  function currentHistoryEntry(): RichDocHistoryEntry {
    const current = selectionRef.current;
    return {
      doc: docRef.current,
      caret: current
        ? { blockIndex: current.blockIndex, itemIndex: current.itemIndex, offset: current.start }
        : null,
    };
  }

  useEffect(() => {
    if (localEdit.current) {
      localEdit.current = false;
      return;
    }
    const clean = sanitizeRichDoc(value);
    if (JSON.stringify(clean) === JSON.stringify(docRef.current)) return;
    docRef.current = clean;
    historyRef.current = emptyRichDocHistory();
    pendingTyping.current = false;
    setTypingMarksBoth({});
    rememberSelection(null);
    syncHistoryButtons();
    setDoc(clean);
    setSyncToken((token) => token + 1);
  }, [value]);

  const lines = useMemo(() => richDocLines(doc), [doc]);

  /** Le DOM n'est réécrit que sur syncToken (outil, Entrée, chargement), jamais pendant la frappe. */
  useEffect(() => {
    for (const line of richDocLines(docRef.current)) {
      const element = lineRefs.current.get(lineKey(line.blockIndex, line.itemIndex));
      if (!element) continue;
      const html = inlinesToHtml(line.inlines);
      if (element.innerHTML !== html) element.innerHTML = html;
    }
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (!caret) return;
    const element = lineRefs.current.get(lineKey(caret.blockIndex, caret.itemIndex));
    if (!element) return;
    element.focus({ preventScroll: true });
    setCharacterSelection(element, caret.offset, caret.offset);
    rememberSelection({
      blockIndex: caret.blockIndex,
      itemIndex: caret.itemIndex,
      start: caret.offset,
      end: caret.offset,
    });
  }, [syncToken]);

  useEffect(() => {
    function onDocKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea")) return;
      const inLine = target instanceof HTMLElement && target.closest("[data-inline-editor]");
      const key = event.key.toLowerCase();
      if (key === "c" && !inLine) {
        event.preventDefault();
        event.stopPropagation();
        copyCurrentRef.current();
        return;
      }
      if (key === "x" && !inLine) {
        event.preventDefault();
        event.stopPropagation();
        cutCurrentRef.current();
        return;
      }
      if (key === "v" && !inLine) {
        event.preventDefault();
        event.stopPropagation();
        pasteCurrentRef.current();
      }
    }
    document.addEventListener("keydown", onDocKey, true);
    return () => document.removeEventListener("keydown", onDocKey, true);
  }, []);

  const commit = useCallback(
    (
      next: CampusRichDoc,
      caret?: RichLinePosition,
      options?: { rewriteDom?: boolean; history?: "typing" | "action" | false },
    ) => {
      const historyKind = options?.history === undefined ? "action" : options.history;
      if (historyKind) {
        historyRef.current = pushRichDocHistory(historyRef.current, currentHistoryEntry(), historyKind);
        syncHistoryButtons();
      }
      const clean = sanitizeRichDoc(next);
      const result = clean.blocks.length ? clean : emptyRichDoc();
      localEdit.current = true;
      docRef.current = result;
      if (caret) pendingCaret.current = caret;
      setDoc(result);
      if (caret || options?.rewriteDom !== false) setSyncToken((token) => token + 1);
      onChange(result);
    },
    [onChange],
  );

  function registerLine(key: string, element: HTMLElement | null) {
    if (element) lineRefs.current.set(key, element);
    else lineRefs.current.delete(key);
  }

  function readSelection(line: RichDocLine, element: HTMLElement): EditorSelection | null {
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return null;
    const range = domSelection.getRangeAt(0);
    const start = characterOffset(element, range.startContainer, range.startOffset);
    const end = characterOffset(element, range.endContainer, range.endOffset);
    if (start == null || end == null) return null;
    return {
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
      start: Math.min(start, end),
      end: Math.max(start, end),
    };
  }

  function syncCaretFromLine(line: RichDocLine, element: HTMLElement) {
    const sel = readSelection(line, element);
    if (!sel) return;
    const previous = selectionRef.current;
    const moved =
      !previous ||
      previous.blockIndex !== sel.blockIndex ||
      previous.itemIndex !== sel.itemIndex ||
      previous.start !== sel.start ||
      previous.end !== sel.end;
    rememberSelection(sel);
    if (pendingTyping.current && !moved) return;
    pendingTyping.current = false;
    const inlines = parseInlinesFromHtml(element.innerHTML);
    const marks =
      sel.start === sel.end
        ? marksAtOffset(inlines, sel.start)
        : marksInRange(inlines, sel.start, sel.end);
    setTypingMarksBoth(marks);
  }

  function handleLineInput(line: RichDocLine, element: HTMLElement) {
    const inlines = parseInlinesFromHtml(element.innerHTML);
    const next = setLineInlines(docRef.current, line.blockIndex, line.itemIndex, inlines);
    const caret = readSelection(line, element);
    commit(next, undefined, { rewriteDom: false, history: "typing" });
    if (caret) rememberSelection(caret);
  }

  function liveTarget(): { selection: EditorSelection; inlines: RichInline[] } | null {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.hasAttribute("data-inline-editor")) {
      const blockIndex = Number(focused.dataset.blockIndex);
      const itemRaw = focused.dataset.itemIndex;
      const itemIndex = itemRaw === undefined || itemRaw === "" ? null : Number(itemRaw);
      const line = lines.find(
        (entry) => entry.blockIndex === blockIndex && entry.itemIndex === itemIndex,
      );
      if (line) {
        const sel = readSelection(line, focused);
        if (sel) return { selection: sel, inlines: parseInlinesFromHtml(focused.innerHTML) };
      }
    }
    const current = selectionRef.current;
    if (!current) return null;
    const line = lines.find(
      (entry) => entry.blockIndex === current.blockIndex && entry.itemIndex === current.itemIndex,
    );
    if (!line) return null;
    const element = lineRefs.current.get(lineKey(line.blockIndex, line.itemIndex));
    return {
      selection: current,
      inlines: element ? parseInlinesFromHtml(element.innerHTML) : line.inlines,
    };
  }

  function applyMark(mark: RichMarkName, value: boolean | RichTextColorId | string | undefined) {
    const target = liveTarget();
    if (!target) {
      pendingTyping.current = true;
      setTypingMarksBoth(withMark(typingMarksRef.current, mark, value) ?? {});
      return;
    }
    const { selection: range, inlines } = target;
    if (range.start === range.end) {
      pendingTyping.current = true;
      rememberSelection(range);
      setTypingMarksBoth(withMark(typingMarksRef.current, mark, value) ?? {});
      return;
    }
    pendingTyping.current = false;
    const next = applyMarkToRange(inlines, range.start, range.end, mark, value);
    commit(setLineInlines(docRef.current, range.blockIndex, range.itemIndex, next), undefined, {
      history: "action",
    });
    setTypingMarksBoth(marksInRange(next, range.start, range.end));
    requestAnimationFrame(() => {
      const element = lineRefs.current.get(lineKey(range.blockIndex, range.itemIndex));
      if (!element) return;
      element.focus({ preventScroll: true });
      setCharacterSelection(element, range.start, range.end);
      rememberSelection(range);
    });
  }

  const activeMarks: RichMarks = useMemo(() => {
    if (selection && selection.start !== selection.end) {
      const line = lines.find(
        (entry) => entry.blockIndex === selection.blockIndex && entry.itemIndex === selection.itemIndex,
      );
      if (!line) return typingMarks;
      return marksInRange(line.inlines, selection.start, selection.end);
    }
    return typingMarks;
  }, [lines, selection, typingMarks]);

  function restoreHistoryEntry(entry: RichDocHistoryEntry) {
    pendingTyping.current = false;
    const caret = entry.caret
      ? { blockIndex: entry.caret.blockIndex, itemIndex: entry.caret.itemIndex, offset: entry.caret.offset }
      : undefined;
    const line = caret
      ? richDocLines(entry.doc).find(
          (item) => item.blockIndex === caret.blockIndex && item.itemIndex === caret.itemIndex,
        )
      : undefined;
    setTypingMarksBoth(line ? marksAtOffset(line.inlines, caret?.offset ?? 0) : {});
    commit(entry.doc, caret, { history: false });
  }

  function undo() {
    const result = undoRichDocHistory(historyRef.current, currentHistoryEntry());
    if (!result) return;
    historyRef.current = result.history;
    syncHistoryButtons();
    restoreHistoryEntry(result.entry);
  }

  function redo() {
    const result = redoRichDocHistory(historyRef.current, currentHistoryEntry());
    if (!result) return;
    historyRef.current = result.history;
    syncHistoryButtons();
    restoreHistoryEntry(result.entry);
  }

  function fallbackSelection(): EditorSelection | null {
    if (selectionRef.current) return selectionRef.current;
    const line = richDocLines(docRef.current)[0];
    if (!line) return null;
    return { blockIndex: line.blockIndex, itemIndex: line.itemIndex, start: 0, end: 0 };
  }

  function buildClip(): RichClip | null {
    const target = liveTarget();
    const current = target?.selection ?? fallbackSelection();
    if (!current) return null;
    const inlines = target?.inlines ?? lineFromSelection(current)?.inlines;
    if (!inlines) return null;
    if (current.start !== current.end) {
      const sliced = sliceInlines(inlines, current.start, current.end);
      if (!sliced.length) return null;
      return { kind: "inlines", inlines: sliced };
    }
    const synced = setLineInlines(docRef.current, current.blockIndex, current.itemIndex, inlines);
    return copyLineAsClip(synced, current.blockIndex, current.itemIndex);
  }

  function lineFromSelection(current: EditorSelection) {
    return lines.find(
      (entry) => entry.blockIndex === current.blockIndex && entry.itemIndex === current.itemIndex,
    );
  }

  function storeClip(clip: RichClip) {
    rememberRichClip(clip);
    const encoded = encodeRichClip(clip);
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (clipboard?.writeText) void clipboard.writeText(encoded).catch(() => undefined);
  }

  function copyCurrent() {
    const clip = buildClip();
    if (!clip) return;
    storeClip(clip);
  }

  function cutCurrent() {
    const target = liveTarget();
    const current = target?.selection ?? fallbackSelection();
    const clip = buildClip();
    if (!clip || !current) return;
    storeClip(clip);
    if (current.start !== current.end) {
      const inlines = target?.inlines ?? lineFromSelection(current)?.inlines;
      if (!inlines) return;
      const [before] = splitInlinesAt(inlines, current.start);
      const [, after] = splitInlinesAt(inlines, current.end);
      commit(setLineInlines(docRef.current, current.blockIndex, current.itemIndex, [...before, ...after]), {
        blockIndex: current.blockIndex,
        itemIndex: current.itemIndex,
        offset: current.start,
      });
      return;
    }
    const result = deleteLine(docRef.current, current.blockIndex, current.itemIndex);
    if (result) commit(result.doc, result.caret);
  }

  function applyClip(
    clip: RichClip,
    line?: RichDocLine,
    element?: HTMLElement,
  ) {
    const current =
      element && line ? (readSelection(line, element) ?? fallbackSelection()) : fallbackSelection();
    if (!current) return;
    let base = docRef.current;
    let offset = current.start;
    if (element && line) {
      let inlines = parseInlinesFromHtml(element.innerHTML);
      if (current.end > current.start && clip.kind === "inlines") {
        const [before] = splitInlinesAt(inlines, current.start);
        const [, after] = splitInlinesAt(inlines, current.end);
        inlines = [...before, ...after];
        offset = current.start;
      }
      base = setLineInlines(base, current.blockIndex, current.itemIndex, inlines);
    }
    const result = pasteRichClip(base, current.blockIndex, current.itemIndex, offset, clip);
    if (result) commit(result.doc, result.caret);
  }

  function pastePlainIntoLine(line: RichDocLine, element: HTMLElement, raw: string) {
    const current = readSelection(line, element);
    let inlines = parseInlinesFromHtml(element.innerHTML);
    let offset = current?.start ?? inlinesPlainText(inlines).length;
    let base = setLineInlines(docRef.current, line.blockIndex, line.itemIndex, inlines);
    if (current && current.end > current.start) {
      const [before] = splitInlinesAt(inlines, current.start);
      const [, after] = splitInlinesAt(inlines, current.end);
      inlines = [...before, ...after];
      base = setLineInlines(docRef.current, line.blockIndex, line.itemIndex, inlines);
      offset = current.start;
    }
    const result = pastePlainText(base, line.blockIndex, line.itemIndex, offset, raw);
    commit(result.doc, result.caret);
  }

  function ingestPastedText(raw: string, line?: RichDocLine, element?: HTMLElement) {
    if (pasteLock.current) return;
    pasteLock.current = true;
    queueMicrotask(() => {
      pasteLock.current = false;
    });
    const clip = decodeRichClip(raw) ?? lastRememberedRichClip();
    if (clip) {
      applyClip(clip, line, element);
      return;
    }
    if (!raw || !line || !element) return;
    pastePlainIntoLine(line, element, raw);
  }

  function pasteCurrent(line?: RichDocLine, element?: HTMLElement) {
    const clip = lastRememberedRichClip();
    if (!clip) return;
    applyClip(clip, line, element);
  }

  useEffect(() => {
    copyCurrentRef.current = copyCurrent;
    cutCurrentRef.current = cutCurrent;
    pasteCurrentRef.current = pasteCurrent;
  });

  function handleHistoryKeys(event: React.KeyboardEvent) {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, textarea")) return false;
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return false;
    if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) redo();
      else undo();
      return true;
    }
    if (event.key.toLowerCase() === "y") {
      event.preventDefault();
      event.stopPropagation();
      redo();
      return true;
    }
    if (event.key.toLowerCase() === "c") {
      const inEditor =
        event.target instanceof HTMLElement && event.target.closest("[data-inline-editor]");
      if (inEditor) return false;
      event.preventDefault();
      event.stopPropagation();
      copyCurrent();
      return true;
    }
    if (event.key.toLowerCase() === "x") {
      const inEditor =
        event.target instanceof HTMLElement && event.target.closest("[data-inline-editor]");
      if (inEditor) return false;
      event.preventDefault();
      event.stopPropagation();
      cutCurrent();
      return true;
    }
    if (event.key.toLowerCase() === "v") {
      const inEditor =
        event.target instanceof HTMLElement && event.target.closest("[data-inline-editor]");
      if (inEditor) return false;
      event.preventDefault();
      event.stopPropagation();
      void pasteCurrent();
      return true;
    }
    return false;
  }

  const activeLine = selection
    ? lines.find((entry) => entry.blockIndex === selection.blockIndex && entry.itemIndex === selection.itemIndex)
    : undefined;
  const activeKind = activeLine?.kind ?? "paragraph";

  function applyStructure(type: RichStructureType) {
    const current = selection ?? { blockIndex: 0, itemIndex: lines[0]?.itemIndex ?? null, start: 0, end: 0 };
    const result = applyStructureToLine(docRef.current, current.blockIndex, current.itemIndex, type);
    commit(result.doc, result.caret);
  }

  function addQuickBlock(kind: QuickBlockKind) {
    const at = selection?.blockIndex ?? docRef.current.blocks.length - 1;
    const next = insertQuickBlock(docRef.current, kind, at);
    commit(next, { blockIndex: at + 1, itemIndex: null, offset: 0 });
  }

  function openLinkBar() {
    const target = liveTarget();
    linkTargetRef.current = target?.selection ?? selectionRef.current;
    setLinkError(null);
    setLinkDraft(activeMarks.href ?? "");
  }

  function applyHrefToFrozenTarget(href: string | undefined): boolean {
    const frozen = linkTargetRef.current ?? liveTarget()?.selection ?? selectionRef.current;
    const live = liveTarget();
    const inlines =
      live &&
      frozen &&
      live.selection.blockIndex === frozen.blockIndex &&
      live.selection.itemIndex === frozen.itemIndex
        ? live.inlines
        : frozen
          ? lineFromSelection(frozen)?.inlines
          : undefined;
    if (!frozen || !inlines) return false;
    const range = resolveLinkRange(inlinesPlainText(inlines), frozen.start, frozen.end);
    if (!range) return false;
    const next = applyMarkToRange(inlines, range.start, range.end, "href", href);
    commit(setLineInlines(docRef.current, frozen.blockIndex, frozen.itemIndex, next), undefined, {
      history: "action",
    });
    const applied = { ...frozen, start: range.start, end: range.end };
    linkTargetRef.current = applied;
    rememberSelection(applied);
    setTypingMarksBoth(marksInRange(next, range.start, range.end));
    requestAnimationFrame(() => {
      const element = lineRefs.current.get(lineKey(frozen.blockIndex, frozen.itemIndex));
      if (!element) return;
      element.focus({ preventScroll: true });
      setCharacterSelection(element, range.start, range.end);
      rememberSelection(applied);
    });
    return true;
  }

  function confirmLink() {
    const href = sanitizeHref(linkDraft);
    if (!href) {
      setLinkError("Adresse invalide. Exemple : campusagenda.ch");
      return;
    }
    if (!applyHrefToFrozenTarget(href)) {
      setLinkError("Sélectionne le texte à lier, ou place le curseur dans un mot.");
      return;
    }
    setLinkError(null);
    setLinkDraft(null);
  }

  function insertSoftBreak(line: RichDocLine, element: HTMLElement) {
    if (softBreakLock.current) return;
    softBreakLock.current = true;
    queueMicrotask(() => {
      softBreakLock.current = false;
    });
    const current = readSelection(line, element);
    let inlines = parseInlinesFromHtml(element.innerHTML);
    const offset = current?.start ?? inlinesPlainText(inlines).length;
    if (current && current.end > current.start) {
      const [before] = splitInlinesAt(inlines, current.start);
      const [, after] = splitInlinesAt(inlines, current.end);
      inlines = [...before, ...after];
    }
    const marks = pendingTyping.current ? typingMarksRef.current : undefined;
    const next = insertTextAt(inlines, offset, "\n", marks);
    commit(setLineInlines(docRef.current, line.blockIndex, line.itemIndex, next), {
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
      offset: offset + 1,
    });
  }

  function handleKeyDown(line: RichDocLine, element: HTMLElement, event: React.KeyboardEvent<HTMLDivElement>) {
    if (handleHistoryKeys(event)) return;
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      insertSoftBreak(line, element);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const current = readSelection(line, element);
      const inlines = parseInlinesFromHtml(element.innerHTML);
      const withText = setLineInlines(docRef.current, line.blockIndex, line.itemIndex, inlines);
      const result = splitLine(withText, line.blockIndex, line.itemIndex, current?.start ?? 0);
      commit(result.doc, result.caret);
      return;
    }
    if (event.key === "Backspace") {
      const current = readSelection(line, element);
      const empty = element.textContent?.length === 0;
      if (empty && current && current.start === 0 && current.end === 0) {
        const result = removeLine(docRef.current, line.blockIndex, line.itemIndex);
        if (result) {
          event.preventDefault();
          commit(result.doc, result.caret);
        }
      }
    }
  }

  function handleBeforeInput(line: RichDocLine, element: HTMLElement, event: React.FormEvent<HTMLDivElement>) {
    const native = event.nativeEvent;
    if (!(native instanceof InputEvent)) return;
    if (native.inputType === "insertLineBreak") {
      event.preventDefault();
      insertSoftBreak(line, element);
      return;
    }
    if (
      native.inputType === "insertFromPaste" ||
      native.inputType === "insertFromPasteAsQuotation" ||
      native.inputType === "insertFromDrop"
    ) {
      event.preventDefault();
      const raw = native.dataTransfer?.getData("text/plain") || native.data || "";
      ingestPastedText(raw, line, element);
      return;
    }
    if (native.inputType === "insertParagraph") {
      event.preventDefault();
      return;
    }
    if (native.inputType !== "insertText" || !native.data) return;
    const current = readSelection(line, element);
    const inlines = parseInlinesFromHtml(element.innerHTML);
    const offset = current?.start ?? inlinesPlainText(inlines).length;
    const around = marksAtOffset(inlines, offset);
    if (marksEqual(typingMarksRef.current, around)) return;
    event.preventDefault();
    let nextInlines = inlines;
    let at = offset;
    if (current && current.end > current.start) {
      const [before] = splitInlinesAt(inlines, current.start);
      const [, after] = splitInlinesAt(inlines, current.end);
      nextInlines = [...before, ...after];
      at = current.start;
    }
    const next = insertTextAt(nextInlines, at, native.data, typingMarksRef.current);
    pendingTyping.current = false;
    commit(
      setLineInlines(docRef.current, line.blockIndex, line.itemIndex, next),
      { blockIndex: line.blockIndex, itemIndex: line.itemIndex, offset: at + native.data.length },
      { history: "typing" },
    );
  }

  return (
    <div className={`rich-doc-editor is-${variant}`}>
      <div
        className="rich-doc-toolbar"
        role="toolbar"
        aria-label="Mise en forme"
        onKeyDown={(event) => handleHistoryKeys(event)}
      >
        <div className="rich-doc-tool-group" role="group" aria-label="Historique">
          <ToolButton label="Annuler (Ctrl+Z)" text="Annuler" disabled={!canUndo} onClick={undo} />
          <ToolButton label="Rétablir (Ctrl+Y)" text="Rétablir" disabled={!canRedo} onClick={redo} />
          <ToolButton label="Copier le bloc (Ctrl+C)" text="Copier" onClick={copyCurrent} />
          <ToolButton label="Couper le bloc (Ctrl+X)" text="Couper" onClick={cutCurrent} />
          <ToolButton label="Coller (Ctrl+V)" text="Coller" onClick={() => pasteCurrent()} />
        </div>
        <div className="rich-doc-tool-group" role="group" aria-label="Texte">
          <ToolButton label="Gras" active={Boolean(activeMarks.bold)} onClick={() => applyMark("bold", !activeMarks.bold)}>
            <strong>B</strong>
          </ToolButton>
          <ToolButton
            label="Italique"
            active={Boolean(activeMarks.italic)}
            onClick={() => applyMark("italic", !activeMarks.italic)}
          >
            <em>I</em>
          </ToolButton>
          <ToolButton
            label="Souligné"
            active={Boolean(activeMarks.underline)}
            onClick={() => applyMark("underline", !activeMarks.underline)}
          >
            <u>S</u>
          </ToolButton>
          <ToolButton
            label="Surligner"
            active={Boolean(activeMarks.highlight)}
            onClick={() => applyMark("highlight", !activeMarks.highlight)}
          >
            <span className="rich-doc-highlight-mark">Abc</span>
          </ToolButton>
        </div>

        <div className="rich-doc-tool-group" role="group" aria-label="Couleur du texte">
          {RICH_TEXT_COLOR_IDS.map((color) => (
            <button
              key={color}
              type="button"
              className={`rich-doc-swatch${activeMarks.color === color ? " is-active" : ""}`}
              title={RICH_TEXT_COLOR_LABELS[color]}
              aria-label={RICH_TEXT_COLOR_LABELS[color]}
              aria-pressed={activeMarks.color === color}
              data-color-swatch={color}
              style={{ background: RICH_TEXT_COLOR_HEX[color] }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyMark("color", activeMarks.color === color ? undefined : color)}
            />
          ))}
        </div>

        <div className="rich-doc-tool-group" role="group" aria-label="Ligne">
          <ToolButton
            label="Texte normal"
            text="Texte"
            active={activeKind === "paragraph"}
            onClick={() => applyStructure("paragraph")}
          />
          <ToolButton
            label="Titre"
            text="Titre"
            active={activeKind === "heading"}
            onClick={() => applyStructure("heading")}
          />
          <ToolButton
            label="Liste à puces"
            text="Puces"
            active={activeKind === "bulletList"}
            onClick={() => applyStructure("bulletList")}
          />
          <ToolButton
            label="Liste numérotée"
            text="1. 2. 3."
            active={activeKind === "orderedList"}
            onClick={() => applyStructure("orderedList")}
          />
          <ToolButton
            label="Liste à cocher"
            text="Cases"
            active={activeKind === "checklist"}
            onClick={() => applyStructure("checklist")}
          />
        </div>

        <div className="rich-doc-tool-group" role="group" aria-label="Lien">
          <ToolButton
            label="Insérer un lien"
            text="Lien"
            active={Boolean(activeMarks.href)}
            onClick={openLinkBar}
          />
          {activeMarks.href ? (
            <ToolButton
              label="Retirer le lien"
              text="Sans lien"
              onClick={() => {
                linkTargetRef.current = liveTarget()?.selection ?? selectionRef.current;
                if (!applyHrefToFrozenTarget(undefined)) applyMark("href", undefined);
              }}
            />
          ) : null}
        </div>
      </div>

      {linkDraft != null ? (
        <div className="rich-doc-link-bar">
          <label>
            Adresse du lien
            <input
              type="text"
              inputMode="url"
              autoComplete="url"
              autoFocus
              value={linkDraft}
              placeholder="campusagenda.ch"
              onChange={(event) => {
                setLinkDraft(event.target.value);
                if (linkError) setLinkError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmLink();
                }
                if (event.key === "Escape") {
                  setLinkDraft(null);
                  setLinkError(null);
                }
              }}
            />
          </label>
          <button
            type="button"
            className="workspace-action"
            onMouseDown={(event) => event.preventDefault()}
            onClick={confirmLink}
          >
            Appliquer
          </button>
          <button
            type="button"
            className="workspace-action secondary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setLinkDraft(null);
              setLinkError(null);
            }}
          >
            Annuler
          </button>
          {linkError ? <p className="rich-doc-link-error">{linkError}</p> : null}
        </div>
      ) : null}

      <div className="rich-doc-quick" role="group" aria-label="Blocs de la semaine">
        <span>Blocs de la semaine</span>
        {QUICK_BLOCK_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`rich-doc-quick-chip is-${kind}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => addQuickBlock(kind)}
          >
            {QUICK_BLOCK_LABELS[kind]}
          </button>
        ))}
      </div>

      <div className="rich-doc-canvas">
        {lines.map((line) => {
          const key = lineKey(line.blockIndex, line.itemIndex);
          return (
            <div
              key={key}
              className={`rich-doc-line is-${line.kind}`}
              data-line-kind={line.kind}
            >
              {line.kind === "callout" && line.calloutKind ? (
                <span className={`rich-doc-line-badge is-${line.calloutKind}`}>
                  {QUICK_BLOCK_LABELS[line.calloutKind]}
                </span>
              ) : null}
              <div className="rich-doc-line-body">
                {line.kind === "bulletList" ? <span className="rich-doc-line-marker" aria-hidden>•</span> : null}
                {line.kind === "orderedList" ? (
                  <span className="rich-doc-line-marker" aria-hidden>{line.ordinal}.</span>
                ) : null}
                {line.kind === "checklist" ? (
                  <input
                    type="checkbox"
                    className="rich-doc-line-check"
                    checked={Boolean(line.checked)}
                    aria-label="Élément fait"
                    onChange={(event) =>
                      commit(
                        setChecklistChecked(
                          docRef.current,
                          line.blockIndex,
                          line.itemIndex ?? 0,
                          event.target.checked,
                        ),
                      )
                    }
                  />
                ) : null}
                <div
                  className="rich-doc-line-input"
                  role="textbox"
                  aria-multiline="true"
                  tabIndex={0}
                  contentEditable
                  suppressContentEditableWarning
                  data-inline-editor=""
                  data-block-index={line.blockIndex}
                  data-item-index={line.itemIndex ?? undefined}
                  ref={(element) => registerLine(key, element)}
                  onInput={(event) => handleLineInput(line, event.currentTarget)}
                  onBeforeInput={(event) => handleBeforeInput(line, event.currentTarget, event)}
                  onKeyUp={(event) => syncCaretFromLine(line, event.currentTarget)}
                  onClick={(event) => {
                    const target = event.target;
                    if (target instanceof Element && target.closest("a")) event.preventDefault();
                  }}
                  onMouseUp={(event) => {
                    const dom = window.getSelection();
                    if (!dom || dom.isCollapsed) {
                      snapCaretToClick(event.currentTarget, event.clientX, event.clientY);
                    }
                    syncCaretFromLine(line, event.currentTarget);
                  }}
                  onFocus={(event) => syncCaretFromLine(line, event.currentTarget)}
                  onKeyDown={(event) => handleKeyDown(line, event.currentTarget, event)}
                  onCopy={(event) => {
                    const clip = buildClip();
                    if (!clip) return;
                    event.preventDefault();
                    storeClip(clip);
                    event.clipboardData.setData("text/plain", encodeRichClip(clip));
                  }}
                  onCut={(event) => {
                    const clip = buildClip();
                    if (!clip) return;
                    event.preventDefault();
                    event.clipboardData.setData("text/plain", encodeRichClip(clip));
                    cutCurrent();
                  }}
                  onPaste={(event) => {
                    event.preventDefault();
                    ingestPastedText(event.clipboardData.getData("text/plain"), line, event.currentTarget);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="rich-doc-hint">
        Entrée crée une ligne. Maj + Entrée va à la ligne dans le bloc. Ctrl+C copie, Ctrl+X coupe,
        Ctrl+V colle. Suppr efface la ligne en surbrillance dans la vue semaine. Souligné n’est pas un
        lien. Lien : sur la sélection, ou sur le mot sous le curseur. Ctrl+Z annule.
      </p>
    </div>
  );
}

function ToolButton({
  label,
  text,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  text?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "is-active" : undefined}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children ?? text}
    </button>
  );
}
