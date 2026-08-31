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

test("server-renders the single entry page, student tab first", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Campus Agenda — Agenda scolaire partagé/);
  assert.match(html, /id="main-content"/);
  assert.match(html, /Mon agenda de classe/);
  assert.match(html, /Code de classe/);
  assert.match(html, /Enseignant/);
  assert.doesNotMatch(html, /Site verrouillé/);
  // Aucun mot de passe ne doit être publié dans le HTML rendu.
  assert.doesNotMatch(html, /campus-demo/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("the rendered version matches the shared APP_VERSION", async () => {
  const [page, sharedVersion, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/app-version.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  // Une seule source de version, sinon /api/health et le pied de page divergent.
  assert.match(page, /import \{ APP_VERSION \} from "@campus\/lib\/app-version"/);
  assert.doesNotMatch(page, /const APP_VERSION\s*=/);

  const version = sharedVersion.match(/APP_VERSION = "([^"]+)"/)?.[1];
  assert.ok(version, "APP_VERSION introuvable dans src/lib/app-version.ts");
  assert.equal(JSON.parse(packageJson).version, version);

  const html = await (await render()).text();
  assert.ok(html.includes(version), `la page doit afficher la version ${version}`);
});

test("keeps the validated teacher essentials and social preview", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /HOMEWORK: "Devoir"/);
  assert.match(page, /TEST: "Contrôle"/);
  assert.match(page, /INFORMATION: "Information"/);
  assert.match(page, /MesCoursPanel/);
  assert.match(page, /MaSemainePanel/);
  assert.match(page, /ClassNotebookPanel/);
  assert.match(page, /ConfigurationPanel/);
  assert.match(page, /AdministrationPanel/);
  assert.match(page, /mobile-tab-bar/);
  assert.match(page, /data-student-tab/);
  assert.match(page, /Navigation enseignant/);
  assert.match(page, /Navigation élève/);
  assert.match(page, /enterStudentWithCode/);
  assert.match(page, /fetchApiSession/);
  assert.match(page, /loginStudentApi/);
  assert.match(page, /resolveDisplayCourseDay/);
  assert.match(page, /LoginPanel/);
  assert.match(page, /submitTeacherLogin/);
  assert.match(page, /PasswordChangePanel/);
  assert.match(page, /changeTeacherPasswordApi/);
  assert.doesNotMatch(page, /DEMO_TEACHER_PASSWORD/);
  assert.match(page, /DEMO_CATALOG/);
  assert.match(page, /brand-emblem-image/);

  // Publication et coordination passent uniquement par le carnet de classe.
  assert.match(page, /notebookCreatePublication/);
  assert.match(page, /notebookSaveControl/);
  assert.match(page, /evaluateThirdTestAlert/);
  assert.match(page, /createAgendaItemApi/);
  assert.match(page, /updateAgendaItemApi/);
  assert.match(page, /deleteAgendaItemApi/);

  // Restes de la grille d'agenda retirée en 2.5.0 : ne doivent pas revenir.
  assert.doesNotMatch(page, /showAgendaTools|openSharedAgenda|isTodayCourseColumn/);
  assert.doesNotMatch(page, /setSubjectFilter|setTeacherFilter|setDayFilter|setTypeFilter/);
  assert.doesNotMatch(page, /buildClassWorkloadSummary|WORKLOAD_LEVEL_LABELS/);
  assert.doesNotMatch(page, /src="\/og-v3\.png"/);
  assert.doesNotMatch(page, /blueprint-watermark|MechanicalEmblem/);
  assert.match(layout, /\/og-v3\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og-v3.png", import.meta.url));
});
