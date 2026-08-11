import type { Metadata } from "next";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
