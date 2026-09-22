import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

test("version 2.61.8 — carnet IBM Plex Sans 18 px, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.61.8");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0030_agenda_student_visible.sql");
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /family=IBM\+Plex\+Sans/);
  assert.match(css, /--font-sans: "IBM Plex Sans"/);
  assert.match(css, /--carnet-font: var\(--font-sans\)/);
  assert.match(css, /html[\s\S]{0,80}font-family: var\(--font-sans\)/);
  assert.match(css, /body[\s\S]{0,80}font-family: var\(--font-sans\)/);
  assert.doesNotMatch(css, /body[\s\S]{0,120}font-family: Inter/);
  assert.match(css, /\.technical-sidebar nav button[^{]*\{[^}]*font-size: 14px/);
  assert.match(css, /\.signout[^{]*\{[^}]*font-size: 13px/);
  assert.match(css, /--carnet-size: 18px/);
  assert.match(css, /--carnet-leading: 1\.7/);
  assert.match(css, /--carnet-title-size: 22px/);
  assert.match(css, /\.rich-doc-view[\s\S]{0,180}font-family: var\(--carnet-font\)/);
  assert.match(css, /\.rich-doc-line-input[\s\S]{0,280}font-size: var\(--carnet-size\)/);
  assert.match(css, /\.student-branch-item \.rich-doc-view[\s\S]{0,160}font-size: var\(--carnet-size\)/);
  assert.match(css, /\.student-course-day-app[\s\S]{0,80}font-family: var\(--carnet-font\)/);
  assert.match(css, /\.student-course-day-app \.eyebrow[\s\S]{0,80}font-weight: 700/);
  assert.match(css, /\.student-item-type[\s\S]{0,120}font-weight: 700/);
  assert.match(css, /\.student-upcoming-tests h2[\s\S]{0,120}font-weight: 700/);
});
