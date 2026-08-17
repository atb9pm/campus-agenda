import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Campus Agenda prototype", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Campus Agenda — Agenda scolaire partagé/);
  assert.match(html, /Tableau de bord/);
  assert.match(html, /Mes classes/);
  assert.match(html, /Mes éléments/);
  assert.match(html, /ESPACE ENSEIGNANT/);
  assert.match(html, /Voir mes éléments/);
  assert.match(html, /2e TMA/);
  assert.match(html, /1re TMA/);
  assert.match(html, /Démonstration uniquement/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the validated publication menu and social preview", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /"HOMEWORK", "TEST", "INFORMATION"/);
  assert.match(page, /HOMEWORK: "Devoir"/);
  assert.match(page, /TEST: "Contrôle"/);
  assert.match(page, /INFORMATION: "Information"/);
  assert.match(page, /updatePublication/);
  assert.match(page, /canModifyPublication/);
  assert.match(page, /event-actions/);
  assert.match(page, /DEFAULT_TEACHER_AGENDA_VIEW/);
  assert.match(page, /DEMO_CATALOG/);
  assert.match(page, /selectedClassroomId/);
  assert.match(page, /className="brand-showcase"/);
  assert.match(page, /src="\/og-v3\.png"/);
  assert.match(page, /Esquisses techniques d’un piston/);
  assert.doesNotMatch(page, /blueprint-watermark|MechanicalEmblem/);
  assert.match(layout, /\/og-v3\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og-v3.png", import.meta.url));
});
