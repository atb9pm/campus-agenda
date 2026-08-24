/**
 * Prévisualisation locale = serveur de production vinext.
 *
 * Ne réimplémente pas HTTP : vinext start sert déjà /_next/static, le HTML
 * et les API. Ce script fixe uniquement l'environnement démo et l'adresse
 * IPv4 127.0.0.1 (localhost IPv6 ::1 bloque souvent Edge/Chrome sous Windows
 * si le serveur n'écoute que 0.0.0.0).
 *
 * Usage (depuis web/) :
 *   $env:CAMPUS_STORE="memory"; $env:AUTH_SECRET="dev-secret"; pnpm.cmd run preview:node
 */
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "../web");
const outDir = path.join(webRoot, "dist");
const preferredPort = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";
const MAX_PORT_ATTEMPTS = 10;

process.env.CAMPUS_STORE ??= "memory";
process.env.AUTH_SECRET ??= "dev-secret";
// Évite le blocage 429 après plusieurs essais ratés en prévisualisation locale.
process.env.CAMPUS_DISABLE_RATE_LIMIT ??= "1";

function isPortAvailable(port, listenHost) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen({ port, host: listenHost, exclusive: true });
  });
}

async function isCampusAgendaRunning(port, listenHost) {
  try {
    const response = await fetch(`http://${listenHost}:${port}/api/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.ok === true;
  } catch {
    return false;
  }
}

async function resolvePreviewPort() {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const candidate = preferredPort + offset;
    if (await isCampusAgendaRunning(candidate, host)) {
      return { port: candidate, alreadyRunning: true, autoSelected: offset > 0 };
    }
    if (await isPortAvailable(candidate, host)) {
      return { port: candidate, alreadyRunning: false, autoSelected: offset > 0 };
    }
  }
  console.error(`\n❌ Aucun port libre entre ${preferredPort} et ${preferredPort + MAX_PORT_ATTEMPTS - 1} sur ${host}.`);
  console.error("   Fermez l'autre serveur (Ctrl+C) ou choisissez un port : $env:PORT=\"5180\"; pnpm.cmd run preview:node\n");
  process.exit(1);
}

async function requireBuild() {
  const entry = path.join(outDir, "server/index.js");
  try {
    await access(entry);
  } catch {
    console.error("\n❌ Build manquant. Dans web/ : pnpm.cmd run build\n");
    process.exit(1);
  }
}

await requireBuild();

const { port, autoSelected, alreadyRunning } = await resolvePreviewPort();
process.env.PORT = String(port);

if (alreadyRunning) {
  const origin = `http://${host}:${port}`;
  console.log("");
  console.log(`✓ Campus Agenda tourne déjà sur ${origin}`);
  console.log(`  Santé API → ${origin}/api/health`);
  console.log("  Connexion → teacher-chf (ChF) / campus-demo");
  console.log("");
  console.log("Ouvrez cette URL dans Edge ou Chrome (pas localhost).");
  console.log("Pour redémarrer : fermez l'autre fenêtre PowerShell (Ctrl+C), puis relancez preview:node.");
  console.log("");
  process.exit(0);
}

const prodServerUrl = pathToFileURL(
  path.join(webRoot, "node_modules/vinext/dist/server/prod-server.js"),
).href;
const { startProdServer } = await import(prodServerUrl);

await startProdServer({ port, host, outDir });

const origin = `http://${host}:${port}`;
console.log("");
if (autoSelected) {
  console.log(`⚠ Port ${preferredPort} déjà utilisé — serveur démarré sur le port ${port}.`);
}
console.log(`Campus Agenda  →  ${origin}`);
console.log(`Santé API      →  ${origin}/api/health`);
console.log("Connexion      →  teacher-chf (ChF) / campus-demo");
console.log("");
console.log("Ouvrez l'URL 127.0.0.1 (pas localhost) dans Edge ou Chrome.");
console.log("Gardez cette fenêtre PowerShell ouverte.");
console.log("");
