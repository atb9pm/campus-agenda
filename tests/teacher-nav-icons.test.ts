import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("menu enseignant — pastille bleue et icônes SVG", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const icon = await readFile(new URL("../web/app/components/teacher-nav-icon.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  const sidebar = page.slice(page.indexOf('aria-label="Navigation principale"'), page.indexOf("technical-note"));
  assert.match(sidebar, /teacher-nav-mark/);
  assert.match(sidebar, /TeacherNavIcon/);
  assert.match(sidebar, /TEACHER_NAV_LABELS\[section\]/);
  assert.doesNotMatch(sidebar, /TEACHER_NAV_ICONS/);
  for (const name of ["ma-semaine", "mes-cours", "controles", "configuration"]) {
    assert.match(icon, new RegExp(`name === "${name}"`));
  }
  assert.match(icon, /strokeWidth: 1\.75/);
  assert.match(css, /\.technical-sidebar nav button\.active \.teacher-nav-mark \{ background: var\(--blue\); color: #fff; \}/);
  assert.match(css, /\.technical-sidebar nav button\.active \{ color: var\(--navy\); background: var\(--blue-soft\); \}/);
  assert.match(page, /navigate\(section\)/);
});
