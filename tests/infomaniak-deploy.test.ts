import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";

test("version 2.43.1 — workflow Infomaniak : santé seulement, pas de SSH", async () => {
  assert.equal(APP_VERSION, "2.43.1");
  const workflow = await readFile(new URL("../.github/workflows/deploy-infomaniak.yml", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/infomaniak-deploy.md", import.meta.url), "utf8");

  assert.match(workflow, /campusagenda\.ch\/api\/health/);
  assert.match(workflow, /timeout-minutes:\s*8/);
  assert.match(workflow, /WAIT_FOR_COMMIT/);
  assert.doesNotMatch(workflow, /sshpass/);
  assert.doesNotMatch(workflow, /ssh-infomaniak/);
  assert.doesNotMatch(workflow, /INFOMANIAK_SSH_PASSWORD/);
  assert.doesNotMatch(workflow, /INFOMANIAK_SSH_HOST/);
  assert.doesNotMatch(workflow, /sshpass -e/);

  assert.match(guide, /Le déploiement ne passe plus par SSH/);
  assert.match(guide, /bouton « Build »/);
  assert.doesNotMatch(guide, /chaque merge d'une PR sur `main`\*\* déclenche/);
});
