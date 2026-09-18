import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

test("version 2.61.6 — logo Campus Agenda dans sidebar, login, MFA et vue élève", async () => {
  assert.equal(APP_VERSION, "2.61.6");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0030_agenda_student_visible.sql");

  const [
    brandLogo,
    loginPanel,
    mfaSetup,
    mfaChallenge,
    passwordChange,
    page,
    css,
  ] = await Promise.all([
    readFile(new URL("../web/app/components/brand-logo.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/login-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/mfa-setup-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/mfa-challenge-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/password-change-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(brandLogo, /campus-agenda-logo\.jpg/);
  assert.match(brandLogo, /alt="Campus Agenda"/);

  for (const source of [loginPanel, mfaSetup, mfaChallenge, passwordChange, page]) {
    assert.match(source, /BrandLogo/);
    assert.doesNotMatch(source, /brand-emblem-image/);
    assert.doesNotMatch(source, />CA</);
    assert.doesNotMatch(source, /<strong>CAMPUS<\/strong>/);
  }

  assert.match(css, /\.brand-logo/);
  assert.doesNotMatch(css, /brand-emblem-image/);
  assert.match(css, /campus-agenda-access-bg\.jpg/);
  assert.match(css, /background-size: cover/);
  assert.match(css, /backdrop-filter: blur\(6px\)/);
  assert.match(css, /teacher-login-brand \.brand-logo \{ width: min\(200px, 72vw\)/);

  for (const source of [loginPanel, mfaSetup, mfaChallenge, passwordChange]) {
    assert.match(source, /teacher-login-shell/);
  }

  await access(new URL("../web/public/campus-agenda-logo.jpg", import.meta.url));
  await access(new URL("../web/public/campus-agenda-access-bg.jpg", import.meta.url));
});
