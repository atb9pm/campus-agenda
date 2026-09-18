import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  inferProfessionPrefixFromClassCode,
  listProfessionColorLegend,
  resolveProfessionColorTheme,
} from "../src/features/school-catalog/profession-colors.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

test("version 2.61.4 — couleurs profession + Ma semaine épurée, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.61.4");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0030_agenda_student_visible.sql");
  const [configPanel, maSemaine, css, professionsPanel] = await Promise.all([
    readFile(new URL("../web/app/components/configuration-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/ma-semaine-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/professions-admin-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(configPanel, /Icône/);
  assert.doesNotMatch(configPanel, /maxLength=\{4\}/);
  assert.match(configPanel, /Jour d’affichage/);
  assert.match(configPanel, /resolveProfessionColorTheme/);
  assert.doesNotMatch(maSemaine, /ma-semaine-class-icon/);
  assert.match(maSemaine, /ma-semaine-class-code/);
  assert.match(maSemaine, /ma-semaine-class-branches/);
  assert.match(maSemaine, /ma-semaine-profession-legend/);
  assert.match(css, /\.ma-semaine-class-card[\s\S]{0,400}border-left: 4px solid var\(--profession-accent/);
  assert.match(css, /\.has-profession-accent/);
  assert.match(professionsPanel, /is-profession-colored/);
});

test("palette — MECAUTO bleu, CONDVL ardoise, MACAM ocre", () => {
  assert.equal(resolveProfessionColorTheme("MECAUTO").accent, "#1d4ed8");
  assert.equal(resolveProfessionColorTheme("CONDVL").foreground, "#334155");
  assert.equal(resolveProfessionColorTheme("MACAM").foreground, "#b45309");
  assert.equal(resolveProfessionColorTheme("MECMA").accent, "#c2410c");
  assert.equal(resolveProfessionColorTheme("AMA").accent, "#047857");
});

test("inférence — MECAUTO3A → MECAUTO", () => {
  assert.equal(inferProfessionPrefixFromClassCode("MECAUTO3A"), "MECAUTO");
  assert.equal(inferProfessionPrefixFromClassCode("CONDVL2A"), "CONDVL");
});

test("légende — 5 professions configurées", () => {
  assert.equal(listProfessionColorLegend().length, 5);
});
