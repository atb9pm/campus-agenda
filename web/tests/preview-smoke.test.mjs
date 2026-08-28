import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

process.env.CAMPUS_STORE ??= "memory";
process.env.AUTH_SECRET ??= "dev-secret";
// L'aperçu utilise les comptes de démonstration : empreinte héritée autorisée.
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

async function startPreview() {
  const prodServerUrl = pathToFileURL(path.join(webRoot, "node_modules/vinext/dist/server/prod-server.js")).href;
  const { startProdServer } = await import(prodServerUrl);
  return startProdServer({
    port: 0,
    host: "127.0.0.1",
    outDir: path.join(webRoot, "dist"),
    silent: true,
  });
}

test("preview vinext sert HTML, JS et login enseignant", async (t) => {
  await access(path.join(webRoot, "dist/server/index.js"));
  const preview = await startPreview();
  t.after(() => preview.server.close());

  const origin = `http://127.0.0.1:${preview.port}`;

  const htmlResponse = await fetch(origin);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  // Porte d'entrée unique : l'onglet élève est rendu côté serveur.
  assert.match(html, /Mon agenda de classe/);
  assert.match(html, /Enseignant/);
  assert.doesNotMatch(html, /Chargement de la session/);

  const chunks = [...html.matchAll(/\/_next\/static\/[^"]+\.(?:js|css)/g)].map((match) => match[0]);
  assert.ok(chunks.length >= 3, "le HTML doit référencer les chunks client");
  for (const chunk of chunks) {
    const asset = await fetch(`${origin}${chunk}`);
    assert.equal(asset.status, 200, `${chunk} doit être servi`);
  }

  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  const healthPayload = await health.json();
  assert.equal(healthPayload.ok, true);

  const login = await fetch(`${origin}/api/auth/teacher`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacherId: "teacher-chf", password: " campus-demo " }),
  });
  assert.equal(login.status, 200);
  const loginPayload = await login.json();
  assert.equal(loginPayload.ok, true);
  assert.equal(loginPayload.session.teacherId, "teacher-chf");
});
