import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

import { formatCourseSessionCardSubtitle, formatCourseSessionCardWeekLabel } from "../src/features/class-notebook/session-window.ts";
import {
  focusNotebookReference,
  notebookReferenceButtonLabel,
  notebookReferenceSession,
  notebookVisibleColumns,
  resolveNotebookStartSession,
  selectNotebookColumn,
  shiftNotebookWindow,
} from "../src/features/class-notebook/notebook-focus.ts";
import { applyTeacherMenuNavigation } from "../src/features/teacher/navigation.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";

const ARTIFACTS = "/opt/cursor/artifacts";
const TODAY = "2026-11-16";
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const css = readFileSync(new URL("../web/app/globals.css", import.meta.url), "utf8")
  .replace('@import "tailwindcss";\n', "")
  .replace(/@import url\([^)]+\);\n/, "");

function frenchDate(iso) {
  const [, month, day] = iso.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

function mondaySessions() {
  return computeCourseSessions({
    schoolYearId: "SY-2026-27",
    courses: [{ id: "ac-lundi", classId: "class-mecauto2", contextId: "ctx-lundi" }],
    slots: [{
      id: "lundi",
      annualCourseId: "ac-lundi",
      dayOfWeek: 1,
      periodStart: 2,
      periodEnd: 3,
      weekKind: "all",
      validFrom: null,
      validTo: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    }],
    weeks: [
      { number: 12, kind: "B", monday: "2026-11-16" },
      { number: 13, kind: "A", monday: "2026-11-23" },
      { number: 14, kind: "B", monday: "2026-11-30" },
      { number: 15, kind: "A", monday: "2026-12-07" },
    ],
    holidays: [],
    exceptions: [],
  }).sort((left, right) => left.date.localeCompare(right.date));
}

const PUBLICATIONS = {
  "2026-11-16": "Devoir donné le 16 novembre",
  "2026-11-23": "Préparer le cours du 23 novembre",
  "2026-11-30": "Lecture du 30 novembre",
  "2026-12-07": "Exercice du 7 décembre",
};
const NOTES = {
  "2026-11-16": "Vérifier les travaux du 16",
  "2026-11-23": "Note prof du 23",
  "2026-11-30": "Note prof du 30",
  "2026-12-07": "Note prof du 7",
};

function resolvedStart(sessions, focus) {
  return resolveNotebookStartSession({
    sessions,
    followMode: focus.followMode,
    todayIso: TODAY,
    centerSessionKey: focus.windowStartKey,
    centerWeekNumber: 12,
  })?.key ?? null;
}

function columnModel(sessions, focus, count) {
  const reference = notebookReferenceSession(sessions, TODAY);
  return {
    count,
    todayLabel: notebookReferenceButtonLabel(reference),
    todayPressed: focus.followMode === "auto",
    columns: notebookVisibleColumns({
      sessions,
      followMode: focus.followMode,
      todayIso: TODAY,
      windowStartKey: focus.windowStartKey,
      selectedSessionKey: focus.selectedSessionKey,
      centerWeekNumber: 12,
      count,
    }).map((column) => {
      const session = sessions.find((entry) => entry.key === column.key);
      return {
        ...column,
        dateLabel: frenchDate(column.date),
        subtitle: `${formatCourseSessionCardWeekLabel(session)} · ${formatCourseSessionCardSubtitle(session)}`,
        publication: PUBLICATIONS[column.date],
        note: NOTES[column.date],
      };
    }),
  };
}

function launchOptions() {
  return {
    headless: true,
    ...(process.env.CAMPUS_PLAYWRIGHT_CHANNEL ? { channel: process.env.CAMPUS_PLAYWRIGHT_CHANNEL } : {}),
  };
}

async function installNotebook(page, sessions, count) {
  let focus = focusNotebookReference(sessions, TODAY);
  await page.exposeFunction("notebookAction", async (action, key) => {
    const resolved = resolvedStart(sessions, focus);
    if (action === "select") focus = selectNotebookColumn(resolved, key);
    if (action === "shift") {
      const next = shiftNotebookWindow(sessions, focus, Number(key), resolved);
      if (next) focus = next;
    }
    if (action === "today") focus = focusNotebookReference(sessions, TODAY);
    return columnModel(sessions, focus, count);
  });
  await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    ${css}
    body { margin: 0; background: #f5f7fb; }
    .demo { max-width: 1180px; margin: 0 auto; padding: 24px 12px 32px; }
    .class-notebook-column { min-height: 240px; }
    .class-notebook-zone h3 { margin: 0; color: #8793a9; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
    .class-notebook-zone p { margin: 4px 0 12px; color: #06183d; }
  </style></head><body><div class="demo"><div class="class-notebook"><div id="notebook"></div></div></div></body></html>`);
  await page.evaluate((model) => {
    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
    const render = (next) => {
      const columns = next.columns.map((column) => `
        <article class="class-notebook-column${column.selected ? " active" : ""}" data-column-date="${column.date}">
          <header class="class-notebook-column-header">
            <button type="button" data-action="select" data-key="${column.key}" aria-pressed="${column.selected ? "true" : "false"}">
              ${column.referenceTag ? `<em class="class-notebook-reference-tag">${escapeHtml(column.referenceTag)}</em>` : ""}
              <strong>${escapeHtml(column.dateLabel)}</strong>
              <span>${escapeHtml(column.subtitle)}</span>
            </button>
          </header>
          <section class="class-notebook-zone">
            <h3>Publications élèves</h3>
            <p>${escapeHtml(column.publication)}</p>
            <h3>Notes prof</h3>
            <p>${escapeHtml(column.note)}</p>
          </section>
        </article>`).join("");
      document.querySelector("#notebook").innerHTML = `
        <div class="class-notebook-shift">
          <button type="button" data-action="shift" data-key="-1" aria-label="Séquences précédentes">◀</button>
          <button type="button" data-action="shift" data-key="1" aria-label="Séquences suivantes">▶</button>
          <button type="button" class="class-notebook-today" data-action="today" aria-pressed="${next.todayPressed ? "true" : "false"}">${escapeHtml(next.todayLabel)}</button>
        </div>
        <div class="class-notebook-grid class-notebook-grid-${next.count}" style="grid-template-columns: repeat(${next.columns.length}, minmax(0, 1fr))">${columns}</div>`;
    };
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      render(await window.notebookAction(button.dataset.action, button.dataset.key || ""));
    });
    render(model);
  }, columnModel(sessions, focus, count));
}

function readColumns(page) {
  return page.locator(".class-notebook-column").evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      date: node.getAttribute("data-column-date"),
      x: Math.round(box.x),
      width: Math.round(box.width),
      active: node.classList.contains("active"),
      display: style.display,
      tag: node.querySelector(".class-notebook-reference-tag")?.textContent ?? "",
      publication: node.querySelector("p")?.textContent ?? "",
      note: node.querySelectorAll("p")[1]?.textContent ?? "",
    };
  }));
}

test("navigateur — sélectionner le 23 novembre ne déplace pas les colonnes", async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const sessions = mondaySessions();
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await installNotebook(page, sessions, 3);
    const before = await readColumns(page);
    assert.deepEqual(before.map((column) => column.date), ["2026-11-16", "2026-11-23", "2026-11-30"]);
    assert.equal(before[0].active, true);
    assert.equal(before[0].tag, "Aujourd’hui");
    assert.equal(before[1].active, false);
    assert.ok(before.every((column) => column.display !== "none" && column.width > 200));
    await page.screenshot({ path: `${ARTIFACTS}/carnet-avant-selection.png` });

    await page.locator('[data-column-date="2026-11-23"] button').click();
    await page.waitForFunction(() => document.querySelector('[data-column-date="2026-11-23"]')?.classList.contains("active"));
    const selected = await readColumns(page);
    assert.deepEqual(selected.map((column) => column.date), ["2026-11-16", "2026-11-23", "2026-11-30"]);
    assert.deepEqual(selected.map((column) => column.x), before.map((column) => column.x));
    assert.deepEqual(selected.map((column) => column.width), before.map((column) => column.width));
    assert.equal(selected[0].active, false);
    assert.equal(selected[0].tag, "Aujourd’hui");
    assert.equal(selected[1].active, true);
    assert.equal(selected[1].tag, "");
    assert.equal(selected[2].active, false);
    assert.equal(selected[0].publication, "Devoir donné le 16 novembre");
    assert.equal(selected[1].publication, "Préparer le cours du 23 novembre");
    assert.equal(selected[2].publication, "Lecture du 30 novembre");
    assert.equal(selected[0].note, "Vérifier les travaux du 16");
    assert.equal(selected[1].note, "Note prof du 23");
    assert.equal(await page.evaluate(() => window.scrollX), 0);
    await page.screenshot({ path: `${ARTIFACTS}/carnet-selection-23-novembre.png` });

    await page.locator('[data-column-date="2026-11-30"] button').click();
    await page.waitForFunction(() => document.querySelector('[data-column-date="2026-11-30"]')?.classList.contains("active"));
    const third = await readColumns(page);
    assert.deepEqual(third.map((column) => column.date), ["2026-11-16", "2026-11-23", "2026-11-30"]);
    assert.deepEqual(third.map((column) => column.x), before.map((column) => column.x));
    assert.equal(third[2].active, true);
    assert.equal(third[0].tag, "Aujourd’hui");

    await page.getByRole("button", { name: "Séquences suivantes" }).click();
    await page.waitForFunction(() => document.querySelector(".class-notebook-column")?.getAttribute("data-column-date") === "2026-11-23");
    const shifted = await readColumns(page);
    assert.deepEqual(shifted.map((column) => column.date), ["2026-11-23", "2026-11-30", "2026-12-07"]);
    assert.equal(shifted[0].active, false);
    assert.equal(shifted[1].active, true);
    assert.equal(shifted[0].publication, "Préparer le cours du 23 novembre");
    assert.equal(shifted[1].publication, "Lecture du 30 novembre");
    assert.equal(shifted[2].note, "Note prof du 7");
    await page.screenshot({ path: `${ARTIFACTS}/carnet-fleche-droite.png` });

    await page.getByRole("button", { name: "Aujourd’hui" }).click();
    await page.waitForFunction(() => document.querySelector('[data-column-date="2026-11-16"]')?.classList.contains("active"));
    const restored = await readColumns(page);
    assert.deepEqual(restored.map((column) => column.date), ["2026-11-16", "2026-11-23", "2026-11-30"]);
    assert.equal(restored[0].active, true);
    assert.equal(restored[0].tag, "Aujourd’hui");
    assert.equal(restored[0].publication, "Devoir donné le 16 novembre");
    assert.equal(restored[0].note, "Vérifier les travaux du 16");
    await page.screenshot({ path: `${ARTIFACTS}/carnet-retour-aujourdhui.png` });
  } finally {
    await browser.close();
  }
});

test("navigateur — smartphone : une séance visible, la flèche ne la sélectionne pas toute seule", async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const sessions = mondaySessions();
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installNotebook(page, sessions, 1);
    const opened = await readColumns(page);
    assert.deepEqual(opened.map((column) => column.date), ["2026-11-16"]);
    assert.equal(opened[0].active, true);
    assert.equal(opened[0].display, "grid");
    assert.ok(opened[0].width > 250);
    await page.screenshot({ path: `${ARTIFACTS}/carnet-mobile-aujourdhui.png` });

    await page.getByRole("button", { name: "Séquences suivantes" }).click();
    await page.waitForFunction(() => document.querySelector(".class-notebook-column")?.getAttribute("data-column-date") === "2026-11-23");
    const shifted = await readColumns(page);
    assert.deepEqual(shifted.map((column) => column.date), ["2026-11-23"]);
    assert.equal(shifted[0].active, false);
    assert.equal(shifted[0].display, "grid");
    assert.ok(shifted[0].width > 250);
    assert.equal(shifted[0].publication, "Préparer le cours du 23 novembre");

    await page.locator(".class-notebook-column button").click();
    await page.waitForFunction(() => document.querySelector(".class-notebook-column")?.classList.contains("active"));
    const clicked = await readColumns(page);
    assert.deepEqual(clicked.map((column) => column.date), ["2026-11-23"]);
    assert.equal(clicked[0].active, true);
    await page.screenshot({ path: `${ARTIFACTS}/carnet-mobile-selection.png` });
  } finally {
    await browser.close();
  }
});

test("navigateur — Ma semaine ferme le Carnet et conserve la semaine 14", async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const classes = ["MECAUTO2", "MECAUTO3A", "CARROSSERIE 1"];
  const fingerprint = "Devoir du 16|Note du 16|Contrôle du 30";
  let menu = { section: "ma-semaine", notebookOpen: false, selectedSchoolWeekNumber: 14 };
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.exposeFunction("menuAction", async (action, section) => {
      if (action === "open") menu = { ...menu, section: "ma-semaine", notebookOpen: true };
      if (action === "back") menu = { ...menu, notebookOpen: false };
      if (action === "nav") menu = applyTeacherMenuNavigation(menu, section);
      return {
        ...menu,
        classes,
        fingerprint,
        showClasses: menu.section === "ma-semaine" && !menu.notebookOpen,
        showNotebook: menu.section === "ma-semaine" && menu.notebookOpen,
        showCourses: menu.section === "mes-cours",
      };
    });
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
      body { margin: 0; background: #f5f7fb; color: #06183d; font-family: "IBM Plex Sans", sans-serif; }
      .shell { display: grid; grid-template-columns: 220px 1fr; min-height: 640px; }
      .side, .mobile-tab-bar { background: #06183d; }
      .side { padding: 18px 12px; display: grid; align-content: start; gap: 6px; }
      .side button, .mobile-tab-bar button, .back, .class-card {
        font: 600 14px/1.2 "IBM Plex Sans", sans-serif; cursor: pointer;
      }
      .side button, .mobile-tab-bar button {
        color: #fff; background: transparent; border: 0; text-align: left; padding: 10px 12px; border-radius: 10px;
      }
      .side button.active, .mobile-tab-bar button.active { background: #eaf1ff; color: #06183d; }
      .mobile-tab-bar { display: none; grid-template-columns: repeat(3, 1fr); }
      .mobile-tab-bar button { text-align: center; }
      main { padding: 28px; }
      .week-pill { display: inline-block; margin: 0 0 16px; padding: 4px 10px; border-radius: 999px; background: #eaf1ff; color: #075dff; font-weight: 700; }
      .classes { display: grid; gap: 12px; }
      .class-card, .notebook-card { background: #fff; border: 1px solid #e2e8f1; border-radius: 14px; padding: 16px 18px; }
      .class-card { display: block; width: 100%; text-align: left; color: #06183d; font-size: 16px; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      .back { margin-bottom: 12px; border: 1px solid #d2dbe8; background: #fff; border-radius: 8px; padding: 8px 12px; color: #06183d; }
      @media (max-width: 760px) {
        .shell { grid-template-columns: 1fr; }
        .side { display: none; }
        .mobile-tab-bar { display: grid; position: sticky; bottom: 0; }
      }
    </style></head><body>
      <div class="shell"><nav class="side" aria-label="Navigation principale"></nav><main id="stage"></main></div>
      <nav class="mobile-tab-bar" aria-label="Navigation enseignant"></nav>
    </body></html>`);

    const sections = [
      ["ma-semaine", "Ma semaine"],
      ["mes-cours", "Mes cours"],
      ["controles", "Contrôles"],
    ];
    await page.evaluate((initial) => {
      const renderNav = (root) => {
        root.innerHTML = initial.sections.map(([id, label]) =>
          `<button type="button" data-action="nav" data-section="${id}" class="${initial.menu.section === id ? "active" : ""}">${label}</button>`,
        ).join("");
      };
      const render = (model) => {
        renderNav(document.querySelector(".side"));
        renderNav(document.querySelector(".mobile-tab-bar"));
        const stage = document.querySelector("#stage");
        stage.dataset.week = String(model.selectedSchoolWeekNumber);
        stage.dataset.notebook = model.notebookOpen ? "open" : "closed";
        stage.dataset.fingerprint = model.fingerprint;
        const week = `<p class="week-pill">Semaine ${model.selectedSchoolWeekNumber}</p>`;
        if (model.showNotebook) {
          stage.innerHTML = `${week}<button type="button" class="back" data-action="back">← Ma semaine</button>
            <article class="notebook-card"><h1>Carnet MECAUTO2</h1><p>${model.fingerprint}</p></article>`;
          return;
        }
        if (model.showCourses) {
          stage.innerHTML = `${week}<h1>Mes cours</h1>`;
          return;
        }
        stage.innerHTML = `${week}<h1>Ma semaine</h1><div class="classes">${model.classes.map((name) =>
          `<button type="button" class="class-card" data-action="open">${name}</button>`).join("")}</div>`;
      };
      document.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        render(await window.menuAction(button.dataset.action, button.dataset.section || ""));
      });
      window.renderMenu = render;
      render(initial.menuView);
    }, {
      sections,
      menu,
      menuView: {
        ...menu,
        classes,
        fingerprint,
        showClasses: true,
        showNotebook: false,
        showCourses: false,
      },
    });

    await page.getByRole("button", { name: "MECAUTO2" }).click();
    await page.waitForFunction(() => document.querySelector("#stage")?.dataset.notebook === "open");
    assert.equal(await page.locator(".week-pill").textContent(), "Semaine 14");
    assert.equal(await page.locator("#stage").getAttribute("data-fingerprint"), fingerprint);
    await page.screenshot({ path: `${ARTIFACTS}/ma-semaine-carnet-ouvert.png` });

    await page.locator(".side").getByRole("button", { name: "Ma semaine" }).click();
    await page.waitForFunction(() => document.querySelector("#stage")?.dataset.notebook === "closed");
    const cards = page.locator(".class-card");
    assert.deepEqual(await cards.allTextContents(), classes);
    assert.equal(await page.locator(".week-pill").textContent(), "Semaine 14");
    assert.equal(await page.locator("h1").textContent(), "Ma semaine");
    assert.equal(await page.locator("#stage").getAttribute("data-fingerprint"), fingerprint);
    await page.screenshot({ path: `${ARTIFACTS}/ma-semaine-retour-menu.png` });

    await page.getByRole("button", { name: "MECAUTO2" }).click();
    await page.waitForFunction(() => document.querySelector("#stage")?.dataset.notebook === "open");
    await page.getByRole("button", { name: "← Ma semaine" }).click();
    await page.waitForFunction(() => document.querySelector("#stage")?.dataset.notebook === "closed");
    assert.deepEqual(await page.locator(".class-card").allTextContents(), classes);
    assert.equal(await page.locator(".week-pill").textContent(), "Semaine 14");
    await page.screenshot({ path: `${ARTIFACTS}/ma-semaine-retour-bouton.png` });

    await page.getByRole("button", { name: "MECAUTO2" }).click();
    await page.waitForFunction(() => document.querySelector("#stage")?.dataset.notebook === "open");
    await page.locator(".side").getByRole("button", { name: "Mes cours" }).click();
    await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Mes cours");
    assert.equal(await page.locator("#stage").getAttribute("data-notebook"), "open");
    assert.equal(await page.locator(".week-pill").textContent(), "Semaine 14");
    await page.locator(".side").getByRole("button", { name: "Ma semaine" }).click();
    await page.waitForFunction(() => document.querySelector("#stage")?.dataset.notebook === "closed");
    assert.deepEqual(await page.locator(".class-card").allTextContents(), classes);

    await page.locator(".side").getByRole("button", { name: "Ma semaine" }).click();
    assert.equal(await page.locator("#stage").getAttribute("data-notebook"), "closed");
    assert.equal(await page.locator(".week-pill").textContent(), "Semaine 14");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "MECAUTO2" }).click();
    await page.waitForFunction(() => document.querySelector("#stage")?.dataset.notebook === "open");
    await page.locator(".mobile-tab-bar").getByRole("button", { name: "Ma semaine" }).click();
    await page.waitForFunction(() => document.querySelector("#stage")?.dataset.notebook === "closed");
    assert.deepEqual(await page.locator(".class-card").allTextContents(), classes);
    assert.equal(await page.locator(".week-pill").textContent(), "Semaine 14");
    await page.screenshot({ path: `${ARTIFACTS}/ma-semaine-retour-mobile.png` });
  } finally {
    await browser.close();
  }
});
