/**
 * Démarrage production pour hébergement Node.js Infomaniak.
 *
 * Infomaniak injecte PORT ; l'app doit écouter sur 0.0.0.0.
 * Persistance SQLite (D1 Cloudflare indisponible hors Workers).
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
  try {
    await access(path.join(outDir, "server/index.js"));
  } catch {
    console.error("\n❌ Build manquant. Commande build Infomaniak : corepack enable && pnpm install && pnpm run build\n");
    process.exit(1);
  }
}

async function requireAuthSecret() {
  if (process.env.AUTH_SECRET?.trim()) return;
  console.error("\n❌ AUTH_SECRET requis dans le Manager Infomaniak (Variables d'environnement).\n");
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
console.log(`Campus Agenda — démarrage Infomaniak`);
console.log(`  Port     : ${port}`);
console.log(`  Store    : sqlite (${sqlitePath})`);
console.log("");

await startProdServer({ port, host, outDir });

console.log(`✓ Serveur prêt — https://votre-domaine (via proxy Infomaniak)`);
console.log(`  Santé API : /api/health`);
console.log("");
