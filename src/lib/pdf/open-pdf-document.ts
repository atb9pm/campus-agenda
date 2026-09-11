import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

function resolvePdfWorkerPath(): string | null {
  const candidates: string[] = [];
  try {
    candidates.push(createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"));
  } catch {
    // résolution via import.meta.url impossible dans certains bundles
  }
  candidates.push(
    path.resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
    path.resolve(process.cwd(), "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
  );
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function ensurePdfWorkerSrc(): void {
  const workerPath = resolvePdfWorkerPath();
  if (workerPath) {
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  }
}

export async function openPdfDocument(pdfBytes: Uint8Array) {
  ensurePdfWorkerSrc();
  return getDocument({ data: pdfBytes.slice(), useSystemFonts: true }).promise;
}
