/**
 * Sépare clairement le contenu de démonstration du démarrage d'une base réelle.
 *
 * Production : jamais de seed démo, même si CAMPUS_DEMO_SEED est activé par erreur.
 * Hors production : seed possible, désactivable avec CAMPUS_DEMO_SEED=false.
 */

export const MISSING_PRODUCTION_ADMIN_PASSWORD =
  "Base Campus Agenda vierge : CAMPUS_ADMIN_PASSWORD est requis pour créer l'administrateur initial.";

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

export function isDemoSeedFlagEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.CAMPUS_DEMO_SEED?.trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

export function shouldSeedDemoData(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProductionEnv(env)) return false;
  const flag = env.CAMPUS_DEMO_SEED?.trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "no") return false;
  if (isDemoSeedFlagEnabled(env)) return true;
  return true;
}
