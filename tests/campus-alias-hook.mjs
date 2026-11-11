import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

const PREFIXES = [
  ["@campus/features/", path.join(root, "src/features")],
  ["@campus/lib/", path.join(root, "src/lib")],
  ["@campus/types/", path.join(root, "src/types")],
];

function mapped(specifier) {
  for (const [prefix, directory] of PREFIXES) {
    if (specifier.startsWith(prefix)) {
      return pathToFileURL(path.join(directory, specifier.slice(prefix.length))).href;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const target = mapped(specifier);
  if (!target) return nextResolve(specifier, context);
  return nextResolve(target, context);
}
