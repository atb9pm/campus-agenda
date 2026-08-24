/**
 * Prévisualisation locale = serveur de production vinext.
 *
 * Ne réimplémente pas HTTP : vinext start sert déjà /_next/static, le HTML
 * et les API. Ce script fixe l'environnement démo, l'adresse IPv4 127.0.0.1
 * (localhost IPv6 ::1 bloque souvent Edge/Chrome sous Windows), et gère
 * EADDRINUSE : vinext n'attache pas de handler 'error' sur listen(), donc
 * le port occupé crashait le process via uncaughtException.
 *
 * Usage (depuis web/) :
 *   $env:CAMPUS_STORE="memory"; $env:AUTH_SECRET="dev-secret"; pnpm.cmd run preview:node
 */
import { access } from "node:fs/promises";
import http from "node:http";
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

function isAddrInUse(error) {
  return Boolean(error && typeof error === "object" && error.code === "EADDRINUSE");
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

/**
 * vinext appelle server.listen() sans handler 'error'. Sans listener, Node
 * traite EADDRINUSE comme uncaughtException et tue le process. On patch
 * temporairement listen() pour rejeter proprement et réessayer un autre port.
 */
async function startProdServerSafe(startProdServer, options) {
  const originalListen = http.Server.prototype.listen;

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      http.Server.prototype.listen = originalListen;
      fn(value);
    };

    http.Server.prototype.listen = function campusListen(...args) {
      this.once("error", (error) => {
        finish(reject, error);
      });
      return originalListen.apply(this, args);
    };

    startProdServer(options).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

function printReady(origin, { reused = false, autoSelected = false } = {}) {
  console.log("");
  if (reused) {
    console.log(`✓ Campus Agenda tourne déjà sur ${origin}`);
  } else if (autoSelected) {
    console.log(`⚠ Port ${preferredPort} occupé — serveur démarré sur ${origin}`);
  } else {
    console.log(`Campus Agenda  →  ${origin}`);
  }
  console.log(`Santé API      →  ${origin}/api/health`);
  console.log("Connexion      →  teacher-chf (ChF) / campus-demo");
  console.log("");
  console.log("Ouvrez l'URL 127.0.0.1 (pas localhost) dans Edge ou Chrome.");
  if (reused) {
    console.log("Pour redémarrer : Ctrl+C dans l'autre fenêtre, ou :");
    console.log("  ..\\scripts\\stop-preview-port.ps1");
  } else {
    console.log("Gardez cette fenêtre PowerShell ouverte.");
  }
  console.log("");
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

const prodServerUrl = pathToFileURL(
  path.join(webRoot, "node_modules/vinext/dist/server/prod-server.js"),
).href;
const { startProdServer } = await import(prodServerUrl);

const candidates = Array.from({ length: MAX_PORT_ATTEMPTS }, (_, offset) => preferredPort + offset);
let started = false;

// D'abord : si une instance Campus Agenda tourne déjà (même sur un autre port), la réutiliser.
for (const port of candidates) {
  if (await isCampusAgendaRunning(port, host)) {
    printReady(`http://${host}:${port}`, { reused: true });
    process.exit(0);
  }
}

for (const [index, port] of candidates.entries()) {
  // Sonde rapide : évite un tour de démarrage vinext inutile si le port est pris
  // par autre chose que Campus Agenda. En cas de course, le catch EADDRINUSE rattrape.
  if (!(await isPortAvailable(port, host))) {
    continue;
  }

  process.env.PORT = String(port);
  try {
    const preview = await startProdServerSafe(startProdServer, { port, host, outDir });
    const actualPort = preview.port ?? port;
    printReady(`http://${host}:${actualPort}`, {
      autoSelected: index > 0 || actualPort !== preferredPort,
    });
    started = true;
    break;
  } catch (error) {
    if (isAddrInUse(error)) {
      console.warn(`Port ${port} pris pendant le démarrage — essai du suivant…`);
      continue;
    }
    throw error;
  }
}

if (!started) {
  console.error(`\n❌ Aucun port libre entre ${preferredPort} et ${preferredPort + MAX_PORT_ATTEMPTS - 1} sur ${host}.`);
  console.error("   Libérez le port :");
  console.error("     ..\\scripts\\stop-preview-port.ps1");
  console.error("   Ou choisissez un port :");
  console.error('     $env:PORT="5180"; pnpm.cmd run preview:node\n');
  process.exit(1);
}

