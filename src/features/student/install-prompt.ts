/**
 * Invitation « Ajoute Campus Agenda à ton téléphone » — logique pure.
 * Préférence mémorisée dans le navigateur uniquement ; aucune donnée envoyée au serveur.
 */

/**
 * - `android` : navigateur Android capable d’installer (Chrome, Edge, Samsung…).
 * - `android-inapp` : navigateur intégré à une app (Instagram, WebView…) : ouvrir dans Chrome.
 * - `ios-safari` : Safari sur iPhone : ajout manuel via Partager.
 * - `ios-other` : autre navigateur ou navigateur intégré sur iPhone : ouvrir dans Safari.
 */
export type InstallPlatform = "android" | "android-inapp" | "ios-safari" | "ios-other";

export const INSTALL_PROMPT_STORAGE_KEY = "campus-agenda:install-prompt:v1";
export const INSTALL_PROMPT_LATER_DAYS = 30;

export type InstallPromptPreference =
  | { state: "later"; until: number }
  | { state: "never" }
  | { state: "installed" };

const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\//;
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|Snapchat|TikTok|musical_ly|Line\/|Twitter|LinkedInApp|Pinterest/;

/** Smartphones uniquement : ordinateurs et tablettes renvoient `null`. */
export function detectInstallPlatform(userAgent: string): InstallPlatform | null {
  const ua = userAgent || "";
  if (/iPhone|iPod/.test(ua)) {
    if (IOS_OTHER_BROWSER.test(ua) || IN_APP_BROWSER.test(ua) || !/Safari\//.test(ua)) return "ios-other";
    return "ios-safari";
  }
  if (/Android/.test(ua) && /Mobile/.test(ua)) {
    if (IN_APP_BROWSER.test(ua) || /; wv\)/.test(ua)) return "android-inapp";
    return "android";
  }
  return null;
}

/** Ouvert depuis l’écran d’accueil (mode application). */
export function isStandaloneDisplay(env: {
  displayModeStandalone?: boolean;
  navigatorStandalone?: boolean;
}): boolean {
  return env.displayModeStandalone === true || env.navigatorStandalone === true;
}

export function parseInstallPromptPreference(raw: string | null | undefined): InstallPromptPreference | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<{ state: string; until: number }>;
    if (parsed?.state === "never" || parsed?.state === "installed") return { state: parsed.state };
    if (parsed?.state === "later" && typeof parsed.until === "number" && Number.isFinite(parsed.until)) {
      return { state: "later", until: parsed.until };
    }
    return null;
  } catch {
    return null;
  }
}

export function readInstallPromptPreference(
  storage: Pick<Storage, "getItem"> | null | undefined,
): InstallPromptPreference | null {
  if (!storage) return null;
  try {
    return parseInstallPromptPreference(storage.getItem(INSTALL_PROMPT_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Stockage indisponible : sans erreur ; l’invitation reste masquée pour la visite en cours. */
export function writeInstallPromptPreference(
  storage: Pick<Storage, "setItem"> | null | undefined,
  preference: InstallPromptPreference,
): void {
  if (!storage) return;
  try {
    storage.setItem(INSTALL_PROMPT_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // stockage indisponible
  }
}

export function laterInstallPromptPreference(nowMs: number): InstallPromptPreference {
  return { state: "later", until: nowMs + INSTALL_PROMPT_LATER_DAYS * 86_400_000 };
}

export function shouldOfferInstallPrompt(input: {
  platform: InstallPlatform | null;
  standalone: boolean;
  preference: InstallPromptPreference | null;
  nowMs: number;
}): boolean {
  if (!input.platform || input.standalone) return false;
  const preference = input.preference;
  if (!preference) return true;
  if (preference.state === "later") return input.nowMs >= preference.until;
  return false;
}
