import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_SECRET ??= "test-secret-e2e-phase-08";

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  waitUntil() {},
  passThroughOnException() {},
};

let workerModule;

async function getWorker() {
  if (!workerModule) {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("e2e", `${process.pid}`);
    workerModule = await import(workerUrl.href);
  }
  return workerModule.default;
}

async function request(path, init = {}) {
  const worker = await getWorker();
  return worker.fetch(new Request(`http://localhost${path}`, init), env, env);
}

function extractCookie(response) {
  const header = response.headers.get("Set-Cookie") ?? "";
  return header.split(";")[0] ?? "";
}

test("phase 0.8 — E2E health check", async () => {
  const response = await request("/api/health");
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("x-request-id"));
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.service, "campus-agenda");
});

test("phase 0.8 — E2E enseignant publie puis élève consulte", async () => {
  const loginResponse = await request("/api/auth/teacher", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacherId: "teacher-demo-current", password: "campus-demo" }),
  });
  assert.equal(loginResponse.status, 200);
  const teacherCookie = extractCookie(loginResponse);

  const createResponse = await request("/api/agenda", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      classroomId: "classe-demo-tma-2a",
      subjectId: "subject-demo-moteur-2a",
      day: 3,
      hour: 10,
      weekOffset: 0,
      type: "HOMEWORK",
      title: "E2E devoir",
      detail: "Parcours complet",
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.item.title, "E2E devoir");

  const backupResponse = await request("/api/admin/backup", {
    headers: { cookie: teacherCookie },
  });
  assert.equal(backupResponse.status, 200);
  const backupPayload = await backupResponse.json();
  assert.ok(backupPayload.snapshot.itemCount >= 1);

  const studentLogin = await request("/api/auth/student", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "eleve-test-001" }),
  });
  assert.equal(studentLogin.status, 200);
  const studentCookie = extractCookie(studentLogin);

  const agendaResponse = await request("/api/agenda?classroomId=classe-demo-tma-2a", {
    headers: { cookie: studentCookie },
  });
  assert.equal(agendaResponse.status, 200);
  const agendaPayload = await agendaResponse.json();
  assert.ok(agendaPayload.items.some((item) => item.title === "E2E devoir"));

  const deleteResponse = await request(`/api/agenda/${created.item.id}`, {
    method: "DELETE",
    headers: { cookie: teacherCookie },
  });
  assert.equal(deleteResponse.status, 200);
});

test("phase 0.8 — E2E restauration de sauvegarde", async () => {
  const loginResponse = await request("/api/auth/teacher", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacherId: "teacher-demo-current", password: "campus-demo" }),
  });
  const teacherCookie = extractCookie(loginResponse);

  const backupResponse = await request("/api/admin/backup", {
    headers: { cookie: teacherCookie },
  });
  const backupPayload = await backupResponse.json();

  await request("/api/agenda", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      classroomId: "classe-demo-tma-2a",
      subjectId: "subject-demo-moteur-2a",
      day: 4,
      hour: 14,
      weekOffset: 0,
      type: "INFORMATION",
      title: "Avant restauration",
      detail: "Temporaire",
    }),
  });

  const restoreResponse = await request("/api/admin/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({ snapshot: backupPayload.snapshot }),
  });
  assert.equal(restoreResponse.status, 200);
  const restorePayload = await restoreResponse.json();
  assert.equal(restorePayload.ok, true);
});
