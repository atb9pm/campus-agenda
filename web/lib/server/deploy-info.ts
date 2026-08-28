export interface DeployInfo {
  version?: string;
  commit?: string;
  shortCommit?: string;
  branch?: string;
  committedAt?: string;
  builtAt?: string;
}

let cached: DeployInfo | null | undefined;

/**
 * Empreinte écrite par `scripts/infomaniak-build.sh` (web/build-info.json).
 * Permet de vérifier depuis `/api/health` quel commit est réellement servi.
 * Retourne `null` hors Node (Cloudflare) ou avant le premier build scripté.
 */
export async function readDeployInfo(): Promise<DeployInfo | null> {
  if (cached !== undefined) return cached;
  cached = null;

  try {
    const { readFile } = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const candidates = [
      process.env.CAMPUS_BUILD_INFO,
      nodePath.join(process.cwd(), "build-info.json"),
      nodePath.join(process.cwd(), "web/build-info.json"),
    ].filter((entry): entry is string => Boolean(entry));

    for (const candidate of candidates) {
      try {
        cached = JSON.parse(await readFile(candidate, "utf8")) as DeployInfo;
        break;
      } catch {
        // candidat suivant
      }
    }
  } catch {
    // Runtime sans accès disque : pas d'empreinte.
  }

  return cached;
}
