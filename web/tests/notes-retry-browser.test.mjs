import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { launchOptions, login, putNotes, seedTeacherCourse, serverNotes, startPreview, waitFor } from "./teacher-browser-helpers.mjs";

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
