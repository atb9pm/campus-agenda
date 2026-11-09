import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ABOUT_PAGE_FEATURES,
  ABOUT_PAGE_PATH,
  PUBLIC_DISALLOWED_PATHS,
  PUBLIC_INDEXABLE_PATHS,
  PUBLIC_SITE_DESCRIPTION,
  PUBLIC_SITE_KEYWORDS,
  PUBLIC_SITE_ORIGIN,
  PUBLIC_SITE_TITLE,
  isProductionSiteHost,
  publicSiteUrl,
} from "../src/lib/public-site.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("identité publique : titre, description et mots-clés validés", () => {
  assert.equal(PUBLIC_SITE_ORIGIN, "https://campusagenda.ch");
  assert.equal(PUBLIC_SITE_TITLE, "Campus Agenda – Agenda scolaire numérique pour les écoles");
  assert.match(PUBLIC_SITE_DESCRIPTION, /^Campus Agenda est une plateforme pédagogique suisse destinée aux établissements de formation\./);
  assert.match(PUBLIC_SITE_DESCRIPTION, /consulter leur agenda scolaire en ligne\.$/);
  assert.deepEqual([...PUBLIC_SITE_KEYWORDS], [
    "agenda scolaire numérique",
    "plateforme pédagogique",
    "enseignement professionnel",
    "formation professionnelle suisse",
    "devoirs scolaires",
    "contrôles scolaires",
    "agenda élèves",
    "agenda enseignants",
    "Campus Agenda",
  ]);
  assert.equal(ABOUT_PAGE_FEATURES.length, 6);
});

test("indexation : seules l’accueil et la présentation, jamais l’API", () => {
  assert.deepEqual([...PUBLIC_INDEXABLE_PATHS], ["/", ABOUT_PAGE_PATH]);
  assert.deepEqual([...PUBLIC_DISALLOWED_PATHS], ["/api/"]);
  assert.equal(publicSiteUrl(ABOUT_PAGE_PATH), "https://campusagenda.ch/a-propos");
});

test("seul le domaine de production est indexable", () => {
  assert.equal(isProductionSiteHost("campusagenda.ch"), true);
  assert.equal(isProductionSiteHost("CampusAgenda.ch:443"), true);
  assert.equal(isProductionSiteHost("www.campusagenda.ch"), true);
  for (const host of ["test.campusagenda.ch", "localhost:3000", "campusagenda.ch.evil.example", "", null, undefined]) {
    assert.equal(isProductionSiteHost(host), false, String(host));
  }
});

test("métadonnées statiques dans le layout ; icônes iPhone conservées dans le <head>", async () => {
  const layout = await read("../web/app/layout.tsx");
  assert.match(layout, /export const metadata: Metadata/);
  assert.doesNotMatch(layout, /export (async )?function generateMetadata|from "next\/headers"/);
  assert.match(layout, /metadataBase: new URL\(PUBLIC_SITE_ORIGIN\)/);
  assert.match(layout, /alternates: \{ canonical: "\/" \}/);
  assert.match(layout, /locale: PUBLIC_SITE_OG_LOCALE/);
  assert.match(layout, /<head>[\s\S]*rel="apple-touch-icon"[\s\S]*rel="manifest"[\s\S]*<\/head>/);
  assert.doesNotMatch(layout, /http-equiv|name="classification"|name="rating"|revisit-after/i);
});

test("page /a-propos : serveur, statique, sans appel API ni donnée scolaire", async () => {
  const [about, loginPanel, robots, sitemap, manifest] = await Promise.all([
    read("../web/app/a-propos/page.tsx"),
    read("../web/app/components/login-panel.tsx"),
    read("../web/app/robots.ts"),
    read("../web/app/sitemap.ts"),
    read("../web/app/manifest.ts"),
  ]);
  assert.doesNotMatch(about, /"use client"/);
  assert.doesNotMatch(about, /fetch\(|@campus\/features|@campus\/lib\/(auth|persistence|store)|cookies\(/);
  assert.match(about, /export const metadata: Metadata/);
  assert.match(about, /alternates: \{ canonical: ABOUT_PAGE_PATH \}/);
  assert.match(about, /<BrandLogo \/>/);
  assert.match(about, /href="\/">← Retour à l’accueil<\/Link>/);
  assert.match(loginPanel, /href="\/a-propos"/);
  const page = await read("../web/app/page.tsx");
  for (const source of [loginPanel, page]) {
    assert.doesNotMatch(source, /placeholder="[A-Z0-9]+-[A-Z0-9]{4}-[A-Z0-9]{4}"/);
  }

  assert.match(robots, /isProductionSiteHost\(host\)/);
  assert.match(robots, /disallow: "\/"/);
  assert.match(sitemap, /publicSiteUrl\("\/"\)/);
  assert.match(sitemap, /publicSiteUrl\(ABOUT_PAGE_PATH\)/);

  assert.match(manifest, /categories: \["education"\]/);
  assert.match(manifest, /campus-agenda-maskable-512\.png/);
});
