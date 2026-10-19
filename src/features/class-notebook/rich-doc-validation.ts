import { QUICK_BLOCK_KINDS, RICH_TEXT_COLOR_IDS, sanitizeHref, type CampusRichDoc } from "./rich-doc.ts";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
function inlines(value: unknown): boolean {
  return Array.isArray(value) && value.every(inline => {
    if (!record(inline) || !onlyKeys(inline, ["text", "marks"]) || typeof inline.text !== "string") return false;
    if (inline.marks === undefined) return true;
    const marks = inline.marks;
    if (!record(marks) || !onlyKeys(marks, ["bold", "italic", "underline", "color", "highlight", "href"])) return false;
    for (const name of ["bold", "italic", "underline", "highlight"]) {
      if (marks[name] !== undefined && typeof marks[name] !== "boolean") return false;
    }
    if (marks.color !== undefined && !(RICH_TEXT_COLOR_IDS as readonly unknown[]).includes(marks.color)) return false;
    return marks.href === undefined || (typeof marks.href === "string" && sanitizeHref(marks.href) === marks.href);
  });
}

/** Restore validates without sanitizing away content. Unknown formats/fields must fail closed. */
export function isValidStoredRichDoc(value: unknown): value is CampusRichDoc {
  if (!record(value) || !onlyKeys(value, ["format", "blocks"]) || value.format !== "campus-rich-v1" || !Array.isArray(value.blocks)) return false;
  return value.blocks.every(block => {
    if (!record(block)) return false;
    switch (block.type) {
      case "paragraph": case "heading":
        return onlyKeys(block, ["type", "inlines"]) && inlines(block.inlines);
      case "callout":
        return onlyKeys(block, ["type", "kind", "inlines"]) && (QUICK_BLOCK_KINDS as readonly unknown[]).includes(block.kind) && inlines(block.inlines);
      case "bulletList": case "orderedList":
        return onlyKeys(block, ["type", "items"]) && Array.isArray(block.items) && block.items.every(inlines);
      case "checklist":
        return onlyKeys(block, ["type", "items"]) && Array.isArray(block.items) && block.items.every(item =>
          record(item) && onlyKeys(item, ["checked", "inlines"]) && typeof item.checked === "boolean" && inlines(item.inlines));
      default: return false;
    }
  });
}
