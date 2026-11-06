import { useState, useSyncExternalStore } from "react";
import {
  detectInstallPlatform,
  isStandaloneDisplay,
  laterInstallPromptPreference,
  readInstallPromptPreference,
  shouldOfferInstallPrompt,
  writeInstallPromptPreference,
  type InstallPlatform,
  type InstallPromptPreference,
} from "@campus/features/student";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredInstallEvent: BeforeInstallPromptEvent | null = null;
let installCaptureStarted = false;
const installListeners = new Set<() => void>();

function notifyInstallListeners() {
  for (const listener of installListeners) listener();
}

/**
 * `beforeinstallprompt` n’est émis qu’une fois, souvent avant la connexion élève :
 * l’écoute démarre au chargement de la page et garde l’événement pour un clic ultérieur.
 */
export function startInstallPromptCapture(): void {
  if (installCaptureStarted || typeof window === "undefined") return;
  installCaptureStarted = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallEvent = event as BeforeInstallPromptEvent;
    notifyInstallListeners();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallEvent = null;
    writeInstallPromptPreference(safeLocalStorage(), { state: "installed" });
    notifyInstallListeners();
  });
}

function subscribeInstallEvent(listener: () => void) {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Lu une fois à l’affichage de l’espace élève. */
function readEnvironment(): { platform: InstallPlatform | null; offered: boolean } {
  if (typeof window === "undefined") return { platform: null, offered: false };
  const navigatorStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  const platform = detectInstallPlatform(window.navigator.userAgent);
  const standalone = isStandaloneDisplay({
    displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches,
    navigatorStandalone,
  });
  const preference = readInstallPromptPreference(safeLocalStorage());
  return { platform, offered: shouldOfferInstallPrompt({ platform, standalone, preference, nowMs: Date.now() }) };
}

function ShareIcon() {
  return (
    <svg className="student-install-inline-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="student-install-inline-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="12" cy="19" r="1.9" />
    </svg>
  );
}

/** Guillemets français insécables : « Ajouter » ne se coupe jamais en fin de ligne. */
function quoted(label: string): string {
  return `«\u00a0${label}\u00a0»`;
}

function IosSteps() {
  return (
    <ol className="student-install-steps">
      <li>Ouvre Campus Agenda dans Safari.</li>
      <li>
        Appuie sur le bouton Partager <ShareIcon />.
      </li>
      <li>Choisis {quoted("Sur l’écran d’accueil")}.</li>
      <li>Active {quoted("Ouvrir comme app web")} si l’option est proposée.</li>
      <li>Appuie sur {quoted("Ajouter")}.</li>
    </ol>
  );
}

function AndroidSteps() {
  return (
    <ol className="student-install-steps">
      <li>
        Ouvre le menu <MenuIcon /> de Chrome.
      </li>
      <li>
        Choisis {quoted("Ajouter à l’écran d’accueil")} ou {quoted("Installer l’application")}.
      </li>
      <li>Confirme.</li>
    </ol>
  );
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  if (typeof navigator === "undefined" || !navigator.clipboard) return null;
  return (
    <button
      type="button"
      className="student-install-secondary"
      onClick={() => {
        void navigator.clipboard
          .writeText(window.location.origin)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? "Lien copié" : "Copier le lien"}
    </button>
  );
}

function InstallHelp({ platform }: { platform: InstallPlatform }) {
  if (platform === "ios-safari") return <IosSteps />;
  if (platform === "ios-other") {
    return (
      <>
        <p className="student-install-note">
          Ce navigateur ne permet pas toujours l’ajout à l’écran d’accueil. Ouvre Campus Agenda dans Safari, puis :
        </p>
        <IosSteps />
        <CopyLinkButton />
      </>
    );
  }
  if (platform === "android-inapp") {
    return (
      <>
        <p className="student-install-note">Ouvre d’abord Campus Agenda dans Chrome, puis :</p>
        <AndroidSteps />
        <CopyLinkButton />
      </>
    );
  }
  return <AndroidSteps />;
}

/** Espace élève authentifié uniquement — jamais en aperçu enseignant ni en administration. */
export function StudentInstallPrompt() {
  const [environment] = useState(readEnvironment);
  const [hidden, setHidden] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const deferredEvent = useSyncExternalStore(
    subscribeInstallEvent,
    () => deferredInstallEvent,
    () => null,
  );
  const installed = useSyncExternalStore(
    subscribeInstallEvent,
    () => readInstallPromptPreference(safeLocalStorage())?.state === "installed",
    () => false,
  );

  if (hidden || installed || !environment.offered || !environment.platform) return null;

  const platform = environment.platform;
  const canPromptNatively = platform === "android" && deferredEvent !== null;

  function remember(preference: InstallPromptPreference) {
    writeInstallPromptPreference(safeLocalStorage(), preference);
    setHidden(true);
  }

  async function installNow() {
    const event = deferredInstallEvent;
    if (!event) {
      setHelpOpen(true);
      return;
    }
    deferredInstallEvent = null;
    notifyInstallListeners();
    try {
      await event.prompt();
      const choice = await event.userChoice;
      remember(choice.outcome === "accepted" ? { state: "installed" } : laterInstallPromptPreference(Date.now()));
    } catch {
      setHelpOpen(true);
    }
  }

  return (
    <aside className="student-install-prompt" aria-labelledby="student-install-title" data-install-platform={platform}>
      {/* Asset statique local : pas de loader Next/Image dans ce projet Vinext. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="student-install-icon" src="/icons/apple-touch-icon.png" alt="" width={40} height={40} />
      <div className="student-install-body">
        <div className="student-install-head">
          <h2 id="student-install-title">Ajoute Campus Agenda à ton téléphone</h2>
          <button
            type="button"
            className="student-install-close"
            aria-label="Fermer — me le rappeler plus tard"
            onClick={() => remember(laterInstallPromptPreference(Date.now()))}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p>Retrouve tes devoirs et tes prochains contrôles directement depuis ton écran d’accueil.</p>
        {helpOpen ? <InstallHelp platform={platform} /> : null}
        <div className="student-install-actions">
          {canPromptNatively ? (
            <button type="button" className="student-install-primary" onClick={() => void installNow()}>
              Installer
            </button>
          ) : !helpOpen ? (
            <button type="button" className="student-install-primary" onClick={() => setHelpOpen(true)}>
              Voir comment installer
            </button>
          ) : null}
          <button
            type="button"
            className="student-install-secondary"
            onClick={() => remember(laterInstallPromptPreference(Date.now()))}
          >
            Plus tard
          </button>
          <button type="button" className="student-install-never" onClick={() => remember({ state: "never" })}>
            Ne plus afficher
          </button>
        </div>
      </div>
    </aside>
  );
}
