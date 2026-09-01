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

async function loginTeacher(teacherId) {
  const response = await request("/api/auth/teacher", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacherId, password: "campus-demo" }),
  });
  assert.equal(response.status, 200, `login ${teacherId}`);
  return extractCookie(response);
}

/** Administrateur réel du seed (ChF), pas l'enseignant démo historique. */
function loginAdmin() {
  return loginTeacher("teacher-chf");
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
  const teacherCookie = await loginTeacher("teacher-demo-current");
  const adminCookie = await loginAdmin();

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
    headers: { cookie: adminCookie },
  });
  assert.equal(backupResponse.status, 200);
  const backupPayload = await backupResponse.json();
  assert.equal(backupPayload.snapshot.version, 4);
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
  const teacherCookie = await loginTeacher("teacher-demo-current");
  const adminCookie = await loginAdmin();

  const backupResponse = await request("/api/admin/backup", {
    headers: { cookie: adminCookie },
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
    headers: { "Content-Type": "application/json", cookie: adminCookie },
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
  const teacherCookie = await loginAdmin();

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

test("2.26.0 — matrice admin : anonyme 401, enseignant 403, admin 200", async () => {
  const adminCookie = await loginAdmin();
  const teacherCookie = await loginTeacher("teacher-demo-martin");

  const sensitive = [
    "/api/admin/backup",
    "/api/admin/memberships",
    "/api/admin/timetable",
    "/api/admin/school-year",
    "/api/admin/annual-courses",
    "/api/admin/course-schedule",
    "/api/admin/catalog",
  ];
  for (const path of sensitive) {
    const anon = await request(path);
    assert.equal(anon.status, 401, `${path} anonyme`);
    const staff = await request(path, { headers: { cookie: teacherCookie } });
    assert.equal(staff.status, 403, `${path} enseignant`);
    const admin = await request(path, { headers: { cookie: adminCookie } });
    assert.ok(admin.status !== 401 && admin.status !== 403, `${path} admin ${admin.status}`);
  }

  const restoreAnon = await request("/api/admin/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(restoreAnon.status, 401);
  const restoreStaff = await request("/api/admin/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: "{}",
  });
  assert.equal(restoreStaff.status, 403);

  const catalogTeacher = await request("/api/admin/catalog?active=1", {
    headers: { cookie: teacherCookie },
  });
  assert.ok(catalogTeacher.status < 400, "GET catalog?active=1 autorisé aux enseignants");

  const invalidRestore = await request("/api/admin/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ snapshot: { version: 4, tables: { teachers: [] } } }),
  });
  assert.equal(invalidRestore.status, 400);
});

test("2.24.0 — E2E Mes cours : session uniquement, teacherId client ignoré", async () => {
  const loginResponse = await request("/api/auth/teacher", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacherId: "teacher-demo-current", password: "campus-demo" }),
  });
  assert.equal(loginResponse.status, 200);
  const teacherCookie = extractCookie(loginResponse);

  const forged = await request("/api/teacher/courses?teacherId=teacher-demo-martin", {
    headers: { cookie: teacherCookie },
  });
  assert.equal(forged.status, 200);
  const payload = await forged.json();
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.courses));
  assert.ok("schoolYearId" in payload);

  const studentLogin = await request("/api/auth/student", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "eleve-test-001" }),
  });
  assert.equal(studentLogin.status, 200);
  const studentForbidden = await request("/api/teacher/courses", {
    headers: { cookie: extractCookie(studentLogin) },
  });
  assert.equal(studentForbidden.status, 401);
});

test("2.27.0 — API CTX refuse profession désactivée et restaure le même id", async () => {
  const adminCookie = await loginAdmin();
  const headers = { "Content-Type": "application/json", cookie: adminCookie };

  const professionResponse = await request("/api/admin/catalog", {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: "profession",
      label: "Profession API cycle de vie",
      durationYears: 4,
      classCodePrefix: "LCY",
    }),
  });
  assert.equal(professionResponse.status, 200, await professionResponse.text());
  const professionPayload = await professionResponse.json();
  assert.equal(professionPayload.ok, true);
  const professionId = professionPayload.profession.id;

  const catalogResponse = await request("/api/admin/catalog", { headers: { cookie: adminCookie } });
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  const branch = (catalog.branches ?? []).find((entry) => entry.isActive && !entry.isArchived);
  assert.ok(branch, "une branche active est requise");

  const disableProfession = await request(`/api/admin/catalog/${professionId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ kind: "profession", isActive: false }),
  });
  assert.equal(disableProfession.status, 200);

  const blockedCreate = await request("/api/admin/catalog", {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: "context",
      professionId,
      trainingYear: 1,
      branchId: branch.id,
    }),
  });
  assert.equal(blockedCreate.status, 400);
  const blockedCreatePayload = await blockedCreate.json();
  assert.equal(blockedCreatePayload.ok, false);
  assert.match(blockedCreatePayload.reason, /profession désactivée/i);

  const enableProfession = await request(`/api/admin/catalog/${professionId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ kind: "profession", isActive: true }),
  });
  assert.equal(enableProfession.status, 200);

  const created = await request("/api/admin/catalog", {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: "context",
      professionId,
      trainingYear: 1,
      branchId: branch.id,
    }),
  });
  assert.equal(created.status, 200, await created.text());
  const createdPayload = await created.json();
  assert.equal(createdPayload.ok, true);
  const contextId = createdPayload.context.id;

  const archived = await request(`/api/admin/catalog/${contextId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ kind: "context", isArchived: true }),
  });
  assert.equal(archived.status, 200);

  const disableAgain = await request(`/api/admin/catalog/${professionId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ kind: "profession", isActive: false }),
  });
  assert.equal(disableAgain.status, 200);

  const blockedRestore = await request(`/api/admin/catalog/${contextId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ kind: "context", isArchived: false, isActive: true }),
  });
  assert.equal(blockedRestore.status, 400);
  const blockedRestorePayload = await blockedRestore.json();
  assert.equal(blockedRestorePayload.ok, false);
  assert.match(blockedRestorePayload.reason, /profession désactivée/i);

  const enableAgain = await request(`/api/admin/catalog/${professionId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ kind: "profession", isActive: true }),
  });
  assert.equal(enableAgain.status, 200);

  const restored = await request(`/api/admin/catalog/${contextId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ kind: "context", isArchived: false, isActive: true }),
  });
  assert.equal(restored.status, 200, await restored.text());
  const restoredPayload = await restored.json();
  assert.equal(restoredPayload.ok, true);
  assert.equal(restoredPayload.context.id, contextId);
  assert.equal(restoredPayload.context.isArchived, false);
});

