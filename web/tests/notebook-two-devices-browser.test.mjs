import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { launchOptions, login, seedTeacherCourse, serverNotes, startPreview, waitFor } from "./teacher-browser-helpers.mjs";

async function openDevice(browser, origin, cookie, { clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const [name, ...rest] = cookie.split("=");
  await context.addCookies([{ name, value: rest.join("="), url: origin }]);
  const page = await context.newPage();
  if (clock) await page.clock.install();
  let offline = false;
  await page.route(/\/api\/(agenda|teacher\/notes)/, (route) => (offline ? route.abort("internetdisconnected") : route.continue()));
  await page.goto(origin);
  await page.getByRole("button", { name: /NRT/ }).first().click();
  await page.getByText("Aucune publication pour cette séance.").first().waitFor();
  return {
    page,
    context,
    setOffline(value) {
      offline = value;
    },
  };
}

async function writeNote(page, text) {
  await page.getByRole("region", { name: "Notes prof" }).first().getByRole("button", { name: "Modifier" }).click();
  await page.locator(".rich-doc-line-input[contenteditable=true]").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
}

async function publish(page, text) {
  await page.getByRole("button", { name: "Rédiger" }).first().click();
  await page.locator(".rich-doc-line-input[contenteditable=true]").last().click();
  await page.keyboard.type(text);
  await page.getByRole("button", { name: "Enregistrer et publier", exact: true }).click();
  await page.getByText(text).first().waitFor({ timeout: 10_000 });
}

async function returnToTab(page) {
  await page.clock.fastForward("00:20");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test("2.62.23 — Carnet ouvert sur deux appareils : relecture au retour, sans écraser une saisie non enregistrée", { timeout: 120_000 }, async () => {
  const preview = await startPreview();
  const browser = await chromium.launch(launchOptions());
  try {
    const admin = await login(preview.origin, "teacher-chf");
    await seedTeacherCourse(preview.origin, admin, "teacher-demo-current");
    const cookieA = await login(preview.origin, "teacher-demo-current");
    const cookieB = await login(preview.origin, "teacher-demo-current");
    const a = await openDevice(browser, preview.origin, cookieA);
    const b = await openDevice(browser, preview.origin, cookieB, { clock: true });
    const banner = b.page.locator('[data-notes-sync="interrupted"]');

    await publish(a.page, "Devoir écrit sur l’appareil A");
    await writeNote(a.page, "Note prof de l’appareil A");
    await waitFor(async () => JSON.stringify((await serverNotes(preview.origin, cookieA)).notes ?? {}).includes("appareil A"), "note de A enregistrée");

    await returnToTab(b.page);
    await b.page.getByText("Devoir écrit sur l’appareil A").first().waitFor({ timeout: 10_000 });
    await b.page.getByText("Note prof de l’appareil A").first().waitFor({ timeout: 10_000 });
    assert.equal(await banner.count(), 0);

    await writeNote(b.page, " puis B");
    await waitFor(async () => JSON.stringify((await serverNotes(preview.origin, cookieB)).notes ?? {}).includes("appareil A puis B"), "B écrit après la relecture");
    assert.equal(await banner.count(), 0, "écrire après la relecture ne crée pas de conflit");

    b.setOffline(true);
    await writeNote(b.page, " hors ligne");
    await b.page.locator(".technical-toast").filter({ hasText: "Connexion au serveur interrompue" }).waitFor({ timeout: 10_000 });
    await a.page.reload();
    await a.page.getByRole("button", { name: /NRT/ }).first().click();
    await a.page.getByText("Note prof de l’appareil A puis B").first().waitFor({ timeout: 10_000 });
    await writeNote(a.page, " et A encore");
    await waitFor(async () => JSON.stringify((await serverNotes(preview.origin, cookieA)).notes ?? {}).includes("et A encore"), "deuxième note de A");

    await returnToTab(b.page);
    await b.page.waitForTimeout(1_000);
    assert.equal(await b.page.getByText("puis B hors ligne").count() > 0, true, "la saisie non enregistrée de B reste à l’écran");
    assert.equal(await b.page.getByText("et A encore").count(), 0, "la relecture ne remplace pas une saisie non enregistrée");
    assert.equal(await b.page.locator('[data-publications-state="ready"]').count() > 0, true, "un échec de relecture ne met pas le Carnet en erreur");
    assert.equal(await b.page.getByText("Devoir écrit sur l’appareil A").count() > 0, true, "les publications déjà affichées restent visibles");

    b.setOffline(false);
    await b.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await banner.waitFor({ timeout: 10_000 });
    const final = JSON.stringify((await serverNotes(preview.origin, cookieA)).notes ?? {});
    assert.equal(final.includes("et A encore"), true, "la version de A n’est pas écrasée");
    assert.equal(final.includes("hors ligne"), false);
    await a.context.close();
    await b.context.close();
  } finally {
    await browser.close();
    preview.close();
  }
});
