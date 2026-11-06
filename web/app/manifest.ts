import type { MetadataRoute } from "next";

/**
 * Installation sur l’écran d’accueil. Volontairement sans service worker :
 * chaque ouverture recharge l’agenda depuis le serveur, aucun devoir périmé en cache.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Campus Agenda",
    short_name: "Campus Agenda",
    description: "Tes devoirs et tes prochains contrôles, directement depuis ton écran d’accueil.",
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/campus-agenda-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/campus-agenda-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/campus-agenda-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
