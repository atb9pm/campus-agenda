import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_SECRET ??= "test-secret-e2e-phase-08";
// Les comptes de démonstration n'ont pas de mot de passe personnel : le parcours
// E2E autorise explicitement l'empreinte héritée `campus-demo`.
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";
// Les tests E2E enchaînent plusieurs connexions enseignant ; le plafond 10/min
// ferait échouer les scénarios ajoutés en fin de fichier.
process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER ??= "50";

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
  const professionPayload = await professionResponse.json();
  assert.equal(professionResponse.status, 200, professionPayload.reason ?? "création profession");
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
  const createdPayload = await created.json();
  assert.equal(created.status, 200, createdPayload.reason ?? "création CTX");
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
  const restoredPayload = await restored.json();
  assert.equal(restored.status, 200, restoredPayload.reason ?? "restauration CTX");
  assert.equal(restoredPayload.ok, true);
  assert.equal(restoredPayload.context.id, contextId);
  assert.equal(restoredPayload.context.isArchived, false);
});

test("2.29.0 — E2E déroulement de cours : session, id, teacherId ignoré, pas de mutation", async () => {
  const anon = await request("/api/teacher/course-timeline");
  assert.equal(anon.status, 401);

  const teacherCookie = await loginTeacher("teacher-demo-current");
  const missingId = await request("/api/teacher/course-timeline", {
    headers: { cookie: teacherCookie },
  });
  assert.equal(missingId.status, 400);

  const unknown = await request("/api/teacher/course-timeline?annualCourseId=unknown-course", {
    headers: { cookie: teacherCookie },
  });
  assert.equal(unknown.status, 404);

  const forgedUnknown = await request(
    "/api/teacher/course-timeline?annualCourseId=unknown-course&teacherId=teacher-chf",
    { headers: { cookie: teacherCookie } },
  );
  assert.equal(forgedUnknown.status, 404);

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const mutation = await request("/api/teacher/course-timeline?annualCourseId=unknown-course", {
      method,
      headers: { cookie: teacherCookie },
    });
    assert.ok(
      mutation.status === 404 || mutation.status === 405,
      `${method} timeline ${mutation.status}`,
    );
  }

  const unassignedPublish = await request("/api/teacher/course-publications", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      annualCourseId: "unknown-course",
      courseSessionKey: "year-x|unknown-course|2027-08-16",
      referenceItemId: "ref-x",
    }),
  });
  assert.ok(
    unassignedPublish.status === 403 || unassignedPublish.status === 404,
    `publication non affectée ${unassignedPublish.status}`,
  );
});

test("PR59 — publication structurée sans session → 401", async () => {
  const response = await request("/api/teacher/course-publications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      annualCourseId: "ac-1",
      courseSessionKey: "year-2027|ac-1|2027-08-16",
      referenceItemId: "ref-1",
    }),
  });
  assert.equal(response.status, 401);
});

test("2.32.0 — E2E planning des contrôles : session, années, 403, TEST", async () => {
  const anon = await request("/api/teacher/controls/planning");
  assert.equal(anon.status, 401);

  const studentLogin = await request("/api/auth/student", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "eleve-test-001" }),
  });
  assert.equal(studentLogin.status, 200);
  const studentForbidden = await request("/api/teacher/controls/planning", {
    headers: { cookie: extractCookie(studentLogin) },
  });
  assert.equal(studentForbidden.status, 401);

  const teacherCookie = await loginTeacher("teacher-demo-current");
  const forged = await request(
    "/api/teacher/controls/planning?teacherId=teacher-demo-martin&week=12&mode=mine",
    { headers: { cookie: teacherCookie } },
  );
  assert.equal(forged.status, 200);
  const payload = await forged.json();
  assert.equal(payload.ok, true);
  assert.ok(payload.week);
  assert.ok(Array.isArray(payload.classroomIds));
  assert.equal(payload.layout === "semester" || payload.layout === "week", true);
  assert.ok(payload.semester);
  assert.ok(Array.isArray(payload.semester.weeks));
  assert.ok(payload.week.days.length <= 5);
  assert.ok(Array.isArray(payload.years));
  assert.ok(payload.years.length >= 1);
  assert.ok(payload.years.every((year) => year.status === "active" || year.status === "archived"));
  assert.equal(
    payload.years.some((year) => year.status === "draft"),
    false,
  );
  const activeYear = payload.years.find((year) => year.status === "active");
  assert.ok(activeYear);
  assert.equal(payload.schoolYearId, activeYear.id);

  for (const day of payload.week.days) {
    assert.equal("hour" in day, false);
    for (const card of day.controls) {
      assert.ok(card.classroomName);
      assert.equal("hour" in card, false);
      assert.notEqual(card.title, "Système de freinage");
      assert.notEqual(card.title, "Dossier technique");
      assert.notEqual(card.title, "Tenue de travail");
    }
  }

  const sameYear = await request(
    `/api/teacher/controls/planning?schoolYearId=${encodeURIComponent(payload.schoolYearId)}&week=12`,
    { headers: { cookie: teacherCookie } },
  );
  assert.equal(sameYear.status, 200);
  const samePayload = await sameYear.json();
  assert.equal(samePayload.schoolYearId, payload.schoolYearId);
  assert.deepEqual(
    (samePayload.classes ?? []).map((entry) => entry.id).sort(),
    (payload.classes ?? []).map((entry) => entry.id).sort(),
  );

  const unknownYear = await request("/api/teacher/controls/planning?schoolYearId=year-inexistante", {
    headers: { cookie: teacherCookie },
  });
  assert.equal(unknownYear.status, 404);

  const unknownClassIds = await request(
    "/api/teacher/controls/planning?classroomIds=classe-inconnue&mode=mine",
    { headers: { cookie: teacherCookie } },
  );
  assert.equal(unknownClassIds.status, 403);

  const unknownClass = await request(
    "/api/teacher/controls/planning?classroomId=classe-inconnue&mode=mine",
    { headers: { cookie: teacherCookie } },
  );
  assert.equal(unknownClass.status, 403);

  const classAllUnknown = await request(
    "/api/teacher/controls/planning?classroomId=classe-inconnue&mode=class-all",
    { headers: { cookie: teacherCookie } },
  );
  assert.equal(classAllUnknown.status, 403);

  const classroomId = payload.classes?.[0]?.id;
  if (classroomId) {
    const classAll = await request(
      `/api/teacher/controls/planning?week=12&mode=class-all&classroomId=${encodeURIComponent(classroomId)}&schoolYearId=${encodeURIComponent(payload.schoolYearId)}`,
      { headers: { cookie: teacherCookie } },
    );
    assert.equal(classAll.status, 200);
    const classPayload = await classAll.json();
    assert.equal(classPayload.ok, true);
    assert.equal(classPayload.mode, "class-all");
    assert.equal(classPayload.schoolYearId, payload.schoolYearId);
    assert.ok(classPayload.week.days.length <= 5);
  }
});

async function jsonRequest(path, init = {}) {
  const response = await request(path, init);
  const payload = await response.json();
  return { response, payload };
}

async function seedInteractiveControlCourse(adminCookie, teacherId, classCodePrefix = "CTL") {
  const headers = { "Content-Type": "application/json", cookie: adminCookie };
  const years = await jsonRequest("/api/admin/school-year", { headers: { cookie: adminCookie } });
  assert.equal(years.response.status, 200, years.payload.reason);
  const active = (years.payload.years ?? []).find((year) => year.status === "active") ?? years.payload.years?.[0];
  assert.ok(active, "année active requise");

  const catalog = await jsonRequest("/api/admin/catalog", { headers: { cookie: adminCookie } });
  const branch =
    (catalog.payload.branches ?? []).find((entry) => entry.label === "Moteur" && entry.isActive) ??
    (catalog.payload.branches ?? []).find((entry) => entry.isActive && !entry.isArchived);
  assert.ok(branch, "branche active requise");
  const typedBranch = await jsonRequest(`/api/admin/catalog/${encodeURIComponent(branch.id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ kind: "branch", teachingType: "TECHNICAL" }),
  });
  assert.equal(typedBranch.response.status, 200, typedBranch.payload.reason);

  const profession = await jsonRequest("/api/admin/catalog", {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: "profession",
      label: `Contrôles interactifs ${Date.now()}`,
      durationYears: 4,
      classCodePrefix,
    }),
  });
  assert.equal(profession.response.status, 200, profession.payload.reason);
  const professionId = profession.payload.profession.id;

  const ctx = await jsonRequest("/api/admin/catalog", {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: "context",
      professionId,
      trainingYear: 1,
      branchId: branch.id,
    }),
  });
  assert.equal(ctx.response.status, 200, ctx.payload.reason);

  const createdClass = await jsonRequest("/api/admin/catalog", {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: "class",
      code: "MA2A",
      label: "MA2A",
      schoolYearId: active.id,
      schoolYearLabel: active.label,
      professionId,
      trainingYear: 1,
      parallelCode: "A",
    }),
  });
  let schoolClass = createdClass.payload.class;
  if (!createdClass.payload.ok) {
    const unique = await jsonRequest("/api/admin/catalog", {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "class",
        code: `CTL${String(Date.now()).slice(-4)}`,
        label: "MA2A",
        schoolYearId: active.id,
        schoolYearLabel: active.label,
        professionId,
        trainingYear: 1,
        parallelCode: "A",
      }),
    });
    assert.equal(unique.response.status, 200, unique.payload.reason ?? createdClass.payload.reason);
    schoolClass = unique.payload.class;
  }

  const course = await jsonRequest("/api/admin/annual-courses", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "create",
      schoolYearId: active.id,
      classId: schoolClass.id,
      contextId: ctx.payload.context.id,
    }),
  });
  assert.equal(course.response.status, 201, course.payload.reason);
  const annualCourseId = course.payload.course.id;

  const typedTeacher = await jsonRequest(`/api/admin/teachers/${encodeURIComponent(teacherId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ teachingType: "TECHNICAL" }),
  });
  assert.equal(typedTeacher.response.status, 200, typedTeacher.payload.reason);

  const assigned = await jsonRequest("/api/admin/annual-courses", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "assign",
      annualCourseId,
      teacherId,
      role: "PRIMARY",
      validFrom: "2026-08-01",
      forceIncompatible: true,
    }),
  });
  assert.ok(assigned.response.status === 201 || assigned.response.status === 200, assigned.payload.reason);

  const attendance = await jsonRequest("/api/admin/course-schedule", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "replaceAttendanceDays",
      classId: schoolClass.id,
      days: [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
    }),
  });
  assert.equal(attendance.response.status, 200, attendance.payload.reason);

  const slot = await jsonRequest("/api/admin/course-schedule", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "create",
      annualCourseId,
      dayOfWeek: 1,
      periodStart: 4,
      periodEnd: 4,
      weekKind: "all",
    }),
  });
  assert.equal(slot.response.status, 201, slot.payload.reason);

  const slot2 = await jsonRequest("/api/admin/course-schedule", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "create",
      annualCourseId,
      dayOfWeek: 1,
      periodStart: 6,
      periodEnd: 6,
      weekKind: "all",
    }),
  });
  assert.equal(slot2.response.status, 201, slot2.payload.reason);

  return { schoolYearId: active.id, annualCourseId, classId: schoolClass.id, classLabel: schoolClass.label ?? schoolClass.code };
}

test("2.32.0 — E2E planification interactive et coordination au 3e contrôle", async () => {
  const anon = await request("/api/teacher/controls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ annualCourseId: "x", courseSessionKey: "y", title: "z" }),
  });
  assert.equal(anon.status, 401);

  const adminCookie = await loginAdmin();
  const teacherCookie = await loginTeacher("teacher-demo-current");
  const seeded = await seedInteractiveControlCourse(adminCookie, "teacher-demo-current");

  const planningAll = await jsonRequest("/api/teacher/controls/planning?week=1", {
    headers: { cookie: teacherCookie },
  });
  assert.equal(planningAll.response.status, 200, planningAll.payload.reason);
  assert.equal(planningAll.payload.ok, true);
  assert.equal(planningAll.payload.allClassesSelected, true);
  assert.ok(Array.isArray(planningAll.payload.classroomIds));

  const classrooms = planningAll.payload.classes ?? [];
  let classroom;
  let planning;
  let option;
  let weekNumber = 1;
  for (const candidate of classrooms) {
    for (let week = 1; week <= 8; week += 1) {
      const next = await jsonRequest(
        `/api/teacher/controls/planning?classroomId=${encodeURIComponent(candidate.id)}&week=${week}&schoolYearId=${encodeURIComponent(seeded.schoolYearId)}`,
        { headers: { cookie: teacherCookie } },
      );
      if (next.response.status !== 200) continue;
      const found = (next.payload.week?.days ?? [])
        .flatMap((day) => day.placementOptions ?? [])
        .find((entry) => entry.annualCourseId === seeded.annualCourseId);
      if (found) {
        classroom = candidate;
        planning = next;
        option = found;
        weekNumber = week;
        break;
      }
    }
    if (option) break;
  }
  assert.ok(classroom, "classe structurée accessible");

  const archivedYear = (planningAll.payload.years ?? []).find((year) => year.status === "archived");
  if (archivedYear) {
    const archived = await jsonRequest(
      `/api/teacher/controls/planning?schoolYearId=${encodeURIComponent(archivedYear.id)}&classroomId=${encodeURIComponent(classroom.id)}&week=1`,
      { headers: { cookie: teacherCookie } },
    );
    if (archived.response.status === 200) {
      assert.equal(archived.payload.canCreate, false);
      assert.ok((archived.payload.week?.days ?? []).every((day) => day.canPlan === false));
    }
  }

  assert.ok(planning && option, "CourseSession de placement requise");
  assert.equal(option.annualCourseId, seeded.annualCourseId);
  const planDay = planning.payload.week.days.find((day) => day.dayIndex === option.dayIndex);
  assert.equal(planDay.canPlan, true);
  assert.equal(planDay.placementOptions.length, 1);

  const loadBefore = planning.payload.teacherLoadThisWeek;

  const forged = await jsonRequest("/api/teacher/controls", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      annualCourseId: option.annualCourseId,
      courseSessionKey: option.courseSessionKey,
      title: "Contrôle injection",
      detail: "Chapitres 3 à 5",
      teacherId: "teacher-demo-martin",
      classroomId: "classe-inconnue",
      type: "HOMEWORK",
      date: "2099-01-01",
      day: 4,
      hour: 10,
    }),
  });
  assert.equal(forged.response.status, 201, forged.payload.reason);
  assert.equal(forged.payload.item.type, "TEST");
  assert.equal(forged.payload.item.title, "Contrôle injection");
  assert.equal(forged.payload.item.authorTeacherId, "teacher-demo-current");
  assert.equal(forged.payload.item.annualCourseId, option.annualCourseId);
  assert.equal(forged.payload.item.courseSessionKey, option.courseSessionKey);
  assert.equal(forged.payload.item.courseSessionDate, option.date);
  assert.equal(forged.payload.item.referenceSessionId, null);
  assert.equal(forged.payload.item.referenceItemId, null);

  const after = await jsonRequest(
    `/api/teacher/controls/planning?classroomId=${encodeURIComponent(classroom.id)}&week=${weekNumber}&schoolYearId=${encodeURIComponent(seeded.schoolYearId)}`,
    { headers: { cookie: teacherCookie } },
  );
  assert.equal(after.response.status, 200);
  const cards = after.payload.week.days.flatMap((day) => day.controls);
  assert.ok(cards.some((card) => card.title === "Contrôle injection"));
  assert.equal(after.payload.teacherLoadThisWeek, loadBefore + 1);

  const agenda = await jsonRequest(`/api/agenda?classroomId=${encodeURIComponent(forged.payload.item.classroomId)}`, {
    headers: { cookie: teacherCookie },
  });
  assert.equal(agenda.response.status, 200);
  assert.ok(agenda.payload.items.some((item) => item.id === forged.payload.item.id));

  const second = await jsonRequest("/api/teacher/controls", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      annualCourseId: option.annualCourseId,
      courseSessionKey: option.courseSessionKey,
      title: "Contrôle 2",
    }),
  });
  assert.equal(second.response.status, 201, second.payload.reason);

  const blocked = await jsonRequest("/api/teacher/controls", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      annualCourseId: option.annualCourseId,
      courseSessionKey: option.courseSessionKey,
      title: "Contrôle 3",
      confirmCoordination: false,
    }),
  });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.payload.code, "CONTROL_COORDINATION_CONFIRM_REQUIRED");
  assert.equal(blocked.payload.coordination.classDayCount, 2);

  const confirmed = await jsonRequest("/api/teacher/controls", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      annualCourseId: option.annualCourseId,
      courseSessionKey: option.courseSessionKey,
      title: "Contrôle 3",
      confirmCoordination: true,
    }),
  });
  assert.equal(confirmed.response.status, 201, confirmed.payload.reason);
  assert.equal(confirmed.payload.item.title, "Contrôle 3");

  const homework = await jsonRequest("/api/agenda", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      classroomId: forged.payload.item.classroomId,
      subjectId: forged.payload.item.subjectId,
      day: forged.payload.item.day,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: forged.payload.item.schoolWeekNumber,
      type: "HOMEWORK",
      title: "Devoir hors coordination",
      detail: "",
    }),
  });
  assert.equal(homework.response.status, 201, homework.payload.reason);

  const legacyBlocked = await jsonRequest("/api/agenda", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      classroomId: forged.payload.item.classroomId,
      subjectId: forged.payload.item.subjectId,
      day: forged.payload.item.day,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: forged.payload.item.schoolWeekNumber,
      type: "TEST",
      title: "Contrôle legacy 4",
      detail: "",
    }),
  });
  assert.equal(legacyBlocked.response.status, 409);
  assert.equal(legacyBlocked.payload.code, "CONTROL_COORDINATION_CONFIRM_REQUIRED");

  const legacyConfirmed = await jsonRequest("/api/agenda", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      classroomId: forged.payload.item.classroomId,
      subjectId: forged.payload.item.subjectId,
      day: forged.payload.item.day,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: forged.payload.item.schoolWeekNumber,
      type: "TEST",
      title: "Contrôle legacy 4",
      detail: "",
      confirmCoordination: true,
    }),
  });
  assert.equal(legacyConfirmed.response.status, 201, legacyConfirmed.payload.reason);
});

test("2.34.0 — E2E déplacement structuré vers une autre CourseSession", async () => {
  const adminCookie = await loginAdmin();
  const teacherCookie = await loginTeacher("teacher-demo-current");
  const otherCookie = await loginTeacher("teacher-demo-martin");
  const seeded = await seedInteractiveControlCourse(adminCookie, "teacher-demo-current", "MOV");

  const semester = await jsonRequest(
    `/api/teacher/controls/planning?view=semester&schoolYearId=${encodeURIComponent(seeded.schoolYearId)}`,
    { headers: { cookie: teacherCookie } },
  );
  assert.equal(semester.response.status, 200, semester.payload.reason);
  assert.equal(semester.payload.ok, true);
  assert.equal(semester.payload.layout, "semester");
  assert.ok(semester.payload.semester);
  assert.ok(Array.isArray(semester.payload.classroomIds));

  const options = [];
  for (let week = 1; week <= 8; week += 1) {
    const next = await jsonRequest(
      `/api/teacher/controls/planning?week=${week}&schoolYearId=${encodeURIComponent(seeded.schoolYearId)}&view=week`,
      { headers: { cookie: teacherCookie } },
    );
    if (next.response.status !== 200) continue;
    for (const day of next.payload.week?.days ?? []) {
      for (const option of day.placementOptions ?? []) {
        if (option.annualCourseId === seeded.annualCourseId) {
          options.push(option);
        }
      }
    }
  }
  const unique = [...new Map(options.map((entry) => [entry.courseSessionKey, entry])).values()];
  assert.ok(unique.length >= 2, "deux CourseSession réelles requises");
  const source = unique[0];
  const dest = unique[1];
  assert.notEqual(source.courseSessionKey, dest.courseSessionKey);

  const created = await jsonRequest("/api/teacher/controls", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      annualCourseId: source.annualCourseId,
      courseSessionKey: source.courseSessionKey,
      title: "Contrôle à déplacer",
    }),
  });
  assert.equal(created.response.status, 201, created.payload.reason);
  const agendaItemId = created.payload.item.id;

  const dateOnly = await jsonRequest(`/api/teacher/controls/${agendaItemId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({ date: "2099-01-01", day: 3, schoolWeekNumber: 12 }),
  });
  assert.equal(dateOnly.response.status, 400);
  assert.match(dateOnly.payload.reason, /séance réelle/);

  const fakeKey = await jsonRequest(`/api/teacher/controls/${agendaItemId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      annualCourseId: source.annualCourseId,
      courseSessionKey: "year-fake|missing|2099-01-01",
    }),
  });
  assert.equal(fakeKey.response.status, 409);

  const stolen = await jsonRequest(`/api/teacher/controls/${agendaItemId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: otherCookie },
    body: JSON.stringify({
      annualCourseId: dest.annualCourseId,
      courseSessionKey: dest.courseSessionKey,
    }),
  });
  assert.equal(stolen.response.status, 403);

  const noop = await jsonRequest(`/api/teacher/controls/${agendaItemId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      annualCourseId: source.annualCourseId,
      courseSessionKey: source.courseSessionKey,
    }),
  });
  assert.equal(noop.response.status, 200, noop.payload.reason);
  assert.equal(noop.payload.moved, false);
  assert.equal(noop.payload.item.id, agendaItemId);

  const moved = await jsonRequest(`/api/teacher/controls/${agendaItemId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      annualCourseId: dest.annualCourseId,
      courseSessionKey: dest.courseSessionKey,
    }),
  });
  assert.equal(moved.response.status, 200, moved.payload.reason);
  assert.equal(moved.payload.ok, true);
  assert.equal(moved.payload.moved, true);
  assert.equal(moved.payload.item.id, agendaItemId);
  assert.equal(moved.payload.item.courseSessionKey, dest.courseSessionKey);
  assert.equal(moved.payload.item.annualCourseId, dest.annualCourseId);
  assert.equal(moved.payload.item.courseSessionDate, dest.date);
  assert.equal(moved.payload.item.title, "Contrôle à déplacer");

  const weekView = await jsonRequest(
    `/api/teacher/controls/planning?week=${dest.schoolWeekNumber}&view=week&schoolYearId=${encodeURIComponent(seeded.schoolYearId)}`,
    { headers: { cookie: teacherCookie } },
  );
  assert.equal(weekView.response.status, 200);
  const cards = (weekView.payload.week?.days ?? []).flatMap((day) => day.controls ?? []);
  assert.ok(cards.some((card) => card.agendaItemId === agendaItemId && card.title === "Contrôle à déplacer"));
});


