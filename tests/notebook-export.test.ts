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
  exportLineHasMark,
  exportLinesContainRawRichPayload,
  filterSessionsForExportPeriod,
  fontKindForMarks,
  formatCourseScheduleSummary,
  highlightHexForMarks,
  notebookExportFilename,
  parseNotebookExportOptions,
  publicationToExportLines,
  renderNotebookExportPdf,
  richDocToExportLines,
  summaryLinesForSession,
  underlineForMarks,
} from "../src/features/notebook-export/index.ts";
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
  assert.match(panel, /annualCourseId\?\.trim\(\) \? \(/);
  assert.match(panel, /Exporter le carnet/);
  assert.match(modal, /Publications élèves/);
  assert.match(modal, /Contrôles/);
  assert.match(modal, /Notes professeur/);
  assert.match(modal, /Brouillons/);
  assert.doesNotMatch(modal, /<legend>Information/);
  assert.doesNotMatch(modal, />Informations</);
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

