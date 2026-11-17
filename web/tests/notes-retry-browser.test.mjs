import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.CAMPUS_STORE ??= "memory";
process.env.AUTH_SECRET ??= "test-secret-e2e-phase-08";
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";
process.env.CAMPUS_MFA_ENCRYPTION_KEY ??= "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";
process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER ??= "80";
process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_TARGET ??= "80";
process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA ??= "80";
process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA_TARGET ??= "80";
if (process.env.NODE_ENV === "production") process.env.NODE_ENV = "test";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

async function startPreview() {
  const { startProdServer } = await import(pathToFileURL(path.join(webRoot, "node_modules/vinext/dist/server/prod-server.js")).href);
  const preview = await startProdServer({ port: 0, host: "127.0.0.1", outDir: path.join(webRoot, "dist"), silent: true });
  return { origin: `http://127.0.0.1:${preview.port}`, close: () => preview.server.close() };
}

const cookieOf = (response) => (response.headers.get("set-cookie") ?? "").split(";")[0];

async function login(origin, teacherId) {
  const response = await fetch(`${origin}/api/auth/teacher`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ teacherId, password: "campus-demo" }),
  });
  const payload = await response.json();
  if (response.status !== 200) throw new Error(`login ${teacherId}: ${payload.reason}`);
  let cookie = cookieOf(response);
  if (payload.session?.isAdmin && payload.session.mfaSetupRequired) {
    const { Secret, TOTP } = await import(pathToFileURL(path.join(webRoot, "node_modules/otpauth/dist/otpauth.node.mjs")).href);
    const setup = await fetch(`${origin}/api/auth/teacher/mfa/setup`, { method: "POST", headers: { cookie, "content-type": "application/json" } });
    const secret = new URL((await setup.json()).otpauthUri).searchParams.get("secret");
    const code = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" }).generate();
    const confirm = await fetch(`${origin}/api/auth/teacher/mfa/confirm`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (confirm.status !== 200) throw new Error("mfa confirm");
    cookie = cookieOf(confirm) || cookie;
  }
  return cookie;
}

async function call(origin, cookie, route, init = {}) {
  const response = await fetch(`${origin}${route}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, origin, ...(init.headers ?? {}) },
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function seedTeacherCourse(origin, adminCookie, teacherId) {
  const years = await call(origin, adminCookie, "/api/admin/school-year");
  const active = (years.payload.years ?? []).find((year) => year.status === "active") ?? years.payload.years?.[0];
  const catalog = await call(origin, adminCookie, "/api/admin/catalog");
  const branch =
    (catalog.payload.branches ?? []).find((entry) => entry.label === "Moteur" && entry.isActive) ??
    (catalog.payload.branches ?? []).find((entry) => entry.isActive && !entry.isArchived);
  await call(origin, adminCookie, `/api/admin/catalog/${encodeURIComponent(branch.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ kind: "branch", teachingType: "TECHNICAL" }),
  });
  const profession = await call(origin, adminCookie, "/api/admin/catalog", {
    method: "POST",
    body: JSON.stringify({ kind: "profession", label: `Notes réseau ${Date.now()}`, durationYears: 4, classCodePrefix: "NRT" }),
  });
  const professionId = profession.payload.profession.id;
  const ctx = await call(origin, adminCookie, "/api/admin/catalog", {
    method: "POST",
    body: JSON.stringify({ kind: "context", professionId, trainingYear: 1, branchId: branch.id }),
  });
  const created = await call(origin, adminCookie, "/api/admin/catalog", {
    method: "POST",
    body: JSON.stringify({
      kind: "class",
      code: `NRT${String(Date.now()).slice(-4)}`,
      label: "NRT1A",
      schoolYearId: active.id,
      schoolYearLabel: active.label,
      professionId,
      trainingYear: 1,
      parallelCode: "A",
    }),
  });
  if (!created.payload.ok) throw new Error(`class: ${created.payload.reason}`);
  const schoolClass = created.payload.class;
  const course = await call(origin, adminCookie, "/api/admin/annual-courses", {
    method: "POST",
    body: JSON.stringify({ action: "create", schoolYearId: active.id, classId: schoolClass.id, contextId: ctx.payload.context.id }),
  });
  if (course.status !== 201) throw new Error(`course: ${course.payload.reason}`);
  const annualCourseId = course.payload.course.id;
  await call(origin, adminCookie, `/api/admin/teachers/${encodeURIComponent(teacherId)}`, {
    method: "PATCH",
    body: JSON.stringify({ teachingType: "TECHNICAL" }),
  });
  const assigned = await call(origin, adminCookie, "/api/admin/annual-courses", {
    method: "POST",
    body: JSON.stringify({ action: "assign", annualCourseId, teacherId, role: "PRIMARY", validFrom: "2026-08-01", forceIncompatible: true }),
  });
  if (assigned.status !== 201 && assigned.status !== 200) throw new Error(`assign: ${assigned.payload.reason}`);
  const attendance = await call(origin, adminCookie, "/api/admin/course-schedule", {
    method: "POST",
    body: JSON.stringify({
      action: "replaceAttendanceDays",
      classId: schoolClass.id,
      days: [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
    }),
  });
  if (attendance.status !== 200) throw new Error(`attendance: ${attendance.payload.reason}`);
  for (const dayOfWeek of [1]) {
    const slot = await call(origin, adminCookie, "/api/admin/course-schedule", {
      method: "POST",
      body: JSON.stringify({ action: "create", annualCourseId, dayOfWeek, periodStart: 4, periodEnd: 4, weekKind: "all" }),
    });
    if (slot.status !== 201) throw new Error(`slot: ${slot.payload.reason}`);
  }
  return { annualCourseId, classLabel: schoolClass.label ?? schoolClass.code };
}

async function serverNotes(origin, cookie) {
  return (await call(origin, cookie, "/api/teacher/notes")).payload;
}

async function putNotes(origin, cookie, notes, revision) {
  return call(origin, cookie, "/api/teacher/notes", { method: "PUT", body: JSON.stringify({ notes, revision }) });
}

function launchOptions() {
  return {
    headless: true,
    ...(process.env.CAMPUS_PLAYWRIGHT_CHANNEL ? { channel: process.env.CAMPUS_PLAYWRIGHT_CHANNEL } : {}),
  };
}

async function waitFor(check, label, timeout = 20_000) {
  const started = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - started > timeout) throw new Error(`délai dépassé : ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

test("2.62.22 — notes prof : reprise réelle après réponse perdue, coupure réseau et vrai conflit", { timeout: 120_000 }, async () => {
  const preview = await startPreview();
  const browser = await chromium.launch(launchOptions());
  try {
    const admin = await login(preview.origin, "teacher-chf");
    await seedTeacherCourse(preview.origin, admin, "teacher-demo-current");
    const cookie = await login(preview.origin, "teacher-demo-current");
    const containsOnServer = async (text) => JSON.stringify((await serverNotes(preview.origin, cookie)).notes ?? {}).includes(text);

    const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: preview.origin }]);
    const page = await context.newPage();

    let mode = "normal";
    const lostBodies = [];
    const putStatuses = [];
    await page.route("**/api/teacher/notes", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      if (mode === "offline") return route.abort("internetdisconnected");
      const response = await route.fetch();
      if (mode === "lose") {
        lostBodies.push(route.request().postData() ?? "");
        return route.abort("connectionreset");
      }
      putStatuses.push(response.status());
      return route.fulfill({ response });
    });

    await page.goto(preview.origin);
    await page.getByRole("button", { name: /NRT/ }).first().click();
    await waitFor(() => putStatuses.length > 0, "première synchronisation des notes");
    const banner = page.locator('[data-notes-sync="interrupted"]');
    const toast = page.locator(".technical-toast");
    async function writeNote(text) {
      await page.getByRole("button", { name: "Modifier" }).first().click();
      await page.locator(".rich-doc-line-input[contenteditable=true]").last().click();
      await page.keyboard.press("End");
      await page.keyboard.type(text);
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    }

    const before = putStatuses.length;
    mode = "lose";
    await writeNote("Réponse perdue");
    await waitFor(() => lostBodies.some((body) => body.includes("Réponse perdue")), "sauvegarde envoyée sans réponse");
    assert.equal(await containsOnServer("Réponse perdue"), true, "le serveur a bien enregistré la sauvegarde sans réponse");
    mode = "normal";
    await toast.filter({ hasText: "Connexion rétablie" }).waitFor({ timeout: 10_000 });
    assert.deepEqual(putStatuses.slice(before), [409, 200], "le 409 est résolu en relisant le serveur puis en renvoyant");
    assert.equal(await banner.count(), 0, "aucun bandeau orange quand le serveur contient déjà ce que l’onglet a envoyé");
    await writeNote(" puis reprise");
    await waitFor(() => containsOnServer("Réponse perdue puis reprise"), "texte suivant enregistré");

    mode = "offline";
    await context.setOffline(true);
    await writeNote(" hors ligne");
    await toast.filter({ hasText: "Connexion au serveur interrompue" }).waitFor({ timeout: 10_000 });
    assert.equal(await banner.count(), 0, "une coupure réseau n’ouvre pas le bandeau orange");
    assert.equal(await containsOnServer("hors ligne"), false);
    mode = "normal";
    await context.setOffline(false);
    await waitFor(() => containsOnServer("puis reprise hors ligne"), "renvoi automatique au retour du réseau");
    await toast.filter({ hasText: "Connexion rétablie" }).waitFor({ timeout: 10_000 });
    assert.equal(await banner.count(), 0);

    const current = await serverNotes(preview.origin, cookie);
    const otherTab = JSON.parse(JSON.stringify(current.notes).replace("hors ligne", "autre onglet"));
    const written = await putNotes(preview.origin, cookie, otherTab, current.revision);
    assert.equal(written.status, 200, written.payload.reason);
    await writeNote(" et suite");
    await banner.waitFor({ timeout: 10_000 });
    assert.equal(await containsOnServer("autre onglet"), true, "la version de l’autre onglet n’est pas écrasée");
    assert.equal(await containsOnServer("et suite"), false);
    await context.close();
  } finally {
    await browser.close();
    preview.close();
  }
});
