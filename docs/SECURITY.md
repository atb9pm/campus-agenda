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

Deux seaux indépendants (IP **et** cible). Concaténer `IP:compte` permettrait de contourner la cible en changeant d’IP.

| Route | Seau IP | Seau cible | Défaut / min |
|---|---|---|---|
| `POST /api/auth/teacher` | IP d’abord | `teacherId` interne canonique (annuaire sans mot de passe) ; identifiant normalisé si inconnu | 10 + 10 |
| `POST /api/auth/student` | IP | préfixe de classe (ou `unparsed`) | 20 + 20 |
| `POST /api/auth/teacher/password` | IP | compte enseignant | 10 + 10 |
| MFA / codes de récupération | IP | compte administrateur | 8 + 8 |

20 tentatives élève / min sur une IP partagée restent compatibles avec une classe qui se connecte en même temps. Le secret du code fait 8 caractères d’un alphabet de **32** symboles (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, I et O exclus) : le plafond empêche un balayage automatique, pas une recherche exhaustive. Le secret complet n’entre jamais dans une clé de rate limit ou de log. Le seau IP n’est **pas** une preuve anti-spoof : `cf-connecting-ip` seulement avec `cf-ray` ; `x-real-ip` / `X-Forwarded-For` dépendent du proxy. La cible reste la protection principale. Corps d’auth ≤ 8 KiB. Le fallback mémoire est **par processus** : redémarrage = compteurs à zéro.

### Rate limiter mémoire

Seaux expirés nettoyés automatiquement (toutes les 32 opérations ou 15 s, et avant décision de saturation). Plafond **8000** seaux **fail closed** : aucun seau actif n’est évincé ; une nouvelle clé est refusée tant que la Map est pleine de seaux encore valides. Pas de vidage global, pas de tri. Les clés ne sont pas journalisées. Redis n’est pas utilisé dans cette version.

## AUTH_SECRET

En production : au moins **32 octets**, 48 ou 64 caractères aléatoires recommandés. Pas d’exigence artificielle majuscule/chiffre. Valeur jamais loguée. Hors production, valeur fictive interne si la variable est absente.

## Mot de passe démo

Un hash `demo:` est **toujours refusé** si `NODE_ENV=production`. `CAMPUS_ALLOW_DEMO_PASSWORD=1` ne peut pas le réactiver en production.

## CSP

`script-src` n’autorise plus `unsafe-inline`. vinext pose un nonce par requête (`web/proxy.ts` + worker). `style-src` conserve `unsafe-inline` pour Tailwind et IBM Plex (Google Fonts). Pas de `unsafe-eval`.

## Avant chaque publication

1. Examiner les fichiers ajoutés et modifiés.
2. Rechercher les secrets et données personnelles.
3. Vérifier qu'aucun fichier de base, export ou sauvegarde n'est suivi.
4. Utiliser seulement des données de démonstration clairement fictives dans les tests.

