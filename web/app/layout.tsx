import type { Metadata, Viewport } from "next";
import {
  PUBLIC_SITE_DESCRIPTION,
  PUBLIC_SITE_KEYWORDS,
  PUBLIC_SITE_NAME,
  PUBLIC_SITE_OG_LOCALE,
  PUBLIC_SITE_ORIGIN,
  PUBLIC_SITE_TITLE,
} from "@campus/lib/public-site";
import "./globals.css";

// Static on purpose: vinext streams `generateMetadata` into <body> for browsers and unknown crawlers.
export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_ORIGIN),
  title: PUBLIC_SITE_TITLE,
  description: PUBLIC_SITE_DESCRIPTION,
  keywords: [...PUBLIC_SITE_KEYWORDS],
  authors: [{ name: PUBLIC_SITE_NAME }],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    siteName: PUBLIC_SITE_NAME,
    locale: PUBLIC_SITE_OG_LOCALE,
    url: "/",
    title: PUBLIC_SITE_TITLE,
    description: PUBLIC_SITE_DESCRIPTION,
    images: [{ url: "/og-v3.png", width: 1536, height: 1024, alt: "Campus Agenda, agenda scolaire numérique pour les écoles" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PUBLIC_SITE_TITLE,
    description: PUBLIC_SITE_DESCRIPTION,
    images: ["/og-v3.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr-CH">
      {/* iOS Safari only reads home-screen icons from <head>; keep them out of the metadata object. */}
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
