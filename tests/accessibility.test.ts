import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("phase 0.8 — structure d'accessibilité de base", async () => {
  const [page, layout, css, schoolYearPanel] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/school-year-admin-panel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /lang="fr"/);
  assert.match(layout, /skip-to-content/);
  assert.match(page, /id="main-content"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /aria-labelledby="student-code-title"/);
  assert.match(page, /aria-labelledby="teacher-login-title"/);
  assert.match(page, /aria-labelledby="site-gate-title"/);
  assert.match(page, /id="site-gate-title"/);
  assert.match(page, /campus-accueil/);
  assert.match(page, /aria-labelledby="modal-title"/);
  assert.match(page, /aria-label="Navigation principale"/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /closeModalOnEscape/);
  assert.match(css, /\.skip-to-content/);
  assert.match(page, /SchoolYearAdminPanel/);
  assert.match(page, /PedagogicalLibraryPanel/);
  assert.match(page, /TimetableImportPanel/);
  assert.match(css, /\.timetable-import-panel/);
  assert.match(page, /Enregistrer dans la bibliothèque/);
  assert.match(css, /\.library-panel/);
  assert.match(schoolYearPanel, /aria-labelledby="school-year-admin-title"/);
  assert.match(schoolYearPanel, /id="school-year-admin-title"/);
  assert.match(css, /\.school-year-admin/);
  assert.match(page, /aria-labelledby="control-alert-title"/);
  assert.match(page, /Contrôles à venir/);
  assert.match(css, /\.student-upcoming-tests/);
  assert.match(css, /\.controls-panel/);
  assert.match(css, /\.teacher-login/);
});
