import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import {
  buildPublicationPayload,
  encodeRichDetail,
  fromPlainText,
  QUICK_BLOCK_LABELS,
  weekNotesKey,
} from "../src/features/class-notebook/index.ts";
import type { CourseScheduleSlot, CourseWeekKind, CourseWeekday } from "../src/features/course-schedule/types.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import { canMutateAgenda } from "../src/lib/auth/permissions.ts";
import {
  assembleNotebookExport,
  COURSE_TIMELINE_FORBIDDEN_REASON,
  DEFAULT_NOTEBOOK_EXPORT_OPTIONS,
  diagnoseAnnualCourseTests,
  exportLineHasMark,
  exportLinesContainRawRichPayload,
  filterSessionsForExportPeriod,
  fontKindForMarks,
  formatCourseScheduleSummary,
  formatNotebookExportCoverage,
  highlightHexForMarks,
  isUnambiguousLegacyTestForCourse,
  matchAgendaItemToSession,
  notebookExportFilename,
  NOTEBOOK_EXPORT_UNMATCHED_CONTROLS_TITLE,
  parseNotebookExportOptions,
  publicationToExportLines,
  renderNotebookExportPdf,
  resolveAgendaItemSession,
  richDocToExportLines,
  summaryLinesForSession,
  underlineForMarks,
} from "../src/features/notebook-export/index.ts";
import { openPdfDocument } from "../src/lib/pdf/open-pdf-document.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";

const COURSE = { id: "ac-export", classId: "class-demo", contextId: "ctx-demo" };

function weeks(): SchoolWeekEntry[] {
  return [
    { number: 5, kind: "A", monday: "2026-09-14" },
    { number: 6, kind: "B", monday: "2026-09-21" },
    { number: 7, kind: "A", monday: "2026-09-28" },
    { number: 8, kind: "B", monday: "2026-10-05" },
    { number: 9, kind: "A", monday: "2026-10-26" },
    { number: 10, kind: "B", monday: "2026-11-02" },
  ];
}

function slot(patch: Partial<CourseScheduleSlot> & { weekKind?: CourseWeekKind; dayOfWeek?: CourseWeekday }): CourseScheduleSlot {
  return {
    id: patch.id ?? "slot-1",
    annualCourseId: patch.annualCourseId ?? COURSE.id,
    dayOfWeek: patch.dayOfWeek ?? 4,
    periodStart: patch.periodStart ?? 3,
    periodEnd: patch.periodEnd ?? 4,
    weekKind: patch.weekKind ?? "B",
    validFrom: patch.validFrom ?? null,
    validTo: patch.validTo ?? null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function sessionsFor(options: {
  slots: CourseScheduleSlot[];
  holidays?: { date: string; label: string }[];
  exceptions?: { date: string; state: "class" | "holiday"; label: string | null }[];
}) {
  return computeCourseSessions({
    schoolYearId: "SY-2026-27",
    courses: [COURSE],
    slots: options.slots,
    weeks: weeks(),
    holidays: options.holidays,
    exceptions: options.exceptions,
  });
}

function item(patch: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "type" | "title">): PrototypeAgendaItem {
  return {
    classroomId: "class-demo",
    subjectId: "subj-demo",
    authorTeacherId: "teacher-demo",
    day: 3,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 6,
    detail: "",
    ...patch,
  };
}

function assemble(options: {
  slots?: CourseScheduleSlot[];
  items?: PrototypeAgendaItem[];
  exportOptions?: Partial<typeof DEFAULT_NOTEBOOK_EXPORT_OPTIONS>;
  notes?: Parameters<typeof assembleNotebookExport>[0]["notes"];
  holidays?: { date: string; label: string }[];
  exceptions?: { date: string; state: "class" | "holiday"; label: string | null }[];
}) {
  const computed = sessionsFor({
    slots: options.slots ?? [slot({})],
    holidays: options.holidays,
    exceptions: options.exceptions,
  });
  return assembleNotebookExport({
    sessions: computed,
    weeks: weeks(),
    items: options.items ?? [],
    notes: options.notes ?? null,
    annualCourseId: COURSE.id,
    classId: COURSE.classId,
    classCode: "MECAUTO3A",
    classLabel: "MECAUTO3A",
    branchLabel: "Injection",
    schoolYearLabel: "2026–2027",
    teacherName: "François Cheseaux",
    scheduleSummary: formatCourseScheduleSummary(options.slots ?? [slot({})]),
    generatedOn: "07.10.2026",
    options: { ...DEFAULT_NOTEBOOK_EXPORT_OPTIONS, ...options.exportOptions },
  });
}

test("export — options par défaut : publications et contrôles, pas notes ni brouillons", () => {
  assert.deepEqual(DEFAULT_NOTEBOOK_EXPORT_OPTIONS, {
    includePublications: true,
    includeControls: true,
    includeTeacherNotes: false,
    includeDrafts: false,
    period: "year",
    layout: "summary",
    coverPage: true,
  });
  const parsed = parseNotebookExportOptions({});
  assert.equal(parsed.includePublications, true);
  assert.equal(parsed.includeControls, true);
  assert.equal(parsed.includeTeacherNotes, false);
  assert.equal(parsed.includeDrafts, false);
});

test("export — bouton et fenêtre uniquement pour un cours ouvert, sans catégorie Information", async () => {
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  const modal = await readFile(new URL("../web/app/components/notebook-export-modal.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(panel, /annualCourseId\?\.trim\(\) \? \(/);
  assert.match(panel, /Exporter le carnet/);
  assert.match(modal, /Publications élèves/);
  assert.match(modal, /Contrôles/);
  assert.match(modal, /Notes professeur/);
  assert.match(modal, /Brouillons/);
  assert.match(modal, /notebook-export-option/);
  assert.doesNotMatch(modal, /<legend>Information/);
  assert.doesNotMatch(modal, />Informations</);
  assert.match(css, /\.notebook-export-modal \.notebook-export-option \{/);
  assert.match(css, /text-transform: none;/);
  assert.match(css, /flex: 0 0 16px;/);
});

test("export — limité au AnnualCourse ouvert / CourseSession semaine B", () => {
  const doc = assemble({
    items: [
      item({ id: 1, type: "HOMEWORK", title: "Devoir injection", schoolWeekNumber: 6, day: 3, studentVisible: true }),
      item({
        id: 99,
        type: "HOMEWORK",
        title: "Autre cours",
        schoolWeekNumber: 6,
        day: 3,
        annualCourseId: "ac-other",
        studentVisible: true,
      }),
    ],
  });
  assert.ok(doc);
  assert.deepEqual(
    doc!.sessions.map((block) => block.weekLabel),
    ["Sem 06-B"],
  );
  const allB = sessionsFor({ slots: [slot({})] });
  assert.deepEqual(
    allB.map((session) => `${session.schoolWeekNumber}-${session.weekKind}`),
    ["6-B", "8-B", "10-B"],
  );
  assert.equal(allB.some((session) => session.weekKind === "A"), false);
  assert.equal(doc!.sessions[0]?.dateLabel, "Jeudi 24.09.2026");
  assert.equal(doc!.sessions[0]?.publications.some((line) => line.text.includes("Autre cours")), false);
});

test("export — vacances, férié, exception, validFrom/validTo, toutes les semaines", () => {
  const holiday = assemble({
    holidays: [{ date: "2026-10-08", label: "Jeûne" }],
    items: [
      item({ id: 1, type: "TEST", title: "C1", schoolWeekNumber: 6, day: 3 }),
      item({ id: 2, type: "TEST", title: "C2", schoolWeekNumber: 8, day: 3 }),
    ],
  });
  assert.equal(holiday?.sessions.some((block) => block.session.schoolWeekNumber === 8), false);

  const restored = sessionsFor({
    slots: [slot({})],
    holidays: [{ date: "2026-10-08", label: "Jeûne" }],
    exceptions: [{ date: "2026-10-08", state: "class", label: "Maintenu" }],
  });
  assert.equal(restored.some((session) => session.schoolWeekNumber === 8), true);

  const ranged = assemble({
    slots: [
      slot({ id: "first", validTo: "2026-10-10" }),
      slot({ id: "second", weekKind: "all", dayOfWeek: 4, periodStart: 3, periodEnd: 3, validFrom: "2026-10-20" }),
    ],
    items: [item({ id: 1, type: "TEST", title: "C1", schoolWeekNumber: 9, day: 3 })],
  });
  assert.ok(ranged?.sessions.some((block) => block.session.schoolWeekNumber === 9));

  const allWeeks = sessionsFor({ slots: [slot({ weekKind: "all" })] });
  assert.deepEqual(
    [...new Set(allWeeks.map((session) => session.schoolWeekNumber))],
    [5, 6, 7, 8, 9, 10],
  );
});

test("export — publication et contrôle rattachés au bon day, plusieurs séances / périodes", () => {
  const twoDays = assemble({
    slots: [slot({ id: "mon", dayOfWeek: 1 }), slot({ id: "thu", dayOfWeek: 4 })],
    items: [
      item({ id: 1, type: "HOMEWORK", title: "Lundi", schoolWeekNumber: 6, day: 0, studentVisible: true }),
      item({ id: 2, type: "TEST", title: "Contrôle jeudi", schoolWeekNumber: 6, day: 3 }),
    ],
  });
  const week6 = twoDays?.sessions.filter((block) => block.session.schoolWeekNumber === 6) ?? [];
  assert.equal(week6.length, 2);
  assert.equal(week6[0]?.session.dayOfWeek, 1);
  assert.equal(week6[0]?.publications.some((line) => line.text.includes("Lundi")), true);
  assert.equal(week6[1]?.controls.includes("Contrôle jeudi"), true);

  const sameDay = sessionsFor({
    slots: [
      slot({ id: "p3", periodStart: 3, periodEnd: 3 }),
      slot({ id: "p4", periodStart: 4, periodEnd: 4 }),
    ],
  });
  assert.equal(sameDay.filter((session) => session.schoolWeekNumber === 6).length, 1);
});

test("export — CampusRichDoc structuré, callout Information dans la publication, jamais JSON brut", () => {
  const doc = {
    format: "campus-rich-v1" as const,
    blocks: [
      { type: "heading" as const, inlines: [{ text: "Moteur" }] },
      { type: "callout" as const, kind: "info" as const, inlines: [{ text: "Apporter le dossier" }] },
    ],
  };
  const lines = richDocToExportLines(doc);
  assert.equal(lines[0]?.kind, "heading");
  assert.match(lines[1]?.text ?? "", /Information/);
  assert.match(lines[1]?.text ?? "", /Apporter le dossier/);
  assert.equal(QUICK_BLOCK_LABELS.info, "Information");
  assert.equal(exportLinesContainRawRichPayload(lines), false);
  const fromItem = publicationToExportLines("Titre synthétique", encodeRichDetail(doc));
  assert.equal(exportLinesContainRawRichPayload(fromItem), false);
  assert.doesNotMatch(fromItem.map((line) => line.text).join("\n"), /CAMPUS_RICH_V1/);
  assert.equal(fromItem.some((line) => line.text.includes("Titre synthétique")), false);
});

test("export — brouillons et notes prof selon les cases", () => {
  const draft = item({
    id: 1,
    type: "HOMEWORK",
    title: "Brouillon",
    studentVisible: false,
  });
  const published = item({
    id: 2,
    type: "HOMEWORK",
    title: "Publié",
    studentVisible: true,
  });
  const withoutDraft = assemble({ items: [draft, published] });
  assert.equal(withoutDraft?.sessions[0]?.publications.some((line) => line.text.includes("Brouillon")), false);
  const withDraft = assemble({
    items: [draft, published],
    exportOptions: { includeDrafts: true },
  });
  assert.equal(withDraft?.sessions[0]?.publications.some((line) => line.text.includes("Brouillon")), true);

  const notesDoc = {
    version: 1 as const,
    weeks: {
      [weekNotesKey("class-demo", 6)]: [{ id: "n1", text: "Prévoir EGR" }],
    },
  };
  const hiddenNotes = assemble({
    items: [published],
    notes: notesDoc,
  });
  assert.equal(hiddenNotes?.sessions[0]?.notes.length ?? 0, 0);
  const shownNotes = assemble({
    items: [published],
    notes: notesDoc,
    exportOptions: { includeTeacherNotes: true },
  });
  assert.equal(shownNotes?.sessions[0]?.notes.some((line) => line.text.includes("Prévoir EGR")), true);
});

test("export — semestres, année complète, vide, nom de fichier, PDF valide", async () => {
  const computed = sessionsFor({ slots: [slot({})] });
  const s1 = filterSessionsForExportPeriod(computed, weeks(), "semester-1");
  const s2 = filterSessionsForExportPeriod(computed, weeks(), "semester-2");
  const year = filterSessionsForExportPeriod(computed, weeks(), "year");
  assert.ok(s1.length && s2.length);
  assert.equal(year.length, computed.length);
  assert.equal(
    s1.some((session) => s2.some((other) => other.schoolWeekNumber === session.schoolWeekNumber)),
    false,
  );

  const empty = assemble({ items: [] });
  assert.equal(empty, null);

  assert.equal(
    notebookExportFilename({
      classCode: "MECAUTO3A",
      branchLabel: "CP Léger Injection, dépollution",
      schoolYearLabel: "2026–2027",
    }),
    "CampusAgenda_MECAUTO3A_CP-Leger-Injection-depollution_2026-2027.pdf",
  );

  const built = assemble({
    items: [item({ id: 1, type: "HOMEWORK", title: "Devoir", studentVisible: true })],
  });
  assert.ok(built);
  assert.equal(built!.sessionCount, computed.length);
  assert.equal(built!.sessions.length, 1);
  const semester1 = assemble({
    items: [item({ id: 1, type: "HOMEWORK", title: "Devoir", studentVisible: true })],
    exportOptions: { period: "semester-1" },
  });
  const semester2 = assemble({
    items: [item({ id: 2, type: "TEST", title: "C2", schoolWeekNumber: 10, day: 3 })],
    exportOptions: { period: "semester-2" },
  });
  assert.equal(semester1?.sessionCount, s1.length);
  assert.equal(semester2?.sessionCount, s2.length);
  const pdf = await renderNotebookExportPdf(built!);
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString("latin1"), "%PDF-");
  assert.match(Buffer.from(pdf.slice(-32)).toString("latin1"), /%%EOF/);
  assert.ok(pdf.byteLength > 500);
});

test("export — horaire résumé depuis les slots, pas le jour générique de classe", () => {
  assert.equal(formatCourseScheduleSummary([slot({})]), "Jeudi · semaines B · P3-P4");
  assert.equal(
    formatCourseScheduleSummary([slot({ weekKind: "all", dayOfWeek: 2, periodStart: 2, periodEnd: 2 })]),
    "Mardi · toutes les semaines · P2",
  );
});

test("export — sécurité enseignant, élève interdit, professeur non assigné", async () => {
  const route = await readFile(new URL("../web/app/api/teacher/notebook-export/route.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../src/features/notebook-export/service.ts", import.meta.url), "utf8");
  const modal = await readFile(new URL("../web/app/components/notebook-export-modal.tsx", import.meta.url), "utf8");
  assert.match(route, /requireTeacherSession/);
  assert.match(route, /auth\.session!\.teacherId/);
  assert.doesNotMatch(route, /body\.teacherId/);
  assert.match(service, /getTeacherCourseTimeline/);
  assert.match(service, /includeTeacherNotes \? await deps\.notes\.getNotes/);
  assert.match(modal, /DEFAULT_NOTEBOOK_EXPORT_OPTIONS/);
  assert.doesNotMatch(route, /kind === "student"/);
  assert.equal(canMutateAgenda({ kind: "student", classroomId: "class-demo", code: "ABC" } as never), false);
  assert.equal(canMutateAgenda({ kind: "teacher", teacherId: "teacher-demo" } as never), true);
  assert.match(COURSE_TIMELINE_FORBIDDEN_REASON, /autorisé/);
  const fromPlain = fromPlainText("ok");
  assert.ok(fromPlain.blocks.length);
});

test("export — marks riches conservés (gras, italique, souligné, surlignage, couleur, lien, combinaison)", () => {
  const doc = {
    format: "campus-rich-v1" as const,
    blocks: [
      {
        type: "paragraph" as const,
        inlines: [
          { text: "gras", marks: { bold: true as const } },
          { text: " " },
          { text: "italique", marks: { italic: true as const } },
          { text: " " },
          { text: "souligné", marks: { underline: true as const } },
          { text: " " },
          { text: "surligné", marks: { highlight: true as const } },
          { text: " " },
          { text: "couleur", marks: { color: "red" as const } },
          { text: " " },
          { text: "lien", marks: { href: "https://campus.example/doc" } },
          { text: " " },
          { text: "combo", marks: { bold: true as const, italic: true as const, underline: true as const, highlight: true as const, color: "navy" as const, href: "https://campus.example/combo" } },
        ],
      },
    ],
  };
  const [line] = richDocToExportLines(doc);
  assert.ok(line);
  assert.equal(exportLineHasMark(line!, "bold"), true);
  assert.equal(exportLineHasMark(line!, "italic"), true);
  assert.equal(exportLineHasMark(line!, "underline"), true);
  assert.equal(exportLineHasMark(line!, "highlight"), true);
  assert.equal(exportLineHasMark(line!, "color"), true);
  assert.equal(exportLineHasMark(line!, "href"), true);
  const combo = line!.runs.find((run) => run.text === "combo");
  assert.equal(fontKindForMarks(combo?.marks), "boldItalic");
  assert.equal(underlineForMarks(combo?.marks), true);
  assert.ok(highlightHexForMarks(combo?.marks));
  assert.equal(combo?.marks?.color, "navy");
  assert.equal(combo?.marks?.href, "https://campus.example/combo");
  assert.equal(line!.runs.find((run) => run.text === "gras")?.marks?.bold, true);
  assert.equal(line!.runs.find((run) => run.text === "italique")?.marks?.italic, true);
});

test("export — publication riche via buildPublicationPayload sans titre dupliqué", () => {
  const doc = {
    format: "campus-rich-v1" as const,
    blocks: [
      { type: "heading" as const, inlines: [{ text: "Moteur" }] },
      { type: "paragraph" as const, inlines: [{ text: "Terminer exercice 4" }] },
      { type: "callout" as const, kind: "info" as const, inlines: [{ text: "apporter dossier" }] },
    ],
  };
  const payload = buildPublicationPayload(doc);
  assert.ok(payload);
  assert.match(payload!.title, /Moteur/);
  const lines = publicationToExportLines(payload!.title, payload!.detail);
  const joined = lines.map((line) => line.text).join("\n");
  assert.equal(joined.split("Moteur").length - 1, 1);
  assert.equal(joined.split("Terminer exercice 4").length - 1, 1);
  assert.equal(joined.includes(payload!.title) && payload!.title.includes("Terminer"), false);
  assert.doesNotMatch(joined, /CAMPUS_RICH_V1/);
  const legacy = publicationToExportLines("Devoir papier", "Lire le dossier");
  assert.equal(legacy[0]?.text, "Devoir papier");
  assert.equal(legacy[1]?.text, "Lire le dossier");
});

test("export — synthèse compacte distincte du carnet détaillé", async () => {
  const rich = encodeRichDetail({
    format: "campus-rich-v1",
    blocks: [
      { type: "heading", inlines: [{ text: "Moteur" }] },
      { type: "paragraph", inlines: [{ text: "Terminer exercice moteur", marks: { bold: true } }] },
      { type: "bulletList", items: [[{ text: "Revoir le schéma" }]] },
      { type: "callout", kind: "info", inlines: [{ text: "apporter dossier" }] },
    ],
  });
  const items = [
    item({ id: 1, type: "HOMEWORK", title: "ignored-title", detail: rich, studentVisible: true }),
    item({ id: 2, type: "TEST", title: "Injection", schoolWeekNumber: 6, day: 3 }),
  ];
  const summary = assemble({ items, exportOptions: { layout: "summary" } });
  const detailed = assemble({ items, exportOptions: { layout: "detailed" } });
  assert.ok(summary && detailed);
  const compact = summaryLinesForSession(summary!.sessions[0]!);
  assert.match(compact[0] ?? "", /SEM 06-B · Jeu\. 24\.09\.2026/);
  assert.equal(compact.some((line) => line.startsWith("Publication élèves —")), true);
  assert.equal(compact.some((line) => line.startsWith("Contrôle — Injection")), true);
  assert.equal(compact.some((line) => line.includes("Information")), true);
  assert.equal(compact.some((line) => line.includes("PUBLICATION ÉLÈVES")), false);
  assert.equal(detailed!.sessions[0]?.publications.some((line) => line.kind === "heading" && line.text === "Moteur"), true);
  assert.equal(detailed!.sessions[0]?.publications.some((line) => exportLineHasMark(line, "bold")), true);
  assert.ok(compact.join("\n").length < detailed!.sessions[0]!.publications.map((line) => line.text).join("\n").length + 80);
  const summaryPdf = await renderNotebookExportPdf(summary!);
  const detailedPdf = await renderNotebookExportPdf(detailed!);
  assert.equal(Buffer.from(summaryPdf.slice(0, 5)).toString("latin1"), "%PDF-");
  assert.equal(Buffer.from(detailedPdf.slice(0, 5)).toString("latin1"), "%PDF-");
  assert.notEqual(summaryPdf.byteLength, detailedPdf.byteLength);
});

function sessionByWeek(weekNumber: number) {
  const found = sessionsFor({ slots: [slot({})] }).find((session) => session.schoolWeekNumber === weekNumber);
  assert.ok(found, `séance semaine ${weekNumber}`);
  return found!;
}

async function pdfText(pdf: Uint8Array): Promise<string> {
  const document = await openPdfDocument(pdf);
  const parts: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const entry of content.items) {
      if ("str" in entry && typeof entry.str === "string") parts.push(entry.str);
    }
  }
  return parts.join(" ");
}

test("export — association key prioritaire même si semaine/jour incohérents", () => {
  const s6 = sessionByWeek(6);
  const itemWithKey = item({
    id: 1,
    type: "TEST",
    title: "C-key",
    annualCourseId: COURSE.id,
    courseSessionKey: s6.key,
    courseSessionDate: s6.date,
    schoolWeekNumber: 99,
    day: 0,
  });
  assert.equal(matchAgendaItemToSession(itemWithKey, s6), "MATCH_KEY");
  assert.equal(resolveAgendaItemSession(itemWithKey, sessionsFor({ slots: [slot({})] })).kind, "MATCH_KEY");
  const doc = assemble({ items: [itemWithKey] });
  assert.equal(doc?.controlCount, 1);
  assert.equal(doc?.sessions.some((block) => block.controls.includes("C-key")), true);
});

test("export — association par courseSessionDate sans key", () => {
  const s6 = sessionByWeek(6);
  const dated = item({
    id: 1,
    type: "TEST",
    title: "C-date",
    annualCourseId: COURSE.id,
    courseSessionKey: null,
    courseSessionDate: s6.date,
    schoolWeekNumber: 99,
    day: 0,
  });
  assert.equal(matchAgendaItemToSession(dated, s6), "MATCH_DATE");
  const doc = assemble({ items: [dated] });
  assert.equal(doc?.controlCount, 1);
  assert.equal(doc?.sessions[0]?.controls.includes("C-date"), true);
});

test("export — fallback historique semaine/jour pour ancien TEST sans key/date", () => {
  const s6 = sessionByWeek(6);
  const legacy = item({
    id: 1,
    type: "TEST",
    title: "C-legacy",
    annualCourseId: COURSE.id,
    schoolWeekNumber: 6,
    day: 3,
  });
  assert.equal(legacy.courseSessionKey, undefined);
  assert.equal(legacy.courseSessionDate, undefined);
  assert.equal(matchAgendaItemToSession(legacy, s6), "MATCH_WEEK_DAY");
  const doc = assemble({ items: [legacy] });
  assert.equal(doc?.controlCount, 1);
  assert.equal(doc?.sessions[0]?.controls.includes("C-legacy"), true);
});

test("export — TEST d'un autre AnnualCourse de la même classe jamais exporté", () => {
  const s6 = sessionByWeek(6);
  const doc = assemble({
    items: [
      item({
        id: 1,
        type: "TEST",
        title: "C-cours",
        annualCourseId: COURSE.id,
        courseSessionKey: s6.key,
        courseSessionDate: s6.date,
      }),
      item({
        id: 2,
        type: "TEST",
        title: "C-autre",
        annualCourseId: "ac-other",
        classroomId: "class-demo",
        courseSessionKey: s6.key,
        courseSessionDate: s6.date,
        schoolWeekNumber: 6,
        day: 3,
      }),
    ],
  });
  assert.equal(doc?.controlCount, 1);
  assert.equal(doc?.sessions.some((block) => block.controls.includes("C-autre")), false);
  assert.equal(doc?.unmatchedControls.some((entry) => entry.title === "C-autre"), false);
});

test("export — TEST non rattaché à une séance actuelle reste compté et listé", () => {
  const orphan = item({
    id: 7,
    type: "TEST",
    title: "C-orphelin",
    annualCourseId: COURSE.id,
    courseSessionKey: "SY-2026-27|ac-export|2099-01-01",
    courseSessionDate: "2099-01-01",
    schoolWeekNumber: 99,
    day: 0,
  });
  const diagnosis = diagnoseAnnualCourseTests([orphan], sessionsFor({ slots: [slot({})] }), COURSE.id);
  assert.equal(diagnosis[0]?.result, "UNMATCHED");
  const doc = assemble({ items: [orphan] });
  assert.ok(doc);
  assert.equal(doc!.controlCount, 1);
  assert.equal(doc!.sessions.some((block) => block.controls.includes("C-orphelin")), false);
  assert.equal(doc!.unmatchedControls.length, 1);
  assert.equal(doc!.unmatchedControls[0]?.title, "C-orphelin");
  assert.equal(doc!.unmatchedControls[0]?.dateLabel, "01.01.2099");
});

test("export — PDF des contrôles non rattachés", async () => {
  const orphan = item({
    id: 7,
    type: "TEST",
    title: "C-orphelin",
    annualCourseId: COURSE.id,
    courseSessionKey: "SY-2026-27|ac-export|2099-01-01",
    courseSessionDate: "2099-01-01",
    schoolWeekNumber: 99,
    day: 0,
  });
  const doc = assemble({ items: [orphan], exportOptions: { layout: "summary" } });
  assert.ok(doc);
  const pdf = await renderNotebookExportPdf(doc!);
  const text = await pdfText(pdf);
  assert.match(text, /C-orphelin/);
  assert.match(text, /1 contrôle/);
  assert.equal(text.includes(NOTEBOOK_EXPORT_UNMATCHED_CONTROLS_TITLE), true);
});

test("export — 2 TEST structurés : controlCount=2, jamais 0, PDF contient les titres", async () => {
  const s6 = sessionByWeek(6);
  const s10 = sessionByWeek(10);
  const items = [
    item({
      id: 1,
      type: "TEST",
      title: "ControleAlpha",
      annualCourseId: COURSE.id,
      courseSessionKey: s6.key,
      courseSessionDate: s6.date,
      schoolWeekNumber: 1,
      day: 0,
    }),
    item({
      id: 2,
      type: "TEST",
      title: "ControleBeta",
      annualCourseId: COURSE.id,
      courseSessionKey: s10.key,
      courseSessionDate: s10.date,
      schoolWeekNumber: 1,
      day: 0,
    }),
  ];
  const doc = assemble({ items });
  assert.ok(doc);
  assert.equal(doc!.controlCount, 2);
  assert.equal(formatNotebookExportCoverage(doc!), "3 séances  ·  0 publication élèves  ·  2 contrôles");
  assert.doesNotMatch(formatNotebookExportCoverage(doc!), /0 contrôle(?:s)?(?!\S)/);
  const titles = doc!.sessions.flatMap((block) => block.controls);
  assert.equal(titles.includes("ControleAlpha"), true);
  assert.equal(titles.includes("ControleBeta"), true);

  const pdf = await renderNotebookExportPdf(doc!);
  const text = await pdfText(pdf);
  assert.match(text, /ControleAlpha/);
  assert.match(text, /ControleBeta/);
  assert.match(text, /2 contrôles/);
  assert.doesNotMatch(text, /0 contrôle/);
});

test("export — singulier/pluriel de la couverture", () => {
  assert.equal(
    formatNotebookExportCoverage({ sessionCount: 0, publicationCount: 0, controlCount: 0 }),
    "0 séance  ·  0 publication élèves  ·  0 contrôle",
  );
  assert.equal(
    formatNotebookExportCoverage({ sessionCount: 1, publicationCount: 1, controlCount: 1 }),
    "1 séance  ·  1 publication élèves  ·  1 contrôle",
  );
  assert.equal(
    formatNotebookExportCoverage({ sessionCount: 10, publicationCount: 3, controlCount: 2 }),
    "10 séances  ·  3 publications élèves  ·  2 contrôles",
  );
});

test("export — année complète et semestres : période par date puis semaine", () => {
  const s6 = sessionByWeek(6);
  const s10 = sessionByWeek(10);
  const items = [
    item({
      id: 1,
      type: "TEST",
      title: "C-S1",
      annualCourseId: COURSE.id,
      courseSessionKey: s6.key,
      courseSessionDate: s6.date,
    }),
    item({
      id: 2,
      type: "TEST",
      title: "C-S2",
      annualCourseId: COURSE.id,
      courseSessionKey: s10.key,
      courseSessionDate: s10.date,
    }),
    item({
      id: 3,
      type: "TEST",
      title: "C-orphelin-S2",
      annualCourseId: COURSE.id,
      courseSessionKey: "gone-key",
      courseSessionDate: "2026-10-29",
      schoolWeekNumber: 9,
      day: 3,
    }),
  ];
  const year = assemble({ items, exportOptions: { period: "year" } });
  const semester1 = assemble({ items, exportOptions: { period: "semester-1" } });
  const semester2 = assemble({ items, exportOptions: { period: "semester-2" } });
  assert.equal(year?.controlCount, 3);
  assert.equal(semester1?.controlCount, 1);
  assert.equal(semester1?.sessions.some((block) => block.controls.includes("C-S1")), true);
  assert.equal(semester2?.controlCount, 2);
  assert.equal(semester2?.sessions.some((block) => block.controls.includes("C-S2")), true);
  assert.equal(semester2?.unmatchedControls.some((entry) => entry.title === "C-orphelin-S2"), true);
  assert.equal(semester1?.unmatchedControls.length, 0);
});

test("export — publications élèves inchangées avec le même rattachement", () => {
  const s6 = sessionByWeek(6);
  const items = [
    item({
      id: 1,
      type: "HOMEWORK",
      title: "Devoir visible",
      studentVisible: true,
      annualCourseId: COURSE.id,
      courseSessionKey: s6.key,
      courseSessionDate: s6.date,
      schoolWeekNumber: 99,
      day: 0,
    }),
    item({
      id: 2,
      type: "HOMEWORK",
      title: "Devoir historique",
      studentVisible: true,
      annualCourseId: COURSE.id,
      schoolWeekNumber: 6,
      day: 3,
    }),
    item({
      id: 3,
      type: "INFORMATION",
      title: "Info visible",
      studentVisible: true,
      annualCourseId: COURSE.id,
      schoolWeekNumber: 6,
      day: 3,
    }),
  ];
  const doc = assemble({ items });
  const texts = doc?.sessions[0]?.publications.map((line) => line.text).join("\n") ?? "";
  assert.match(texts, /Devoir visible/);
  assert.match(texts, /Devoir historique/);
  assert.match(texts, /Info visible/);
  assert.equal(doc?.publicationCount, 3);
  assert.equal(doc?.controlCount, 0);
});

test("export — diagnostic non destructif MATCH_KEY / DATE / WEEK_DAY / UNMATCHED", () => {
  const computed = sessionsFor({ slots: [slot({})] });
  const s6 = computed.find((session) => session.schoolWeekNumber === 6)!;
  const s10 = computed.find((session) => session.schoolWeekNumber === 10)!;
  const items = [
    item({
      id: 1,
      type: "TEST",
      title: "Par clé",
      annualCourseId: COURSE.id,
      courseSessionKey: s6.key,
      courseSessionDate: s6.date,
      schoolWeekNumber: 99,
      day: 0,
    }),
    item({
      id: 2,
      type: "TEST",
      title: "Par date",
      annualCourseId: COURSE.id,
      courseSessionDate: s10.date,
      schoolWeekNumber: 99,
      day: 0,
    }),
    item({
      id: 3,
      type: "TEST",
      title: "Par semaine",
      annualCourseId: COURSE.id,
      schoolWeekNumber: 6,
      day: 3,
    }),
    item({
      id: 4,
      type: "TEST",
      title: "Sans séance",
      annualCourseId: COURSE.id,
      courseSessionKey: "missing-key",
      courseSessionDate: "2099-12-31",
      schoolWeekNumber: 99,
      day: 0,
    }),
    item({
      id: 5,
      type: "TEST",
      title: "Autre cours",
      annualCourseId: "ac-other",
      schoolWeekNumber: 6,
      day: 3,
    }),
  ];
  const snapshot = items.map((entry) => ({ ...entry }));
  const rows = diagnoseAnnualCourseTests(items, computed, COURSE.id);
  assert.deepEqual(
    rows.map((row) => [row.id, row.title, row.result, row.annualCourseId]),
    [
      [1, "Par clé", "MATCH_KEY", COURSE.id],
      [2, "Par date", "MATCH_DATE", COURSE.id],
      [3, "Par semaine", "MATCH_WEEK_DAY", COURSE.id],
      [4, "Sans séance", "UNMATCHED", COURSE.id],
    ],
  );
  assert.equal(rows[0]?.courseSessionKey, s6.key);
  assert.equal(rows[1]?.courseSessionDate, s10.date);
  assert.equal(rows.some((row) => row.title === "Autre cours"), false);
  assert.deepEqual(items, snapshot);
});

test("export — intégration listAgendaItemsByAnnualCourse puis PDF", async () => {
  const s6 = sessionByWeek(6);
  const s10 = sessionByWeek(10);
  const store = new MemoryAgendaStore([]);
  await store.replaceAllItems([
    item({
      id: 11,
      type: "TEST",
      title: "ControleStoreA",
      annualCourseId: COURSE.id,
      courseSessionKey: s6.key,
      courseSessionDate: s6.date,
      schoolWeekNumber: 1,
      day: 0,
    }),
    item({
      id: 12,
      type: "TEST",
      title: "ControleStoreB",
      annualCourseId: COURSE.id,
      courseSessionKey: s10.key,
      courseSessionDate: s10.date,
      schoolWeekNumber: 1,
      day: 0,
    }),
    item({
      id: 13,
      type: "TEST",
      title: "ControleAutreCours",
      annualCourseId: "ac-other",
      classroomId: "class-demo",
      courseSessionKey: s6.key,
      courseSessionDate: s6.date,
      schoolWeekNumber: 6,
      day: 3,
    }),
  ]);
  const listed = await store.listAgendaItemsByAnnualCourse(COURSE.id);
  assert.equal(listed.length, 2);
  assert.equal(listed.some((entry) => entry.title === "ControleAutreCours"), false);
  const doc = assemble({ items: listed });
  assert.equal(doc?.controlCount, 2);
  assert.equal(formatNotebookExportCoverage(doc!), "3 séances  ·  0 publication élèves  ·  2 contrôles");
  const pdf = await renderNotebookExportPdf(doc!);
  const text = await pdfText(pdf);
  assert.match(text, /ControleStoreA/);
  assert.match(text, /ControleStoreB/);
  assert.match(text, /2 contrôles/);
  assert.doesNotMatch(text, /ControleAutreCours/);
  assert.doesNotMatch(text, /non rattachés/);
});

test("export — key invalide : date encore valide, sinon fallback semaine/jour", () => {
  const s6 = sessionByWeek(6);
  const staleKeyDate = item({
    id: 1,
    type: "TEST",
    title: "C-stale-key-date",
    annualCourseId: COURSE.id,
    courseSessionKey: "stale-key",
    courseSessionDate: s6.date,
    schoolWeekNumber: 99,
    day: 0,
  });
  assert.equal(resolveAgendaItemSession(staleKeyDate, sessionsFor({ slots: [slot({})] })).kind, "MATCH_DATE");
  const byDate = assemble({ items: [staleKeyDate] });
  assert.equal(byDate?.controlCount, 1);
  assert.equal(byDate?.sessions.some((block) => block.controls.includes("C-stale-key-date")), true);

  const staleKeyWeek = item({
    id: 2,
    type: "TEST",
    title: "C-stale-key-week",
    annualCourseId: COURSE.id,
    courseSessionKey: "stale-key",
    courseSessionDate: "2099-01-01",
    schoolWeekNumber: 6,
    day: 3,
  });
  assert.equal(resolveAgendaItemSession(staleKeyWeek, sessionsFor({ slots: [slot({})] })).kind, "MATCH_WEEK_DAY");
  const byWeek = assemble({ items: [staleKeyWeek] });
  assert.equal(byWeek?.sessions.some((block) => block.controls.includes("C-stale-key-week")), true);
});

test("export — publication structurée à key invalide ne disparaît pas", () => {
  const s6 = sessionByWeek(6);
  const doc = assemble({
    items: [
      item({
        id: 1,
        type: "HOMEWORK",
        title: "DevoirStaleKey",
        studentVisible: true,
        annualCourseId: COURSE.id,
        courseSessionKey: "obsolete-session-key",
        courseSessionDate: s6.date,
        schoolWeekNumber: 6,
        day: 3,
      }),
    ],
  });
  const texts = doc?.sessions.flatMap((block) => block.publications.map((line) => line.text)).join("\n") ?? "";
  assert.match(texts, /DevoirStaleKey/);
  assert.equal(doc?.publicationCount, 1);
});

test("export — TEST legacy sans annualCourseId seulement s'il est non ambigu", () => {
  const s6 = sessionByWeek(6);
  const course = {
    annualCourseId: COURSE.id,
    classroomId: "class-demo",
    subjectId: "subj-demo",
    schoolYearId: "SY-2026-27",
  };
  const sessions = sessionsFor({ slots: [slot({})] });
  const legacy = item({
    id: 1,
    type: "TEST",
    title: "C-legacy-null",
    classroomId: "class-demo",
    subjectId: "subj-demo",
    schoolYearId: "SY-2026-27",
    courseSessionDate: s6.date,
    schoolWeekNumber: 6,
    day: 3,
  });
  assert.equal(legacy.annualCourseId, undefined);
  assert.equal(isUnambiguousLegacyTestForCourse(legacy, course, sessions), true);
  const otherBranch = item({
    ...legacy,
    id: 2,
    title: "C-autre-branche",
    subjectId: "subj-other",
  });
  assert.equal(isUnambiguousLegacyTestForCourse(otherBranch, course, sessions), false);
  const otherClass = item({
    ...legacy,
    id: 3,
    title: "C-autre-classe",
    classroomId: "class-other",
  });
  assert.equal(isUnambiguousLegacyTestForCourse(otherClass, course, sessions), false);
});

test("export — Carnet structuré crée le contrôle via POST /api/teacher/controls", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  const perform = page.slice(page.indexOf("async function performNotebookControl"));
  const save = page.slice(page.indexOf("async function notebookSaveControl"));
  assert.match(page, /createTeacherControlApi/);
  assert.match(perform, /createTeacherControlApi/);
  assert.match(perform, /annualCourseId: input\.annualCourseId/);
  assert.match(perform, /courseSessionKey: input\.courseSessionKey/);
  assert.match(save, /notebookPublishAnnualCourseId/);
  assert.match(save, /courseSessionKey/);
  assert.match(save, /Ce cours n’a pas de séance à cette date/);
  assert.match(panel, /courseSessionForControlSlot/);
  assert.match(panel, /courseSessionKey: session\.key/);
  const structuredSave = save.slice(
    save.indexOf("if (notebookPublishAnnualCourseId)"),
    save.indexOf("evaluateThirdTestAlert"),
  );
  assert.match(structuredSave, /performNotebookControl/);
  assert.doesNotMatch(structuredSave, /createAgendaItemApi/);
});

