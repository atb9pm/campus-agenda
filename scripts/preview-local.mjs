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
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "../web");
const outDir = path.join(webRoot, "dist");
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";

process.env.CAMPUS_STORE ??= "memory";
process.env.AUTH_SECRET ??= "dev-secret";

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

try {
  await startProdServer({ port, host, outDir });
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
    console.error(`\n❌ Port ${port} déjà utilisé sur ${host}.`);
    console.error(`   Ctrl+C dans l'autre terminal, ou : $env:PORT="${port + 1}"; pnpm.cmd run preview:node\n`);
    process.exit(1);
  }
  throw error;
}

const origin = `http://${host}:${port}`;
console.log("");
console.log(`Campus Agenda  →  ${origin}`);
console.log(`Santé API      →  ${origin}/api/health`);
console.log("Connexion      →  teacher-demo-current / campus-demo");
console.log("");
console.log("Ouvrez l'URL 127.0.0.1 (pas localhost) dans Edge ou Chrome.");
console.log("Gardez cette fenêtre PowerShell ouverte.");
console.log("");
