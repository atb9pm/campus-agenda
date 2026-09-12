import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import {
  addStructuredListItem,
  buildPublicationPayload,
  cloneRichDoc,
  composeWeekNotesDoc,
  composeWeekPublicationDoc,
  decodeRichDetail,
  emptyRichDoc,
  encodeRichDetail,
  excerptRichDoc,
  fromPlainText,
  insertQuickBlock,
  isCarnetOwnedPublication,
  isClassNotesPayload,
  isEmptyRichDoc,
  isPublicationLine,
  listFoldableCarnetPublications,
  normalizeClassNotes,
  parseInlinesFromHtml,
  planCarnetWeekPublicationSave,
  previousSchoolWeekNumber,
  rejectDangerousRichPayload,
  removeStructuredListItem,
  sanitizeHref,
  sanitizeRichDoc,
  savePlanTouchesItem,
  setWeekRichNote,
  CAMPUS_RICH_DETAIL_PREFIX,
  type CampusRichDoc,
} from "../src/features/class-notebook/index.ts";
import { TEACHER_CHF_ID } from "../src/features/classes/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { getMemoryTeacherNotesStore, resetMemoryTeacherNotesStore } from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlTeacherNotesStore } from "../src/lib/persistence/sql/sql-teacher-notes-store.ts";

function item(patch: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title" | "type">): PrototypeAgendaItem {
  return {
    classroomId: "rt-1",
    subjectId: "sub-1",
    authorTeacherId: "teacher-francois",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 4,
    detail: "",
    ...patch,
  };
}

function sampleDoc(): CampusRichDoc {
  return sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      { type: "heading", inlines: [{ text: "Moteur", marks: { bold: true, underline: true } }] },
      { type: "paragraph", inlines: [{ text: "Révision injection", marks: { italic: true } }] },
      {
        type: "paragraph",
        inlines: [
          { text: "4.7.06-5", marks: { color: "blue" } },
          { text: " " },
          { text: "question 30", marks: { color: "red", highlight: true } },
        ],
      },
      { type: "bulletList", items: [[{ text: "exercices n°3" }]] },
      { type: "orderedList", items: [[{ text: "copier la donnée" }]] },
      {
        type: "paragraph",
        inlines: [{ text: "Campus", marks: { href: "https://campusagenda.ch" } }],
      },
      { type: "checklist", items: [{ checked: false, inlines: [{ text: "Revoir exercice 7" }] }] },
    ],
  });
}

test("version 2.52.0 — éditeur enrichi Carnet, sans migration", async () => {
  assert.equal(APP_VERSION, "2.53.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0029_admin_mfa.sql");
  const [panel, notesApi, studentPage] = await Promise.all([
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/notes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /Publication élèves/);
  assert.match(panel, /Notes prof/);
  assert.match(panel, /Copier depuis la semaine précédente/);
  assert.match(panel, /Aperçu élève/);
  assert.match(panel, /isCarnetOwnedPublication/);
  assert.match(panel, /weekCarnetPublications/);
  assert.match(panel, /weekStructuredPublications/);
  assert.doesNotMatch(panel, /À faire[\s\S]*Contrôle/);
  assert.doesNotMatch(panel, /insertQuickBlock\([^\)]*control/);
  assert.match(notesApi, /requireTeacherSession/);
  assert.match(studentPage, /RichDocView/);
  assert.match(studentPage, /isPlaceholderDetail/);
  assert.match(studentPage, /isCarnetOwnedPublication/);
  assert.match(studentPage, /planCarnetWeekPublicationSave/);
  const editor = await readFile(new URL("../web/app/components/rich-doc-editor.tsx", import.meta.url), "utf8");
  assert.match(editor, /parseInlinesFromHtml/);
  assert.match(editor, /hiliteColor/);
  assert.match(editor, /serializeFromDom/);
  assert.match(editor, /Ajouter un élément/);
  assert.match(editor, /Supprimer l’élément/);
  assert.match(editor, /onEnter/);
  assert.match(editor, /addStructuredListItem/);
});

test("création / modification / persistance d’une publication riche", () => {
  const created = sampleDoc();
  const payload = buildPublicationPayload(created);
  assert.ok(payload);
  assert.match(payload!.detail, new RegExp(`^${CAMPUS_RICH_DETAIL_PREFIX}`));
  const decoded = decodeRichDetail(payload!.detail);
  assert.ok(decoded);
  assert.equal(decoded!.blocks[0]?.type, "heading");
  const updated = sanitizeRichDoc({
    ...decoded!,
    blocks: [
      ...decoded!.blocks,
      { type: "paragraph", inlines: [{ text: "À avancer en classe." }] },
    ],
  });
  const again = decodeRichDetail(buildPublicationPayload(updated)!.detail);
  assert.equal(again?.blocks.at(-1)?.type, "paragraph");
  assert.match(JSON.stringify(again), /À avancer en classe/);
});

test("titre, gras, italique, souligné, couleur, surlignage, listes, lien, checklist", () => {
  const doc = sampleDoc();
  const heading = doc.blocks[0];
  assert.equal(heading?.type, "heading");
  if (heading?.type === "heading") {
    assert.equal(heading.inlines[0]?.marks?.bold, true);
    assert.equal(heading.inlines[0]?.marks?.underline, true);
  }
  const paragraph = doc.blocks[1];
  if (paragraph?.type === "paragraph") {
    assert.equal(paragraph.inlines[0]?.marks?.italic, true);
  }
  const colored = doc.blocks[2];
  if (colored?.type === "paragraph") {
    assert.equal(colored.inlines[0]?.marks?.color, "blue");
    assert.equal(colored.inlines[2]?.marks?.highlight, true);
    assert.equal(colored.inlines[2]?.marks?.color, "red");
  }
  assert.equal(doc.blocks[3]?.type, "bulletList");
  assert.equal(doc.blocks[4]?.type, "orderedList");
  const link = doc.blocks[5];
  if (link?.type === "paragraph") {
    assert.equal(link.inlines[0]?.marks?.href, "https://campusagenda.ch");
  }
  assert.equal(doc.blocks[6]?.type, "checklist");
});

test("blocs rapides — pas de bloc Contrôle", () => {
  const withBlock = insertQuickBlock(emptyRichDoc(), "finish");
  assert.equal(withBlock.blocks[0]?.type, "callout");
  if (withBlock.blocks[0]?.type === "callout") {
    assert.equal(withBlock.blocks[0].kind, "finish");
  }
  const rejected = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "callout", kind: "control", inlines: [{ text: "interdit" }] }],
  });
  assert.equal(rejected.blocks.length, 0);
});

test("aperçu élève = même document que la publication", () => {
  const doc = sampleDoc();
  const stored = decodeRichDetail(buildPublicationPayload(doc)!.detail);
  assert.deepEqual(stored, doc);
  assert.equal(excerptRichDoc(stored), excerptRichDoc(doc));
});

test("ancien texte brut toujours lisible", () => {
  const items = [
    item({ id: 1, type: "HOMEWORK", title: "Révision du chapitre injection", detail: "Aucune précision" }),
    item({ id: 2, type: "INFORMATION", title: "Apporter le poly", detail: "" }),
  ];
  const doc = composeWeekPublicationDoc(items);
  assert.equal(isEmptyRichDoc(doc), false);
  assert.match(excerptRichDoc(doc), /Révision du chapitre injection/);
  assert.match(excerptRichDoc(doc), /Apporter le poly/);
});

test("notes prof privées — jamais dans une publication", () => {
  const notes = setWeekRichNote({ version: 1, weeks: {} }, "classe-a:4", fromPlainText("Préparer capteur PMH"));
  const publication = composeWeekPublicationDoc([
    item({ id: 3, type: "HOMEWORK", title: "Exercices 3 à 9", detail: "" }),
  ]);
  assert.doesNotMatch(JSON.stringify(publication), /Préparer capteur PMH/);
  assert.match(JSON.stringify(notes), /Préparer capteur PMH/);
  assert.equal(isClassNotesPayload(notes), true);
});

test("copie semaine précédente — indépendante, sans contrôle ni notes", () => {
  const sourceItems: PrototypeAgendaItem[] = [
    item({
      id: 10,
      type: "HOMEWORK",
      schoolWeekNumber: 3,
      title: "Semaine 3",
      detail: encodeRichDetail(fromPlainText("Contenu source")),
    }),
    item({ id: 11, type: "TEST", schoolWeekNumber: 3, title: "Contrôle injection" }),
  ];
  const source = composeWeekPublicationDoc(sourceItems.filter((entry) => entry.schoolWeekNumber === 3));
  const copied = cloneRichDoc(source);
  copied.blocks.push({ type: "paragraph", inlines: [{ text: "Nouveau" }] });
  assert.doesNotMatch(JSON.stringify(source), /Nouveau/);
  assert.doesNotMatch(JSON.stringify(copied), /Contrôle injection/);
  assert.doesNotMatch(JSON.stringify(copied), /Préparer/);
  assert.ok(sourceItems.filter(isPublicationLine).every((entry) => entry.type !== "TEST"));
  assert.equal(previousSchoolWeekNumber([{ number: 1 }, { number: 3 }, { number: 4 }], 4), 3);
});

test("protection XSS / contenu dangereux", () => {
  assert.equal(sanitizeHref("javascript:alert(1)"), undefined);
  assert.equal(sanitizeHref("https://ok.example"), "https://ok.example");
  const dirty = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [
      {
        type: "paragraph",
        inlines: [{ text: "clic", marks: { href: "javascript:alert(1)" } }],
      },
      { type: "heading", inlines: [{ text: "<script>alert(1)</script>" }] },
    ],
  });
  const link = dirty.blocks[0];
  if (link?.type === "paragraph") {
    assert.equal(link.inlines[0]?.marks?.href, undefined);
  }
  assert.equal(rejectDangerousRichPayload({ html: "<script>alert(1)</script>" }), true);
  assert.equal(rejectDangerousRichPayload(sampleDoc()), false);
});

test("foldable — seuls les items Carnet, pas les publications structurées", () => {
  const items = [
    item({ id: 1, type: "HOMEWORK", title: "Carnet", detail: "" }),
    item({
      id: 2,
      type: "HOMEWORK",
      title: "Structuré",
      annualCourseId: "ac-1",
      courseSessionKey: "year|ac-1|2026-08-17",
    }),
    item({ id: 3, type: "TEST", title: "Contrôle" }),
  ];
  assert.deepEqual(
    listFoldableCarnetPublications(items).map((entry) => entry.id),
    [1],
  );
});

test("semaine mixte — l’éditeur n’ouvre que la publication Carnet et la sauvegarde n’altère pas le structuré", () => {
  const carnet = item({
    id: 41,
    type: "HOMEWORK",
    title: "Révision Carnet injection",
    detail: encodeRichDetail(fromPlainText("Révision Carnet injection")),
  });
  const structured = item({
    id: 42,
    type: "HOMEWORK",
    title: "Publication structurée CourseSession",
    detail: "Ne pas absorber",
    annualCourseId: "ac-moteur",
    courseSessionKey: "year|ac-moteur|2026-09-14",
  });
  const week = [carnet, structured];

  assert.equal(isCarnetOwnedPublication(carnet), true);
  assert.equal(isCarnetOwnedPublication(structured), false);

  const opened = composeWeekPublicationDoc(week);
  assert.match(excerptRichDoc(opened), /Révision Carnet injection/);
  assert.doesNotMatch(excerptRichDoc(opened), /Publication structurée CourseSession/);
  assert.doesNotMatch(JSON.stringify(opened), /Ne pas absorber/);
  assert.deepEqual(
    listFoldableCarnetPublications(week).map((entry) => entry.id),
    [41],
  );

  const savedDoc = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "paragraph", inlines: [{ text: "Texte Carnet modifié" }] }],
  });
  const plan = planCarnetWeekPublicationSave(week, savedDoc);
  assert.equal(plan.action, "update");
  if (plan.action === "update") {
    assert.equal(plan.updateId, 41);
    assert.deepEqual(plan.deleteIds, []);
    assert.match(plan.payload.detail, /Texte Carnet modifié/);
    assert.doesNotMatch(plan.payload.detail, /Publication structurée CourseSession/);
  }
  assert.equal(savePlanTouchesItem(plan, 42), false);
  assert.equal(structured.title, "Publication structurée CourseSession");
  assert.equal(structured.detail, "Ne pas absorber");
  assert.equal(structured.annualCourseId, "ac-moteur");

  const emptyPlan = planCarnetWeekPublicationSave(week, emptyRichDoc());
  assert.equal(emptyPlan.action, "clear");
  if (emptyPlan.action === "clear") {
    assert.deepEqual(emptyPlan.deleteIds, [41]);
  }
  assert.equal(savePlanTouchesItem(emptyPlan, 42), false);

  const onlyStructured = composeWeekPublicationDoc([structured]);
  assert.equal(isEmptyRichDoc(onlyStructured), true);

  const copied = composeWeekPublicationDoc([
    structured,
    item({
      id: 43,
      type: "HOMEWORK",
      schoolWeekNumber: 3,
      title: "Source Carnet",
      detail: encodeRichDetail(fromPlainText("Source Carnet")),
    }),
  ]);
  assert.match(excerptRichDoc(copied), /Source Carnet/);
  assert.doesNotMatch(excerptRichDoc(copied), /Publication structurée CourseSession/);
});

test("parseur — HTML Chrome execCommand hiliteColor / foreColor, pas seulement <mark>", () => {
  const chromeHighlight = parseInlinesFromHtml(
    '<span style="background-color: rgb(254, 240, 138);">question 30</span>',
  );
  assert.equal(chromeHighlight[0]?.text, "question 30");
  assert.equal(chromeHighlight[0]?.marks?.highlight, true);

  const chromeColor = parseInlinesFromHtml('<span style="color: rgb(29, 78, 216);">4.7.06-5</span>');
  assert.equal(chromeColor[0]?.text, "4.7.06-5");
  assert.equal(chromeColor[0]?.marks?.color, "blue");

  const fontColor = parseInlinesFromHtml('<font color="#b42318">alerte</font>');
  assert.equal(fontColor[0]?.marks?.color, "red");

  const yellow = parseInlinesFromHtml('<span style="background-color: yellow;">marqué</span>');
  assert.equal(yellow[0]?.marks?.highlight, true);

  const markTag = parseInlinesFromHtml("<mark>ancien</mark>");
  assert.equal(markTag[0]?.marks?.highlight, true);

  const persisted = decodeRichDetail(
    encodeRichDetail({
      format: "campus-rich-v1",
      blocks: [
        {
          type: "paragraph",
          inlines: [
            ...chromeHighlight,
            { text: " " },
            ...chromeColor,
          ],
        },
      ],
    }),
  );
  const paragraph = persisted?.blocks[0];
  assert.ok(paragraph && paragraph.type === "paragraph");
  if (paragraph && paragraph.type === "paragraph") {
    assert.equal(paragraph.inlines[0]?.marks?.highlight, true);
    assert.equal(paragraph.inlines[2]?.marks?.color, "blue");
  }
});

test("listes et checklists — plusieurs éléments, ajout et suppression", () => {
  let bullets: CampusRichDoc["blocks"][number] = { type: "bulletList", items: [[{ text: "un" }]] };
  bullets = addStructuredListItem(bullets);
  bullets = addStructuredListItem(bullets);
  assert.ok(bullets.type === "bulletList");
  if (bullets.type === "bulletList") {
    assert.equal(bullets.items.length, 3);
    bullets = removeStructuredListItem(bullets, 1);
    assert.ok(bullets.type === "bulletList");
    if (bullets.type === "bulletList") assert.equal(bullets.items.length, 2);
  }

  let numbered: CampusRichDoc["blocks"][number] = { type: "orderedList", items: [[{ text: "a" }]] };
  numbered = addStructuredListItem(numbered, 0);
  numbered = addStructuredListItem(numbered, 1);
  assert.ok(numbered.type === "orderedList" && numbered.items.length === 3);

  let checks: CampusRichDoc["blocks"][number] = {
    type: "checklist",
    items: [{ checked: false, inlines: [{ text: "case 1" }] }],
  };
  checks = addStructuredListItem(checks);
  checks = addStructuredListItem(checks);
  assert.ok(checks.type === "checklist" && checks.items.length === 3);
});

test("notes prof — document riche + ancien texte, normalisation", () => {
  const body = sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: [{ type: "checklist", items: [{ checked: true, inlines: [{ text: "Vérifier les absents", marks: { bold: true } }] }] }],
  });
  const saved = setWeekRichNote({ version: 1, weeks: {} }, "classe-a:2", body);
  const composed = composeWeekNotesDoc(saved.weeks["classe-a:2"] ?? []);
  assert.equal(composed.blocks[0]?.type, "checklist");

  const legacy = composeWeekNotesDoc([{ id: "n1", text: "Ancienne note brute" }]);
  assert.equal(legacy.blocks[0]?.type, "paragraph");
  assert.equal(excerptRichDoc(legacy), "Ancienne note brute");

  const normalized = normalizeClassNotes({
    version: 1,
    weeks: {
      "classe-a:2": [{ id: "keep", text: "  ", body }],
      "classe-a:3": [{ id: "drop", text: "   " }],
    },
  });
  assert.ok(normalized.weeks["classe-a:2"]?.[0]?.body);
  assert.equal(normalized.weeks["classe-a:3"], undefined);
});

test("backup notes — ancien JSON et nouveau body restaurables", async () => {
  resetMemoryTeacherNotesStore();
  const memory = getMemoryTeacherNotesStore();
  const legacy = { version: 1 as const, weeks: { "classe-a:1": [{ id: "n1", text: "Legacy" }] } };
  await memory.saveNotes("teacher-1", legacy);
  assert.deepEqual((await memory.getNotes("teacher-1"))?.weeks["classe-a:1"], [{ id: "n1", text: "Legacy" }]);

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const store = new SqlTeacherNotesStore(db);
  const rich = setWeekRichNote({ version: 1, weeks: {} }, "classe-a:5", sampleDoc());
  await store.saveNotes(TEACHER_CHF_ID, rich);
  const roundtrip = await store.getNotes(TEACHER_CHF_ID);
  assert.equal(roundtrip?.weeks["classe-a:5"]?.[0]?.body?.format, "campus-rich-v1");
  const dumped = await store.exportAllNotes();
  await store.replaceAllNotes(dumped);
  const restored = await store.getNotes(TEACHER_CHF_ID);
  assert.deepEqual(restored?.weeks["classe-a:5"]?.[0]?.body, rich.weeks["classe-a:5"]?.[0]?.body);
  db.close();
});
