import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CAMPUS_RICH_FORMAT,
  applyMarkToRange,
  applyStructureAtVisualLine,
  applyStructureToLine,
  copyLineAsClip,
  encodeRichDetail,
  decodeRichClip,
  decodeRichDetail,
  encodeRichClip,
  emptyRichDoc,
  emptyRichDocHistory,
  extractLine,
  extractWeekUnit,
  compactSummaryCards,
  listDisplayRows,
  adjacentWeekUnitInsertIndex,
  copyLineToDoc,
  copyWeekUnitToDoc,
  insertWeekUnitAt,
  moveWeekUnitWithinDoc,
  deleteLine,
  inlinesPlainText,
  insertBlockAt,
  insertQuickBlock,
  insertTextAt,
  lineIndexAfterMove,
  marksAtOffset,
  marksInRange,
  moveLineToDoc,
  moveLineWithinDoc,
  normalizeInlines,
  parseInlinesFromHtml,
  pastePlainText,
  pasteRichClip,
  lastRememberedRichClip,
  rememberRichClip,
  resolveClipboardPaste,
  resolveLinkRange,
  sanitizeHref,
  sliceInlines,
  pushRichDocHistory,
  redoRichDocHistory,
  removeLine,
  richDocLines,
  sanitizeRichDoc,
  setChecklistChecked,
  setLineInlines,
  splitInlinesAt,
  splitLine,
  continueListAtCaret,
  exitListAtCaret,
  undoRichDocHistory,
  visibleRichDocLines,
  wordRangeAtOffset,
  type CampusRichDoc,
} from "../src/features/class-notebook/index.ts";

function paragraphDoc(text: string): CampusRichDoc {
  return sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "paragraph", inlines: [{ text }] }],
  });
}

function lineText(doc: CampusRichDoc, blockIndex: number, itemIndex: number | null = null): string {
  const line = richDocLines(doc).find(
    (entry) => entry.blockIndex === blockIndex && entry.itemIndex === itemIndex,
  );
  return inlinesPlainText(line?.inlines ?? []);
}

test("version 2.56.0 — éditeur Carnet reconstruit sur le modèle, sans execCommand", async () => {
  const { APP_VERSION } = await import("../src/lib/app-version.ts");
  assert.equal(APP_VERSION, "2.62.0");
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(editor, /execCommand/);
  assert.doesNotMatch(editor, /window\.prompt/);
  assert.doesNotMatch(editor, /dangerouslySetInnerHTML/);
});

test("souligné — appliqué sur la sélection exacte, puis retiré", () => {
  const inlines = [{ text: "Réviser le circuit injection" }];

  const underlined = applyMarkToRange(inlines, 8, 15, "underline", true);
  assert.equal(inlinesPlainText(underlined), "Réviser le circuit injection");
  assert.equal(underlined.length, 3);
  assert.equal(underlined[0]?.text, "Réviser ");
  assert.equal(underlined[0]?.marks, undefined);
  assert.equal(underlined[1]?.text, "le circ");
  assert.equal(underlined[1]?.marks?.underline, true);
  assert.equal(underlined[2]?.marks, undefined);

  const removed = applyMarkToRange(underlined, 8, 15, "underline", false);
  assert.deepEqual(removed, [{ text: "Réviser le circuit injection" }]);
});

test("souligné — plusieurs passages successifs sans décalage ni perte de texte", () => {
  let inlines = [{ text: "abcdefghij" }];
  inlines = applyMarkToRange(inlines, 0, 3, "underline", true);
  inlines = applyMarkToRange(inlines, 6, 9, "underline", true);
  inlines = applyMarkToRange(inlines, 2, 7, "bold", true);
  assert.equal(inlinesPlainText(inlines), "abcdefghij");

  // Le caractère 2 garde le souligné et gagne le gras : aucune bascule involontaire.
  assert.deepEqual(marksInRange(inlines, 2, 3), { bold: true, underline: true });
  assert.deepEqual(marksInRange(inlines, 3, 6), { bold: true });
  assert.deepEqual(marksInRange(inlines, 9, 10), {});

  const cleared = applyMarkToRange(inlines, 0, 10, "underline", false);
  assert.equal(inlinesPlainText(cleared), "abcdefghij");
  assert.equal(marksInRange(cleared, 0, 10).underline, undefined);
});

test("couleur et surlignage — appliqués puis remplacés sur la même sélection", () => {
  let inlines = [{ text: "4.7.06-5 question 30" }];
  inlines = applyMarkToRange(inlines, 0, 8, "color", "blue");
  inlines = applyMarkToRange(inlines, 9, 20, "highlight", true);
  assert.equal(marksInRange(inlines, 0, 8).color, "blue");
  assert.equal(marksInRange(inlines, 9, 20).highlight, true);

  inlines = applyMarkToRange(inlines, 0, 8, "color", "red");
  assert.equal(marksInRange(inlines, 0, 8).color, "red");
  assert.equal(inlinesPlainText(inlines), "4.7.06-5 question 30");
});

test("lien — appliqué sur la sélection, retirable, jamais javascript:", () => {
  let inlines = [{ text: "Voir le dossier technique" }];
  inlines = applyMarkToRange(inlines, 5, 25, "href", "https://campusagenda.ch/doc");
  assert.equal(marksInRange(inlines, 5, 25).href, "https://campusagenda.ch/doc");
  assert.equal(marksInRange(inlines, 0, 4).href, undefined);

  const sansLien = applyMarkToRange(inlines, 5, 25, "href", undefined);
  assert.equal(marksInRange(sansLien, 5, 25).href, undefined);

  const dangerous = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "paragraph", inlines: applyMarkToRange(inlines, 0, 4, "href", "javascript:alert(1)") }],
  });
  assert.doesNotMatch(JSON.stringify(dangerous), /javascript:/);
});

test("normalisation — segments voisins fusionnés, segments vides supprimés", () => {
  const merged = normalizeInlines([
    { text: "a", marks: { bold: true } },
    { text: "b", marks: { bold: true } },
    { text: "" },
    { text: "c" },
  ]);
  assert.deepEqual(merged, [{ text: "ab", marks: { bold: true } }, { text: "c" }]);
});

test("titre — ne s’applique qu’à la ligne active, Entrée repasse en texte normal", () => {
  const doc = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "paragraph", inlines: [{ text: "Semaine 5" }] },
      { type: "paragraph", inlines: [{ text: "Exercices 12 à 18" }] },
    ],
  });

  const titled = applyStructureToLine(doc, 0, null, "heading");
  assert.equal(titled.doc.blocks[0]?.type, "heading");
  assert.equal(titled.doc.blocks[1]?.type, "paragraph");
  assert.equal(lineText(titled.doc, 1), "Exercices 12 à 18");

  // Entrée à la fin d’un titre ouvre un paragraphe : le titre ne contamine pas la suite.
  const afterEnter = splitLine(titled.doc, 0, null, "Semaine 5".length);
  assert.equal(afterEnter.doc.blocks[0]?.type, "heading");
  assert.equal(afterEnter.doc.blocks[1]?.type, "paragraph");
  assert.deepEqual(afterEnter.caret, { blockIndex: 1, itemIndex: null, offset: 0 });
});

test("titre — un second clic revient au texte normal", () => {
  const titled = applyStructureToLine(paragraphDoc("Moteur"), 0, null, "heading");
  const back = applyStructureToLine(titled.doc, 0, null, "heading");
  assert.equal(back.doc.blocks[0]?.type, "paragraph");
  assert.equal(lineText(back.doc, 0), "Moteur");
});

test("listes — une ligne par élément, Entrée ajoute, Retour arrière retire", () => {
  const bullets = applyStructureToLine(paragraphDoc("premier"), 0, null, "bulletList");
  assert.equal(bullets.doc.blocks[0]?.type, "bulletList");

  const second = splitLine(bullets.doc, 0, 0, "premier".length);
  assert.deepEqual(second.caret, { blockIndex: 0, itemIndex: 1, offset: 0 });
  const withText = setLineInlines(second.doc, 0, 1, [{ text: "deuxième" }]);
  const lines = richDocLines(withText);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => inlinesPlainText(line.inlines)), ["premier", "deuxième"]);
  assert.deepEqual(lines.map((line) => line.ordinal), [1, 2]);

  const emptied = setLineInlines(withText, 0, 1, []);
  const removed = removeLine(emptied, 0, 1);
  assert.ok(removed);
  assert.equal(richDocLines(removed!.doc).length, 1);
  assert.deepEqual(removed!.caret, { blockIndex: 0, itemIndex: 0, offset: "premier".length });
});

test("liste numérotée — conversion depuis des puces, numéros recalculés", () => {
  const bullets = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "bulletList", items: [[{ text: "un" }], [{ text: "deux" }], [{ text: "trois" }]] }],
  });
  const numbered = applyStructureToLine(bullets, 0, 1, "orderedList");
  assert.deepEqual(
    numbered.doc.blocks.map((block) => block.type),
    ["bulletList", "orderedList", "bulletList"],
  );
  assert.deepEqual(
    richDocLines(numbered.doc).map((line) => [line.kind, inlinesPlainText(line.inlines), line.ordinal ?? null]),
    [
      ["bulletList", "un", 1],
      ["orderedList", "deux", 1],
      ["bulletList", "trois", 1],
    ],
  );

  const thenTrois = applyStructureToLine(numbered.doc, 2, 0, "orderedList");
  const thenUn = applyStructureToLine(thenTrois.doc, 0, 0, "orderedList");
  assert.equal(thenUn.doc.blocks[0]?.type, "orderedList");
  assert.deepEqual(
    richDocLines(thenUn.doc).map((line) => [inlinesPlainText(line.inlines), line.ordinal]),
    [
      ["un", 1],
      ["deux", 2],
      ["trois", 3],
    ],
  );
});

test("liste — passer une seule ligne en titre n’écrase pas le reste de la liste", () => {
  const bullets = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "bulletList", items: [[{ text: "un" }], [{ text: "deux" }], [{ text: "trois" }]] }],
  });
  const extracted = applyStructureToLine(bullets, 0, 1, "heading");
  assert.deepEqual(
    extracted.doc.blocks.map((block) => block.type),
    ["bulletList", "heading", "bulletList"],
  );
  assert.equal(lineText(extracted.doc, 1), "deux");
  assert.equal(
    richDocLines(extracted.doc)
      .map((line) => inlinesPlainText(line.inlines))
      .join("|"),
    "un|deux|trois",
  );
});

test("cases à cocher — texte et état indépendants, cochage sans perte de mise en forme", () => {
  const checks = applyStructureToLine(paragraphDoc("Revoir exercice 7"), 0, null, "checklist");
  const colored = setLineInlines(
    checks.doc,
    0,
    0,
    applyMarkToRange([{ text: "Revoir exercice 7" }], 0, 6, "underline", true),
  );
  const ticked = setChecklistChecked(colored, 0, 0, true);
  const line = richDocLines(ticked)[0]!;
  assert.equal(line.kind, "checklist");
  assert.equal(line.checked, true);
  assert.equal(inlinesPlainText(line.inlines), "Revoir exercice 7");
  assert.equal(marksInRange(line.inlines, 0, 6).underline, true);
});

test("blocs de la semaine — insérés après la ligne active, pas en fin de document", () => {
  const doc = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "paragraph", inlines: [{ text: "intro" }] },
      { type: "paragraph", inlines: [{ text: "fin" }] },
    ],
  });
  const withBlock = insertQuickBlock(doc, "todo", 0);
  assert.deepEqual(
    withBlock.blocks.map((block) => block.type),
    ["paragraph", "callout", "paragraph"],
  );
  const callout = withBlock.blocks[1];
  assert.ok(callout && callout.type === "callout");
  if (callout && callout.type === "callout") assert.equal(callout.kind, "todo");
});

test("découpe des segments — la mise en forme suit chaque moitié", () => {
  const [before, after] = splitInlinesAt(
    [{ text: "gras", marks: { bold: true } }, { text: " simple" }],
    2,
  );
  assert.deepEqual(before, [{ text: "gr", marks: { bold: true } }]);
  assert.deepEqual(after, [{ text: "as", marks: { bold: true } }, { text: " simple" }]);
});

test("aller-retour — enregistrer puis recharger conserve toute la mise en forme", () => {
  let inlines = [{ text: "Réviser le circuit" }];
  inlines = applyMarkToRange(inlines, 0, 7, "underline", true);
  inlines = applyMarkToRange(inlines, 8, 18, "color", "blue");
  inlines = applyMarkToRange(inlines, 8, 18, "highlight", true);
  const doc = sanitizeRichDoc({ format: "campus-rich-v1", blocks: [{ type: "paragraph", inlines }] });

  const reloaded = decodeRichDetail(encodeRichDetail(doc));
  const block = reloaded?.blocks[0];
  assert.ok(block && block.type === "paragraph");
  if (block && block.type === "paragraph") {
    assert.equal(marksInRange(block.inlines, 0, 7).underline, true);
    assert.equal(marksInRange(block.inlines, 8, 18).color, "blue");
    assert.equal(marksInRange(block.inlines, 8, 18).highlight, true);
  }
});

test("document vide — aucune opération ne casse l’éditeur", () => {
  const empty = emptyRichDoc();
  assert.equal(richDocLines(empty).length, 1);
  assert.equal(applyMarkToRange([], 0, 0, "bold", true).length, 0);
  assert.equal(removeLine(empty, 0, null), null);
  const structured = applyStructureToLine(empty, 0, null, "bulletList");
  assert.equal(structured.doc.blocks[0]?.type, "bulletList");
});

test("vue compacte — résumé lisible, sans cases décalées ni cadres", async () => {
  const view = await readFile(new URL("../web/app/components/rich-doc-view.tsx", import.meta.url), "utf8");
  assert.match(view, /rich-doc-summary/);
  assert.match(view, /visibleRichDocLines/);
  assert.match(view, /compactSummaryCards/);
  assert.match(view, /is-list-block/);
  assert.match(view, /listDisplayRows/);
  assert.match(view, /COMPACT_LINE_LIMIT/);
  assert.match(view, /data-carnet-line/);
  assert.match(view, /is-interactive/);
  assert.doesNotMatch(view, /is-compact/);
  assert.doesNotMatch(view, /renderLineLeading/);

  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.rich-doc-summary-line/);
  assert.match(css, /\.rich-doc-line-marker/);
  assert.match(css, /\.is-selected/);
  assert.doesNotMatch(css, /class-notebook-line-handle/);
  assert.doesNotMatch(css, /rich-doc-view\.is-compact/);

  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /class-notebook-drag-handle/);
  assert.doesNotMatch(panel, /class-notebook-line-handle/);
  assert.doesNotMatch(panel, /data-line-handle/);
  assert.match(panel, /selectAndCopyLine/);
  assert.match(panel, /copyWeekUnitToDoc/);
  assert.match(panel, /onDragStart/);
  assert.match(panel, /moveWeekUnitToDoc/);
  assert.match(panel, /encodeCarnetMove/);
  assert.match(panel, /Supprimer/);
  assert.match(panel, /placeCopiedLine/);
  assert.match(panel, /nudgeSelectedLine/);
  assert.match(panel, /insertWeekUnitAt|moveWeekUnitWithinDoc/);
  assert.match(panel, /Insérer à cet endroit|showInsertSlots/);
  assert.match(view, /Monter d’une ligne/);
  assert.match(view, /Descendre d’une ligne/);
  assert.match(view, /rich-doc-insert-slot/);
  assert.match(css, /rich-doc-insert-slot/);
  assert.match(css, /rich-doc-line-nudge/);
  assert.match(panel, /class-notebook-move-menu/);
  assert.match(panel, /Déplacer vers/);
  assert.match(panel, /setData\("text\/plain"/);
  assert.match(panel, /dataTransfer\.getData\("text\/plain"\)/);
});

test("version 2.57.0 — curseur, menus notes, déplacement d’une ligne", async () => {
  const { APP_VERSION } = await import("../src/lib/app-version.ts");
  assert.equal(APP_VERSION, "2.62.0");
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  assert.match(editor, /Le DOM n'est réécrit que sur syncToken/);
  assert.match(editor, /snapCaretToClick/);
  assert.match(editor, /rewriteDom: false/);
  assert.doesNotMatch(editor, /showExtended/);
  assert.doesNotMatch(editor, /\[lines, syncToken\]/);
  assert.doesNotMatch(editor, /Blocs de la semaine/);
  assert.doesNotMatch(editor, /rich-doc-quick/);
  assert.doesNotMatch(editor, /addQuickBlock/);
  assert.doesNotMatch(editor, /insertQuickBlock/);
  assert.doesNotMatch(editor, /QUICK_BLOCK_KINDS/);
  assert.doesNotMatch(editor, /label="Titre"/);
  assert.match(editor, /Insérer un lien/);
  assert.match(editor, /event\.shiftKey/);
  assert.match(editor, /insertTextAt/);
  assert.match(editor, /Maj \+ Entrée ajoute un retour à la ligne/);
  assert.match(editor, /pastePlainText/);
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /selectAndCopyLine/);
  assert.match(panel, /Supprimer/);
});

test("extraire une puce ne déplace pas le reste de la liste", () => {
  const doc = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "bulletList", items: [[{ text: "alpha" }], [{ text: "beta" }], [{ text: "gamma" }]] },
    ],
  });
  const extracted = extractLine(doc, 0, 1);
  assert.ok(extracted);
  assert.equal(extracted!.extracted.type, "bulletList");
  if (extracted!.extracted.type === "bulletList") {
    assert.equal(extracted!.extracted.items.length, 1);
    assert.equal(inlinesPlainText(extracted!.extracted.items[0] ?? []), "beta");
  }
  const remaining = richDocLines(extracted!.remaining);
  assert.equal(remaining.length, 2);
  assert.equal(inlinesPlainText(remaining[0]!.inlines), "alpha");
  assert.equal(inlinesPlainText(remaining[1]!.inlines), "gamma");
});

test("déplacer une ligne vers un autre document — fusion des puces, dernière ligne vide", () => {
  const source = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "callout", kind: "todo", inlines: [{ text: "Devoir injection" }] },
      { type: "paragraph", inlines: [{ text: "Rester ici" }] },
    ],
  });
  const target = emptyRichDoc();
  const movedCallout = moveLineToDoc(source, target, 0, null);
  assert.ok(movedCallout);
  assert.equal(movedCallout!.source.blocks[0]?.type, "paragraph");
  assert.equal(movedCallout!.target.blocks[0]?.type, "callout");

  const listSource = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "bulletList", items: [[{ text: "nouvelle puce" }], [{ text: "reste" }]] }],
  });
  const listTarget = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "bulletList", items: [[{ text: "déjà là" }]] }],
  });
  const merged = moveLineToDoc(listSource, listTarget, 0, 0);
  assert.ok(merged);
  const bullets = merged!.target.blocks[0];
  assert.ok(bullets && bullets.type === "bulletList");
  if (bullets && bullets.type === "bulletList") {
    assert.equal(bullets.items.length, 2);
    assert.equal(inlinesPlainText(bullets.items[0] ?? []), "déjà là");
    assert.equal(inlinesPlainText(bullets.items[1] ?? []), "nouvelle puce");
  }
  assert.equal(inlinesPlainText(richDocLines(merged!.source)[0]?.inlines ?? []), "reste");

  const lastLine = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "paragraph", inlines: [{ text: "unique" }] }],
  });
  const emptied = moveLineToDoc(lastLine, emptyRichDoc(), 0, null);
  assert.ok(emptied);
  assert.equal(emptied!.source.blocks.length, 0);
  assert.equal(emptied!.target.blocks[0]?.type, "paragraph");
});

test("copier une ligne laisse la source intacte", () => {
  const source = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "paragraph", inlines: [{ text: "à copier" }] },
      { type: "paragraph", inlines: [{ text: "reste" }] },
    ],
  });
  const copied = copyLineToDoc(source, emptyRichDoc(), 0, null);
  assert.ok(copied);
  assert.equal(copied!.blocks[0]?.type, "paragraph");
  assert.equal(inlinesPlainText(richDocLines(copied!)[0]?.inlines ?? []), "à copier");
  assert.equal(source.blocks.length, 2);
  assert.equal(inlinesPlainText(richDocLines(source)[0]?.inlines ?? []), "à copier");
});

test("insérer un bloc au début, au milieu et à la fin", () => {
  const doc = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "paragraph", inlines: [{ text: "alpha" }] },
      { type: "paragraph", inlines: [{ text: "gamma" }] },
    ],
  });
  const atStart = insertBlockAt(doc, { type: "paragraph", inlines: [{ text: "début" }] }, 0);
  assert.deepEqual(
    visibleRichDocLines(atStart).map((line) => inlinesPlainText(line.inlines)),
    ["début", "alpha", "gamma"],
  );
  const atMiddle = insertBlockAt(doc, { type: "paragraph", inlines: [{ text: "beta" }] }, 1);
  assert.deepEqual(
    visibleRichDocLines(atMiddle).map((line) => inlinesPlainText(line.inlines)),
    ["alpha", "beta", "gamma"],
  );
  const atEnd = insertBlockAt(doc, { type: "paragraph", inlines: [{ text: "omega" }] }, 2);
  assert.deepEqual(
    visibleRichDocLines(atEnd).map((line) => inlinesPlainText(line.inlines)),
    ["alpha", "gamma", "omega"],
  );
});

test("insérer une puce au milieu d’une liste la fusionne ; un paragraphe la coupe", () => {
  const list = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "bulletList", items: [[{ text: "alpha" }], [{ text: "gamma" }]] }],
  });
  const merged = insertBlockAt(list, { type: "bulletList", items: [[{ text: "beta" }]] }, 1);
  const bullets = merged.blocks[0];
  assert.ok(bullets && bullets.type === "bulletList");
  if (bullets && bullets.type === "bulletList") {
    assert.equal(bullets.items.length, 3);
    assert.equal(inlinesPlainText(bullets.items[1] ?? []), "beta");
  }

  const split = insertBlockAt(list, { type: "paragraph", inlines: [{ text: "note" }] }, 1);
  assert.equal(split.blocks.length, 3);
  assert.equal(split.blocks[0]?.type, "bulletList");
  assert.equal(split.blocks[1]?.type, "paragraph");
  assert.equal(split.blocks[2]?.type, "bulletList");
  assert.equal(inlinesPlainText(visibleRichDocLines(split)[1]!.inlines), "note");
});

test("réordonner une ligne dans le même document, no-op à la même place", () => {
  const doc = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "paragraph", inlines: [{ text: "A" }] },
      { type: "paragraph", inlines: [{ text: "B" }] },
      { type: "paragraph", inlines: [{ text: "C" }] },
    ],
  });
  const unchanged = moveLineWithinDoc(doc, 1, null, 1);
  assert.equal(unchanged, doc);
  const alsoUnchanged = moveLineWithinDoc(doc, 1, null, 2);
  assert.equal(alsoUnchanged, doc);

  const toStart = moveLineWithinDoc(doc, 1, null, 0);
  assert.ok(toStart);
  assert.deepEqual(
    visibleRichDocLines(toStart!).map((line) => inlinesPlainText(line.inlines)),
    ["B", "A", "C"],
  );
  assert.equal(lineIndexAfterMove(1, 0), 0);

  const toEnd = moveLineWithinDoc(doc, 1, null, 3);
  assert.ok(toEnd);
  assert.deepEqual(
    visibleRichDocLines(toEnd!).map((line) => inlinesPlainText(line.inlines)),
    ["A", "C", "B"],
  );
  assert.equal(lineIndexAfterMove(1, 3), 2);
});

test("copier une ligne à un emplacement précis", () => {
  const source = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "paragraph", inlines: [{ text: "copie" }] }],
  });
  const target = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "paragraph", inlines: [{ text: "avant" }] },
      { type: "paragraph", inlines: [{ text: "après" }] },
    ],
  });
  const copied = copyLineToDoc(source, target, 0, null, 1);
  assert.ok(copied);
  assert.deepEqual(
    visibleRichDocLines(copied!).map((line) => inlinesPlainText(line.inlines)),
    ["avant", "copie", "après"],
  );
  assert.equal(source.blocks.length, 1);
});

test("version 2.58.0 — couleur sur la sélection, Annuler / Rétablir", async () => {
  const { APP_VERSION } = await import("../src/lib/app-version.ts");
  assert.equal(APP_VERSION, "2.62.0");
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(editor, /Annuler \(Ctrl\+Z\)/);
  assert.doesNotMatch(editor, /Rétablir \(Ctrl\+Y\)/);
  assert.match(editor, /pushRichDocHistory/);
  assert.match(editor, /onBeforeInput/);
  assert.match(editor, /liveTarget/);
  assert.doesNotMatch(editor, /Sans sélection, un outil s’applique à toute la ligne/);
  assert.doesNotMatch(editor, /collapsed \? \{ \.\.\.current, start: 0, end: length \}/);
  assert.match(editor, /data-padding/);
  assert.match(editor, /insertSoftBreak/);
  assert.doesNotMatch(editor, /Copier le bloc \(Ctrl\+C\)/);
  assert.doesNotMatch(editor, /Couper le bloc \(Ctrl\+X\)/);
  assert.doesNotMatch(editor, /text="Coller"/);
  assert.match(editor, /pasteRichClip/);
  assert.match(editor, /insertFromPaste/);
  assert.match(editor, /fallbackSelection/);
  assert.match(editor, /cutSelection/);
  assert.match(editor, /onCut/);
  assert.match(editor, /undoRichDocHistory/);
  assert.match(editor, /redoRichDocHistory/);
  assert.doesNotMatch(editor, /disabled=\{!canPaste\}/);
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /if \(editor\) return;/);
  assert.match(panel, /deleteCarnetLine/);
  assert.match(panel, /cutCarnetLine/);
  assert.match(panel, /key === "delete"/);
});

test("couleur — seulement la plage choisie, pas le début de la ligne", () => {
  const text = '4.7.06-5 "Principe", à terminer jusqu\'à la question N°30';
  const start = text.indexOf("à terminer");
  const inlines = applyMarkToRange([{ text }], start, text.length, "color", "red");
  assert.ok(start > 0);
  assert.equal(marksInRange(inlines, 0, start).color, undefined);
  assert.equal(marksInRange(inlines, start, text.length).color, "red");
  assert.equal(inlinesPlainText(inlines), text);
});

test("frappe suivante — insertTextAt applique les marques du curseur", () => {
  const around = [{ text: "Climatisation : " }];
  assert.deepEqual(marksAtOffset(around, 16), {});
  const typed = insertTextAt(around, 16, "alerte", { color: "red" });
  assert.equal(inlinesPlainText(typed), "Climatisation : alerte");
  assert.equal(marksInRange(typed, 0, 16).color, undefined);
  assert.equal(marksInRange(typed, 16, 22).color, "red");
});

test("historique — frappe regroupée, Ctrl+Z puis rétablir", () => {
  const empty = paragraphDoc("");
  const typed = paragraphDoc("abc");
  const colored = setLineInlines(
    typed,
    0,
    null,
    applyMarkToRange([{ text: "abc" }], 0, 3, "color", "red"),
  );
  let history = emptyRichDocHistory();
  history = pushRichDocHistory(history, { doc: empty, caret: { blockIndex: 0, itemIndex: null, offset: 0 } }, "typing", 1000);
  history = pushRichDocHistory(history, { doc: paragraphDoc("a"), caret: { blockIndex: 0, itemIndex: null, offset: 1 } }, "typing", 1100);
  history = pushRichDocHistory(history, { doc: paragraphDoc("ab"), caret: { blockIndex: 0, itemIndex: null, offset: 2 } }, "typing", 1200);
  assert.equal(history.undo.length, 1);

  history = pushRichDocHistory(history, { doc: typed, caret: { blockIndex: 0, itemIndex: null, offset: 3 } }, "action", 3000);
  const undone = undoRichDocHistory(history, { doc: colored, caret: { blockIndex: 0, itemIndex: null, offset: 3 } });
  assert.ok(undone);
  assert.equal(inlinesPlainText(richDocLines(undone!.entry.doc)[0]!.inlines), "abc");
  assert.equal(undone!.history.redo.length, 1);

  const redone = redoRichDocHistory(undone!.history, undone!.entry);
  assert.ok(redone);
  assert.equal(marksInRange(richDocLines(redone!.entry.doc)[0]!.inlines, 0, 3).color, "red");
});

test("Maj+Entrée — un <br> devient un saut de ligne dans le même bloc", () => {
  const parsed = parseInlinesFromHtml("Bonjour<br>tout le monde");
  assert.equal(inlinesPlainText(parsed), "Bonjour\ntout le monde");

  const inserted = insertTextAt([{ text: "Devoirinjection" }], 6, "\n");
  assert.equal(inlinesPlainText(inserted), "Devoir\ninjection");

  const atEnd = insertTextAt([{ text: "Fin" }], 3, "\n");
  assert.equal(inlinesPlainText(atEnd), "Fin\n");
  const withPadding = parseInlinesFromHtml('Fin<br><br data-padding="1">');
  assert.equal(inlinesPlainText(withPadding), "Fin\n");
  assert.equal(inlinesPlainText(parseInlinesFromHtml("Fin<br><br>")), "Fin\n\n");
});

test("coller — saut simple dans le bloc, ligne vide = nouveau bloc", () => {
  const doc = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "paragraph", inlines: [{ text: "AvantAprès" }] }],
  });
  const same = pastePlainText(doc, 0, null, 5, "milieu\nsuite");
  assert.equal(same.doc.blocks.length, 1);
  assert.equal(inlinesPlainText(richDocLines(same.doc)[0]!.inlines), "Avantmilieu\nsuiteAprès");

  const split = pastePlainText(doc, 0, null, 5, "un\n\ndeux");
  assert.equal(split.doc.blocks.length, 2);
  assert.equal(inlinesPlainText(richDocLines(split.doc)[0]!.inlines), "Avantun");
  assert.equal(inlinesPlainText(richDocLines(split.doc)[1]!.inlines), "deuxAprès");
});

test("copier-coller — bloc sous le curseur, sélection colorée, sans HTML étranger", () => {
  rememberRichClip(null);
  const source = paragraphDoc("Alpha");
  const clip = copyLineAsClip(source, 0, null);
  assert.equal(clip?.kind, "block");
  const encoded = encodeRichClip(clip!);
  assert.match(encoded, /^CAMPUS_RICH_CLIP_V1:/);
  assert.deepEqual(decodeRichClip(encoded)?.kind, "block");
  assert.equal(decodeRichClip("texte Word sans préfixe"), null);

  const target = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "paragraph", inlines: [{ text: "Alpha" }] },
      { type: "paragraph", inlines: [{ text: "Beta" }] },
    ],
  });
  const pasted = pasteRichClip(target, 0, null, 5, clip!);
  assert.ok(pasted);
  const texts = richDocLines(pasted!.doc).map((line) => inlinesPlainText(line.inlines));
  assert.deepEqual(texts, ["Alpha", "Alpha", "Beta"]);

  const colored = applyMarkToRange([{ text: "Alpha" }], 0, 5, "color", "red");
  const sliced = sliceInlines(colored, 0, 5);
  const into = pasteRichClip(paragraphDoc("X"), 0, null, 1, { kind: "inlines", inlines: sliced });
  assert.ok(into);
  const line = richDocLines(into!.doc)[0]!.inlines;
  assert.equal(inlinesPlainText(line), "XAlpha");
  assert.equal(marksInRange(line, 1, 6).color, "red");
  assert.equal(marksInRange(line, 0, 1).color, undefined);

  const same = copyLineToDoc(source, source, 0, null, 1);
  assert.ok(same);
  assert.deepEqual(
    visibleRichDocLines(same!).map((entry) => inlinesPlainText(entry.inlines)),
    ["Alpha", "Alpha"],
  );
});

test("couper / supprimer — retire n’importe quelle ligne, y compris la première", () => {
  const two = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "paragraph", inlines: [{ text: "Premier" }] },
      { type: "paragraph", inlines: [{ text: "Second" }] },
    ],
  });
  const deletedFirst = deleteLine(two, 0, null);
  assert.ok(deletedFirst);
  assert.deepEqual(
    visibleRichDocLines(deletedFirst!.doc).map((line) => inlinesPlainText(line.inlines)),
    ["Second"],
  );

  const deletedLast = deleteLine(two, 1, null);
  assert.ok(deletedLast);
  assert.deepEqual(
    visibleRichDocLines(deletedLast!.doc).map((line) => inlinesPlainText(line.inlines)),
    ["Premier"],
  );

  const only = paragraphDoc("Seul");
  const emptied = deleteLine(only, 0, null);
  assert.ok(emptied);
  assert.equal(visibleRichDocLines(emptied!.doc).length, 0);
  assert.equal(inlinesPlainText(richDocLines(emptied!.doc)[0]!.inlines), "");
});

test("version 2.59.1 — souligné ≠ lien, Lien visible sur le mot", async () => {
  const { APP_VERSION } = await import("../src/lib/app-version.ts");
  assert.equal(APP_VERSION, "2.62.0");
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  const view = await readFile(new URL("../web/app/components/rich-doc-view.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(editor, /linkTargetRef/);
  assert.match(editor, /applyHrefToFrozenTarget/);
  assert.match(editor, /resolveLinkRange/);
  assert.match(editor, /openLinkBar/);
  assert.match(editor, /Le lien peut être appliqué au texte sélectionné ou au mot sous le curseur/);
  assert.doesNotMatch(editor, /Souligné n’est pas un lien/);
  assert.match(editor, /Adresse invalide/);
  assert.doesNotMatch(editor, /type="url"/);
  assert.doesNotMatch(editor, /autoFocus/);
  assert.doesNotMatch(editor, /element\?\.focus\(\)/);
  assert.match(view, /navigateLinks/);
  assert.match(view, /rich-doc-hyperlink/);
  assert.match(view, /<span className="rich-doc-hyperlink"/);
  assert.match(css, /rich-doc-hyperlink/);
  assert.match(css, /rich-doc-link-error/);
  assert.match(css, /\.rich-doc-line-input u/);
});

test("souligné HTML n’est jamais un href", () => {
  const parsed = parseInlinesFromHtml("<u>sadfad</u>");
  assert.equal(parsed[0]?.text, "sadfad");
  assert.equal(parsed[0]?.marks?.underline, true);
  assert.equal(parsed[0]?.marks?.href, undefined);

  const linked = parseInlinesFromHtml('<a href="https://campusagenda.ch">dossier</a>');
  assert.equal(linked[0]?.marks?.href, "https://campusagenda.ch");
  assert.equal(linked[0]?.marks?.underline, undefined);
});

test("Lien — adresse normalisée, plage au mot si curseur seul", () => {
  assert.equal(sanitizeHref("https://"), undefined);
  assert.equal(sanitizeHref("https:// ddsfafafs.ch"), "https://ddsfafafs.ch");
  assert.equal(sanitizeHref("ddsfafafs.ch"), "https://ddsfafafs.ch");
  assert.equal(wordRangeAtOffset("asdfasdf", 3)?.start, 0);
  assert.equal(wordRangeAtOffset("asdfasdf", 3)?.end, 8);
  assert.deepEqual(resolveLinkRange("asdfasdf", 3, 3), { start: 0, end: 8 });
  assert.deepEqual(resolveLinkRange("voir le dossier ici", 8, 15), { start: 8, end: 15 });

  const inlines = [{ text: "asdfasdf" }];
  const range = resolveLinkRange(inlinesPlainText(inlines), 4, 4);
  assert.ok(range);
  const linked = applyMarkToRange(inlines, range.start, range.end, "href", "https://ddsfafafs.ch");
  assert.equal(marksInRange(linked, 0, 8).href, "https://ddsfafafs.ch");
  assert.equal(marksInRange(linked, 0, 8).underline, undefined);

  const underlined = applyMarkToRange(inlines, 0, 8, "underline", true);
  assert.equal(marksInRange(underlined, 0, 8).underline, true);
  assert.equal(marksInRange(underlined, 0, 8).href, undefined);
});

test("version 2.60.0 — cartes sans trait, barres d’insertion au survol", async () => {
  const { APP_VERSION } = await import("../src/lib/app-version.ts");
  assert.equal(APP_VERSION, "2.62.0");
  const view = await readFile(new URL("../web/app/components/rich-doc-view.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(view, /insertSlotsDragging/);
  assert.match(view, /is-insert-dragging/);
  assert.match(view, /is-dragging/);
  assert.match(css, /class-notebook-zone-publication \{[^}]*background: #eef4fb/);
  assert.match(css, /\.rich-doc-summary-line\.is-interactive \{[^}]*background: #fff/);
  assert.match(css, /\.rich-doc-insert-slot\.is-interactive \.rich-doc-insert-slot-bar \{ background: transparent/);
  assert.match(css, /is-insert-dragging/);
  assert.doesNotMatch(css, /\.rich-doc-insert-slot\.is-interactive \.rich-doc-insert-slot-bar \{ background: #c5d4ea/);
  assert.match(panel, /insertSlotsDragging/);
  assert.match(panel, /survolez entre les blocs pour coller/);
  assert.doesNotMatch(panel, /touchez une barre pour l’insérer/);
});

test("version 2.61.0 — cadre semaine trait plein, plus de tiretés", async () => {
  const { APP_VERSION } = await import("../src/lib/app-version.ts");
  assert.equal(APP_VERSION, "2.62.0");
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.class-notebook-column \{[^}]*border: 1px solid var\(--line\)/);
  assert.match(css, /\.class-notebook-column \{[^}]*box-shadow: 0 8px 24px rgba\(6, 24, 61, \.06\)/);
  assert.match(css, /\.class-notebook-column\.is-drop-target \{[^}]*border-style: solid/);
  assert.match(css, /\.class-notebook-column-header \{[^}]*border-radius: 13px 13px 0 0/);
  assert.match(css, /\.class-notebook-zone-notes \{[^}]*border-radius: 0 0 13px 13px/);
  assert.match(css, /\.class-notebook-zone-control \{[^}]*border-bottom: 1px solid var\(--line\)/);
  assert.match(css, /\.class-notebook-zone-publication \{[^}]*border-bottom: 1px solid var\(--line\)/);
  assert.doesNotMatch(css, /\.class-notebook-column\.is-drop-target \{[^}]*border-style: dashed/);
  assert.doesNotMatch(css, /\.class-notebook-zone-control \{[^}]*border-bottom: 1px dashed/);
  assert.doesNotMatch(css, /\.class-notebook-zone-publication \{[^}]*border-bottom: 1px dashed/);
});

test("éditeur 2.62.0 — structures génériques, callouts hérités neutres, listes compactes", async () => {
  const { APP_VERSION } = await import("../src/lib/app-version.ts");
  const { SQL_MIGRATION_FILES } = await import("../src/lib/persistence/sql/migrate.ts");
  assert.equal(APP_VERSION, "2.62.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0034_annual_course_meeting_days.sql");

  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  const view = await readFile(new URL("../web/app/components/rich-doc-view.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(editor, /Blocs de la semaine/);
  assert.doesNotMatch(editor, /rich-doc-quick/);
  assert.doesNotMatch(editor, /addQuickBlock/);
  assert.doesNotMatch(editor, /insertQuickBlock/);
  assert.doesNotMatch(editor, /QUICK_BLOCK_KINDS/);
  assert.doesNotMatch(editor, /À terminer/);
  assert.doesNotMatch(editor, /À apporter/);
  assert.doesNotMatch(editor, /À lire/);
  assert.doesNotMatch(editor, /text="Texte"/);
  assert.doesNotMatch(editor, /label="Titre"/);
  assert.doesNotMatch(editor, /text="Puces"/);
  assert.doesNotMatch(editor, /Liste numérotée/);
  assert.doesNotMatch(editor, /text="Cases"/);
  assert.match(editor, /text="Lien"/);
  assert.match(editor, /event\.key === "Enter" && event\.shiftKey/);
  assert.match(editor, /insertSoftBreak/);
  assert.doesNotMatch(editor, /applyStructure\(/);
  assert.match(editor, /splitLine/);
  assert.match(editor, /pasteRichClip/);
  assert.match(editor, /undoRichDocHistory/);
  assert.match(editor, /redoRichDocHistory/);
  assert.match(editor, /QUICK_BLOCK_LABELS/);

  assert.match(view, /QUICK_BLOCK_LABELS/);
  assert.match(view, /rich-doc-callout/);
  assert.doesNotMatch(view, /is-\$\{block\.kind\}/);
  assert.doesNotMatch(view, /is-\$\{line\.calloutKind\}/);

  assert.match(css, /list-style-position: outside/);
  assert.match(css, /\.rich-doc-view ul, \.rich-doc-view ol \{[\s\S]*padding: 0 0 0 1\.55em/);
  assert.match(css, /\.rich-doc-view \{ display: grid; gap: 0\.28em;/);
  assert.match(css, /\.rich-doc-line-marker \{[\s\S]*font-size: var\(--carnet-size\)/);
  assert.match(css, /\.rich-doc-summary-text \{ min-width: 0; flex: 1;/);
  assert.match(css, /\.rich-doc-line-body \{[\s\S]*display: flex;[\s\S]*align-items: flex-start;[\s\S]*gap: 0\.35em;/);
  assert.match(css, /\.rich-doc-toolbar \{[\s\S]*flex-wrap: wrap/);
  assert.match(css, /\.rich-doc-editor \{[\s\S]*overflow-x: hidden/);
  assert.doesNotMatch(css, /rich-doc-quick/);
  assert.doesNotMatch(css, /\.rich-doc-callout\.is-todo/);
  assert.doesNotMatch(css, /\.rich-doc-summary-tag\.is-todo/);
  assert.doesNotMatch(css, /\.rich-doc-line\.is-callout:has/);
  assert.doesNotMatch(css, /\.rich-doc-view \{ display: grid; gap: 10px/);

  assert.doesNotMatch(panel, /Blocs de la semaine/);
  const publicationService = await readFile(
    new URL("../src/features/class-notebook/notebook-publication-service.ts", import.meta.url),
    "utf8",
  );
  assert.match(publicationService, /NOTEBOOK_PUBLICATION_TYPES = \["HOMEWORK", "INFORMATION"\]/);
  assert.match(panel, /item\.type === "TEST"/);

  const historic = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "callout", kind: "review", inlines: [{ text: "Chapitre injection" }] },
      { type: "bulletList", items: [[{ text: "Exercice 4" }]] },
    ],
  });
  const encoded = encodeRichDetail(historic);
  const reloaded = decodeRichDetail(encoded);
  assert.equal(reloaded?.blocks[0]?.type, "callout");
  if (reloaded?.blocks[0]?.type === "callout") {
    assert.equal(reloaded.blocks[0].kind, "review");
    assert.equal(inlinesPlainText(reloaded.blocks[0].inlines), "Chapitre injection");
  }
  const savedAgain = decodeRichDetail(encodeRichDetail(reloaded!));
  assert.deepEqual(savedAgain, reloaded);
});

test("éditeur — puces, numéros et cases dans la zone de saisie commune", async () => {
  const { APP_VERSION } = await import("../src/lib/app-version.ts");
  const { SQL_MIGRATION_FILES } = await import("../src/lib/persistence/sql/migrate.ts");
  assert.equal(APP_VERSION, "2.62.0");
  assert.equal(CAMPUS_RICH_FORMAT, "campus-rich-v1");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0034_annual_course_meeting_days.sql");

  const bullets = applyStructureToLine(paragraphDoc("Devoir :"), 0, null, "bulletList");
  assert.equal(bullets.doc.blocks[0]?.type, "bulletList");
  const numbered = applyStructureToLine(paragraphDoc("Devoir :"), 0, null, "orderedList");
  assert.equal(numbered.doc.blocks[0]?.type, "orderedList");
  const checks = applyStructureToLine(paragraphDoc("Apporter la calculatrice"), 0, null, "checklist");
  assert.equal(checks.doc.blocks[0]?.type, "checklist");
  assert.equal(inlinesPlainText(richDocLines(bullets.doc)[0]!.inlines), "Devoir :");

  const afterEnter = splitLine(numbered.doc, 0, 0, "Devoir :".length);
  assert.equal(afterEnter.doc.blocks[0]?.type, "orderedList");
  if (afterEnter.doc.blocks[0]?.type === "orderedList") {
    assert.equal(afterEnter.doc.blocks[0].items.length, 2);
  }

  const withBreak = insertTextAt([{ text: "Devoir :" }], "Devoir".length, "\n");
  assert.equal(inlinesPlainText(withBreak), "Devoir\n :");

  const wrapped = applyStructureToLine(
    paragraphDoc("Terminer la feuille « Base N°6 » et apprendre les formules."),
    0,
    null,
    "bulletList",
  );
  assert.equal(wrapped.doc.blocks[0]?.type, "bulletList");
  assert.equal(
    inlinesPlainText(richDocLines(wrapped.doc)[0]!.inlines),
    "Terminer la feuille « Base N°6 » et apprendre les formules.",
  );

  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(editor, /className="rich-doc-line-body"/);
  assert.match(editor, /rich-doc-line-marker/);
  assert.match(editor, /rich-doc-line-check/);
  assert.match(editor, /className="rich-doc-line-input"/);
  assert.doesNotMatch(editor, /contentEditable[\s\S]{0,80}rich-doc-line-marker/);
  assert.doesNotMatch(css, /\.rich-doc-line-body:focus-within/);
  assert.match(css, /\.rich-doc-line-body \{[\s\S]*width: 100%/);
  assert.match(css, /\.rich-doc-line-input \{[\s\S]*flex: 1;[\s\S]*min-width: 0;/);
  assert.match(css, /\.rich-doc-line-marker \{[\s\S]*pointer-events: none/);
  assert.doesNotMatch(css, /\.rich-doc-line-input:focus \{ background: #f4f8ff/);
  assert.doesNotMatch(css, /\.rich-doc-line-input:focus \{[\s\S]{0,80}box-shadow: inset 0 0 0 1px #c9daf3/);

  const historic = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "orderedList", items: [[{ text: "Ancien devoir" }]] },
      { type: "callout", kind: "todo", inlines: [{ text: "À faire encore" }] },
    ],
  });
  assert.deepEqual(decodeRichDetail(encodeRichDetail(historic)), historic);
});

test("ligne visuelle — Cases n’applique que la sous-ligne du curseur", () => {
  const doc = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "paragraph", inlines: [{ text: "Devoir :\nLe moteur" }] }],
  });
  const offset = "Devoir :\n".length;
  const result = applyStructureAtVisualLine(doc, 0, null, offset, "checklist");
  assert.deepEqual(
    result.doc.blocks.map((block) => block.type),
    ["paragraph", "checklist"],
  );
  assert.deepEqual(
    richDocLines(result.doc).map((line) => [line.kind, inlinesPlainText(line.inlines)]),
    [
      ["paragraph", "Devoir :"],
      ["checklist", "Le moteur"],
    ],
  );
  assert.equal(result.caret.blockIndex, 1);
  assert.equal(result.caret.itemIndex, 0);
});

test("ligne visuelle — Puces scindent avant et après, puis fusionnent", () => {
  const doc = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "paragraph", inlines: [{ text: "Devoir :\nLe moteur\nInjection" }] }],
  });
  const moteur = applyStructureAtVisualLine(doc, 0, null, "Devoir :\n".length, "bulletList");
  assert.deepEqual(
    moteur.doc.blocks.map((block) => block.type),
    ["paragraph", "bulletList", "paragraph"],
  );
  assert.deepEqual(
    richDocLines(moteur.doc).map((line) => inlinesPlainText(line.inlines)),
    ["Devoir :", "Le moteur", "Injection"],
  );

  const both = applyStructureAtVisualLine(moteur.doc, 2, null, 0, "bulletList");
  assert.deepEqual(
    both.doc.blocks.map((block) => block.type),
    ["paragraph", "bulletList"],
  );
  if (both.doc.blocks[1]?.type === "bulletList") {
    assert.deepEqual(
      both.doc.blocks[1].items.map((item) => inlinesPlainText(item)),
      ["Le moteur", "Injection"],
    );
  }
});

test("ligne visuelle — numérotation automatique après fusion", () => {
  const doc = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "paragraph", inlines: [{ text: "Devoir :\nMoteur\nInjection" }] }],
  });
  const moteur = applyStructureAtVisualLine(doc, 0, null, "Devoir :\n".length, "orderedList");
  const injection = applyStructureAtVisualLine(moteur.doc, 2, null, 0, "orderedList");
  assert.equal(injection.doc.blocks[0]?.type, "paragraph");
  assert.equal(lineText(injection.doc, 0), "Devoir :");
  assert.equal(injection.doc.blocks[1]?.type, "orderedList");
  assert.deepEqual(
    richDocLines(injection.doc)
      .filter((line) => line.kind === "orderedList")
      .map((line) => [inlinesPlainText(line.inlines), line.ordinal]),
    [
      ["Moteur", 1],
      ["Injection", 2],
    ],
  );
});

test("ligne visuelle — Texte ne convertit que l’élément visé", () => {
  const listed = applyStructureToLine(
    sanitizeRichDoc({
      format: CAMPUS_RICH_FORMAT,
      blocks: [{ type: "checklist", items: [
        { checked: false, inlines: [{ text: "Le moteur" }] },
        { checked: false, inlines: [{ text: "Injection" }] },
      ] }],
    }),
    0,
    1,
    "paragraph",
  );
  assert.deepEqual(
    listed.doc.blocks.map((block) => block.type),
    ["checklist", "paragraph"],
  );
  assert.deepEqual(
    richDocLines(listed.doc).map((line) => [line.kind, inlinesPlainText(line.inlines)]),
    [
      ["checklist", "Le moteur"],
      ["paragraph", "Injection"],
    ],
  );
});

test("ligne visuelle — Titre uniquement sur la sous-ligne du curseur", () => {
  const doc = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "paragraph", inlines: [{ text: "Devoir :\nLe moteur" }] }],
  });
  const titled = applyStructureAtVisualLine(doc, 0, null, 0, "heading");
  assert.equal(titled.doc.blocks[0]?.type, "heading");
  assert.equal(titled.doc.blocks[1]?.type, "paragraph");
  assert.equal(lineText(titled.doc, 0), "Devoir :");
  assert.equal(lineText(titled.doc, 1), "Le moteur");
});

test("ligne visuelle — marks conservés au découpage", () => {
  const doc = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{
      type: "paragraph",
      inlines: [
        { text: "Devoir :\n", marks: { bold: true } },
        {
          text: "Le moteur",
          marks: {
            italic: true,
            underline: true,
            highlight: true,
            color: "blue",
            href: "https://campusagenda.ch",
          },
        },
      ],
    }],
  });
  const result = applyStructureAtVisualLine(doc, 0, null, "Devoir :\n".length, "checklist");
  const heading = result.doc.blocks[0];
  const item = result.doc.blocks[1];
  assert.ok(heading && heading.type === "paragraph");
  assert.ok(item && item.type === "checklist");
  if (heading?.type === "paragraph") {
    assert.equal(marksInRange(heading.inlines, 0, 8).bold, true);
  }
  if (item?.type === "checklist") {
    const inlines = item.items[0]?.inlines ?? [];
    assert.equal(marksInRange(inlines, 0, 9).italic, true);
    assert.equal(marksInRange(inlines, 0, 9).underline, true);
    assert.equal(marksInRange(inlines, 0, 9).highlight, true);
    assert.equal(marksInRange(inlines, 0, 9).color, "blue");
    assert.equal(marksInRange(inlines, 0, 9).href, "https://campusagenda.ch");
  }
});

test("ligne visuelle — Maj+Entrée dans une liste crée l’item suivant, Entrée sort", () => {
  const listed = applyStructureToLine(paragraphDoc("Terminer la feuille"), 0, null, "bulletList");
  const nextItem = continueListAtCaret(listed.doc, 0, 0, "Terminer la feuille".length);
  assert.equal(nextItem.doc.blocks[0]?.type, "bulletList");
  if (nextItem.doc.blocks[0]?.type === "bulletList") {
    assert.equal(nextItem.doc.blocks[0].items.length, 2);
  }
  const exited = exitListAtCaret(listed.doc, 0, 0, "Terminer la feuille".length);
  assert.equal(exited.doc.blocks[0]?.type, "bulletList");
  assert.equal(exited.doc.blocks[1]?.type, "paragraph");
  assert.deepEqual(exited.caret, { blockIndex: 1, itemIndex: null, offset: 0 });

  const paragraph = paragraphDoc("Devoir injection");
  const soft = insertTextAt([{ text: "Devoir injection" }], "Devoir".length, "\n");
  const sameBlock = setLineInlines(paragraph, 0, null, soft);
  assert.equal(sameBlock.blocks[0]?.type, "paragraph");
  assert.equal(inlinesPlainText(sameBlock.blocks[0] && "inlines" in sameBlock.blocks[0] ? sameBlock.blocks[0].inlines : []), "Devoir\n injection");
});

test("ligne visuelle — campus-rich-v1 encode/decode sans perte", () => {
  const doc = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "paragraph", inlines: [{ text: "Devoir :\nLe moteur" }] }],
  });
  const converted = applyStructureAtVisualLine(doc, 0, null, "Devoir :\n".length, "checklist");
  assert.equal(converted.doc.format, "campus-rich-v1");
  assert.deepEqual(decodeRichDetail(encodeRichDetail(converted.doc)), converted.doc);
  const historic = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "callout", kind: "review", inlines: [{ text: "Ancien\nbloc" }] }],
  });
  assert.deepEqual(decodeRichDetail(encodeRichDetail(historic)), historic);
});

test("surface continue — Maj+Entrée prolonge orderedList, puces et cases", () => {
  const numbered = applyStructureToLine(paragraphDoc("Moteur"), 0, null, "orderedList");
  const second = splitLine(numbered.doc, 0, 0, "Moteur".length);
  assert.equal(second.doc.blocks.length, 1);
  assert.equal(second.doc.blocks[0]?.type, "orderedList");
  if (second.doc.blocks[0]?.type === "orderedList") {
    assert.equal(second.doc.blocks[0].items.length, 2);
  }
  const withInjection = setLineInlines(second.doc, 0, 1, [{ text: "Injection" }]);
  assert.deepEqual(
    richDocLines(withInjection).map((line) => [inlinesPlainText(line.inlines), line.ordinal]),
    [
      ["Moteur", 1],
      ["Injection", 2],
    ],
  );
  const third = splitLine(withInjection, 0, 1, "Injection".length);
  assert.equal(third.doc.blocks[0]?.type, "orderedList");
  if (third.doc.blocks[0]?.type === "orderedList") {
    assert.equal(third.doc.blocks[0].items.length, 3);
    assert.equal(inlinesPlainText(third.doc.blocks[0].items[2] ?? []), "");
  }

  const bullets = applyStructureToLine(paragraphDoc("Moteur"), 0, null, "bulletList");
  const nextBullet = splitLine(bullets.doc, 0, 0, "Moteur".length);
  assert.equal(nextBullet.doc.blocks.length, 1);
  assert.equal(nextBullet.doc.blocks[0]?.type, "bulletList");
  if (nextBullet.doc.blocks[0]?.type === "bulletList") {
    assert.equal(nextBullet.doc.blocks[0].items.length, 2);
  }

  const checks = applyStructureToLine(paragraphDoc("Moteur"), 0, null, "checklist");
  const nextCheck = splitLine(checks.doc, 0, 0, "Moteur".length);
  assert.equal(nextCheck.doc.blocks[0]?.type, "checklist");
  if (nextCheck.doc.blocks[0]?.type === "checklist") {
    assert.equal(nextCheck.doc.blocks[0].items.length, 2);
    assert.equal(nextCheck.doc.blocks[0].items[1]?.checked, false);
  }
});

test("surface continue — Enter sur item vide sort de la liste", () => {
  for (const type of ["orderedList", "bulletList", "checklist"] as const) {
    const listed = applyStructureToLine(paragraphDoc("Moteur"), 0, null, type);
    const emptyItem = continueListAtCaret(listed.doc, 0, 0, "Moteur".length);
    const exited = exitListAtCaret(emptyItem.doc, 0, 1, 0);
    assert.equal(exited.doc.blocks[0]?.type, type);
    assert.equal(exited.doc.blocks[1]?.type, "paragraph");
    assert.equal(inlinesPlainText(richDocLines(exited.doc)[0]!.inlines), "Moteur");
    assert.equal(inlinesPlainText(richDocLines(exited.doc)[1]!.inlines), "");
    assert.equal(exited.caret.blockIndex, 1);
    assert.equal(exited.caret.itemIndex, null);
    if (exited.doc.blocks[0] && "items" in exited.doc.blocks[0]) {
      assert.equal(exited.doc.blocks[0].items.length, 1);
    }
  }
});

test("surface continue — Shift+Enter dans une liste crée un nouvel item", () => {
  const listed = applyStructureToLine(paragraphDoc("Terminer la feuille"), 0, null, "orderedList");
  const split = splitLine(listed.doc, 0, 0, "Terminer la feuille".length);
  assert.equal(split.doc.blocks.length, 1);
  assert.equal(split.doc.blocks[0]?.type, "orderedList");
  if (split.doc.blocks[0]?.type === "orderedList") {
    assert.equal(split.doc.blocks[0].items.length, 2);
    assert.equal(inlinesPlainText(split.doc.blocks[0].items[0] ?? []), "Terminer la feuille");
    assert.equal(inlinesPlainText(split.doc.blocks[0].items[1] ?? []), "");
  }
});

test("surface continue — orderedList adjacentes fusionnées, interruption puis recolle", () => {
  const adjacent = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "orderedList", items: [[{ text: "Moteur" }]] },
      { type: "orderedList", items: [[{ text: "Injection" }]] },
    ],
  });
  assert.equal(adjacent.blocks.length, 2);
  assert.deepEqual(
    richDocLines(adjacent).map((line) => [inlinesPlainText(line.inlines), line.ordinal]),
    [
      ["Moteur", 1],
      ["Injection", 1],
    ],
  );

  const interrupted = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "orderedList", items: [[{ text: "Moteur" }]] },
      { type: "checklist", items: [{ checked: false, inlines: [{ text: "Injection" }] }] },
      { type: "orderedList", items: [[{ text: "Dépollution" }]] },
    ],
  });
  assert.deepEqual(
    interrupted.blocks.map((block) => block.type),
    ["orderedList", "checklist", "orderedList"],
  );
  assert.deepEqual(
    richDocLines(interrupted).map((line) => [line.kind, inlinesPlainText(line.inlines), line.ordinal ?? null]),
    [
      ["orderedList", "Moteur", 1],
      ["checklist", "Injection", null],
      ["orderedList", "Dépollution", 1],
    ],
  );

  const restored = applyStructureAtVisualLine(interrupted, 1, 0, 0, "orderedList");
  assert.equal(restored.doc.blocks.length, 1);
  assert.equal(restored.doc.blocks[0]?.type, "orderedList");
  assert.deepEqual(
    richDocLines(restored.doc).map((line) => [inlinesPlainText(line.inlines), line.ordinal]),
    [
      ["Moteur", 1],
      ["Injection", 2],
      ["Dépollution", 3],
    ],
  );
});

test("fusion — listes adjacentes trop grandes ne perdent aucun item", () => {
  const orderedItems = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => [{ text: `${prefix}-${index + 1}` }]);
  const checkItems = (count: number, prefix: string, checkedFrom = 0) =>
    Array.from({ length: count }, (_, index) => ({
      checked: index >= checkedFrom,
      inlines: [{ text: `${prefix}-${index + 1}` }],
    }));

  const tooBig = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "orderedList", items: orderedItems(30, "A") },
      { type: "orderedList", items: orderedItems(20, "B") },
    ],
  });
  assert.equal(tooBig.blocks.length, 2);
  assert.deepEqual(
    tooBig.blocks.map((block) => block.type),
    ["orderedList", "orderedList"],
  );
  assert.equal(
    tooBig.blocks.reduce((sum, block) => sum + ("items" in block ? block.items.length : 0), 0),
    50,
  );
  assert.equal(inlinesPlainText((tooBig.blocks[0] as { items: { text: string }[][] }).items[0] ?? []), "A-1");
  assert.equal(inlinesPlainText((tooBig.blocks[1] as { items: { text: string }[][] }).items[19] ?? []), "B-20");
  const reloaded = decodeRichDetail(encodeRichDetail(tooBig));
  assert.deepEqual(reloaded, tooBig);
  assert.equal(
    reloaded?.blocks.reduce((sum, block) => sum + ("items" in block ? block.items.length : 0), 0),
    50,
  );

  const fits = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "orderedList", items: orderedItems(20, "C") },
      { type: "orderedList", items: orderedItems(20, "D") },
    ],
  });
  assert.equal(fits.blocks.length, 2);
  assert.equal(
    fits.blocks.reduce((sum, block) => sum + ("items" in block ? block.items.length : 0), 0),
    40,
  );
  const mergedByEdit = applyStructureAtVisualLine(
    sanitizeRichDoc({
      format: CAMPUS_RICH_FORMAT,
      blocks: [
        { type: "orderedList", items: orderedItems(20, "C") },
        { type: "paragraph", inlines: [{ text: "jointure" }] },
        { type: "orderedList", items: orderedItems(10, "D") },
      ],
    }),
    1,
    null,
    0,
    "orderedList",
  );
  assert.equal(mergedByEdit.doc.blocks.length, 1);
  assert.equal(mergedByEdit.doc.blocks[0]?.type, "orderedList");
  if (mergedByEdit.doc.blocks[0]?.type === "orderedList") {
    assert.equal(mergedByEdit.doc.blocks[0].items.length, 31);
    assert.equal(inlinesPlainText(mergedByEdit.doc.blocks[0].items[0] ?? []), "C-1");
    assert.equal(inlinesPlainText(mergedByEdit.doc.blocks[0].items[20] ?? []), "jointure");
    assert.equal(inlinesPlainText(mergedByEdit.doc.blocks[0].items[30] ?? []), "D-10");
  }

  const bullets = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "bulletList", items: orderedItems(35, "P") },
      { type: "bulletList", items: orderedItems(10, "Q") },
    ],
  });
  assert.equal(bullets.blocks.length, 2);
  assert.equal(
    bullets.blocks.reduce((sum, block) => sum + ("items" in block ? block.items.length : 0), 0),
    45,
  );
  assert.equal(inlinesPlainText((bullets.blocks[1] as { items: { text: string }[][] }).items[9] ?? []), "Q-10");

  const checks = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "checklist", items: checkItems(30, "K", 30) },
      { type: "checklist", items: checkItems(20, "L", 0) },
    ],
  });
  assert.equal(checks.blocks.length, 2);
  assert.equal(
    checks.blocks.reduce((sum, block) => sum + ("items" in block ? block.items.length : 0), 0),
    50,
  );
  if (checks.blocks[0]?.type === "checklist" && checks.blocks[1]?.type === "checklist") {
    assert.equal(checks.blocks[0].items.every((item) => item.checked), false);
    assert.equal(checks.blocks[1].items.every((item) => item.checked), true);
    assert.equal(inlinesPlainText(checks.blocks[0].items[29]?.inlines ?? []), "K-30");
    assert.equal(inlinesPlainText(checks.blocks[1].items[19]?.inlines ?? []), "L-20");
  }
});

test("sanitize — listes historiques adjacentes restent deux blocs", () => {
  for (const type of ["orderedList", "bulletList"] as const) {
    const historic = sanitizeRichDoc({
      format: CAMPUS_RICH_FORMAT,
      blocks: [
        { type, items: [[{ text: "Premier" }], [{ text: "Deuxième" }]] },
        { type, items: [[{ text: "Nouveau chapitre" }], [{ text: "Suite" }]] },
      ],
    });
    assert.equal(historic.blocks.length, 2);
    assert.deepEqual(
      historic.blocks.map((block) => block.type),
      [type, type],
    );
    const reloaded = decodeRichDetail(encodeRichDetail(historic));
    assert.deepEqual(reloaded, historic);
    assert.equal(reloaded?.blocks.length, 2);
    if (type === "orderedList") {
      assert.deepEqual(
        richDocLines(reloaded!).map((line) => line.ordinal),
        [1, 2, 1, 2],
      );
    }
  }

  const checks = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "checklist", items: [
        { checked: true, inlines: [{ text: "Premier" }] },
        { checked: false, inlines: [{ text: "Deuxième" }] },
      ] },
      { type: "checklist", items: [
        { checked: true, inlines: [{ text: "Nouveau chapitre" }] },
        { checked: false, inlines: [{ text: "Suite" }] },
      ] },
    ],
  });
  assert.equal(checks.blocks.length, 2);
  const reloadedChecks = decodeRichDetail(encodeRichDetail(checks));
  assert.deepEqual(reloadedChecks, checks);
  if (reloadedChecks?.blocks[0]?.type === "checklist" && reloadedChecks.blocks[1]?.type === "checklist") {
    assert.equal(reloadedChecks.blocks[0].items[0]?.checked, true);
    assert.equal(reloadedChecks.blocks[1].items[0]?.checked, true);
  }
});

test("fusion — édition éloignée ne recolle pas les listes historiques adjacentes", () => {
  const historic = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "orderedList", items: [[{ text: "Premier" }], [{ text: "Deuxième" }]] },
      { type: "orderedList", items: [[{ text: "Nouveau chapitre" }], [{ text: "Suite" }]] },
      { type: "paragraph", inlines: [{ text: "Note éloignée" }] },
    ],
  });
  assert.equal(historic.blocks.length, 3);

  const remoteHeading = applyStructureAtVisualLine(historic, 2, null, 0, "heading");
  assert.deepEqual(
    remoteHeading.doc.blocks.map((block) => block.type),
    ["orderedList", "orderedList", "heading"],
  );
  assert.equal(remoteHeading.doc.blocks.length, 3);
  if (
    remoteHeading.doc.blocks[0]?.type === "orderedList"
    && remoteHeading.doc.blocks[1]?.type === "orderedList"
  ) {
    assert.equal(remoteHeading.doc.blocks[0].items.length, 2);
    assert.equal(remoteHeading.doc.blocks[1].items.length, 2);
    assert.equal(inlinesPlainText(remoteHeading.doc.blocks[0].items[0] ?? []), "Premier");
    assert.equal(inlinesPlainText(remoteHeading.doc.blocks[1].items[0] ?? []), "Nouveau chapitre");
  }
  assert.deepEqual(
    richDocLines(remoteHeading.doc).map((line) => line.ordinal ?? null),
    [1, 2, 1, 2, null],
  );

  const afterLists = applyStructureAtVisualLine(historic, 2, null, 0, "orderedList");
  assert.equal(afterLists.doc.blocks.length, 2);
  assert.deepEqual(
    afterLists.doc.blocks.map((block) => block.type),
    ["orderedList", "orderedList"],
  );
  if (
    afterLists.doc.blocks[0]?.type === "orderedList"
    && afterLists.doc.blocks[1]?.type === "orderedList"
  ) {
    assert.equal(afterLists.doc.blocks[0].items.length, 2);
    assert.deepEqual(
      afterLists.doc.blocks[0].items.map((item) => inlinesPlainText(item)),
      ["Premier", "Deuxième"],
    );
    assert.equal(afterLists.doc.blocks[1].items.length, 3);
    assert.deepEqual(
      afterLists.doc.blocks[1].items.map((item) => inlinesPlainText(item)),
      ["Nouveau chapitre", "Suite", "Note éloignée"],
    );
  }

  const before = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "paragraph", inlines: [{ text: "Avant" }] },
      { type: "orderedList", items: [[{ text: "Premier" }], [{ text: "Deuxième" }]] },
      { type: "orderedList", items: [[{ text: "Nouveau chapitre" }], [{ text: "Suite" }]] },
    ],
  });
  const beforeLists = applyStructureAtVisualLine(before, 0, null, 0, "orderedList");
  assert.equal(beforeLists.doc.blocks.length, 2);
  if (
    beforeLists.doc.blocks[0]?.type === "orderedList"
    && beforeLists.doc.blocks[1]?.type === "orderedList"
  ) {
    assert.deepEqual(
      beforeLists.doc.blocks[0].items.map((item) => inlinesPlainText(item)),
      ["Avant", "Premier", "Deuxième"],
    );
    assert.deepEqual(
      beforeLists.doc.blocks[1].items.map((item) => inlinesPlainText(item)),
      ["Nouveau chapitre", "Suite"],
    );
  }
});

test("splitLine — liste déjà à 40 items ne perd aucun contenu", () => {
  const texts = Array.from({ length: 40 }, (_, index) => `item-${index + 1}`);
  const ordered = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "orderedList", items: texts.map((text) => [{ text }]) }],
  });
  const splitOrdered = splitLine(ordered, 0, 20, 2);
  assert.equal(splitOrdered.doc.blocks.length, 1);
  if (splitOrdered.doc.blocks[0]?.type === "orderedList") {
    assert.equal(splitOrdered.doc.blocks[0].items.length, 40);
    assert.deepEqual(
      splitOrdered.doc.blocks[0].items.map((item) => inlinesPlainText(item)),
      texts,
    );
  }
  assert.deepEqual(splitOrdered.caret, { blockIndex: 0, itemIndex: 20, offset: 2 });

  const bullets = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "bulletList", items: texts.map((text) => [{ text }]) }],
  });
  const splitBullets = splitLine(bullets, 0, 10, 1);
  if (splitBullets.doc.blocks[0]?.type === "bulletList") {
    assert.equal(splitBullets.doc.blocks[0].items.length, 40);
    assert.deepEqual(
      splitBullets.doc.blocks[0].items.map((item) => inlinesPlainText(item)),
      texts,
    );
  }

  const checkItems = texts.map((text, index) => ({
    checked: index % 2 === 0,
    inlines: [{ text }],
  }));
  const checks = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "checklist", items: checkItems }],
  });
  const splitChecks = splitLine(checks, 0, 15, 3);
  if (splitChecks.doc.blocks[0]?.type === "checklist") {
    assert.equal(splitChecks.doc.blocks[0].items.length, 40);
    assert.deepEqual(
      splitChecks.doc.blocks[0].items.map((item) => [inlinesPlainText(item.inlines), item.checked]),
      checkItems.map((item) => [item.inlines[0]?.text, item.checked]),
    );
  }

  const thirtyNine = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{
      type: "orderedList",
      items: Array.from({ length: 39 }, (_, index) => [{ text: `n-${index + 1}` }]),
    }],
  });
  const grew = splitLine(thirtyNine, 0, 38, "n-39".length);
  assert.equal(grew.doc.blocks[0]?.type, "orderedList");
  if (grew.doc.blocks[0]?.type === "orderedList") {
    assert.equal(grew.doc.blocks[0].items.length, 40);
    assert.equal(inlinesPlainText(grew.doc.blocks[0].items[0] ?? []), "n-1");
    assert.equal(inlinesPlainText(grew.doc.blocks[0].items[38] ?? []), "n-39");
    assert.equal(inlinesPlainText(grew.doc.blocks[0].items[39] ?? []), "");
  }
});

test("surface continue — canvas unique, pas de carte au focus, campus-rich-v1", async () => {
  const { APP_VERSION } = await import("../src/lib/app-version.ts");
  const { SQL_MIGRATION_FILES } = await import("../src/lib/persistence/sql/migrate.ts");
  assert.equal(APP_VERSION, "2.62.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0034_annual_course_meeting_days.sql");
  assert.equal(CAMPUS_RICH_FORMAT, "campus-rich-v1");

  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.rich-doc-canvas \{[\s\S]*border: 1px solid var\(--line\)/);
  assert.doesNotMatch(css, /\.rich-doc-line-body:focus-within/);
  assert.doesNotMatch(css, /\.rich-doc-line-body:focus-within \{[\s\S]*box-shadow/);
  assert.doesNotMatch(css, /\.rich-doc-line-body:focus-within \{[\s\S]*background: #f4f8ff/);
  assert.doesNotMatch(css, /\.rich-doc-line-input:focus \{ background: #f4f8ff/);
  assert.match(css, /\.rich-doc-line-input:focus \{[\s\S]*outline: none/);

  const historic = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "callout", kind: "bring", inlines: [{ text: "Ancien bloc" }] },
      { type: "paragraph", inlines: [{ text: "Toujours lisible" }] },
    ],
  });
  assert.deepEqual(decodeRichDetail(encodeRichDetail(historic)), historic);
});

test("liste — Maj+Entrée et \\n deviennent des items numérotés dans un seul bloc", () => {
  const wrapped = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "bulletList", items: [[{ text: "Devoir :\nJdjd" }]] }],
  });
  assert.equal(wrapped.blocks.length, 1);
  assert.equal(wrapped.blocks[0]?.type, "bulletList");
  if (wrapped.blocks[0]?.type === "bulletList") {
    assert.equal(wrapped.blocks[0].items.length, 2);
    assert.equal(inlinesPlainText(wrapped.blocks[0].items[0] ?? []), "Devoir :");
    assert.equal(inlinesPlainText(wrapped.blocks[0].items[1] ?? []), "Jdjd");
  }

  const numbered = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{
      type: "orderedList",
      items: [[{ text: "Premier\nDeuxième" }], [{ text: "Troisième" }]],
    }],
  });
  assert.equal(numbered.blocks.length, 1);
  if (numbered.blocks[0]?.type === "orderedList") {
    assert.equal(numbered.blocks[0].items.length, 3);
    assert.deepEqual(
      numbered.blocks[0].items.map((item) => inlinesPlainText(item)),
      ["Premier", "Deuxième", "Troisième"],
    );
  }
  assert.deepEqual(
    listDisplayRows(visibleRichDocLines(numbered)).map((row) => [row.ordinal, inlinesPlainText(row.inlines)]),
    [
      [1, "Premier"],
      [2, "Deuxième"],
      [3, "Troisième"],
    ],
  );

  const paragraph = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "paragraph", inlines: [{ text: "Intro" }] },
      { type: "orderedList", items: [[{ text: "A" }], [{ text: "B" }], [{ text: "C" }]] },
      { type: "paragraph", inlines: [{ text: "Fin" }] },
    ],
  });
  const cards = compactSummaryCards(visibleRichDocLines(paragraph));
  assert.equal(cards.length, 3);
  assert.equal(cards[0]?.kind, "single");
  assert.equal(cards[1]?.kind, "list");
  assert.equal(cards[1]?.kind === "list" ? cards[1].lines.length : 0, 3);
  assert.equal(cards[2]?.kind, "single");

  const oneItem = extractLine(paragraph, 1, 1);
  assert.equal(oneItem?.extracted.type, "orderedList");
  if (oneItem?.extracted.type === "orderedList") {
    assert.equal(oneItem.extracted.items.length, 1);
    assert.equal(inlinesPlainText(oneItem.extracted.items[0] ?? []), "B");
  }
  const whole = extractWeekUnit(paragraph, 1, 1);
  assert.equal(whole?.extracted.type, "orderedList");
  if (whole?.extracted.type === "orderedList") {
    assert.equal(whole.extracted.items.length, 3);
  }
  assert.equal(whole?.remaining.blocks.length, 2);

  const copied = copyWeekUnitToDoc(
    paragraph,
    sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks: [{ type: "paragraph", inlines: [{ text: "Cible" }] }] }),
    1,
    0,
  );
  assert.equal(copied?.blocks.length, 2);
  assert.equal(copied?.blocks[1]?.type, "orderedList");
  if (copied?.blocks[1]?.type === "orderedList") {
    assert.equal(copied.blocks[1].items.length, 3);
  }

  const listed = applyStructureAtVisualLine(
    sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks: [{ type: "paragraph", inlines: [{ text: "Premier" }] }] }),
    0,
    null,
    0,
    "orderedList",
  );
  const second = splitLine(listed.doc, 0, 0, "Premier".length);
  const withSecond = setLineInlines(second.doc, 0, 1, [{ text: "Deuxième" }]);
  const third = splitLine(withSecond, 0, 1, "Deuxième".length);
  const withThird = setLineInlines(third.doc, 0, 2, [{ text: "Troisième" }]);
  const fourth = splitLine(withThird, 0, 2, "Troisième".length);
  const complete = setLineInlines(fourth.doc, 0, 3, [{ text: "Quatrième" }]);
  assert.equal(complete.blocks.length, 1);
  assert.equal(complete.blocks[0]?.type, "orderedList");
  if (complete.blocks[0]?.type === "orderedList") {
    assert.deepEqual(
      complete.blocks[0].items.map((item) => inlinesPlainText(item)),
      ["Premier", "Deuxième", "Troisième", "Quatrième"],
    );
  }
  assert.equal(compactSummaryCards(visibleRichDocLines(complete)).length, 1);

  const alreadyListed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "orderedList", items: [[{ text: "Ancien" }]] }],
  });
  const copiedBeside = copyWeekUnitToDoc(complete, alreadyListed, 0, 0);
  assert.equal(copiedBeside?.blocks.length, 2);
  assert.equal(copiedBeside?.blocks[0]?.type, "orderedList");
  assert.equal(copiedBeside?.blocks[1]?.type, "orderedList");
  if (copiedBeside?.blocks[1]?.type === "orderedList") {
    assert.equal(copiedBeside.blocks[1].items.length, 4);
  }

  const stacked = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "orderedList", items: [[{ text: "A1" }], [{ text: "A2" }]] },
      { type: "paragraph", inlines: [{ text: "Milieu" }] },
      { type: "orderedList", items: [[{ text: "B1" }], [{ text: "B2" }]] },
    ],
  });
  assert.equal(adjacentWeekUnitInsertIndex(stacked, 0, 0, 1), 3);
  const nudged = moveWeekUnitWithinDoc(stacked, 0, 0, 3);
  assert.ok(nudged);
  assert.deepEqual(
    nudged!.blocks.map((block) => block.type),
    ["paragraph", "orderedList", "orderedList"],
  );
  if (nudged!.blocks[1]?.type === "orderedList") {
    assert.deepEqual(
      nudged!.blocks[1].items.map((item) => inlinesPlainText(item)),
      ["A1", "A2"],
    );
  }

  const beside = insertWeekUnitAt(
    alreadyListed,
    { type: "orderedList", items: [[{ text: "Nouveau 1" }], [{ text: "Nouveau 2" }]] },
    1,
  );
  assert.equal(beside.blocks.length, 2);
});

test("éditeur — Maj+Entrée d’une liste crée un item, Entrée sort du bloc", async () => {
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  assert.match(editor, /function splitAtCaret/);
  assert.match(editor, /event\.key === "Enter" && event\.shiftKey/);
  assert.match(editor, /function isListLine/);
  assert.match(editor, /native\.inputType === "insertParagraph"/);
  assert.match(editor, /insertParagraph[\s\S]{0,220}exitListAtCaretLine\(line, element\)/);
  assert.match(editor, /splitAtCaret\(line, element\)/);
  assert.doesNotMatch(editor, /Entrée termine la liste et crée un nouveau bloc/);
  assert.doesNotMatch(editor, /Maj \+ Entrée ajoute la puce, le numéro ou la case suivante/);
  assert.match(editor, /Entrée termine le bloc courant et crée un nouveau bloc indépendant/);
  assert.match(editor, /Maj \+ Entrée ajoute un retour à la ligne dans le même bloc/);
  assert.match(editor, /Les blocs peuvent ensuite être déplacés ou réorganisés dans le Carnet/);
  assert.match(editor, /Ctrl\+C copie, Ctrl\+X coupe, Ctrl\+V colle et Ctrl\+Z annule/);
  assert.match(editor, /Ctrl\+B met en gras, Ctrl\+I en italique et Ctrl\+U souligne/);
  assert.match(editor, /Le lien peut être appliqué au texte sélectionné ou au mot sous le curseur/);
  assert.doesNotMatch(editor, /Entrée crée un nouveau paragraphe/);
  const view = await readFile(new URL("../web/app/components/rich-doc-view.tsx", import.meta.url), "utf8");
  assert.match(view, /data-carnet-list-block/);
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.rich-doc-summary-list-row/);
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /extractWeekUnit/);
  assert.match(panel, /copyWeekUnitToDoc/);
  assert.match(panel, /insertWeekUnitAt/);
  assert.match(panel, /adjacentWeekUnitInsertIndex/);
  assert.match(panel, /Bloc sélectionné/);
  assert.doesNotMatch(panel, /const extracted = extractLine\(/);
});

function listTexts(block: CampusRichDoc["blocks"][number] | undefined): string[] {
  if (!block) return [];
  if (block.type === "bulletList" || block.type === "orderedList") {
    return block.items.map((item) => inlinesPlainText(item));
  }
  if (block.type === "checklist") {
    return block.items.map((item) => inlinesPlainText(item.inlines));
  }
  if ("inlines" in block) return [inlinesPlainText(block.inlines)];
  return [];
}

test("A — bulletList 1 item + Shift+Enter reste le même bloc à 2 items", () => {
  const listed = applyStructureToLine(paragraphDoc("Moteur"), 0, null, "bulletList");
  const next = continueListAtCaret(listed.doc, 0, 0, "Moteur".length);
  assert.equal(next.doc.blocks.length, 1);
  assert.equal(next.doc.blocks[0]?.type, "bulletList");
  assert.deepEqual(listTexts(next.doc.blocks[0]), ["Moteur", ""]);
  assert.deepEqual(next.caret, { blockIndex: 0, itemIndex: 1, offset: 0 });
});

test("B — orderedList 1 item + Shift+Enter garde 1. puis 2.", () => {
  const listed = applyStructureToLine(paragraphDoc("Moteur"), 0, null, "orderedList");
  const next = continueListAtCaret(listed.doc, 0, 0, "Moteur".length);
  assert.equal(next.doc.blocks.length, 1);
  assert.equal(next.doc.blocks[0]?.type, "orderedList");
  assert.deepEqual(listTexts(next.doc.blocks[0]), ["Moteur", ""]);
  assert.deepEqual(
    richDocLines(next.doc).map((line) => [inlinesPlainText(line.inlines), line.ordinal]),
    [
      ["Moteur", 1],
      ["", 2],
    ],
  );
});

test("C — checklist 1 item + Shift+Enter, second item unchecked", () => {
  const listed = applyStructureToLine(paragraphDoc("Moteur"), 0, null, "checklist");
  const checked = setChecklistChecked(listed.doc, 0, 0, true);
  const next = continueListAtCaret(checked, 0, 0, "Moteur".length);
  assert.equal(next.doc.blocks[0]?.type, "checklist");
  if (next.doc.blocks[0]?.type === "checklist") {
    assert.equal(next.doc.blocks[0].items.length, 2);
    assert.equal(next.doc.blocks[0].items[0]?.checked, true);
    assert.equal(next.doc.blocks[0].items[1]?.checked, false);
    assert.equal(inlinesPlainText(next.doc.blocks[0].items[1]?.inlines ?? []), "");
  }
});

test("D — bulletList dernier item + Enter → paragraph vide après", () => {
  const listed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "bulletList", items: [[{ text: "Moteur" }], [{ text: "Injection" }]] }],
  });
  const exited = exitListAtCaret(listed, 0, 1, "Injection".length);
  assert.deepEqual(exited.doc.blocks.map((block) => block.type), ["bulletList", "paragraph"]);
  assert.deepEqual(listTexts(exited.doc.blocks[0]), ["Moteur", "Injection"]);
  assert.equal(listTexts(exited.doc.blocks[1])[0], "");
  assert.deepEqual(exited.caret, { blockIndex: 1, itemIndex: null, offset: 0 });
  assert.equal(compactSummaryCards(visibleRichDocLines(exited.doc)).filter((card) => card.kind === "list").length, 1);
});

test("E — orderedList dernier item + Enter → paragraph après, pas de 4.", () => {
  const listed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{
      type: "orderedList",
      items: [[{ text: "Moteur" }], [{ text: "Injection" }], [{ text: "Dépollution" }]],
    }],
  });
  const exited = exitListAtCaret(listed, 0, 2, "Dépollution".length);
  assert.deepEqual(exited.doc.blocks.map((block) => block.type), ["orderedList", "paragraph"]);
  assert.deepEqual(listTexts(exited.doc.blocks[0]), ["Moteur", "Injection", "Dépollution"]);
  assert.equal(richDocLines(exited.doc).filter((line) => line.kind === "orderedList").length, 3);
  assert.deepEqual(exited.caret, { blockIndex: 1, itemIndex: null, offset: 0 });
});

test("F — checklist dernier item + Enter → paragraph après", () => {
  const listed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{
      type: "checklist",
      items: [
        { checked: true, inlines: [{ text: "Moteur" }] },
        { checked: false, inlines: [{ text: "Injection" }] },
      ],
    }],
  });
  const exited = exitListAtCaret(listed, 0, 1, "Injection".length);
  assert.deepEqual(exited.doc.blocks.map((block) => block.type), ["checklist", "paragraph"]);
  if (exited.doc.blocks[0]?.type === "checklist") {
    assert.equal(exited.doc.blocks[0].items[0]?.checked, true);
    assert.equal(exited.doc.blocks[0].items[1]?.checked, false);
  }
});

test("G — Enter au milieu du dernier item, zéro perte", () => {
  const listed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "bulletList", items: [[{ text: "Moteur et injection" }]] }],
  });
  const cut = "Moteur et".length;
  const exited = exitListAtCaret(listed, 0, 0, cut);
  assert.deepEqual(exited.doc.blocks.map((block) => block.type), ["bulletList", "paragraph"]);
  assert.equal(listTexts(exited.doc.blocks[0])[0], "Moteur et");
  assert.equal(listTexts(exited.doc.blocks[1])[0], " injection");
  assert.equal(
    listTexts(exited.doc.blocks[0])[0] + listTexts(exited.doc.blocks[1])[0],
    "Moteur et injection",
  );
});

test("H — Enter sur un item intermédiaire coupe la liste, zéro perte", () => {
  const listed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{
      type: "orderedList",
      items: [[{ text: "Moteur" }], [{ text: "Injection" }], [{ text: "Dépollution" }]],
    }],
  });
  const exited = exitListAtCaret(listed, 0, 1, "Injection".length);
  assert.deepEqual(exited.doc.blocks.map((block) => block.type), ["orderedList", "paragraph", "orderedList"]);
  assert.deepEqual(listTexts(exited.doc.blocks[0]), ["Moteur", "Injection"]);
  assert.equal(listTexts(exited.doc.blocks[1])[0], "");
  assert.deepEqual(listTexts(exited.doc.blocks[2]), ["Dépollution"]);
  if (exited.doc.blocks[2]?.type === "orderedList") {
    assert.equal(richDocLines(exited.doc).find((line) => line.blockIndex === 2)?.ordinal, 1);
  }
  assert.equal(
    [...listTexts(exited.doc.blocks[0]), ...listTexts(exited.doc.blocks[2])].join("|"),
    "Moteur|Injection|Dépollution",
  );
});

test("I — Enter sur item vide le retire et pose un paragraph", () => {
  const listed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{
      type: "orderedList",
      items: [[{ text: "Moteur" }], [], [{ text: "Injection" }]],
    }],
  });
  const exited = exitListAtCaret(listed, 0, 1, 0);
  assert.deepEqual(exited.doc.blocks.map((block) => block.type), ["orderedList", "paragraph", "orderedList"]);
  assert.deepEqual(listTexts(exited.doc.blocks[0]), ["Moteur"]);
  assert.equal(listTexts(exited.doc.blocks[1])[0], "");
  assert.deepEqual(listTexts(exited.doc.blocks[2]), ["Injection"]);
  assert.deepEqual(exited.caret, { blockIndex: 1, itemIndex: null, offset: 0 });
});

test("J — liste avec seul item vide + Enter → paragraph unique", () => {
  const listed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "orderedList", items: [[]] }],
  });
  const exited = exitListAtCaret(listed, 0, 0, 0);
  assert.equal(exited.doc.blocks.length, 1);
  assert.equal(exited.doc.blocks[0]?.type, "paragraph");
  assert.equal(listTexts(exited.doc.blocks[0])[0], "");
  assert.deepEqual(exited.caret, { blockIndex: 0, itemIndex: null, offset: 0 });
});

test("K — Shift+Enter au milieu d’un item → deux items du même bloc", () => {
  const listed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{ type: "orderedList", items: [[{ text: "Moteur" }]] }],
  });
  const split = continueListAtCaret(listed, 0, 0, "Mo".length);
  assert.equal(split.doc.blocks.length, 1);
  assert.equal(split.doc.blocks[0]?.type, "orderedList");
  assert.deepEqual(listTexts(split.doc.blocks[0]), ["Mo", "teur"]);
});

test("L — checklist : checked des anciens items conservé à la sortie", () => {
  const listed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{
      type: "checklist",
      items: [
        { checked: true, inlines: [{ text: "Moteur" }] },
        { checked: true, inlines: [{ text: "Injection" }] },
        { checked: false, inlines: [{ text: "Dépollution" }] },
      ],
    }],
  });
  const exited = exitListAtCaret(listed, 0, 1, "Injec".length);
  assert.deepEqual(exited.doc.blocks.map((block) => block.type), ["checklist", "paragraph", "checklist"]);
  if (exited.doc.blocks[0]?.type === "checklist") {
    assert.equal(exited.doc.blocks[0].items[0]?.checked, true);
    assert.equal(exited.doc.blocks[0].items[1]?.checked, true);
    assert.equal(inlinesPlainText(exited.doc.blocks[0].items[1]?.inlines ?? []), "Injec");
  }
  assert.equal(listTexts(exited.doc.blocks[1])[0], "tion");
  if (exited.doc.blocks[2]?.type === "checklist") {
    assert.equal(exited.doc.blocks[2].items[0]?.checked, false);
    assert.equal(inlinesPlainText(exited.doc.blocks[2].items[0]?.inlines ?? []), "Dépollution");
  }
});

test("M–T — éditeur : Enter sort, Maj+Entrée continue, iPhone et lock", async () => {
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  const keyDownStart = editor.indexOf("function handleKeyDown");
  const beforeStart = editor.indexOf("function handleBeforeInput");
  const keyDown = editor.slice(keyDownStart, beforeStart);
  const beforeInput = editor.slice(beforeStart, editor.indexOf("\n  return (", beforeStart));

  assert.match(keyDown, /event\.key === "Enter" && !event\.shiftKey[\s\S]*isListLine\(line\)[\s\S]*exitListAtCaretLine\(line, element\)/);
  assert.match(keyDown, /event\.key === "Enter" && event\.shiftKey[\s\S]*isListLine\(line\)[\s\S]*continueListAtCaretLine\(line, element\)/);
  assert.match(keyDown, /event\.key === "Enter" && !event\.shiftKey[\s\S]*splitAtCaret\(line, element\)/);
  assert.match(keyDown, /event\.key === "Enter" && event\.shiftKey[\s\S]*insertSoftBreak\(line, element\)/);

  assert.match(beforeInput, /insertParagraph[\s\S]*isListLine\(line\)[\s\S]*exitListAtCaretLine\(line, element\)/);
  assert.match(beforeInput, /insertLineBreak[\s\S]*isListLine\(line\)[\s\S]*continueListAtCaretLine\(line, element\)/);
  assert.match(beforeInput, /insertText[\s\S]*"\\n"[\s\S]*isListLine\(line\)[\s\S]*exitListAtCaretLine\(line, element\)/);
  assert.match(beforeInput, /insertParagraph[\s\S]*splitAtCaret\(line, element\)/);
  assert.match(beforeInput, /insertLineBreak[\s\S]*insertSoftBreak\(line, element\)/);
  assert.match(beforeInput, /insertText[\s\S]*"\\n"[\s\S]*splitAtCaret\(line, element\)/);

  assert.match(editor, /function applyEnterOp/);
  assert.match(editor, /if \(enterLock\.current\) return;/);
  assert.match(editor, /enterLock\.current = true;/);
  assert.match(editor, /enterLock\.current = false;/);
  assert.match(editor, /applyEnterOp\(line, element, continueListAtCaret\)/);
  assert.match(editor, /applyEnterOp\(line, element, exitListAtCaret\)/);
  assert.match(editor, /applyEnterOp\(line, element, splitLine\)/);
  assert.doesNotMatch(editor, /insertParagraph[\s\S]{0,120}continueListAtCaretLine/);
  assert.doesNotMatch(editor, /insertText" && \(native\.data === "\\n"[\s\S]{0,180}continueListAtCaretLine/);
});

test("Enter liste + paragraph ensuite = deux cartes Ma semaine", () => {
  const listed = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [{
      type: "orderedList",
      items: [[{ text: "Moteur" }], [{ text: "Injection" }], [{ text: "Dépollution" }]],
    }],
  });
  const exited = exitListAtCaret(listed, 0, 2, "Dépollution".length);
  const withText = setLineInlines(exited.doc, 1, null, [{ text: "Apporter le classeur" }]);
  const cards = compactSummaryCards(visibleRichDocLines(withText));
  assert.equal(cards.length, 2);
  assert.equal(cards[0]?.kind, "list");
  if (cards[0]?.kind === "list") {
    assert.equal(cards[0].lines.length, 3);
    assert.deepEqual(cards[0].lines.map((line) => inlinesPlainText(line.inlines)), [
      "Moteur",
      "Injection",
      "Dépollution",
    ]);
  }
  assert.equal(cards[1]?.kind, "single");
  if (cards[1]?.kind === "single") {
    assert.equal(inlinesPlainText(cards[1].line.inlines), "Apporter le classeur");
  }
  assert.equal(withText.format, "campus-rich-v1");
});

test("éditeur — toolbar simplifiée, raccourcis, collage externe prioritaire", async () => {
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  const view = await readFile(new URL("../web/app/components/rich-doc-view.tsx", import.meta.url), "utf8");

  for (const removed of [
    'text="Annuler"',
    'text="Rétablir"',
    'text="Copier"',
    'text="Couper"',
    'text="Coller"',
    'text="Texte"',
    'text="Titre"',
    'text="Puces"',
    'text="1. 2. 3."',
    'text="Cases"',
  ]) {
    assert.doesNotMatch(editor, new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(editor, /label="Gras"/);
  assert.match(editor, /label="Italique"/);
  assert.match(editor, /label="Souligné"/);
  assert.match(editor, /label="Surligner"/);
  assert.match(editor, /data-color-swatch/);
  assert.match(editor, /text="Lien"/);
  assert.match(editor, /rich-doc-toolbar-link/);
  assert.match(editor, /key === "b"/);
  assert.match(editor, /applyMark\("bold"/);
  assert.match(editor, /key === "i"/);
  assert.match(editor, /applyMark\("italic"/);
  assert.match(editor, /key === "u"/);
  assert.match(editor, /applyMark\("underline"/);
  assert.match(editor, /resolveClipboardPaste/);
  assert.doesNotMatch(editor, /lastRememberedRichClip\(\)/);
  assert.match(editor, /variant: "publication" \| "notes"/);
  assert.equal([...panel.matchAll(/<RichDocEditor/g)].length, 1);
  assert.match(panel, /variant=\{editor\.kind === "publication" \? "publication" : "notes"\}/);

  assert.match(view, /block\.type === "heading"/);
  assert.match(view, /block\.type === "bulletList"/);
  assert.match(view, /block\.type === "orderedList"/);
  assert.match(view, /block\.type === "checklist"/);

  const historic = sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      { type: "heading", inlines: [{ text: "Moteur" }] },
      { type: "bulletList", items: [[{ text: "Injection" }]] },
      { type: "orderedList", items: [[{ text: "Dépollution" }]] },
      { type: "checklist", items: [{ checked: true, inlines: [{ text: "Contrôle" }] }] },
    ],
  });
  const reloaded = decodeRichDetail(encodeRichDetail(historic));
  assert.deepEqual(reloaded, historic);

  const typed = setLineInlines(splitLine(paragraphDoc("1. écrire"), 0, null, "1. écrire".length).doc, 1, null, [
    { text: "2. penser" },
  ]);
  assert.deepEqual(typed.blocks.map((block) => block.type), ["paragraph", "paragraph"]);
  assert.equal(lineText(typed, 0), "1. écrire");
  assert.equal(lineText(typed, 1), "2. penser");
});

test("collage — text/plain externe prioritaire sur lastRememberedRichClip", () => {
  rememberRichClip({ kind: "inlines", inlines: [{ text: "ANCIEN CLIP" }] });
  const remembered = lastRememberedRichClip();
  assert.equal(remembered?.kind, "inlines");
  if (remembered?.kind === "inlines") {
    assert.equal(inlinesPlainText(remembered.inlines), "ANCIEN CLIP");
  }

  const fromWord = resolveClipboardPaste("Révision moteur jeudi");
  assert.equal(fromWord?.mode, "plain");
  if (fromWord?.mode === "plain") assert.equal(fromWord.text, "Révision moteur jeudi");

  const override = resolveClipboardPaste("TEXTE WORD");
  assert.equal(override?.mode, "plain");
  if (override?.mode === "plain") assert.equal(override.text, "TEXTE WORD");
  assert.notEqual(override?.mode === "plain" ? override.text : "", "ANCIEN CLIP");

  const lines = resolveClipboardPaste("une\ndeux\n\ntrois");
  assert.equal(lines?.mode, "plain");
  if (lines?.mode === "plain") assert.equal(lines.text, "une\ndeux\n\ntrois");

  const campus = resolveClipboardPaste("ignore", encodeRichClip({ kind: "inlines", inlines: [{ text: "riche" }] }));
  assert.equal(campus?.mode, "rich");
  if (campus?.mode === "rich" && campus.clip.kind === "inlines") {
    assert.equal(inlinesPlainText(campus.clip.inlines), "riche");
  }

  const encodedPlain = resolveClipboardPaste(encodeRichClip({ kind: "inlines", inlines: [{ text: "interne" }] }));
  assert.equal(encodedPlain?.mode, "rich");
});

test("Entrée — Premier / Deuxième / Troisième = trois blocs paragraph indépendants", () => {
  let doc = paragraphDoc("Premier");
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0]?.type, "paragraph");

  const afterFirst = splitLine(doc, 0, null, "Premier".length);
  assert.equal(afterFirst.caret.blockIndex, 1);
  doc = setLineInlines(afterFirst.doc, afterFirst.caret.blockIndex, afterFirst.caret.itemIndex, [
    { text: "Deuxième" },
  ]);

  const afterSecond = splitLine(doc, 1, null, "Deuxième".length);
  assert.equal(afterSecond.caret.blockIndex, 2);
  doc = setLineInlines(afterSecond.doc, afterSecond.caret.blockIndex, afterSecond.caret.itemIndex, [
    { text: "Troisième" },
  ]);

  assert.equal(doc.blocks.length, 3);
  assert.deepEqual(
    doc.blocks.map((block) => block.type),
    ["paragraph", "paragraph", "paragraph"],
  );
  assert.equal(lineText(doc, 0), "Premier");
  assert.equal(lineText(doc, 1), "Deuxième");
  assert.equal(lineText(doc, 2), "Troisième");

  doc = setLineInlines(doc, 1, null, [{ text: "Modifié" }]);
  assert.equal(lineText(doc, 0), "Premier");
  assert.equal(lineText(doc, 1), "Modifié");
  assert.equal(lineText(doc, 2), "Troisième");
});

test("Maj+Entrée — Premier puis Deuxième restent un seul bloc", () => {
  const broken = insertTextAt([{ text: "Premier" }], "Premier".length, "\n");
  const withSecond = insertTextAt(broken, "Premier\n".length, "Deuxième");
  const doc = setLineInlines(paragraphDoc("Premier"), 0, null, withSecond);

  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0]?.type, "paragraph");
  if (doc.blocks[0]?.type === "paragraph") {
    assert.equal(inlinesPlainText(doc.blocks[0].inlines), "Premier\nDeuxième");
  }
});

test("éditeur — Entrée/Maj+Entrée identiques publication et notes, blocs Carnet intacts", async () => {
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");

  assert.match(editor, /variant: "publication" \| "notes"/);
  assert.equal([...panel.matchAll(/<RichDocEditor/g)].length, 1);
  assert.match(panel, /variant=\{editor\.kind === "publication" \? "publication" : "notes"\}/);

  const keyDownStart = editor.indexOf("function handleKeyDown");
  const beforeStart = editor.indexOf("function handleBeforeInput");
  const keyDown = editor.slice(keyDownStart, beforeStart);
  assert.match(keyDown, /event\.key === "Enter" && !event\.shiftKey[\s\S]*splitAtCaret\(line, element\)/);
  assert.match(keyDown, /event\.key === "Enter" && event\.shiftKey[\s\S]*insertSoftBreak\(line, element\)/);
  assert.match(editor, /applyEnterOp\(line, element, splitLine\)/);
  assert.match(editor, /insertTextAt\(inlines, offset, "\\n"/);

  assert.match(panel, /function selectAndCopyLine/);
  assert.match(panel, /function placeCopiedLine/);
  assert.match(panel, /function nudgeSelectedLine/);
  assert.match(panel, /copyWeekUnitToDoc/);
  assert.match(panel, /moveWeekUnitWithinDoc/);
  assert.match(panel, /insertWeekUnitAt/);
  assert.match(panel, /extractWeekUnit/);

  const source = paragraphDoc("Alpha");
  const target = paragraphDoc("Beta");
  const copied = copyLineToDoc(source, target, 0, null, 1);
  assert.ok(copied);
  assert.deepEqual(
    visibleRichDocLines(copied!).map((line) => inlinesPlainText(line.inlines)),
    ["Beta", "Alpha"],
  );
  assert.equal(source.blocks.length, 1);
  assert.equal(lineText(source, 0), "Alpha");

  const moved = moveLineToDoc(paragraphDoc("Delta"), paragraphDoc("Gamma"), 0, null, 1);
  assert.ok(moved);
  assert.deepEqual(
    visibleRichDocLines(moved.target).map((line) => inlinesPlainText(line.inlines)),
    ["Gamma", "Delta"],
  );

  const weekUnit = extractWeekUnit(paragraphDoc("Semaine A"), 0, null);
  assert.ok(weekUnit);
  const otherWeek = copyWeekUnitToDoc(paragraphDoc("Semaine A"), paragraphDoc("Semaine B"), 0, null, 1);
  assert.ok(otherWeek);
  assert.equal(otherWeek.blocks.length, 2);
  assert.equal(lineText(otherWeek, 0), "Semaine B");
  assert.equal(lineText(otherWeek, 1), "Semaine A");
});

