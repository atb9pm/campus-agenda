/**
 * Identité publique de Campus Agenda : métadonnées, robots.txt, sitemap.xml et page « À propos ».
 * Uniquement des informations de présentation. Jamais de donnée d’établissement,
 * de classe, d’élève, de code d’accès ou de détail d’infrastructure.
 */

export const PUBLIC_SITE_ORIGIN = "https://campusagenda.ch";
export const PUBLIC_SITE_HOST = "campusagenda.ch";
export const PUBLIC_SITE_NAME = "Campus Agenda";
export const PUBLIC_SITE_LOCALE = "fr-CH";
export const PUBLIC_SITE_OG_LOCALE = "fr_CH";

export const PUBLIC_SITE_TITLE = "Campus Agenda – Agenda scolaire numérique pour les écoles";

export const PUBLIC_SITE_DESCRIPTION =
  "Campus Agenda est une plateforme pédagogique suisse destinée aux établissements de formation. Elle permet aux enseignants de publier les devoirs, les contrôles et les informations de cours, et aux élèves de consulter leur agenda scolaire en ligne.";

export const PUBLIC_SITE_KEYWORDS = [
  "agenda scolaire numérique",
  "plateforme pédagogique",
  "enseignement professionnel",
  "formation professionnelle suisse",
  "devoirs scolaires",
  "contrôles scolaires",
  "agenda élèves",
  "agenda enseignants",
  "Campus Agenda",
] as const;

export const ABOUT_PAGE_PATH = "/a-propos";
export const ABOUT_PAGE_TITLE = "À propos de Campus Agenda – Plateforme suisse d’agenda scolaire numérique";
export const ABOUT_PAGE_DESCRIPTION =
  "Campus Agenda, plateforme suisse d’agenda scolaire numérique : publication des devoirs, planification des contrôles et informations de cours, consultées par les élèves avec un code fourni par leur établissement.";

/** Seules pages indexables : le portail de connexion et la présentation. */
export const PUBLIC_INDEXABLE_PATHS = ["/", ABOUT_PAGE_PATH] as const;

/** Routes jamais indexées. Les espaces élève, enseignant et admin s’ouvrent sur `/` après authentification. */
export const PUBLIC_DISALLOWED_PATHS = ["/api/"] as const;

export function publicSiteUrl(path: string): string {
  return new URL(path, PUBLIC_SITE_ORIGIN).toString();
}

/** Seul le domaine de production est indexable ; TEST et les autres hôtes sont exclus. */
export function isProductionSiteHost(host: string | null | undefined): boolean {
  const hostname = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  return hostname === PUBLIC_SITE_HOST || hostname === `www.${PUBLIC_SITE_HOST}`;
}

export const ABOUT_PAGE_FEATURES = [
  "Agenda scolaire partagé.",
  "Publication des devoirs.",
  "Planification des contrôles.",
  "Consultation des informations de cours.",
  "Organisation par classes et branches.",
  "Consultation sur ordinateur, tablette et smartphone.",
] as const;
