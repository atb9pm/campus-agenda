"use client";

import { useEffect, useRef, useState } from "react";

import {
  QUICK_BLOCK_KINDS,
  QUICK_BLOCK_LABELS,
  RICH_HIGHLIGHT_HEX,
  RICH_TEXT_COLOR_HEX,
  RICH_TEXT_COLOR_IDS,
  addStructuredListItem,
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

function applyCommand(command: string, value?: string) {
  document.execCommand(command, false, value);
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
  const editorRef = useRef<HTMLDivElement | null>(null);
  const skipExternal = useRef(false);

  useEffect(() => {
    if (skipExternal.current) {
      skipExternal.current = false;
      return;
    }
    setDoc(sanitizeRichDoc(value));
  }, [value]);

  const blocks = doc.blocks.length ? doc.blocks : [{ type: "paragraph" as const, inlines: [] }];

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

  function format(command: string, value?: string) {
    applyCommand(command, value);
    serializeFromDom();
  }

  function addBlock(type: RichBlock["type"]) {
    const current = currentDoc();
    const base = current.blocks.length ? current.blocks : [];
    if (type === "bulletList" || type === "orderedList") {
      emit({ format: "campus-rich-v1", blocks: [...base, { type, items: [[]] }] });
      return;
    }
    if (type === "checklist") {
      emit({ format: "campus-rich-v1", blocks: [...base, { type: "checklist", items: [{ checked: false, inlines: [] }] }] });
      return;
    }
    if (type === "callout") return;
    emit({ format: "campus-rich-v1", blocks: [...base, { type, inlines: [] }] });
  }

  function addQuick(kind: QuickBlockKind) {
    emit(insertQuickBlock(currentDoc(), kind));
  }

  function wrapLink() {
    const raw = window.prompt("Lien (https:// ou mailto:)", "https://");
    const href = sanitizeHref(raw);
    if (!href) return;
    applyCommand("createLink", href);
    serializeFromDom();
  }

  function setColor(color: RichTextColorId) {
    applyCommand("foreColor", RICH_TEXT_COLOR_HEX[color]);
    const selection = window.getSelection();
    const el = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement;
    if (el instanceof HTMLElement) el.setAttribute("data-color", color);
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
        {showExtended ? (
          <button type="button" onClick={() => addBlock("heading")}>
            Titre
          </button>
        ) : null}
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("bold")}>
          <strong>B</strong>
        </button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("italic")}>
          <em>I</em>
        </button>
        {showExtended ? (
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("underline")}>
            <u>U</u>
          </button>
        ) : null}
        {showExtended ? (
          <label className="rich-doc-color">
            <span>Couleur</span>
            <select
              defaultValue=""
              onChange={(event) => {
                const selected = event.target.value;
                if ((RICH_TEXT_COLOR_IDS as readonly string[]).includes(selected)) {
                  setColor(selected as RichTextColorId);
                }
                event.target.value = "";
              }}
            >
              <option value="" disabled>
                Couleur
              </option>
              {RICH_TEXT_COLOR_IDS.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {showExtended ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format("hiliteColor", RICH_HIGHLIGHT_HEX)}
          >
            Surlignage
          </button>
        ) : null}
        <button type="button" onClick={() => addBlock("bulletList")}>
          Liste
        </button>
        <button type="button" onClick={() => addBlock("orderedList")}>
          1.
        </button>
        {showExtended ? (
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={wrapLink}>
            Lien
          </button>
        ) : null}
        <button type="button" onClick={() => addBlock("checklist")}>
          ☐
        </button>
      </div>

      {showExtended ? (
        <div className="rich-doc-quick">
          <span>Blocs rapides</span>
          {QUICK_BLOCK_KINDS.map((kind) => (
            <button key={kind} type="button" onClick={() => addQuick(kind)}>
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

function EditorBlock({
  block,
  index,
  onBlur,
  onToggleCheck,
  onAddListItem,
  onRemoveListItem,
}: {
  block: RichBlock;
  index: number;
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
                onBlur={onBlur}
                onEnter={() => onAddListItem(itemIndex)}
              />
              {canRemove ? (
                <button
                  type="button"
                  className="rich-doc-list-remove"
                  aria-label="Supprimer l’élément"
                  onMouseDown={(event) => event.preventDefault()}
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
                onBlur={onBlur}
                onEnter={() => onAddListItem(itemIndex)}
              />
              {canRemove ? (
                <button
                  type="button"
                  className="rich-doc-list-remove"
                  aria-label="Supprimer l’élément"
                  onMouseDown={(event) => event.preventDefault()}
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
        <InlineEditor html={inlinesToHtml(block.inlines)} blockIndex={index} onBlur={onBlur} />
      </aside>
    );
  }
  return (
    <InlineEditor
      html={inlinesToHtml(block.inlines)}
      blockIndex={index}
      heading={block.type === "heading"}
      onBlur={onBlur}
    />
  );
}

function InlineEditor({
  html,
  blockIndex,
  itemIndex,
  heading,
  onBlur,
  onEnter,
}: {
  html: string;
  blockIndex: number;
  itemIndex?: number;
  heading?: boolean;
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
