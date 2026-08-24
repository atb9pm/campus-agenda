/**
 * Serveur preview local (Node pur) — Windows.
 * Démarre immédiatement ; le worker vinext se charge seulement si nécessaire.
 *
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
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 5180);
const workerTimeoutMs = Number(process.env.PREVIEW_TIMEOUT_MS ?? 25000);

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
  return pathname.replace(/\\/g, "/").replace(/\.\./g, "").replace(/^\/+/, "");
}

function baseUrl() {
  return `http://${host}:${port}`;
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
      return { data, type: contentType(candidate) };
    } catch {
      // try next
    }
  }
  return null;
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
}

function sendText(res, status, body, type = "text/plain; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  noStore(res);
  res.end(body);
}

function sendJson(res, status, payload) {
  sendText(res, status, JSON.stringify(payload, null, 2), "application/json; charset=utf-8");
}

async function verifyBuild() {
  const problems = [];
  if (!(await fileExists(serverEntry))) {
    problems.push("dist/server/index.js manquant — lancez « pnpm run build » dans web/.");
  }
  if (!(await fileExists(clientRoot))) {
    problems.push("dist/client/ manquant — lancez « pnpm run build » dans web/.");
  }
  const chunksDir = path.join(clientRoot, "_next/static/chunks");
  if (await fileExists(chunksDir)) {
    const chunks = await readdir(chunksDir);
    for (const chunkName of chunks.filter((name) => name.startsWith("page-") && name.endsWith(".js"))) {
      const source = await readFile(path.join(chunksDir, chunkName), "utf8");
      if (source.includes("Chargement de la session")) {
        problems.push(`Build obsolète (${chunkName}). Refaites « pnpm run build » après git pull.`);
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

/** Worker vinext — chargé à la demande pour ne pas bloquer le démarrage. */
let workerPromise = null;
let workerLoadError = null;

function getWorker() {
  if (workerLoadError) return Promise.reject(workerLoadError);
  if (!workerPromise) {
    workerPromise = (async () => {
      console.log("Chargement du worker vinext (première requête API/app)…");
      const workerUrl = pathToFileURL(serverEntry).href;
      const workerModule = await import(`${workerUrl}?preview=${process.pid}`);
      console.log("Worker vinext prêt.");
      return workerModule.default;
    })().catch((error) => {
      workerLoadError = error;
      throw error;
    });
  }
  return workerPromise;
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

const FALLBACK_LOGIN_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Campus Agenda</title></head>
<body style="font-family:sans-serif;max-width:420px;margin:40px auto;padding:20px">
<h1>Connexion preview</h1>
<p>Serveur OK. Fichier preview-login.html introuvable — faites <code>git pull</code>.</p>
</body></html>`;

let previewLoginHtmlPromise = null;

async function getPreviewLoginHtml() {
  if (!previewLoginHtmlPromise) {
    previewLoginHtmlPromise = readFile(previewLoginPath, "utf8").catch(() => FALLBACK_LOGIN_HTML);
  }
  return previewLoginHtmlPromise;
}

async function tryServeStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", baseUrl());
  const asset = await readAsset(url.pathname);
  if (!asset) return false;
  res.statusCode = 200;
  res.setHeader("Content-Type", asset.type);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(req.method === "HEAD" ? undefined : asset.data);
  return true;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyToWorker(req, res, url) {
  const worker = await getWorker();
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readRequestBody(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const response = await Promise.race([
    worker.fetch(
      new Request(url, { method: req.method, headers, body: body?.length ? body : undefined }),
      env,
      env,
    ),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout worker (${workerTimeoutMs} ms)`)), workerTimeoutMs);
    }),
  ]);

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") res.appendHeader(key, value);
    else res.setHeader(key, value);
  });

  const responseType = response.headers.get("content-type") ?? "";
  if (responseType.includes("text/html")) noStore(res);

  if (response.body) res.end(Buffer.from(await response.arrayBuffer()));
  else res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", baseUrl());

  try {
    // Routes instantanées — jamais de worker
    if (url.pathname === "/ping") {
      sendText(res, 200, `pong ${previewVersion}\n`);
      return;
    }

    if (url.pathname === "/api/preview-info") {
      sendJson(res, 200, {
        ok: true,
        preview: "node",
        version: previewVersion,
        host,
        port,
        loginPage: `${baseUrl()}/preview-login.html`,
        ping: `${baseUrl()}/ping`,
      });
      return;
    }

    if (url.pathname === "/preview-login.html") {
      const html = await getPreviewLoginHtml();
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      noStore(res);
      res.end(html);
      return;
    }

    if (await tryServeStatic(req, res)) return;

    await proxyToWorker(req, res, url);
  } catch (error) {
    sendText(
      res,
      500,
      error instanceof Error ? error.message : "Erreur serveur",
    );
  }
});

server.on("error", (error) => {
  if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
    console.error(`\n❌ Port ${port} déjà utilisé sur ${host}.`);
    console.error(`   Fermez l'autre serveur (Ctrl+C) ou lancez : $env:PORT="${port + 1}"; pnpm.cmd run preview:node\n`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, host, () => {
  const loginUrl = `${baseUrl()}/preview-login.html`;
  const pingUrl = `${baseUrl()}/ping`;
  console.log(`\nCampus Agenda preview (Node v${previewVersion})`);
  console.log(`Test rapide   : ${pingUrl}`);
  console.log(`Connexion     : ${loginUrl}`);
  console.log(`API santé     : ${baseUrl()}/api/health`);
  console.log(`Compte démo   : teacher-demo-current / campus-demo`);
  console.log("\n1. Gardez cette fenêtre PowerShell OUVERTE.");
  console.log("2. Testez d'abord /ping dans Edge — vous devez voir « pong ».");
  console.log("3. Puis ouvrez /preview-login.html dans Edge (pas Cursor).\n");
});
