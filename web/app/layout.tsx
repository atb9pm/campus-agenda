import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const incomingHeaders = await headers();
  const host = incomingHeaders.get("host") ?? "localhost:3000";
  const protocol = incomingHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og-v3.png`;

  return {
    title: "Campus Agenda — Agenda scolaire partagé",
    description: "Une démonstration de l’agenda scolaire multi-professeurs et multi-classes Campus Agenda.",
    openGraph: {
      title: "Campus Agenda",
      description: "L’agenda partagé qui donne à toute la classe une vision claire de la semaine.",
      type: "website",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "Campus Agenda, l’agenda scolaire des passionnés de mécanique" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Campus Agenda",
      description: "L’agenda partagé qui donne à toute la classe une vision claire de la semaine.",
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      {/* Dynamic metadata is streamed into <body> for browsers; iOS Safari only reads home-screen icons from <head>. */}
      <head>
        <meta name="application-name" content="Campus Agenda" />
        <meta name="apple-mobile-web-app-title" content="Campus Agenda" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" sizes="180x180" />
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>
        <a className="skip-to-content" href="#main-content">Aller au contenu principal</a>
        {children}
      </body>
    </html>
  );
}
