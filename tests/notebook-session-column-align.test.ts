import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("carnet — colonnes de séances alignées par lignes communes, sans hauteur de carte forcée", async () => {
  const [panel, css] = await Promise.all([
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(css, /@supports \(grid-template-rows: subgrid\)/);
  assert.match(css, /grid-template-rows: subgrid/);
  assert.match(css, /\[session-header\] auto/);
  assert.match(css, /\[control\] auto/);
  assert.match(css, /\[publication-heading\] auto/);
  assert.match(css, /\[publication-visibility\] auto/);
  assert.match(css, /\[publication-body\] auto/);
  assert.match(css, /\[publication-actions\] auto/);
  assert.match(css, /\[notes-heading\] auto/);
  assert.match(css, /\[notes-body\] auto/);
  assert.match(css, /\[notes-actions\] auto/);
  assert.match(css, /grid-row: publication-heading \/ notes-heading/);
  assert.match(css, /grid-row: notes-heading \/ notebook-end/);
  assert.doesNotMatch(css, /\.class-notebook-publication-body \{[^}]*max-height:/);
  assert.doesNotMatch(css, /\.class-notebook-zone-control \{[^}]*max-height:/);
  assert.doesNotMatch(css, /\.class-notebook-notes-body \{[^}]*max-height:/);

  assert.match(panel, /className="class-notebook-control-list"/);
  assert.match(panel, /className="class-notebook-publication-body"/);
  assert.match(panel, /className="class-notebook-notes-extra"/);
  assert.match(panel, /className="class-notebook-notes-body"/);
  assert.match(panel, /class-notebook-visibility-hint\$\{visibility === "draft" \? "" : " is-reserved"\}/);
  assert.match(panel, /Les élèves ne voient pas encore ce texte\./);
  assert.match(panel, /class-notebook-publish-action/);
  assert.match(css, /\.class-notebook-publish-action \{/);
  assert.match(css, /min-width: 11\.5rem/);
  assert.match(css, /\.class-notebook-zone-actions \.workspace-action \{[^}]*min-height: 36px/);
  assert.match(css, /\.class-notebook-visibility-hint\.is-reserved \{ visibility: hidden; \}/);
  assert.match(css, /\.class-notebook-visibility-badge\.is-reserved/);

  assert.match(panel, /\[1, 2, 3, 4\] as WeekDisplayCount\[\]/);
  assert.match(css, /\.class-notebook-grid > \.class-notebook-column:not\(\.active\) \{ display: none; \}/);
});

test("carnet — la zone Contrôle reste présente sans contrôle, Planifier conservé", async () => {
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  const control = panel.slice(
    panel.indexOf('aria-label="Contrôle"'),
    panel.indexOf('aria-label="Publication élèves"'),
  );
  assert.match(control, /<ul className="class-notebook-control-list">/);
  assert.match(control, /weekControls\.map/);
  assert.match(control, /Planifier →/);
  assert.doesNotMatch(control, /weekControls\.length \?/);
});
