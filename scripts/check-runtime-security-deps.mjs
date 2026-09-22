/**
 * Vérifie que react-server-dom-webpack n’est pas une version RSC vulnérable
 * (GHSA-wx67-qw84-cm4g / CVE-2026-44907 : 19.2.0–19.2.7), même classé en
 * devDependency. À lancer depuis `web/` :
 *   node ../scripts/check-runtime-security-deps.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = existsSync(join(process.cwd(), "package.json")) && existsSync(join(process.cwd(), "package-lock.json"))
  ? process.cwd()
  : join(scriptDir, "..", "web");

function parseSemver(raw) {
  const match = String(raw ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), raw: String(raw) };
}

/** Versions react-server-dom-* 19.2.0 → 19.2.7 (CVE-2026-44907). */
export function isVulnerableReactServerDom(version) {
  const parsed = parseSemver(version);
  if (!parsed) return true;
  return parsed.major === 19 && parsed.minor === 2 && parsed.patch >= 0 && parsed.patch <= 7;
}

function fail(message) {
  console.error(`[check-runtime-security-deps] ${message}`);
  process.exit(1);
}

function readInstalledVersion(packageName) {
  const pkgPath = join(webRoot, "node_modules", packageName, "package.json");
  if (!existsSync(pkgPath)) fail(`${packageName} : package installé introuvable (${pkgPath}).`);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return String(pkg.version ?? "");
}

function readLockfileVersion(packageName) {
  const lockPath = join(webRoot, "package-lock.json");
  if (!existsSync(lockPath)) fail(`package-lock.json introuvable (${lockPath}).`);
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const entry = lock.packages?.[`node_modules/${packageName}`];
  if (!entry?.version) fail(`${packageName} : version absente du package-lock.json.`);
  return String(entry.version);
}

function readDeclaredVersion(packageName) {
  const pkg = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8"));
  return String(pkg.dependencies?.[packageName] ?? pkg.devDependencies?.[packageName] ?? "");
}

function main() {
  const name = "react-server-dom-webpack";
  const installed = readInstalledVersion(name);
  const locked = readLockfileVersion(name);
  const declared = readDeclaredVersion(name);

  for (const [label, version] of [
    ["installé", installed],
    ["package-lock", locked],
    ["package.json", declared],
  ]) {
    if (isVulnerableReactServerDom(version)) {
      fail(
        `${name} ${label} = ${version} : versions 19.2.0–19.2.7 vulnérables (CVE-2026-44907 / GHSA-wx67-qw84-cm4g). Exiger 19.2.8+.`,
      );
    }
  }

  const react = readInstalledVersion("react");
  const reactDom = readInstalledVersion("react-dom");
  if (react !== installed || reactDom !== installed) {
    fail(`React désaligné : react=${react} react-dom=${reactDom} ${name}=${installed}.`);
  }

  console.log(`${name} ${installed} (lock ${locked}) — hors plage 19.2.0–19.2.7 ; react=${react} react-dom=${reactDom}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
