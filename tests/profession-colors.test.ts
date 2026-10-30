import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  inferProfessionPrefixFromClassCode,
  listProfessionColorLegend,
  professionColorStyleVars,
  resolveProfessionColorTheme,
} from "../src/features/school-catalog/profession-colors.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

test("version 2.61.8 — halo et badge branche Ma semaine, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.62.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0034_annual_course_meeting_days.sql");
  const [configPanel, maSemaine, css, professionsPanel] = await Promise.all([
    readFile(new URL("../web/app/components/configuration-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/ma-semaine-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/professions-admin-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(configPanel, /Icône/);
  assert.doesNotMatch(configPanel, /maxLength=\{4\}/);
  assert.doesNotMatch(configPanel, /Jour d’affichage/);
  assert.doesNotMatch(maSemaine, /ma-semaine-class-icon/);
  assert.doesNotMatch(maSemaine, /ma-semaine-profession-legend/);
  assert.match(maSemaine, /ma-semaine-class-code/);
  assert.match(maSemaine, /ma-semaine-branch-badge/);
  assert.match(css, /\.ma-semaine-class-card[\s\S]{0,280}box-shadow: 0 8px 28px var\(--profession-halo/);
  assert.match(css, /\.ma-semaine-branch-badge/);
  assert.match(css, /\.has-profession-accent/);
  assert.match(professionsPanel, /is-profession-colored/);
});

test("palette — MECAUTO bleu, CONDVL ardoise, MACAM blanc, MECMA orange", () => {
  assert.equal(resolveProfessionColorTheme("MECAUTO").accent, "#1d4ed8");
  assert.equal(resolveProfessionColorTheme("CONDVL").foreground, "#334155");
  assert.equal(resolveProfessionColorTheme("MACAM").background, "#ffffff");
  assert.equal(resolveProfessionColorTheme("MACAM").foreground, "#334155");
  assert.notEqual(resolveProfessionColorTheme("MACAM").accent, "#d97706");
  assert.equal(resolveProfessionColorTheme("MECMA").accent, "#c2410c");
  assert.equal(resolveProfessionColorTheme("MECMA").background, "#ffedd5");
  assert.equal(resolveProfessionColorTheme("AMA").accent, "#047857");
});

test("MACAM — fond blanc, halo conservé, distinct de MECMA", () => {
  const macam = professionColorStyleVars(resolveProfessionColorTheme("MACAM"));
  const mecma = professionColorStyleVars(resolveProfessionColorTheme("MECMA"));
  assert.equal(macam["--profession-bg"], "#ffffff");
  assert.equal(macam["--profession-wash"], "#ffffff");
  assert.match(macam["--profession-halo"], /^rgba\(/);
  assert.notEqual(macam["--profession-halo"], mecma["--profession-halo"]);
  assert.notEqual(macam["--profession-bg"], mecma["--profession-bg"]);
});

test("inférence — MECAUTO3A → MECAUTO", () => {
  assert.equal(inferProfessionPrefixFromClassCode("MECAUTO3A"), "MECAUTO");
  assert.equal(inferProfessionPrefixFromClassCode("CONDVL2A"), "CONDVL");
});

test("halo — MECAUTO expose une ombre bleue rgba", () => {
  const style = professionColorStyleVars(resolveProfessionColorTheme("MECAUTO"));
  assert.equal(style["--profession-halo"], "rgba(29, 78, 216, 0.22)");
});

test("palette — 5 professions configurées", () => {
  assert.equal(listProfessionColorLegend().length, 5);
});
