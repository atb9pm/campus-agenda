import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fitRemarkFontSize } from "../src/features/student/fit-remark-size.ts";

test("remarque — la taille du jour est conservée quand la ligne tient", () => {
  const result = fitRemarkFontSize(46, (size, singleLine) => singleLine && size <= 46);
  assert.equal(result.size, 46);
  assert.equal(result.singleLine, true);
});

test("remarque — la police rétrécit pour tenir sur une ligne", () => {
  const result = fitRemarkFontSize(46, (size, singleLine) => (singleLine ? size <= 28 : size <= 40));
  assert.equal(result.size, 28);
  assert.equal(result.singleLine, true);
});

test("remarque — deux lignes si une seule ligne serait trop petite", () => {
  const result = fitRemarkFontSize(46, (size, singleLine) => (singleLine ? size <= 16 : size <= 24));
  assert.equal(result.singleLine, false);
  assert.equal(result.size, 24);
});

test("remarque — plancher à 18 px", () => {
  const result = fitRemarkFontSize(46, () => false);
  assert.equal(result.size, 18);
  assert.equal(result.singleLine, false);
});

test("aperçu branche — menu en haut, logo en bas, bandeau, agenda élève inchangé", async () => {
  const [dashboard, page, css, controls, homework] = await Promise.all([
    readFile(new URL("../web/app/components/student-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-controls-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-homework-panel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /branchPreview=\{studentEntry === "teacher-branch-preview"\}/);
  assert.match(dashboard, /data-branch-preview/);
  assert.match(dashboard, /branch-preview-dock/);
  assert.match(dashboard, /Aperçu branche – Élève/);
  assert.match(dashboard, /Cours précédents/);
  assert.match(dashboard, /data-layout="tout"/);
  const branchBlock = dashboard.slice(dashboard.indexOf("branchPreview && (contentTab"));
  assert.ok(branchBlock.indexOf("StudentControlsPanel") < branchBlock.indexOf("StudentHomeworkPanel"));
  assert.match(homework, /branch-preview-banner-chip/);
  assert.match(homework, /hideChip/);
  assert.match(controls, /student-control-remark/);
  assert.match(controls, /fitRemarkFontSize/);
  assert.match(controls, /function ControlRow/);
  assert.match(css, /\.branch-preview \{[\s\S]*--course-day-size: 46px/);
  assert.match(css, /grid-template-columns: minmax\(0, 1\.62fr\) minmax\(0, 1fr\)/);
});
