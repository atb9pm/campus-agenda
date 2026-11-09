import type { Metadata } from "next";
import Link from "next/link";
import {
  ABOUT_PAGE_DESCRIPTION,
  ABOUT_PAGE_FEATURES,
  ABOUT_PAGE_PATH,
  ABOUT_PAGE_TITLE,
  PUBLIC_SITE_DESCRIPTION,
  PUBLIC_SITE_LOCALE,
  PUBLIC_SITE_NAME,
  PUBLIC_SITE_OG_LOCALE,
  publicSiteUrl,
} from "@campus/lib/public-site";
import { APP_VERSION } from "@campus/lib/app-version";
import { BrandLogo } from "../components/brand-logo";

export const metadata: Metadata = {
  title: ABOUT_PAGE_TITLE,
  description: ABOUT_PAGE_DESCRIPTION,
  alternates: { canonical: ABOUT_PAGE_PATH },
  openGraph: {
    type: "website",
    siteName: PUBLIC_SITE_NAME,
    locale: PUBLIC_SITE_OG_LOCALE,
    url: ABOUT_PAGE_PATH,
    title: ABOUT_PAGE_TITLE,
    description: ABOUT_PAGE_DESCRIPTION,
    images: [{ url: "/og-v3.png", width: 1536, height: 1024, alt: "Campus Agenda, agenda scolaire numérique pour les écoles" }],
  },
  twitter: {
    card: "summary_large_image",
    title: ABOUT_PAGE_TITLE,
    description: ABOUT_PAGE_DESCRIPTION,
    images: ["/og-v3.png"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: PUBLIC_SITE_NAME,
  url: publicSiteUrl("/"),
  description: PUBLIC_SITE_DESCRIPTION,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  inLanguage: PUBLIC_SITE_LOCALE,
  countryOfOrigin: { "@type": "Country", name: "Suisse" },
  audience: { "@type": "EducationalAudience", educationalRole: ["student", "teacher"] },
  isAccessibleForFree: true,
};

export default function AboutPage() {
  return (
    <div className="about-shell">
      <main className="about-page" id="main-content">
        <header className="about-header">
          <Link className="about-brand" href="/" aria-label="Campus Agenda, retour à l’accueil">
            <BrandLogo />
          </Link>
          <Link className="about-back" href="/">← Retour à l’accueil</Link>
        </header>

        <article className="about-card" aria-labelledby="about-title">
          <span className="eyebrow">À propos</span>
          <h1 id="about-title">Campus Agenda</h1>
          <p className="about-lead">Plateforme suisse d’agenda scolaire numérique.</p>

          <section aria-labelledby="about-presentation">
            <h2 id="about-presentation">Présentation</h2>
            <p>
              Campus Agenda est un outil pédagogique destiné à faciliter l’organisation et la communication des
              devoirs, des contrôles et des informations de cours entre les enseignants et les élèves.
            </p>
          </section>

          <section aria-labelledby="about-features">
            <h2 id="about-features">Fonctionnalités</h2>
            <ul className="about-features">
              {ABOUT_PAGE_FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="about-usage">
            <h2 id="about-usage">Utilisation</h2>
            <p>
              L’accès aux informations scolaires est réservé aux utilisateurs autorisés. Les élèves accèdent à leur
              espace à l’aide d’un code fourni par leur établissement.
            </p>
          </section>

          <section aria-labelledby="about-security">
            <h2 id="about-security">Sécurité</h2>
            <p>
              Campus Agenda utilise une connexion HTTPS et des mécanismes de contrôle d’accès pour protéger les
              espaces réservés.
            </p>
          </section>

          <footer className="about-actions">
            <Link className="about-primary" href="/">Accéder à Campus Agenda</Link>
          </footer>
        </article>

        <p className="prototype-label">CAMPUS AGENDA {APP_VERSION}</p>
      </main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
    </div>
  );
}
