import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decodeRichDetail,
  encodeRichDetail,
  parseInlinesFromHtml,
} from "../src/features/class-notebook/index.ts";

const CHROME_HIGHLIGHT_HTML = '<span style="background-color: rgb(254, 240, 138);">question 30</span>';
const CHROME_COLOR_HTML = '<span style="color: rgb(29, 78, 216);">4.7.06-5</span>';

function findChrome(): string | null {
  for (const candidate of [
    process.env.CHROME_PATH,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/** dump-dom est fiable ici, pas sur les runners GHA sans affichage. Forcer avec CAMPUS_BROWSER_E2E=1. */
function shouldRunLiveChrome(): boolean {
  if (!findChrome()) return false;
  if (process.env.CAMPUS_BROWSER_E2E === "1") return true;
  if (process.env.CAMPUS_BROWSER_E2E === "0") return false;
  return process.env.GITHUB_ACTIONS !== "true";
}

function persistMarks(highlightHtml: string, colorHtml: string) {
  const highlight = parseInlinesFromHtml(highlightHtml);
  const color = parseInlinesFromHtml(colorHtml);
  assert.equal(highlight[0]?.marks?.highlight, true, `surlignage perdu dans ${highlightHtml}`);
  assert.equal(color[0]?.marks?.color, "blue", `couleur perdue dans ${colorHtml}`);
  const stored = encodeRichDetail({
    format: "campus-rich-v1",
    blocks: [{ type: "paragraph", inlines: [...highlight, { text: " " }, ...color] }],
  });
  const reloaded = decodeRichDetail(stored);
  const paragraph = reloaded?.blocks[0];
  assert.ok(paragraph && paragraph.type === "paragraph");
  if (paragraph && paragraph.type === "paragraph") {
    assert.equal(paragraph.inlines[0]?.marks?.highlight, true);
    assert.equal(paragraph.inlines[2]?.marks?.color, "blue");
  }
}

test("navigateur — HTML Chrome documenté : sélection, surlignage, couleur, save + reload", () => {
  persistMarks(CHROME_HIGHLIGHT_HTML, CHROME_COLOR_HTML);
});

test("navigateur — Chrome réel execCommand hiliteColor / foreColor", { skip: !findChrome() }, () => {
  const chrome = findChrome();
  assert.ok(chrome);
  const fixture = fileURLToPath(new URL("./fixtures/rich-editor-execcommand.html", import.meta.url));
  const result = spawnSync(
    "timeout",
    [
      "10",
      chrome,
      "--headless=old",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--user-data-dir=/tmp/campus-rich-editor-${process.pid}`,
      "--dump-dom",
      `file://${fixture}`,
    ],
    { encoding: "utf8", timeout: 12_000 },
  );
  const dump = `${result.stdout}\n${result.stderr}`;
  const highlight = dump.match(/id="highlight"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  const color = dump.match(/id="color"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(highlight, `DOM highlight introuvable: ${dump.slice(0, 400)}`);
  assert.ok(color, `DOM couleur introuvable: ${dump.slice(0, 400)}`);
  assert.match(highlight, /background-color/i);
  assert.doesNotMatch(highlight, /<mark/i);
  assert.match(color, /color:\s*rgb\(29,\s*78,\s*216\)/i);
  persistMarks(highlight, color);
});
