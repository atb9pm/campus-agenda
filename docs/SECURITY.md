# Sécurité et protection des données

## Règles du dépôt

GitHub conserve le code, la documentation, les migrations de schéma et des exemples strictement fictifs. Il ne conserve jamais les données réelles de l'application.

Sont interdits dans le dépôt :

- noms ou coordonnées d'élèves ;
- codes d'accès actifs et identifiants réels ;
- devoirs, résultats ou informations scolaires réels ;
- mots de passe, jetons, clés et secrets ;
- bases locales, sauvegardes et exports.

## Principes d'implémentation

- Collecte minimale et pseudonymisation des accès élèves.
- Séparation stricte des données par classe.
- Permissions contrôlées côté serveur.
- Secrets fournis par l'environnement d'exécution.
- Journalisation sans contenu scolaire sensible.
- Suppression et rotation possibles des codes d'accès.

## Sessions longues (« Rester connecté »)

Le cookie `campus_session` « rester connecté » dure **60 jours**. Ce délai est conservé :

- cookie `HttpOnly` + `SameSite=Lax` + `Secure` en production ;
- un changement de mot de passe ou de MFA révoque les cookies plus anciens ;
- la session courte (poste partagé, case décochée) reste **8 heures**.

Une réduction à 30 jours améliorerait un peu le risque sur un poste partagé où un enseignant aurait coché « rester connecté ». L’impact UX est réel pour les enseignants qui se connectent rarement. **Non modifié** dans cette version : les enseignants sur poste partagé doivent laisser la case décochée.

## CSRF

Pas de jeton CSRF dédié. Politique retenue :

- cookie `SameSite=Lax` : un POST cross-site n’envoie pas le cookie ;
- API JSON same-origin, pas de CORS credentialed ;
- écritures authentifiées : `Origin` doit correspondre à `Host` si elle est présente ; `Sec-Fetch-Site: cross-site` est refusé ;
- `GET /api/admin/backup` et autres lectures admin : même contrôle `Sec-Fetch-Site` (Lax enverrait le cookie sur une navigation GET).

Les tests et `curl` sans `Origin` restent acceptés.

## Rate limiting

| Route | Portée | Défaut |
|---|---|---|
| `POST /api/auth/teacher` | IP / min | 10 |
| `POST /api/auth/student` | IP / min | 20 |
| `POST /api/auth/teacher/password` | IP / min | 10 |
| MFA / codes de récupération | IP+compte / min | 8 |

20 tentatives élève / min sur une IP partagée restent compatibles avec une classe qui se connecte en même temps. Le secret du code fait 8 caractères d’un alphabet 32 symboles : le plafond empêche un balayage automatique, pas une recherche exhaustive. `cf-connecting-ip` n’est utilisé que si `cf-ray` est présent (Infomaniak n’est pas Cloudflare).

## CSP

`script-src` n’autorise plus `unsafe-inline`. vinext pose un nonce par requête (`web/proxy.ts` + worker). `style-src` conserve `unsafe-inline` pour Tailwind et IBM Plex (Google Fonts). Pas de `unsafe-eval`.

## Avant chaque publication

1. Examiner les fichiers ajoutés et modifiés.
2. Rechercher les secrets et données personnelles.
3. Vérifier qu'aucun fichier de base, export ou sauvegarde n'est suivi.
4. Utiliser seulement des données de démonstration clairement fictives dans les tests.

