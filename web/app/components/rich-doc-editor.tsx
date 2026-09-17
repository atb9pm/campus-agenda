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
  emptyRichDoc,
  inlinesPlainText,
  insertQuickBlock,
  insertTextAt,
  marksInRange,
  parseInlinesFromHtml,
  pastePlainText,
  removeLine,
  richDocLines,
  sanitizeHref,
  sanitizeRichDoc,
  setChecklistChecked,
  setLineInlines,
  splitInlinesAt,
  splitLine,
  type CampusRichDoc,
  type QuickBlockKind,
  type RichDocLine,
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

function inlinesToHtml(inlines: readonly RichInline[]): string {
  if (!inlines.length) return "";
  return inlines
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
}

function nodeCharLength(node: Node): number {
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
        offset += 1;
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
      offset += 1;
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
    else if (node.nodeName === "BR") atoms.push({ kind: "br", node: node as Element });
    else for (const child of node.childNodes) collect(child);
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
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [syncToken, setSyncToken] = useState(0);

  const docRef = useRef(doc);
  const lineRefs = useRef(new Map<string, HTMLElement>());
  const pendingCaret = useRef<RichLinePosition | null>(null);
  const localEdit = useRef(false);

  useEffect(() => {
    if (localEdit.current) {
      localEdit.current = false;
      return;
    }
    const clean = sanitizeRichDoc(value);
    docRef.current = clean;
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
    setSelection({
      blockIndex: caret.blockIndex,
      itemIndex: caret.itemIndex,
      start: caret.offset,
      end: caret.offset,
    });
  }, [syncToken]);

  const commit = useCallback(
    (next: CampusRichDoc, caret?: RichLinePosition, options?: { rewriteDom?: boolean }) => {
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

  function handleLineInput(line: RichDocLine, element: HTMLElement) {
    const inlines = parseInlinesFromHtml(element.innerHTML);
    const next = setLineInlines(docRef.current, line.blockIndex, line.itemIndex, inlines);
    const caret = readSelection(line, element);
    commit(next, undefined, { rewriteDom: false });
    if (caret) setSelection(caret);
  }

  /** Sélection courante, ou la ligne entière si rien n'est sélectionné. */
  function targetRange(): { selection: EditorSelection; inlines: RichInline[] } | null {
    const current = selection ?? (lines[0] ? { blockIndex: lines[0].blockIndex, itemIndex: lines[0].itemIndex, start: 0, end: 0 } : null);
    if (!current) return null;
    const line = lines.find(
      (entry) => entry.blockIndex === current.blockIndex && entry.itemIndex === current.itemIndex,
    );
    if (!line) return null;
    const element = lineRefs.current.get(lineKey(line.blockIndex, line.itemIndex));
    const inlines = element ? parseInlinesFromHtml(element.innerHTML) : line.inlines;
    const length = inlinesPlainText(inlines).length;
    const collapsed = current.start === current.end;
    return {
      selection: collapsed ? { ...current, start: 0, end: length } : current,
      inlines,
    };
  }

  function applyMark(mark: RichMarkName, value: boolean | RichTextColorId | string | undefined) {
    const target = targetRange();
    if (!target) return;
    const { selection: range, inlines } = target;
    const next = applyMarkToRange(inlines, range.start, range.end, mark, value);
    const nextDoc = setLineInlines(docRef.current, range.blockIndex, range.itemIndex, next);
    const clean = sanitizeRichDoc(nextDoc);
    localEdit.current = true;
    docRef.current = clean;
    setDoc(clean);
    setSyncToken((token) => token + 1);
    onChange(clean);
    requestAnimationFrame(() => {
      const element = lineRefs.current.get(lineKey(range.blockIndex, range.itemIndex));
      if (!element) return;
      element.focus({ preventScroll: true });
      setCharacterSelection(element, range.start, range.end);
      setSelection(range);
    });
  }

  const activeMarks: RichMarks = useMemo(() => {
    if (!selection) return {};
    const line = lines.find(
      (entry) => entry.blockIndex === selection.blockIndex && entry.itemIndex === selection.itemIndex,
    );
    if (!line) return {};
    const length = inlinesPlainText(line.inlines).length;
    const start = selection.start === selection.end ? 0 : selection.start;
    const end = selection.start === selection.end ? length : selection.end;
    return marksInRange(line.inlines, start, end);
  }, [lines, selection]);

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

  function confirmLink() {
    const href = sanitizeHref(linkDraft);
    setLinkDraft(null);
    if (!href) return;
    applyMark("href", href);
  }

  function handleKeyDown(line: RichDocLine, element: HTMLElement, event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      const current = readSelection(line, element);
      let inlines = parseInlinesFromHtml(element.innerHTML);
      const offset = current?.start ?? inlinesPlainText(inlines).length;
      if (current && current.end > current.start) {
        const [before] = splitInlinesAt(inlines, current.start);
        const [, after] = splitInlinesAt(inlines, current.end);
        inlines = [...before, ...after];
      }
      const next = insertTextAt(inlines, offset, "\n");
      commit(setLineInlines(docRef.current, line.blockIndex, line.itemIndex, next), {
        blockIndex: line.blockIndex,
        itemIndex: line.itemIndex,
        offset: offset + 1,
      });
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

  return (
    <div className={`rich-doc-editor is-${variant}`}>
      <div className="rich-doc-toolbar" role="toolbar" aria-label="Mise en forme">
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
            onClick={() => setLinkDraft(activeMarks.href ?? "https://")}
          />
          {activeMarks.href ? (
            <ToolButton label="Retirer le lien" text="Sans lien" onClick={() => applyMark("href", undefined)} />
          ) : null}
        </div>
      </div>

      {linkDraft != null ? (
        <div className="rich-doc-link-bar">
          <label>
            Adresse du lien
            <input
              type="url"
              ref={(element) => element?.focus()}
              value={linkDraft}
              placeholder="https://"
              onChange={(event) => setLinkDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmLink();
                }
                if (event.key === "Escape") setLinkDraft(null);
              }}
            />
          </label>
          <button type="button" className="workspace-action" onClick={confirmLink}>
            Appliquer
          </button>
          <button type="button" className="workspace-action secondary" onClick={() => setLinkDraft(null)}>
            Annuler
          </button>
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
                  onKeyUp={(event) => setSelection(readSelection(line, event.currentTarget))}
                  onMouseUp={(event) => {
                    snapCaretToClick(event.currentTarget, event.clientX, event.clientY);
                    setSelection(readSelection(line, event.currentTarget));
                  }}
                  onFocus={(event) => setSelection(readSelection(line, event.currentTarget))}
                  onKeyDown={(event) => handleKeyDown(line, event.currentTarget, event)}
                  onPaste={(event) => {
                    event.preventDefault();
                    const raw = event.clipboardData.getData("text/plain");
                    const current = readSelection(line, event.currentTarget);
                    let inlines = parseInlinesFromHtml(event.currentTarget.innerHTML);
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
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="rich-doc-hint">
        Entrée crée une ligne. Maj + Entrée va à la ligne dans le bloc. Sans sélection, un outil s’applique à toute la ligne.
      </p>
    </div>
  );
}

function ToolButton({
  label,
  text,
  active = false,
  onClick,
  children,
}: {
  label: string;
  text?: string;
  active?: boolean;
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
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children ?? text}
    </button>
  );
}
