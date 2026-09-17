import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyMarkToRange,
  applyStructureToLine,
  copyLineAsClip,
  encodeRichDetail,
  decodeRichClip,
  decodeRichDetail,
  encodeRichClip,
  emptyRichDoc,
  emptyRichDocHistory,
  extractLine,
  copyLineToDoc,
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
  rememberRichClip,
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
  undoRichDocHistory,
  visibleRichDocLines,
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
  assert.equal(APP_VERSION, "2.58.1");
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
  assert.equal(numbered.doc.blocks[0]?.type, "orderedList");
  assert.deepEqual(
    richDocLines(numbered.doc).map((line) => line.ordinal),
    [1, 2, 3],
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
  assert.match(panel, /copyLineToDoc/);
  assert.match(panel, /onDragStart/);
  assert.match(panel, /moveLineToDoc/);
  assert.match(panel, /encodeCarnetMove/);
  assert.match(panel, /Supprimer/);
  assert.match(panel, /placeCopiedLine/);
  assert.match(panel, /nudgeSelectedLine/);
  assert.match(panel, /insertBlockAt|moveLineWithinDoc/);
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
  assert.equal(APP_VERSION, "2.58.1");
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  assert.match(editor, /Le DOM n'est réécrit que sur syncToken/);
  assert.match(editor, /snapCaretToClick/);
  assert.match(editor, /rewriteDom: false/);
  assert.doesNotMatch(editor, /showExtended/);
  assert.doesNotMatch(editor, /\[lines, syncToken\]/);
  assert.match(editor, /Blocs de la semaine/);
  assert.match(editor, /label="Titre"/);
  assert.match(editor, /Insérer un lien/);
  assert.match(editor, /event\.shiftKey/);
  assert.match(editor, /insertTextAt/);
  assert.match(editor, /Maj \+ Entrée va à la ligne dans le bloc/);
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
  assert.equal(APP_VERSION, "2.58.1");
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  assert.match(editor, /Annuler \(Ctrl\+Z\)/);
  assert.match(editor, /Rétablir \(Ctrl\+Y\)/);
  assert.match(editor, /pushRichDocHistory/);
  assert.match(editor, /onBeforeInput/);
  assert.match(editor, /liveTarget/);
  assert.doesNotMatch(editor, /Sans sélection, un outil s’applique à toute la ligne/);
  assert.doesNotMatch(editor, /collapsed \? \{ \.\.\.current, start: 0, end: length \}/);
  assert.match(editor, /data-padding/);
  assert.match(editor, /insertSoftBreak/);
  assert.match(editor, /Copier le bloc \(Ctrl\+C\)/);
  assert.match(editor, /Coller \(Ctrl\+V\)/);
  assert.match(editor, /pasteRichClip/);
  assert.match(editor, /insertFromPaste/);
  assert.match(editor, /fallbackSelection/);
  assert.doesNotMatch(editor, /disabled=\{!canPaste\}/);
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /if \(editor\) return;/);
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
