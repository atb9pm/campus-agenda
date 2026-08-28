import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("phase 0.8 — structure d'accessibilité de base", async () => {
  const [page, layout, css, loginPanel, schoolYearPanel, passwordPanel] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/login-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/school-year-admin-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/password-change-panel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /lang="fr"/);
  assert.match(layout, /skip-to-content/);
  assert.match(page, /id="main-content"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /aria-labelledby="student-code-title"/);
  assert.match(page, /aria-labelledby="control-alert-title"/);
  assert.match(page, /aria-label="Navigation principale"/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /closeOnEscape/);
  assert.doesNotMatch(page, /Compte&nbsp;: <strong>\{currentTeacher/);
  assert.doesNotMatch(page, /François Cheseaux \(ChF\)/);

  // Page d'entrée unique : onglets étiquetés, panneaux liés, pas de verrou séparé.
  assert.match(loginPanel, /id="main-content"/);
  assert.match(loginPanel, /role="tablist"/);
  assert.match(loginPanel, /aria-label="Type de connexion"/);
  assert.match(loginPanel, /aria-controls="login-panel-student"/);
  assert.match(loginPanel, /aria-controls="login-panel-teacher"/);
  assert.match(loginPanel, /aria-labelledby="login-tab-student"/);
  assert.match(loginPanel, /aria-labelledby="login-tab-teacher"/);
  assert.match(loginPanel, /id="login-title"/);
  assert.doesNotMatch(loginPanel, /autoFocus/);
  assert.doesNotMatch(page, /site-gate-title/);
  assert.doesNotMatch(page, /campus-accueil/);

  // Aucun mot de passe n'est plus annoncé à l'écran de connexion.
  assert.doesNotMatch(loginPanel, /campus-demo/);

  // Première connexion : écran de changement de mot de passe étiqueté.
  assert.match(passwordPanel, /id="main-content"/);
  assert.match(passwordPanel, /aria-labelledby="password-change-title"/);
  assert.match(passwordPanel, /id="password-change-title"/);
  assert.doesNotMatch(passwordPanel, /autoFocus/);

  assert.match(css, /\.skip-to-content/);
  assert.match(css, /\.teacher-login/);
  assert.match(css, /\.login-tabs/);
  assert.match(css, /\.login-remember/);
  assert.match(page, /AdministrationPanel/);
  assert.match(page, /MaSemainePanel/);
  assert.match(page, /ClassNotebookPanel/);
  assert.match(schoolYearPanel, /aria-labelledby="school-year-admin-title"/);
  assert.match(schoolYearPanel, /id="school-year-admin-title"/);
  assert.match(css, /\.school-year-admin/);
  assert.match(css, /\.day-grid/);
});
