"use client";

import { useEffect, useRef, useState } from "react";

import {
  QUICK_BLOCK_KINDS,
  QUICK_BLOCK_LABELS,
  RICH_HIGHLIGHT_HEX,
  RICH_TEXT_COLOR_HEX,
  RICH_TEXT_COLOR_IDS,
  emptyRichDoc,
  insertQuickBlock,
  sanitizeHref,
  sanitizeRichDoc,
  type CampusRichDoc,
  type QuickBlockKind,
  type RichBlock,
  type RichInline,
  type RichMarks,
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

function readMarks(el: HTMLElement, inherited: RichMarks = {}): RichMarks {
  const marks = { ...inherited };
  const tag = el.tagName.toLowerCase();
  if (tag === "strong" || tag === "b") marks.bold = true;
  if (tag === "em" || tag === "i") marks.italic = true;
  if (tag === "u") marks.underline = true;
  if (tag === "mark") marks.highlight = true;
  if (tag === "a") {
    const href = sanitizeHref(el.getAttribute("href"));
    if (href) marks.href = href;
  }
  const color = el.getAttribute("data-color");
  if (color && (RICH_TEXT_COLOR_IDS as readonly string[]).includes(color)) {
    marks.color = color as RichTextColorId;
  }
  return marks;
}

function inlinesFromElement(root: HTMLElement): RichInline[] {
  const inlines: RichInline[] = [];

  function walk(node: Node, marks: RichMarks) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) inlines.push(Object.keys(marks).length ? { text, marks: { ...marks } } : { text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "iframe" || tag === "object" || tag === "embed" || tag === "style") {
      return;
    }
    const next = readMarks(el, marks);
    if (tag === "br") {
      inlines.push({ text: " " });
      return;
    }
    for (const child of el.childNodes) walk(child, next);
  }

  walk(root, {});
  return inlines;
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

  function addBlock(type: RichBlock["type"]) {
    serializeFromDom();
    const current = editorRef.current
      ? readDocFromDom(editorRef.current, { format: "campus-rich-v1", blocks })
      : doc;
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
    const current = editorRef.current
      ? readDocFromDom(editorRef.current, { format: "campus-rich-v1", blocks })
      : doc;
    emit(insertQuickBlock(current, kind));
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

  function toggleCheck(blockIndex: number, itemIndex: number, checked: boolean) {
    const current = blocks[blockIndex];
    if (current?.type !== "checklist") return;
    emit({
      format: "campus-rich-v1",
      blocks: blocks.map((block, index) =>
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
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand("bold")}>
          <strong>B</strong>
        </button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand("italic")}>
          <em>I</em>
        </button>
        {showExtended ? (
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand("underline")}>
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
            onClick={() => applyCommand("hiliteColor", RICH_HIGHLIGHT_HEX)}
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
}: {
  block: RichBlock;
  index: number;
  onBlur: () => void;
  onToggleCheck: (itemIndex: number, checked: boolean) => void;
}) {
  if (block.type === "bulletList" || block.type === "orderedList") {
    const List = block.type === "orderedList" ? "ol" : "ul";
    return (
      <List className="rich-doc-edit-list">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            <InlineEditor html={inlinesToHtml(item)} blockIndex={index} itemIndex={itemIndex} onBlur={onBlur} />
          </li>
        ))}
      </List>
    );
  }
  if (block.type === "checklist") {
    return (
      <ul className="rich-doc-edit-check">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            <input
              type="checkbox"
              checked={item.checked}
              onChange={(event) => onToggleCheck(itemIndex, event.target.checked)}
            />
            <InlineEditor html={inlinesToHtml(item.inlines)} blockIndex={index} itemIndex={itemIndex} onBlur={onBlur} />
          </li>
        ))}
      </ul>
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
}: {
  html: string;
  blockIndex: number;
  itemIndex?: number;
  heading?: boolean;
  onBlur: () => void;
}) {
  return (
    <div
      className={heading ? "rich-doc-heading-input" : "rich-doc-text-input"}
      contentEditable
      suppressContentEditableWarning
      data-inline-editor=""
      data-block-index={blockIndex}
      data-item-index={itemIndex}
      dangerouslySetInnerHTML={{ __html: html }}
      onBlur={onBlur}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
      }}
    />
  );
}
