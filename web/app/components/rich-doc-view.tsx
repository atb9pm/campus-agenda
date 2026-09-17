import { Fragment, type DragEvent, type ReactNode } from "react";

import {
  QUICK_BLOCK_LABELS,
  RICH_HIGHLIGHT_HEX,
  RICH_TEXT_COLOR_HEX,
  isEmptyRichDoc,
  visibleRichDocLines,
  type CampusRichDoc,
  type RichDocLine,
  type RichInline,
} from "@campus/features/class-notebook";

const COMPACT_LINE_LIMIT = 6;

function InlineView({ inline }: { inline: RichInline }) {
  const marks = inline.marks;
  let node: ReactNode = inline.text;
  if (marks?.bold) node = <strong>{node}</strong>;
  if (marks?.italic) node = <em>{node}</em>;
  if (marks?.underline) node = <u>{node}</u>;
  if (marks?.highlight) {
    node = <mark style={{ background: RICH_HIGHLIGHT_HEX }}>{node}</mark>;
  }
  if (marks?.color) {
    node = <span style={{ color: RICH_TEXT_COLOR_HEX[marks.color] }}>{node}</span>;
  }
  if (marks?.href) {
    node = (
      <a href={marks.href} target="_blank" rel="noreferrer">
        {node}
      </a>
    );
  }
  return <>{node}</>;
}

function Inlines({ inlines }: { inlines: RichInline[] }) {
  if (!inlines.length) return null;
  return (
    <>
      {inlines.map((inline, index) => (
        <InlineView key={`${index}-${inline.text.slice(0, 12)}`} inline={inline} />
      ))}
    </>
  );
}

function SummaryLineBody({ line }: { line: RichDocLine }) {
  return (
    <>
      {line.kind === "callout" && line.calloutKind ? (
        <span className={`rich-doc-summary-tag is-${line.calloutKind}`}>
          {QUICK_BLOCK_LABELS[line.calloutKind]}
        </span>
      ) : null}
      {line.kind === "bulletList" ? <span className="rich-doc-summary-marker">•</span> : null}
      {line.kind === "orderedList" ? (
        <span className="rich-doc-summary-marker">{line.ordinal}.</span>
      ) : null}
      {line.kind === "checklist" ? (
        <span className="rich-doc-summary-marker">{line.checked ? "☑" : "☐"}</span>
      ) : null}
      <span className="rich-doc-summary-text">
        <Inlines inlines={line.inlines} />
      </span>
    </>
  );
}

export function lineViewKey(line: Pick<RichDocLine, "blockIndex" | "itemIndex">): string {
  return `${line.blockIndex}-${line.itemIndex ?? "x"}`;
}

function InsertSlot({
  at,
  active = false,
  interactive = false,
  emptyLabel,
  onInsert,
  onDragOver,
  onDrop,
}: {
  at: number;
  active?: boolean;
  interactive?: boolean;
  emptyLabel?: string;
  onInsert?: (at: number) => void;
  onDragOver?: (at: number, event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (at: number, event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`rich-doc-insert-slot${active ? " is-active" : ""}${interactive ? " is-interactive" : ""}${emptyLabel ? " is-empty" : ""}`}
      data-carnet-insert={String(at)}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? "Insérer à cet endroit" : undefined}
      onClick={
        interactive && onInsert
          ? (event) => {
              event.stopPropagation();
              onInsert(at);
            }
          : undefined
      }
      onKeyDown={
        interactive && onInsert
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onInsert(at);
            }
          : undefined
      }
      onDragOver={
        onDragOver
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              onDragOver(at, event);
            }
          : undefined
      }
      onDrop={
        onDrop
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              onDrop(at, event);
            }
          : undefined
      }
    >
      {emptyLabel ? <p className="rich-doc-empty">{emptyLabel}</p> : <span className="rich-doc-insert-slot-bar" />}
    </div>
  );
}

export function RichDocView({
  doc,
  compact = false,
  emptyLabel = "Aucun contenu",
  interactive = false,
  selectedLineKey,
  lineDraggable = false,
  showInsertSlots = false,
  activeInsertSlot,
  hiddenInsertSlots,
  onLineClick,
  onLineDragStart,
  onLineDragEnd,
  onInsertSlot,
  onInsertSlotDragOver,
  onInsertSlotDrop,
  onMoveLine,
}: {
  doc: CampusRichDoc;
  compact?: boolean;
  emptyLabel?: string;
  interactive?: boolean;
  selectedLineKey?: string;
  lineDraggable?: boolean;
  showInsertSlots?: boolean;
  activeInsertSlot?: number | null;
  hiddenInsertSlots?: ReadonlySet<number>;
  onLineClick?: (line: RichDocLine) => void;
  onLineDragStart?: (line: RichDocLine, event: DragEvent<HTMLDivElement>) => void;
  onLineDragEnd?: () => void;
  onInsertSlot?: (atLineIndex: number) => void;
  onInsertSlotDragOver?: (atLineIndex: number, event: DragEvent<HTMLDivElement>) => void;
  onInsertSlotDrop?: (atLineIndex: number, event: DragEvent<HTMLDivElement>) => void;
  onMoveLine?: (line: RichDocLine, direction: -1 | 1) => void;
}) {
  if (isEmptyRichDoc(doc)) {
    if (showInsertSlots) {
      return (
        <div className="rich-doc-summary">
          <InsertSlot
            at={0}
            active={activeInsertSlot === 0}
            interactive={Boolean(onInsertSlot)}
            emptyLabel={emptyLabel}
            onInsert={onInsertSlot}
            onDragOver={onInsertSlotDragOver}
            onDrop={onInsertSlotDrop}
          />
        </div>
      );
    }
    return <p className="rich-doc-empty">{emptyLabel}</p>;
  }

  if (compact) {
    const lines = visibleRichDocLines(doc);
    const shown = interactive ? lines : lines.slice(0, COMPACT_LINE_LIMIT);
    const hidden = lines.length - shown.length;

    const renderSlot = (at: number) => {
      if (!showInsertSlots || hiddenInsertSlots?.has(at)) return null;
      return (
        <InsertSlot
          at={at}
          active={activeInsertSlot === at}
          interactive={Boolean(onInsertSlot)}
          onInsert={onInsertSlot}
          onDragOver={onInsertSlotDragOver}
          onDrop={onInsertSlotDrop}
        />
      );
    };

    return (
      <div className="rich-doc-summary">
        {renderSlot(0)}
        {shown.map((line, index) => {
          const key = lineViewKey(line);
          const selected = selectedLineKey === key;
          return (
            <Fragment key={key}>
              <div
                className={`rich-doc-summary-line is-${line.kind}${interactive ? " is-interactive" : ""}${selected ? " is-selected" : ""}`}
                data-carnet-line={interactive ? "" : undefined}
                draggable={lineDraggable}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-pressed={interactive ? selected : undefined}
                onClick={
                  onLineClick
                    ? (event) => {
                        if ((event.target as HTMLElement).closest("a, .rich-doc-line-nudge")) return;
                        event.stopPropagation();
                        onLineClick(line);
                      }
                    : undefined
                }
                onKeyDown={
                  onLineClick
                    ? (event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        if ((event.target as HTMLElement).closest(".rich-doc-line-nudge")) return;
                        event.preventDefault();
                        onLineClick(line);
                      }
                    : undefined
                }
                onDragStart={
                  onLineDragStart
                    ? (event) => {
                        onLineDragStart(line, event);
                      }
                    : undefined
                }
                onDragEnd={onLineDragEnd}
              >
                <SummaryLineBody line={line} />
                {selected && onMoveLine ? (
                  <div className="rich-doc-line-nudge">
                    {index > 0 ? (
                      <button
                        type="button"
                        aria-label="Monter d’une ligne"
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveLine(line, -1);
                        }}
                      >
                        ↑
                      </button>
                    ) : null}
                    {index < shown.length - 1 ? (
                      <button
                        type="button"
                        aria-label="Descendre d’une ligne"
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveLine(line, 1);
                        }}
                      >
                        ↓
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {renderSlot(index + 1)}
            </Fragment>
          );
        })}
        {hidden > 0 ? (
          <p className="rich-doc-more">+ {hidden} ligne{hidden > 1 ? "s" : ""}</p>
        ) : null}
      </div>
    );
  }

  const blocks = doc.blocks;

  return (
    <div className="rich-doc-view">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <h4 key={index}>
              <Inlines inlines={block.inlines} />
            </h4>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={index}>
              <Inlines inlines={block.inlines} />
            </p>
          );
        }
        if (block.type === "bulletList") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inlines inlines={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "orderedList") {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inlines inlines={item} />
                </li>
              ))}
            </ol>
          );
        }
        if (block.type === "checklist") {
          return (
            <ul key={index} className="rich-doc-checklist">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <input type="checkbox" checked={item.checked} readOnly />
                  <span>
                    <Inlines inlines={item.inlines} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <aside key={index} className={`rich-doc-callout is-${block.kind}`}>
            <strong>{QUICK_BLOCK_LABELS[block.kind]}</strong>
            <p>
              <Inlines inlines={block.inlines} />
            </p>
          </aside>
        );
      })}
    </div>
  );
}
