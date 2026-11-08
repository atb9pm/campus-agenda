import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  INSTALL_PROMPT_LATER_DAYS,
  INSTALL_PROMPT_STORAGE_KEY,
  detectInstallPlatform,
  isStandaloneDisplay,
  laterInstallPromptPreference,
  parseInstallPromptPreference,
  readInstallPromptPreference,
  shouldOfferInstallPrompt,
  writeInstallPromptPreference,
} from "../src/features/student/index.ts";
import { buildSecurityCsp } from "../src/lib/security/http-headers.ts";
import manifest from "../web/app/manifest.ts";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  ipad:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  desktopMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const NOW = Date.UTC(2026, 10, 6, 9, 0);

test("plateformes : iPhone et Android uniquement, navigateurs intégrés reconnus", () => {
  assert.equal(detectInstallPlatform(UA.iphoneSafari), "ios-safari");
  assert.equal(detectInstallPlatform(UA.iphoneChrome), "ios-other");
  assert.equal(detectInstallPlatform(UA.iphoneInstagram), "ios-other");
  assert.equal(detectInstallPlatform(UA.androidChrome), "android");
  assert.equal(detectInstallPlatform(UA.androidSamsung), "android");
  assert.equal(detectInstallPlatform(UA.androidWebView), "android-inapp");
});

test("aucune invitation sur ordinateur ni tablette", () => {
  for (const ua of [UA.desktopChrome, UA.desktopMac, UA.ipad, UA.androidTablet, ""]) {
    assert.equal(detectInstallPlatform(ua), null, ua);
    assert.equal(
      shouldOfferInstallPrompt({ platform: detectInstallPlatform(ua), standalone: false, preference: null, nowMs: NOW }),
      false,
    );
  }
});

test("première visite sur smartphone : invitation proposée", () => {
  for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.androidChrome, UA.androidWebView]) {
    assert.equal(
      shouldOfferInstallPrompt({ platform: detectInstallPlatform(ua), standalone: false, preference: null, nowMs: NOW }),
      true,
      ua,
    );
  }
});

test("mode application installée : aucune invitation", () => {
  assert.equal(isStandaloneDisplay({ displayModeStandalone: true }), true);
  assert.equal(isStandaloneDisplay({ navigatorStandalone: true }), true);
  assert.equal(isStandaloneDisplay({}), false);
  assert.equal(
    shouldOfferInstallPrompt({ platform: "ios-safari", standalone: true, preference: null, nowMs: NOW }),
    false,
  );
});

test("« Plus tard » : masquée 30 jours, puis reproposée", () => {
  const later = laterInstallPromptPreference(NOW);
  assert.equal(INSTALL_PROMPT_LATER_DAYS, 30);
  const day = 86_400_000;
  assert.equal(shouldOfferInstallPrompt({ platform: "android", standalone: false, preference: later, nowMs: NOW + 29 * day }), false);
  assert.equal(shouldOfferInstallPrompt({ platform: "android", standalone: false, preference: later, nowMs: NOW + 30 * day }), true);
});

test("« Ne plus afficher » et installation confirmée : préférence définitive", () => {
  for (const preference of [{ state: "never" as const }, { state: "installed" as const }]) {
    assert.equal(
      shouldOfferInstallPrompt({ platform: "ios-safari", standalone: false, preference, nowMs: NOW + 365 * 86_400_000 }),
      false,
    );
  }
});

test("stockage local : lecture, écriture, données corrompues et stockage indisponible", () => {
  const storage = new MemoryStorage();
  writeInstallPromptPreference(storage, { state: "never" });
  assert.deepEqual(readInstallPromptPreference(storage), { state: "never" });
  assert.equal(storage.getItem(INSTALL_PROMPT_STORAGE_KEY), '{"state":"never"}');
  assert.equal(parseInstallPromptPreference("{oups"), null);
  assert.equal(parseInstallPromptPreference('{"state":"later"}'), null);
  assert.equal(parseInstallPromptPreference('{"state":"autre"}'), null);

  const broken = {
    getItem(): string | null {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(readInstallPromptPreference(broken), null);
  assert.doesNotThrow(() => writeInstallPromptPreference(broken, { state: "never" }));
  assert.equal(readInstallPromptPreference(null), null);
});

test("manifest : nom, mode standalone, portée et icônes 192 / 512 / maskable", async () => {
  const data = manifest();
  assert.equal(data.name, "Campus Agenda");
  assert.equal(data.short_name, "Campus Agenda");
  assert.equal(data.display, "standalone");
  assert.equal(data.start_url, "/");
  assert.equal(data.scope, "/");
  assert.equal(data.id, "/");
  assert.match(data.theme_color ?? "", /^#[0-9a-f]{6}$/i);
  assert.match(data.background_color ?? "", /^#[0-9a-f]{6}$/i);
  const icons = data.icons ?? [];
  assert.ok(icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));

  for (const icon of [...icons, { src: "/icons/apple-touch-icon.png", sizes: "180x180" }, { src: "/icons/favicon-32.png", sizes: "32x32" }, { src: "/apple-touch-icon.png", sizes: "180x180" }, { src: "/apple-touch-icon-precomposed.png", sizes: "180x180" }]) {
    const bytes = await readFile(new URL(`../web/public${icon.src}`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", icon.src);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.equal(`${width}x${height}`, icon.sizes, icon.src);
  }
});

test("pas de service worker ni de cache hors ligne ; CSP inchangée et compatible", async () => {
  const appFiles = await readdir(new URL("../web/app", import.meta.url), { recursive: true });
  for (const file of appFiles) {
    if (!/\.(tsx?|mjs)$/.test(String(file))) continue;
    const source = await readFile(new URL(`../web/app/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /serviceWorker\.register/, String(file));
  }
  const publicFiles = await readdir(new URL("../web/public", import.meta.url));
  assert.equal(publicFiles.some((file) => /^(sw|service-worker)\.js$/.test(file)), false);
  const csp = buildSecurityCsp({ scriptNonce: "abc" });
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /img-src 'self'/);
  assert.doesNotMatch(csp, /manifest-src/);
});

test("affichage réservé à l’élève connecté par code : ni enseignant, ni administration, ni aperçu", async () => {
  const [page, dashboard, prompt, layout] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-install-prompt.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /offerInstall=\{studentEntry === "code"\}/);
  assert.equal([...page.matchAll(/<StudentInstallPrompt/g)].length, 0);
  assert.match(dashboard, /offerInstall = false/);
  assert.match(dashboard, /\{offerInstall \? <StudentInstallPrompt \/> : null\}/);
  for (const file of ["administration-panel.tsx", "class-notebook-panel.tsx", "ma-semaine-panel.tsx"]) {
    const source = await readFile(new URL(`../web/app/components/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /StudentInstallPrompt|student-install-prompt/, file);
  }

  assert.match(prompt, /Ajoute Campus Agenda à ton téléphone/);
  assert.match(prompt, /Retrouve tes devoirs et tes prochains contrôles directement depuis ton écran d’accueil\./);
  assert.match(prompt, /Plus tard/);
  assert.match(prompt, /Ne plus afficher/);
  assert.match(prompt, /Voir comment installer/);
  assert.match(prompt, /canPromptNatively = platform === "android" && deferredEvent !== null/);
  assert.match(prompt, /beforeinstallprompt/);
  assert.match(prompt, /event\.preventDefault\(\)/);
  assert.match(prompt, /appinstalled/);
  assert.match(prompt, /await event\.prompt\(\)/);
  assert.match(prompt, /Sur l’écran d’accueil/);
  assert.match(prompt, /Ouvrir comme app web/);
  assert.match(prompt, /Ouvre Campus Agenda dans Safari/);
  assert.doesNotMatch(prompt, /fetch\(|sendBeacon|analytics/i);
  assert.doesNotMatch(prompt, /document\.cookie/);

  assert.match(layout, /<head>[\s\S]*rel="apple-touch-icon"[\s\S]*<\/head>/);
  assert.doesNotMatch(layout, /appleWebApp|icons:/);
  assert.match(layout, /apple-touch-icon\.png/);
});
