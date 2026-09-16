import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyMarkToRange,
  applyStructureToLine,
  encodeRichDetail,
  decodeRichDetail,
  emptyRichDoc,
  extractLine,
  inlinesPlainText,
  insertQuickBlock,
  marksInRange,
  moveLineToDoc,
  normalizeInlines,
  removeLine,
  richDocLines,
  sanitizeRichDoc,
  setChecklistChecked,
  setLineInlines,
  splitInlinesAt,
  splitLine,
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
  assert.equal(APP_VERSION, "2.57.0");
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
  assert.match(view, /richDocLines/);
  assert.match(view, /COMPACT_LINE_LIMIT/);
  assert.match(view, /renderLineLeading/);
  assert.doesNotMatch(view, /is-compact/);

  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.rich-doc-summary-line/);
  assert.match(css, /\.rich-doc-line-marker/);
  assert.match(css, /\.class-notebook-line-handle/);
  assert.doesNotMatch(css, /rich-doc-view\.is-compact/);

  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /class-notebook-drag-handle/);
  assert.match(panel, /class-notebook-line-handle/);
  assert.match(panel, /onDragStart/);
  assert.match(panel, /moveLineToDoc/);
  assert.match(panel, /encodeCarnetMove/);
  // Le glisser HTML5 ne suffit pas (tactile, drags synthétiques) : menu explicite en repli.
  assert.match(panel, /class-notebook-move-menu/);
  assert.match(panel, /Déplacer vers/);
  assert.match(panel, /setData\("text\/plain"/);
  assert.match(panel, /dataTransfer\.getData\("text\/plain"\)/);
});

test("version 2.57.0 — curseur, menus notes, déplacement d’une ligne", async () => {
  const { APP_VERSION } = await import("../src/lib/app-version.ts");
  assert.equal(APP_VERSION, "2.57.0");
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  assert.match(editor, /Le DOM n'est réécrit que sur syncToken/);
  assert.match(editor, /snapCaretToClick/);
  assert.match(editor, /rewriteDom: false/);
  assert.doesNotMatch(editor, /showExtended/);
  assert.doesNotMatch(editor, /\[lines, syncToken\]/);
  assert.match(editor, /Blocs de la semaine/);
  assert.match(editor, /label="Titre"/);
  assert.match(editor, /Insérer un lien/);
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
