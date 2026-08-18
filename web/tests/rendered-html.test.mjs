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
  assert.match(html, /Chargement de la session/);
  assert.match(html, /id="main-content"/);
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
  assert.match(page, /enterStudentWithCode/);
  assert.match(page, /fetchApiSession/);
  assert.match(page, /createAgendaItemApi/);
  assert.match(page, /publishSchoolWeekNumber/);
  assert.match(page, /selectedSchoolWeekNumber/);
  assert.match(page, /filterItemsForSchoolWeek/);
  assert.match(page, /loginStudentApi/);
  assert.match(page, /student-course-day-app/);
  assert.match(page, /resolveDisplayCourseDay/);
  assert.match(page, /studentHistoryOpen/);
  assert.match(page, /workload-panel/);
  assert.match(page, /openSharedAgenda/);
  assert.match(page, /canModifyPublication/);
  assert.match(page, /event-actions/);
  assert.match(page, /teacher-login/);
  assert.match(page, /submitTeacherLogin/);
  assert.doesNotMatch(page, /DEMO_TEACHER_PASSWORD/);
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
