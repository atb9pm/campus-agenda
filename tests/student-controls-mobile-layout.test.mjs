import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

const css = readFileSync(new URL("../web/app/globals.css", import.meta.url), "utf8")
  .replace('@import "tailwindcss";\n', "")
  .replace(/@import url\([^)]+\);\n/, "");

function control({ day, month, week, title, branch, detail, shot }) {
  return `<article class="student-next-control student-control-row urgency-soon" data-control${shot ? ` id="${shot}"` : ""}>
    <p class="student-course-chip">${branch}</p>
    <div class="student-control-main">
      <time class="student-control-date">
        <span class="student-control-day">${day}</span>
        <span class="student-control-month">${month}</span>
      </time>
      <span class="student-control-week">${week}</span>
      <div class="student-control-card-body">
        <strong>${title}</strong>
        ${detail ? `<span class="student-next-control-detail student-control-remark">${detail}</span>` : ""}
      </div>
    </div>
  </article>`;
}

function course(name, text) {
  return `<article class="student-subject-card">
    <h3 class="student-subject-card-title">Cours du jour</h3>
    <section class="student-branch-block">
      <div class="student-branch-head"><p class="student-course-chip">${name}</p></div>
      ${text ? `<div class="student-branch-item"><div class="student-pub-legacy"><p>${text}</p></div></div>` : ""}
    </section>
  </article>`;
}

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="mechanical-app student-app student-course-day-app has-mobile-tabs" data-student-tab="tout">
  <main class="student-course-day-main">
    <section class="student-course-day-card student-dashboard-hero">
      <div class="student-hero-title-row">
        <div class="student-dashboard-hero-copy"><h1>Jeudi 26 novembre</h1></div>
        <button class="student-signout-mobile" type="button">Sortir</button>
      </div>
      <div class="student-context-pills">
        <span class="student-context-pill">MECAUTO3A</span>
        <span class="student-context-pill">Sem 13-A</span>
      </div>
      <div class="student-view-tabs">
        <button class="active" type="button">Tout</button>
        <button type="button">Devoirs</button>
        <button type="button">Contrôles</button>
      </div>
    </section>
    <div class="student-dashboard-grid" data-layout="tout">
      <section class="student-todo-panel" id="courses">
        <h2 class="student-panel-heading" id="courses-title">Cours du jour</h2>
        <div class="student-branch-list">
          ${course("CP 2 Châssis : Géométrie", "Contrôle des jeux et des angles.")}
          ${course("CP 3 Moteur", "Révision du circuit de lubrification.")}
        </div>
      </section>
      <section class="student-controls-preview" id="controls">
        <h2>Contrôles à venir</h2>
        <div class="student-control-preview-list">
          ${control({ day: "19", month: "nov", week: "Sem. 12-B", title: "Contrôle 3", branch: "CP 3 Moteur", detail: "Uniquement programme de 2ème année moteur + châssis + climatisation.", shot: "moteur" })}
          ${control({ day: "26", month: "nov", week: "Sem. 13-A", title: "Contrôle 2", branch: "CP 1 Électrotechnique", detail: "Calculs électriques 1ère - 2ème.", shot: "electro" })}
          ${control({ day: "15", month: "déc", week: "Sem. 16-B", title: "Contrôle 2", branch: "CP 2 Châssis : Géométrie", shot: "chassis" })}
          ${control({ day: "17", month: "nov", week: "Sem. 12-A", title: "Société", branch: "BG", detail: "Institutions suisses.", shot: "bg-societe" })}
          ${control({ day: "24", month: "nov", week: "Sem. 13-B", title: "Langue", branch: "BG", detail: "Compréhension écrite.", shot: "bg-langue" })}
          ${control({ day: "26", month: "nov", week: "Sem. 13-A", title: "Contrôle 1", branch: "BG" })}
        </div>
      </section>
    </div>
  </main>
  <nav class="mobile-tab-bar">
    <button class="active" type="button"><span class="student-nav-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg></span>Tout</button>
    <button type="button"><span class="student-nav-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M7 3.5h7.2L19 8.2V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z M14 3.8V8h4.2 M8.5 12.5h7 M8.5 16h5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg></span>Devoirs</button>
    <button type="button"><span class="student-nav-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M8 4.5h8a2 2 0 0 1 2 2V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V6.5a2 2 0 0 1 2-2Z M9 12.2 11 14.2 15.2 10" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg></span>Contrôles</button>
    <button type="button"><span class="student-nav-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 6.5V12l3.5 2 M12 20a8 8 0 1 0-7.2-4.5 M5 12.5H2.5V15" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg></span>Cours précédents</button>
  </nav>
</div>
</body></html>`;

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440];

test("smartphone — Contrôle 2 n’est jamais comprimé lettre par lettre", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const shots = process.env.CAMPUS_LAYOUT_SHOTS;
  if (shots) mkdirSync(shots, { recursive: true });
  const measures = [];
  try {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(html, { waitUntil: "load" });
      const result = await page.evaluate(({ width }) => {
        const lineCount = (element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getClientRects().length;
        };
        const phone = width <= 760;
        const problems = [];
        if (document.documentElement.scrollWidth > width + 1) problems.push(`débordement ${document.documentElement.scrollWidth}`);
        const rows = [...document.querySelectorAll("[data-control]")];
        const rowMeasures = rows.map((row) => {
          const title = row.querySelector("strong");
          const badge = row.querySelector(".student-course-chip");
          const remark = row.querySelector(".student-control-remark");
          const date = row.querySelector(".student-control-date");
          const week = row.querySelector(".student-control-week");
          const rowBox = row.getBoundingClientRect();
          const rowStyle = getComputedStyle(row);
          const contentWidth = row.clientWidth - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight);
          const titleBox = title.getBoundingClientRect();
          const badgeBox = badge.getBoundingClientRect();
          const fontSize = parseFloat(getComputedStyle(title).fontSize);
          const titleLines = lineCount(title);
          const badgeLines = lineCount(badge);
          const info = {
            title: title.textContent,
            branch: badge.textContent,
            titleWidth: Math.round(titleBox.width),
            rowWidth: Math.round(contentWidth),
            titleLines,
            titleHeight: Math.round(titleBox.height),
            fontSize,
            badgeWidth: Math.round(badgeBox.width),
            badgeLines,
          };
          if (title.scrollWidth > title.clientWidth + 2) problems.push(`${title.textContent} déborde`);
          if (badge.scrollWidth > badge.clientWidth + 2) problems.push(`${badge.textContent} déborde`);
          if (remark && (remark.scrollWidth > remark.clientWidth + 2 || remark.scrollHeight > remark.clientHeight + 2)) {
            problems.push(`description tronquée pour ${title.textContent}`);
          }
          if (badgeBox.width > rowBox.width + 1) problems.push(`badge plus large que la carte : ${badge.textContent}`);
          if (phone) {
            if (titleBox.width < contentWidth - 2) problems.push(`${title.textContent} trop étroit (${info.titleWidth}/${info.rowWidth})`);
            if (date.getBoundingClientRect().top > week.getBoundingClientRect().bottom) problems.push("date et semaine séparées");
            if (badgeBox.top < date.getBoundingClientRect().bottom - 2) problems.push("branche sur la ligne de la date");
            if (titleBox.top < badgeBox.bottom - 2) problems.push("titre comprimé à côté de la branche");
            if (title.textContent === "Contrôle 2" && (titleLines > 1 || titleBox.height > fontSize * 1.8)) {
              problems.push(`Contrôle 2 sur ${titleLines} lignes, hauteur ${Math.round(titleBox.height)}`);
            }
            if (getComputedStyle(badge).whiteSpace === "nowrap") problems.push(`badge nowrap : ${badge.textContent}`);
          } else if (title.textContent === "Contrôle 2" && titleLines > 2) {
            problems.push(`Contrôle 2 illisible sur grand écran (${titleLines} lignes)`);
          }
          return info;
        });
        const banners = [...document.querySelectorAll(".student-panel-heading, .student-subject-card-title")]
          .filter((element) => getComputedStyle(element).display !== "none" && element.textContent.includes("Cours du jour"));
        if (banners.length !== 1) problems.push(`${banners.length} bandeaux Cours du jour`);
        const labels = [...document.querySelectorAll(".mobile-tab-bar button")].map((button) => button.textContent.trim());
        const navVisible = getComputedStyle(document.querySelector(".mobile-tab-bar")).display !== "none";
        if (phone) {
          if (!navVisible) problems.push("barre absente");
          if (labels.join("|") !== "Tout|Devoirs|Contrôles|Cours précédents") problems.push(`barre ${labels.join("|")}`);
          if (getComputedStyle(document.querySelector(".student-view-tabs")).display !== "none") problems.push("onglets du haut visibles");
          const controlsTop = document.getElementById("controls").getBoundingClientRect().top;
          const coursesTop = document.getElementById("courses").getBoundingClientRect().top;
          if (controlsTop > coursesTop + 2) problems.push("contrôles après les cours");
          const mainPad = parseFloat(getComputedStyle(document.querySelector(".student-course-day-main")).paddingBottom);
          if (mainPad < 90) problems.push(`marge basse ${mainPad}`);
        } else if (navVisible) {
          problems.push("barre mobile visible sur grand écran");
        }
        const longTitle = rowMeasures.find((item) => item.branch === "CP 1 Électrotechnique");
        return { problems, longTitle, rowMeasures };
      }, { width });
      if (width === 390) {
        const electro = result.longTitle;
        assert.ok(electro, "mesure CP 1 Électrotechnique absente");
        assert.ok(electro.titleWidth >= electro.rowWidth - 2, `titre trop étroit ${electro.titleWidth}/${electro.rowWidth}`);
        assert.equal(electro.titleLines, 1, "Contrôle 2 ne tient pas sur une ligne");
      }
      assert.deepEqual(result.problems, [], `${width}px : ${result.problems.join(" | ")}`);
      measures.push({ width, titleWidth: result.longTitle?.titleWidth, rowWidth: result.longTitle?.rowWidth, lines: result.longTitle?.titleLines, rows: result.rowMeasures });
      if (shots && [320, 390, 430, 1440].includes(width)) {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width, height: Math.min(Math.max(height, 700), 1800) });
        const names = {
          320: "controles-320-electrotechnique.png",
          390: "controles-390-plusieurs.png",
          430: "controles-430-plusieurs.png",
          1440: "controles-1440-ordinateur.png",
        };
        await page.screenshot({ path: `${shots}/${names[width]}`, fullPage: false });
        if (width === 390) {
          await page.locator("#electro").screenshot({ path: `${shots}/controles-390-electrotechnique.png` });
          await page.locator("#chassis").screenshot({ path: `${shots}/controles-390-chassis.png` });
          await page.locator("#courses").screenshot({ path: `${shots}/controles-390-cours-du-jour.png` });
          const first = await page.locator("#bg-societe").boundingBox();
          const second = await page.locator("#bg-langue").boundingBox();
          await page.screenshot({
            path: `${shots}/controles-390-bg.png`,
            clip: {
              x: first.x,
              y: first.y,
              width: first.width,
              height: second.y + second.height - first.y,
            },
          });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.screenshot({ path: `${shots}/controles-390-navigation.png` });
        }
      }
    }
  } finally {
    await browser.close();
  }
  assert.ok(measures.every((item) => item.lines === 1));
  console.log(JSON.stringify(measures.map(({ width, titleWidth, rowWidth, lines }) => ({ width, titleWidth, rowWidth, lines }))));
});
