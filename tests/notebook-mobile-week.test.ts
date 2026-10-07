import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { SchoolWeek } from "../src/features/calendar/types.ts";
import {
  NOTEBOOK_NARROW_VIEWPORT_MAX_PX,
  notebookWeekDisplayCountForViewport,
  shiftEligibleCourseWeek,
  visibleCourseWeeks,
  visibleSchoolWeeks,
} from "../src/features/class-notebook/index.ts";

function week(number: number): SchoolWeek {
  return { number, kind: "A", monday: new Date(2026, 8, number, 12) };
}

const SCHOOL_WEEKS = [5, 6, 7, 8, 9, 10].map(week);
const COURSE_WEEKS = [6, 8, 10, 12].map(week);

test("carnet mobile — ≤ 760 px force une semaine, desktop conserve 1–4", () => {
  assert.equal(NOTEBOOK_NARROW_VIEWPORT_MAX_PX, 760);
  assert.equal(notebookWeekDisplayCountForViewport(320, 3), 1);
  assert.equal(notebookWeekDisplayCountForViewport(760, 4), 1);
  assert.equal(notebookWeekDisplayCountForViewport(761, 3), 3);
  assert.equal(notebookWeekDisplayCountForViewport(1280, 4), 4);
  assert.equal(notebookWeekDisplayCountForViewport(1024, 2), 2);
  assert.equal(notebookWeekDisplayCountForViewport(900, 1), 1);
});

test("carnet mobile — une semaine à la fois conserve la semaine sélectionnée", () => {
  const mobileCount = notebookWeekDisplayCountForViewport(390, 3);
  assert.equal(mobileCount, 1);

  const structured = visibleCourseWeeks(COURSE_WEEKS, 8, mobileCount);
  assert.deepEqual(
    structured.map((item) => item.number),
    [8],
  );

  const school = visibleSchoolWeeks(SCHOOL_WEEKS, 7, mobileCount);
  assert.deepEqual(
    school.map((item) => item.number),
    [7],
  );
});

test("carnet mobile — ◀ ▶ changent toujours de semaine", () => {
  const eligible = COURSE_WEEKS.map((item) => item.number);
  assert.equal(shiftEligibleCourseWeek(eligible, 8, 1), 10);
  assert.equal(shiftEligibleCourseWeek(eligible, 8, -1), 6);
  assert.equal(shiftEligibleCourseWeek(eligible, 6, -1), null);
  assert.equal(shiftEligibleCourseWeek(eligible, 12, 1), null);

  const afterNext = visibleCourseWeeks(COURSE_WEEKS, 10, 1);
  assert.deepEqual(
    afterNext.map((item) => item.number),
    [10],
  );
});

test("carnet desktop — 1 / 2 / 3 / 4 semaines restent disponibles", () => {
  const desktopCount = notebookWeekDisplayCountForViewport(1024, 3);
  assert.equal(desktopCount, 3);
  assert.deepEqual(
    visibleCourseWeeks(COURSE_WEEKS, 6, desktopCount).map((item) => item.number),
    [6, 8, 10],
  );
  const fourWeeks = visibleSchoolWeeks(SCHOOL_WEEKS, 7, 4).map((item) => item.number);
  assert.equal(fourWeeks.length, 4);
  assert.ok(fourWeeks.includes(7));
});

test("carnet mobile — UI : une semaine, 2/3/4 masqués, ◀ ▶ et titre conservés", async () => {
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  const helper = await readFile(new URL("../src/features/class-notebook/week-window.ts", import.meta.url), "utf8");

  assert.match(helper, /NOTEBOOK_NARROW_VIEWPORT_MAX_PX = 760/);
  assert.match(panel, /notebookWeekDisplayCountForViewport/);
  assert.match(panel, /matchMedia\(NOTEBOOK_NARROW_MEDIA\)/);
  assert.match(panel, /effectiveWeekDisplayCount/);
  assert.match(panel, /visibleCourseWeeks\(eligibleWeeks, displayStartWeek, effectiveWeekDisplayCount\)/);
  assert.match(panel, /visibleSchoolWeeks\(schoolWeeks, centerWeekNumber, effectiveWeekDisplayCount\)/);
  assert.match(panel, /shiftVisibleWeeks\(-1\)/);
  assert.match(panel, /shiftVisibleWeeks\(1\)/);
  assert.match(panel, /aria-label="Semaines précédentes"/);
  assert.match(panel, /aria-label="Semaines suivantes"/);
  assert.match(panel, /classSetup\.name\} · \{branchLabel/);
  assert.match(panel, /\[1, 2, 3, 4\] as WeekDisplayCount\[\]/);
  assert.match(panel, /\{count\} semaine\{count > 1 \? "s" : ""\}/);

  const mobileCss = css.slice(css.indexOf("/* Carnet enseignant — smartphone"));
  assert.match(mobileCss, /@media \(max-width: 760px\) \{/);
  assert.match(mobileCss, /\.class-notebook-display-count \{ display: none; \}/);
  assert.match(mobileCss, /\.class-notebook-grid > \.class-notebook-column:not\(\.active\) \{ display: none; \}/);
  assert.match(mobileCss, /\.class-notebook-column \{ min-height: 0; \}/);
  assert.match(mobileCss, /\.class-notebook-title h2 \{/);
  const tabletCss = css.slice(css.indexOf("@media (max-width: 1030px)"), css.indexOf("@media (max-width: 760px)"));
  assert.doesNotMatch(tabletCss, /class-notebook-display-count/);
  assert.doesNotMatch(tabletCss, /class-notebook-column:not\(\.active\)/);
});

test("carnet mobile — AnnualCourse ouvert inchangé, pas de sélecteur CP2/CP3", async () => {
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /data-annual-course-id=\{annualCourseId \?\? undefined\}/);
  assert.match(panel, /fetchTeacherCourseTimelineApi\(courseId, controller\.signal\)/);
  assert.match(panel, /const courseId = annualCourseId\?\.trim\(\) \|\| ""/);
  assert.doesNotMatch(panel, /setOpenNotebookCourse/);
  assert.doesNotMatch(panel, /CP2/);
  assert.doesNotMatch(panel, /CP3/);
  assert.doesNotMatch(panel, /annualCourseId: "ac-/);
});

test("carnet mobile — Contrôles / Publications / Notes / Export inchangés", async () => {
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Contrôles 📅/);
  assert.match(panel, /📄 Exporter le carnet/);
  assert.match(panel, /Aperçu élève/);
  assert.match(panel, /onSaveControl/);
  assert.match(panel, /onDeleteControl/);
  assert.match(panel, /persistSaveWeekPublication/);
  assert.match(panel, /class-notebook-zone-notes/);
  assert.match(panel, /class-notebook-zone-publication/);
  assert.match(panel, /class-notebook-zone-control/);
  assert.match(panel, /<NotebookExportModal/);
  assert.match(panel, /<ControlsModal/);
  assert.doesNotMatch(panel, /onSaveControl = undefined/);
  assert.doesNotMatch(panel, /exportOpen \{ false \}/);
});
