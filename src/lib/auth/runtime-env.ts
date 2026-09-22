/**
 * Lecture runtime de NODE_ENV.
 * Ne pas écrire `process.env.NODE_ENV === "production"` en tête d’une fonction :
 * le bundler de production le replie en `true` et casse les tests E2E / l’aperçu.
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}
