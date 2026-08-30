import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_SECRET ??= "test-secret-e2e-phase-08";
// Les comptes de démonstration n'ont pas de mot de passe personnel : le parcours
// E2E autorise explicitement l'empreinte héritée `campus-demo`.
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";

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
      schoolWeekNumber: 12,
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
  assert.equal(backupPayload.snapshot.version, 3);
  assert.ok(backupPayload.snapshot.itemCount >= 1);
  assert.ok(Array.isArray(backupPayload.snapshot.teacherSetups));
  assert.ok(Array.isArray(backupPayload.snapshot.teacherNotes));
  assert.ok(Array.isArray(backupPayload.snapshot.teacherAccounts));

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
      day: 0,
      hour: 14,
      weekOffset: 0,
      schoolWeekNumber: 12,
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

test("phase 1.0 — E2E rate limit sur connexion enseignant", async () => {
  const previous = process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER;
  process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER = "2";
  const clientIp = `203.0.113.${Date.now() % 200}`;

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request("/api/auth/teacher", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": clientIp,
        },
        body: JSON.stringify({ teacherId: "teacher-demo-current", password: "wrong-password" }),
      });
      assert.notEqual(response.status, 429);
    }

    const blocked = await request("/api/auth/teacher", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": clientIp,
      },
      body: JSON.stringify({ teacherId: "teacher-demo-current", password: "wrong-password" }),
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
    const payload = await blocked.json();
    assert.equal(payload.ok, false);
  } finally {
    if (previous === undefined) {
      delete process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER;
    } else {
      process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER = previous;
    }
  }
});

test("comptes enseignant — E2E création, mot de passe provisoire, première connexion", async () => {
  const clientIp = "198.51.100.42";
  const jsonHeaders = { "Content-Type": "application/json", "cf-connecting-ip": clientIp };

  const adminLogin = await request("/api/auth/teacher", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initials: "ChF", password: "campus-demo" }),
  });
  assert.equal(adminLogin.status, 200);
  const adminPayload = await adminLogin.json();
  assert.equal(adminPayload.session.isAdmin, true);
  const adminCookie = extractCookie(adminLogin);

  const initials = `Zz${(Date.now() % 1000).toString().padStart(3, "0")}`;
  const missingType = await request("/api/admin/teachers", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ displayName: "Sans type", initials: `${initials}x` }),
  });
  assert.equal(missingType.status, 400);

  const createResponse = await request("/api/admin/teachers", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ displayName: "Compte E2E", initials, teachingType: "TECHNICAL" }),
  });
  assert.equal(createResponse.status, 200);
  const created = await createResponse.json();
  assert.equal(created.ok, true);
  assert.equal(created.teacher.mustChangePassword, true);
  assert.ok(created.temporaryPassword.length >= 10);

  const listResponse = await request("/api/admin/teachers", { headers: { cookie: adminCookie } });
  const list = await listResponse.json();
  assert.ok(list.teachers.some((teacher) => teacher.id === created.teacher.id));

  const firstLogin = await request("/api/auth/teacher", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initials, password: created.temporaryPassword }),
  });
  assert.equal(firstLogin.status, 200);
  const firstPayload = await firstLogin.json();
  assert.equal(firstPayload.session.mustChangePassword, true);
  const newCookie = extractCookie(firstLogin);

  // Mot de passe provisoire : aucune autre route enseignant n'est accessible.
  const blocked = await request("/api/library/templates", { headers: { cookie: newCookie } });
  assert.equal(blocked.status, 403);
  const blockedPayload = await blocked.json();
  assert.equal(blockedPayload.passwordChangeRequired, true);

  const weakChange = await request("/api/auth/teacher/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: newCookie, "cf-connecting-ip": clientIp },
    body: JSON.stringify({ currentPassword: created.temporaryPassword, nextPassword: "court" }),
  });
  assert.equal(weakChange.status, 400);

  const change = await request("/api/auth/teacher/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: newCookie, "cf-connecting-ip": clientIp },
    body: JSON.stringify({ currentPassword: created.temporaryPassword, nextPassword: "Atelier-2027" }),
  });
  assert.equal(change.status, 200);

  const sessionResponse = await request("/api/auth/session", { headers: { cookie: newCookie } });
  const sessionPayload = await sessionResponse.json();
  assert.equal(sessionPayload.session.mustChangePassword, false);

  const relogin = await request("/api/auth/teacher", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initials, password: "Atelier-2027" }),
  });
  assert.equal(relogin.status, 200);
  assert.equal((await relogin.json()).session.mustChangePassword, false);

  // Un enseignant simple ne gère pas les comptes.
  const forbidden = await request("/api/admin/teachers", {
    headers: { cookie: extractCookie(relogin) },
  });
  assert.equal(forbidden.status, 403);
});

test("phase 2.0 — E2E calendrier scolaire et liste admin", async () => {
  const loginResponse = await request("/api/auth/teacher", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacherId: "teacher-demo-current", password: "campus-demo" }),
  });
  assert.equal(loginResponse.status, 200);
  const teacherCookie = extractCookie(loginResponse);

  const calendarResponse = await request("/api/school-year/calendar", {
    headers: { Cookie: teacherCookie },
  });
  assert.equal(calendarResponse.status, 200);
  const calendar = await calendarResponse.json();
  assert.equal(calendar.ok, true);
  assert.equal(calendar.calendar.weeks.length, 38);

  const yearsResponse = await request("/api/admin/school-year", {
    headers: { Cookie: teacherCookie },
  });
  assert.equal(yearsResponse.status, 200);
  const years = await yearsResponse.json();
  assert.equal(years.ok, true);
  assert.ok(Array.isArray(years.years));
});
