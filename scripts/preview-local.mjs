/**
 * Serveur de prévisualisation local (Node pur) — fiable sous Windows.
 * Usage (depuis web/) :
 *   $env:CAMPUS_STORE="memory"; $env:AUTH_SECRET="dev-secret"; node ../scripts/preview-local.mjs
 */
import { createServer } from "node:http";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "../web");
const clientRoot = path.join(webRoot, "dist/client");
const serverEntry = path.join(webRoot, "dist/server/index.js");
const previewLoginPath = path.join(scriptDir, "preview-login.html");
const port = Number(process.env.PORT ?? 5173);

process.env.CAMPUS_STORE ??= "memory";
process.env.AUTH_SECRET ??= "dev-secret";

const packageJson = JSON.parse(await readFile(path.join(webRoot, "package.json"), "utf8"));
const previewVersion = packageJson.version ?? "unknown";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function assetPathname(pathname) {
  return pathname
    .replace(/\\/g, "/")
    .replace(/\.\./g, "")
    .replace(/^\/+/, "");
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readAsset(pathname) {
  const relativePath = assetPathname(pathname);
  const candidates = [
    path.join(clientRoot, ...relativePath.split("/")),
    path.join(clientRoot, ...relativePath.split("/"), "index.html"),
  ];
  for (const candidate of candidates) {
    try {
      const data = await readFile(candidate);
      return { data, type: contentType(candidate), path: candidate };
    } catch {
      // try next
    }
  }
  return null;
}

async function verifyBuild() {
  const problems = [];

  if (!(await fileExists(serverEntry))) {
    problems.push("dist/server/index.js manquant — lancez « pnpm run build » dans web/.");
  }
  if (!(await fileExists(clientRoot))) {
    problems.push("dist/client/ manquant — lancez « pnpm run build » dans web/.");
  }

  const manifestPath = path.join(clientRoot, "vinext-client-entry-manifest.json");
  if (await fileExists(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const entryPath = path.join(clientRoot, manifest.appBrowserEntry ?? "");
    if (!(await fileExists(entryPath))) {
      problems.push(`Entrée client introuvable : ${manifest.appBrowserEntry}`);
    }
  }

  const chunksDir = path.join(clientRoot, "_next/static/chunks");
  if (await fileExists(chunksDir)) {
    const chunks = await readdir(chunksDir);
    const pageChunks = chunks.filter((name) => name.startsWith("page-") && name.endsWith(".js"));
    for (const chunkName of pageChunks) {
      const source = await readFile(path.join(chunksDir, chunkName), "utf8");
      if (source.includes("Chargement de la session")) {
        problems.push(
          `Build obsolète (${chunkName} contient encore l'écran de chargement). Refaites « pnpm run build » après git pull.`,
        );
      }
    }
  }

  return problems;
}

const buildProblems = await verifyBuild();
if (buildProblems.length) {
  console.error("\n❌ Prévisualisation impossible :\n");
  for (const problem of buildProblems) console.error(`   • ${problem}`);
  console.error("\n");
  process.exit(1);
}

const workerUrl = pathToFileURL(serverEntry).href;
const workerModule = await import(`${workerUrl}?preview=${process.pid}`);
const worker = workerModule.default;

async function tryServeStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const host = req.headers.host ?? `localhost:${port}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const asset = await readAsset(url.pathname);
  if (!asset) return false;

  res.statusCode = 200;
  res.setHeader("Content-Type", asset.type);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  if (req.method === "HEAD") {
    res.end();
  } else {
    res.end(asset.data);
  }
  return true;
}

function sendPreviewInfo(res) {
  const payload = {
    ok: true,
    preview: "node",
    version: previewVersion,
    staticAssets: "direct",
    loginScreen: "immediate",
    loginPage: `http://localhost:${port}/preview-login.html`,
    hint: "Utilisez Chrome ou Edge. Ouvrez /preview-login.html si l'écran reste bloqué.",
  };
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.end(JSON.stringify(payload, null, 2));
}

async function sendPreviewLogin(res) {
  const html = await readFile(previewLoginPath, "utf8");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.end(html);
}

const env = {
  ASSETS: {
    fetch(request) {
      const url = new URL(request.url);
      return readAsset(url.pathname).then((asset) =>
        asset
          ? new Response(asset.data, { headers: { "Content-Type": asset.type } })
          : new Response("Not found", { status: 404 }),
      );
    },
  },
  waitUntil() {},
  passThroughOnException() {},
};

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function shouldDisableCache(contentType) {
  return typeof contentType === "string" && contentType.includes("text/html");
}

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `localhost:${port}`;
    const url = new URL(req.url ?? "/", `http://${host}`);

    if (url.pathname === "/api/preview-info") {
      sendPreviewInfo(res);
      return;
    }

    if (url.pathname === "/preview-login.html") {
      await sendPreviewLogin(res);
      return;
    }

    if (await tryServeStatic(req, res)) return;

    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readRequestBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }

    const response = await worker.fetch(
      new Request(url, { method: req.method, headers, body: body?.length ? body : undefined }),
      env,
      env,
    );

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        res.appendHeader(key, value);
      } else {
        res.setHeader(key, value);
      }
    });

    const responseType = response.headers.get("content-type") ?? "";
    if (shouldDisableCache(responseType)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
    }

    if (response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
    } else {
      res.end();
    }
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(error instanceof Error ? error.message : "Erreur serveur");
  }
});

server.listen(port, "0.0.0.0", () => {
  const loginUrl = `http://localhost:${port}/preview-login.html`;
  console.log(`Campus Agenda preview (Node v${previewVersion}) → http://localhost:${port}`);
  console.log(`Connexion (Chrome/Edge) : ${loginUrl}`);
  console.log(`Test API              : http://localhost:${port}/api/health`);
  console.log(`Info preview          : http://localhost:${port}/api/preview-info`);
  console.log("Compte démo           : teacher-demo-current / campus-demo");
  console.log("");
  console.log("⚠ N'utilisez PAS l'aperçu navigateur intégré de Cursor (cache bloquant).");
  console.log("  Ouvrez l'URL ci-dessus dans Chrome ou Edge.");
  console.log("  Si besoin : $env:PORT=5180; pnpm.cmd run preview:node");
});
