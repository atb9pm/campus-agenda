import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";

test("version 2.43.1 — workflow Infomaniak : santé seulement, pas de SSH", async () => {
  assert.equal(APP_VERSION, "2.46.0");
  const workflow = await readFile(new URL("../.github/workflows/deploy-infomaniak.yml", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/infomaniak-deploy.md", import.meta.url), "utf8");

  assert.match(workflow, /^name: Infomaniak — vérifier production$/m);
  assert.match(workflow, /name: Vérifier campusagenda\.ch/);
  assert.match(workflow, /campusagenda\.ch\/api\/health/);
  assert.match(workflow, /timeout-minutes:\s*8/);
  assert.match(workflow, /WAIT_FOR_COMMIT/);
  assert.match(workflow, /::warning::/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /⚠️ Production pas encore à jour/);
  assert.match(workflow, /✅ Production à jour/);
  assert.match(workflow, /full\.startswith\(got\) or got\[:7\] == full\[:7\]/);
  assert.doesNotMatch(workflow, /::notice::/);
  assert.doesNotMatch(workflow, /^name: Deploy Infomaniak$/m);
  assert.doesNotMatch(workflow, /sshpass/);
  assert.doesNotMatch(workflow, /ssh-infomaniak/);
  assert.doesNotMatch(workflow, /INFOMANIAK_SSH_PASSWORD/);
  assert.doesNotMatch(workflow, /INFOMANIAK_SSH_HOST/);
  assert.doesNotMatch(workflow, /sshpass -e/);
  assert.doesNotMatch(workflow, /\[ "\$commit" = "\$expected" \]/);

  assert.match(guide, /Le déploiement ne passe plus par SSH/);
  assert.match(guide, /bouton « Build »/);
  assert.match(guide, /Infomaniak — vérifier production/);
  assert.doesNotMatch(guide, /Actions → Deploy Infomaniak/);
  assert.doesNotMatch(guide, /chaque merge d'une PR sur `main`\*\* déclenche/);
});
