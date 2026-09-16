"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  QUICK_BLOCK_KINDS,
  QUICK_BLOCK_LABELS,
  RICH_HIGHLIGHT_HEX,
  RICH_TEXT_COLOR_HEX,
  RICH_TEXT_COLOR_IDS,
  RICH_TEXT_COLOR_LABELS,
  addStructuredListItem,
  applyStructureToDoc,
  emptyRichDoc,
  insertQuickBlock,
  parseInlinesFromHtml,
  removeStructuredListItem,
  sanitizeHref,
  sanitizeRichDoc,
  type CampusRichDoc,
  type QuickBlockKind,
  type RichBlock,
  type RichInline,
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

function inlinesToHtml(inlines: RichInline[]): string {
  if (!inlines.length) return "";
  return inlines
    .map((inline) => {
      let html = escapeHtml(inline.text);
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
        html = `<a href="${escapeHtml(marks.href)}" target="_blank" rel="noreferrer">${html}</a>`;
      }
      return html;
    })
    .join("");
}

function inlinesFromElement(root: HTMLElement): RichInline[] {
  return parseInlinesFromHtml(root.innerHTML);
}

function keepEditorFocus(event: { preventDefault: () => void }) {
  event.preventDefault();
}

function readDocFromDom(root: HTMLElement, fallback: CampusRichDoc): CampusRichDoc {
  const nextBlocks: RichBlock[] = fallback.blocks.length ? [...fallback.blocks] : [{ type: "paragraph", inlines: [] }];
  const editors = root.querySelectorAll<HTMLElement>("[data-inline-editor]");
  for (const editor of editors) {
    const index = Number(editor.dataset.blockIndex);
    const itemIndex = editor.dataset.itemIndex != null ? Number(editor.dataset.itemIndex) : null;
    const inlines = inlinesFromElement(editor);
    const current = nextBlocks[index];
    if (!current) continue;
    if (current.type === "bulletList" || current.type === "orderedList") {
      nextBlocks[index] = {
        ...current,
        items: current.items.map((item, currentIndex) => (currentIndex === itemIndex ? inlines : item)),
      };
    } else if (current.type === "checklist") {
      nextBlocks[index] = {
        ...current,
        items: current.items.map((item, currentIndex) =>
          currentIndex === itemIndex ? { ...item, inlines } : item,
        ),
      };
    } else {
      nextBlocks[index] = { ...current, inlines };
    }
  }
  return sanitizeRichDoc({ format: "campus-rich-v1", blocks: nextBlocks });
}

function rangeInside(root: HTMLElement, range: Range): boolean {
  return root.contains(range.commonAncestorContainer);
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
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRange = useRef<Range | null>(null);
  const skipExternal = useRef(false);

  useEffect(() => {
    if (skipExternal.current) {
      skipExternal.current = false;
      return;
    }
    setDoc(sanitizeRichDoc(value));
  }, [value]);

  useEffect(() => {
    function rememberSelection() {
      const root = editorRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!rangeInside(root, range)) return;
      savedRange.current = range.cloneRange();
    }
    document.addEventListener("selectionchange", rememberSelection);
    return () => document.removeEventListener("selectionchange", rememberSelection);
  }, []);

  const blocks = doc.blocks.length ? doc.blocks : [{ type: "paragraph" as const, inlines: [] }];
  const activeType = blocks[activeBlockIndex]?.type;

  function currentDoc(): CampusRichDoc {
    return editorRef.current
      ? readDocFromDom(editorRef.current, { format: "campus-rich-v1", blocks })
      : doc;
  }

  function emit(next: CampusRichDoc) {
    const clean = sanitizeRichDoc(next);
    skipExternal.current = true;
    setDoc(clean.blocks.length ? clean : emptyRichDoc());
    onChange(clean);
  }

  function serializeFromDom() {
    const root = editorRef.current;
    if (!root) return;
    emit(readDocFromDom(root, { format: "campus-rich-v1", blocks }));
  }

  function restoreSelection(): boolean {
    const root = editorRef.current;
    const range = savedRange.current;
    if (!root || !range || !rangeInside(root, range)) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    try {
      selection.addRange(range);
      return true;
    } catch {
      return false;
    }
  }

  function format(command: string, value?: string) {
    restoreSelection();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
    serializeFromDom();
  }

  function setColor(color: RichTextColorId) {
    restoreSelection();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, RICH_TEXT_COLOR_HEX[color]);
    serializeFromDom();
  }

  function applyStructure(type: RichStructureType) {
    emit(applyStructureToDoc(currentDoc(), activeBlockIndex, type));
  }

  function addQuick(kind: QuickBlockKind) {
    emit(insertQuickBlock(currentDoc(), kind));
  }

  function wrapLink() {
    const raw = window.prompt("Lien (https:// ou mailto:)", "https://");
    const href = sanitizeHref(raw);
    if (!href) return;
    restoreSelection();
    document.execCommand("createLink", false, href);
    serializeFromDom();
  }

  function mutateList(blockIndex: number, mutate: (block: RichBlock) => RichBlock) {
    const current = currentDoc();
    emit({
      format: "campus-rich-v1",
      blocks: current.blocks.map((block, index) => (index === blockIndex ? mutate(block) : block)),
    });
  }

  function addListItem(blockIndex: number, afterIndex?: number) {
    mutateList(blockIndex, (block) => addStructuredListItem(block, afterIndex));
  }

  function removeListItem(blockIndex: number, itemIndex: number) {
    mutateList(blockIndex, (block) => removeStructuredListItem(block, itemIndex));
  }

  function toggleCheck(blockIndex: number, itemIndex: number, checked: boolean) {
    const current = currentDoc();
    emit({
      format: "campus-rich-v1",
      blocks: current.blocks.map((block, index) =>
        index === blockIndex && block.type === "checklist"
          ? {
              ...block,
              items: block.items.map((item, currentIndex) =>
                currentIndex === itemIndex ? { ...item, checked } : item,
              ),
            }
          : block,
      ),
    });
  }

  const showExtended = variant === "publication";

  return (
    <div className={`rich-doc-editor is-${variant}`} ref={editorRef}>
      <div className="rich-doc-toolbar" role="toolbar" aria-label="Mise en forme">
        <div className="rich-doc-tool-group" role="group" aria-label="Caractère">
          <ToolButton label="Gras" onClick={() => format("bold")}>
            <strong>B</strong>
          </ToolButton>
          <ToolButton label="Italique" onClick={() => format("italic")}>
            <em>I</em>
          </ToolButton>
          {showExtended ? (
            <ToolButton label="Souligné" onClick={() => format("underline")}>
              <u>S</u>
            </ToolButton>
          ) : null}
          {showExtended ? (
            <div className="rich-doc-swatches" role="group" aria-label="Couleur du texte">
              {RICH_TEXT_COLOR_IDS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="rich-doc-swatch"
                  title={RICH_TEXT_COLOR_LABELS[color]}
                  aria-label={RICH_TEXT_COLOR_LABELS[color]}
                  data-color-swatch={color}
                  style={{ background: RICH_TEXT_COLOR_HEX[color] }}
                  onMouseDown={keepEditorFocus}
                  onClick={() => setColor(color)}
                />
              ))}
            </div>
          ) : null}
          {showExtended ? (
            <ToolButton
              label="Surligner la sélection"
              onClick={() => format("hiliteColor", RICH_HIGHLIGHT_HEX)}
            >
              <span className="rich-doc-highlight-mark">Abc</span>
            </ToolButton>
          ) : null}
        </div>

        <div className="rich-doc-tool-group" role="group" aria-label="Paragraphe">
          {showExtended ? (
            <ToolButton
              label="Titre"
              text="Titre"
              active={activeType === "heading"}
              onClick={() => applyStructure("heading")}
            />
          ) : null}
          <ToolButton
            label="Liste à puces"
            text="Puces"
            active={activeType === "bulletList"}
            onClick={() => applyStructure("bulletList")}
          />
          <ToolButton
            label="Liste numérotée"
            text="1. 2. 3."
            active={activeType === "orderedList"}
            onClick={() => applyStructure("orderedList")}
          />
          <ToolButton
            label="Liste à cocher"
            text="Cases"
            active={activeType === "checklist"}
            onClick={() => applyStructure("checklist")}
          />
          {showExtended ? (
            <ToolButton label="Insérer un lien" text="Lien" onClick={wrapLink} />
          ) : null}
        </div>
      </div>

      {showExtended ? (
        <div className="rich-doc-quick" role="group" aria-label="Blocs pédagogiques">
          <span>Blocs de la semaine</span>
          {QUICK_BLOCK_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`rich-doc-quick-chip is-${kind}`}
              onMouseDown={keepEditorFocus}
              onClick={() => addQuick(kind)}
            >
              {QUICK_BLOCK_LABELS[kind]}
            </button>
          ))}
        </div>
      ) : null}

      <div className="rich-doc-canvas">
        {blocks.map((block, index) => (
          <EditorBlock
            key={`${block.type}-${index}`}
            block={block}
            index={index}
            onFocusBlock={() => setActiveBlockIndex(index)}
            onBlur={serializeFromDom}
            onToggleCheck={(itemIndex, checked) => toggleCheck(index, itemIndex, checked)}
            onAddListItem={(afterIndex) => addListItem(index, afterIndex)}
            onRemoveListItem={(itemIndex) => removeListItem(index, itemIndex)}
          />
        ))}
      </div>
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
      onMouseDown={keepEditorFocus}
      onClick={onClick}
    >
      {children ?? text}
    </button>
  );
}

function EditorBlock({
  block,
  index,
  onFocusBlock,
  onBlur,
  onToggleCheck,
  onAddListItem,
  onRemoveListItem,
}: {
  block: RichBlock;
  index: number;
  onFocusBlock: () => void;
  onBlur: () => void;
  onToggleCheck: (itemIndex: number, checked: boolean) => void;
  onAddListItem: (afterIndex?: number) => void;
  onRemoveListItem: (itemIndex: number) => void;
}) {
  if (block.type === "bulletList" || block.type === "orderedList") {
    const List = block.type === "orderedList" ? "ol" : "ul";
    const canRemove = block.items.length > 1;
    return (
      <div className="rich-doc-list-wrap">
        <List className="rich-doc-edit-list">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex} className="rich-doc-list-item">
              <InlineEditor
                html={inlinesToHtml(item)}
                blockIndex={index}
                itemIndex={itemIndex}
                onFocus={onFocusBlock}
                onBlur={onBlur}
                onEnter={() => onAddListItem(itemIndex)}
              />
              {canRemove ? (
                <button
                  type="button"
                  className="rich-doc-list-remove"
                  aria-label="Supprimer l’élément"
                  onMouseDown={keepEditorFocus}
                  onClick={() => onRemoveListItem(itemIndex)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </List>
        <div className="rich-doc-list-actions">
          <button type="button" onClick={() => onAddListItem()}>
            Ajouter un élément
          </button>
        </div>
      </div>
    );
  }
  if (block.type === "checklist") {
    const canRemove = block.items.length > 1;
    return (
      <div className="rich-doc-list-wrap">
        <ul className="rich-doc-edit-check">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex} className="rich-doc-list-item">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(event) => onToggleCheck(itemIndex, event.target.checked)}
              />
              <InlineEditor
                html={inlinesToHtml(item.inlines)}
                blockIndex={index}
                itemIndex={itemIndex}
                onFocus={onFocusBlock}
                onBlur={onBlur}
                onEnter={() => onAddListItem(itemIndex)}
              />
              {canRemove ? (
                <button
                  type="button"
                  className="rich-doc-list-remove"
                  aria-label="Supprimer l’élément"
                  onMouseDown={keepEditorFocus}
                  onClick={() => onRemoveListItem(itemIndex)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="rich-doc-list-actions">
          <button type="button" onClick={() => onAddListItem()}>
            Ajouter un élément
          </button>
        </div>
      </div>
    );
  }
  if (block.type === "callout") {
    return (
      <aside className={`rich-doc-callout is-${block.kind}`}>
        <strong>{QUICK_BLOCK_LABELS[block.kind]}</strong>
        <InlineEditor
          html={inlinesToHtml(block.inlines)}
          blockIndex={index}
          onFocus={onFocusBlock}
          onBlur={onBlur}
        />
      </aside>
    );
  }
  return (
    <InlineEditor
      html={inlinesToHtml(block.inlines)}
      blockIndex={index}
      heading={block.type === "heading"}
      onFocus={onFocusBlock}
      onBlur={onBlur}
    />
  );
}

function InlineEditor({
  html,
  blockIndex,
  itemIndex,
  heading,
  onFocus,
  onBlur,
  onEnter,
}: {
  html: string;
  blockIndex: number;
  itemIndex?: number;
  heading?: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onEnter?: () => void;
}) {
  return (
    <div
      className={heading ? "rich-doc-heading-input" : "rich-doc-text-input"}
      role="textbox"
      aria-multiline="true"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      data-inline-editor=""
      data-block-index={blockIndex}
      data-item-index={itemIndex}
      dangerouslySetInnerHTML={{ __html: html }}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (!onEnter || event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        onEnter();
      }}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
      }}
    />
  );
}
