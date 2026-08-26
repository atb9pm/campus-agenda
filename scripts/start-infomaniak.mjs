/**
 * Démarrage production pour hébergement Node.js Infomaniak.
 *
 * IMPORTANT Infomaniak :
 * - le disque système est en lecture seule → PAS de `corepack enable`
 * - pas d'UI « variables d'environnement » pour Node.js
 *   → passer AUTH_SECRET dans la commande de lancement
 * - Infomaniak injecte PORT ; écouter sur 0.0.0.0
 *
 * Commandes Manager (dossier d'exécution = web) :
 *   Build     : npm install && npm run build
 *   Lancement : AUTH_SECRET=... CAMPUS_STORE=sqlite npm run start:infomaniak
 */
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "../web");
const outDir = path.join(webRoot, "dist");
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const sqlitePath = process.env.CAMPUS_SQLITE_PATH ?? path.join(webRoot, ".data/campus-agenda.sqlite");

process.env.NODE_ENV ??= "production";
process.env.APP_ENV ??= "production";
process.env.CAMPUS_STORE ??= "sqlite";
process.env.CAMPUS_SQLITE_PATH = sqlitePath;
process.env.CAMPUS_MIGRATIONS_PATH ??= path.resolve(webRoot, "../migrations");

async function requireBuild() {
  const candidates = [
    path.join(outDir, "server/index.js"),
    path.join(outDir, "server/entry.js"),
  ];
  for (const entry of candidates) {
    try {
      await access(entry);
      return;
    } catch {
      // essai suivant
    }
  }
  console.error("\n❌ Build manquant.");
  console.error("   Dans le Manager Infomaniak, commande de build :");
  console.error("   npm install && npm run build\n");
  process.exit(1);
}

async function requireAuthSecret() {
  if (process.env.AUTH_SECRET?.trim()) return;
  console.error("\n❌ AUTH_SECRET manquant.");
  console.error("   Infomaniak n'a pas d'UI variables pour Node.js.");
  console.error("   Mettez-le dans la commande de lancement, ex. :");
  console.error("   AUTH_SECRET=votre-secret-long CAMPUS_STORE=sqlite npm run start:infomaniak\n");
  process.exit(1);
}

await requireAuthSecret();
await mkdir(path.dirname(sqlitePath), { recursive: true });
await requireBuild();

const prodServerUrl = pathToFileURL(
  path.join(webRoot, "node_modules/vinext/dist/server/prod-server.js"),
).href;
const { startProdServer } = await import(prodServerUrl);

console.log("");
console.log("Campus Agenda — démarrage Infomaniak");
console.log(`  Port     : ${port}`);
console.log(`  Host     : ${host}`);
console.log(`  Store    : sqlite (${sqlitePath})`);
console.log("");

await startProdServer({ port, host, outDir });

console.log("✓ Serveur prêt");
console.log("  Santé API : /api/health");
console.log("");
