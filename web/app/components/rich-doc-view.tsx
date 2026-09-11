import type { ReactNode } from "react";

import {
  QUICK_BLOCK_LABELS,
  RICH_HIGHLIGHT_HEX,
  RICH_TEXT_COLOR_HEX,
  isEmptyRichDoc,
  type CampusRichDoc,
  type RichInline,
} from "@campus/features/class-notebook";

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

export function RichDocView({
  doc,
  compact = false,
  emptyLabel = "Aucun contenu",
}: {
  doc: CampusRichDoc;
  compact?: boolean;
  emptyLabel?: string;
}) {
  if (isEmptyRichDoc(doc)) {
    return <p className="rich-doc-empty">{emptyLabel}</p>;
  }

  const blocks = compact ? doc.blocks.slice(0, 4) : doc.blocks;

  return (
    <div className={`rich-doc-view${compact ? " is-compact" : ""}`}>
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
      {compact && doc.blocks.length > 4 ? <p className="rich-doc-more">…</p> : null}
    </div>
  );
}
