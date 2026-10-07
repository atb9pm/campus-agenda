import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEMO_CATALOG } from "../src/features/classes/index.ts";
import { TEACHER_WEEK_EMPTY_CLASSES_MESSAGE } from "../src/features/teacher-workspace/index.ts";

test("page.tsx — aucun DEMO_CATALOG, plus de PROTOTYPE INTERACTIF", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /DEMO_CATALOG/);
  assert.doesNotMatch(page, /PROTOTYPE INTERACTIF/);
  assert.match(page, /CAMPUS AGENDA \{APP_VERSION\}/);
  assert.match(page, /EMPTY_CLASSROOM_CATALOG/);
  assert.match(page, /showNotice\("Aucune classe\."\)/);
  assert.doesNotMatch(page, /getSubjectsForClassroom\(DEMO_CATALOG/);
  assert.doesNotMatch(page, /findStudentAccessForClassroom\(DEMO_CATALOG/);
  assert.doesNotMatch(page, /getStudentClassroom\(DEMO_CATALOG/);
});

test("écrans hors parcours — plus de listes DEMO_CATALOG", async () => {
  const [multiYear, library] = await Promise.all([
    readFile(new URL("../web/app/components/multi-year-operations-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/pedagogical-library-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(multiYear, /DEMO_CATALOG/);
  assert.doesNotMatch(library, /DEMO_CATALOG/);
  assert.match(multiYear, /Aucune classe/);
  assert.match(multiYear, /Aucune branche disponible/);
  assert.match(library, /Aucune classe/);
  assert.match(library, /Aucune branche disponible pour le déploiement/);

  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /MultiYearOperationsPanel/);
  assert.doesNotMatch(page, /PedagogicalLibraryPanel/);
});

test("Ma semaine vide — message réel, pas de TMA démo", () => {
  assert.equal(TEACHER_WEEK_EMPTY_CLASSES_MESSAGE, "Aucune classe configurée.");
  assert.equal(
    DEMO_CATALOG.classrooms.some((entry) => /tma/i.test(entry.name) || /tma/i.test(entry.id)),
    true,
  );
});

test("fixtures DEMO_CATALOG toujours disponibles pour les tests", () => {
  assert.ok(DEMO_CATALOG.classrooms.length > 0);
  assert.ok(DEMO_CATALOG.subjects.length > 0);
  assert.ok(DEMO_CATALOG.teachers.length > 0);
});

test("README / ARCHITECTURE / ROADMAP décrivent le produit actuel", async () => {
  const [readme, architecture, roadmap, webReadme] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/ARCHITECTURE.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/ROADMAP.md", import.meta.url), "utf8"),
    readFile(new URL("../web/README.md", import.meta.url), "utf8"),
  ]);

  assert.match(readme, /Infomaniak/);
  assert.match(readme, /SQLite/);
  assert.match(readme, /Ma semaine/);
  assert.match(readme, /AnnualCourse/);
  assert.doesNotMatch(readme, /prototype Cloudflare/i);
  assert.doesNotMatch(readme, /Cloudflare D1/);
  assert.doesNotMatch(readme, /simple démo/i);

  assert.match(architecture, /AnnualCourse/);
  assert.match(architecture, /CourseSession/);
  assert.match(architecture, /calculée/);
  assert.match(architecture, /Ma semaine/);
  assert.doesNotMatch(architecture, /Mes éléments.*, vue par défaut/);

  assert.match(roadmap, /réalisées/);
  assert.match(roadmap, /Ma semaine/);
  assert.match(roadmap, /Infomaniak/);
  assert.doesNotMatch(roadmap, /vue par défaut « Mes éléments »/);
  assert.doesNotMatch(roadmap, /phase 3/i);

  assert.doesNotMatch(webReadme, /Prototype interactif/);
  assert.doesNotMatch(webReadme, /Cloudflare Workers/);
});
