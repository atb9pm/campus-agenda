import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

test("version 2.61.6 — logo Campus Agenda image, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.61.6");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0030_agenda_student_visible.sql");
  const [page, login, css] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/login-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);
  await access(new URL("../web/public/campus-agenda-logo.png", import.meta.url));
  assert.match(page, /BrandLogo/);
  assert.match(login, /BrandLogo/);
  assert.match(css, /\.brand-logo/);
  assert.doesNotMatch(page, /brand-emblem-image/);
  assert.doesNotMatch(login, />CA</);
  assert.doesNotMatch(css, /\.brand-emblem-image/);
});
