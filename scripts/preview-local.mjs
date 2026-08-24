/**
 * Serveur de prévisualisation local (Node pur) — fiable sous Windows.
 * Usage (depuis web/) :
 *   $env:CAMPUS_STORE="memory"; $env:AUTH_SECRET="dev-secret"; node ../scripts/preview-local.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "../web");
const clientRoot = path.join(webRoot, "dist/client");
const port = Number(process.env.PORT ?? 5173);

process.env.CAMPUS_STORE ??= "memory";
process.env.AUTH_SECRET ??= "dev-secret";

const workerUrl = pathToFileURL(path.join(webRoot, "dist/server/index.js")).href;
const workerModule = await import(`${workerUrl}?preview=${process.pid}`);
const worker = workerModule.default;

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
  return pathname.replace(/\.\./g, "").replace(/^\/+/, "");
}

async function readAsset(pathname) {
  const relativePath = assetPathname(pathname);
  const candidates = [
    path.join(clientRoot, relativePath),
    path.join(clientRoot, relativePath, "index.html"),
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

const server = createServer(async (req, res) => {
  try {
    if (await tryServeStatic(req, res)) return;

    const host = req.headers.host ?? `localhost:${port}`;
    const url = new URL(req.url ?? "/", `http://${host}`);
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

    if (response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
    } else {
      res.end();
    }
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(error instanceof Error ? error.message : "Erreur serveur");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Campus Agenda preview (Node) → http://localhost:${port}`);
  console.log(`Test API : http://localhost:${port}/api/health`);
  console.log("Connexion : teacher-demo-current / campus-demo");
});
