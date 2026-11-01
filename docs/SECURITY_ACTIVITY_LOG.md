# Journal d’activité de sécurité

Administration → Sécurité → **Activité de sécurité**.

Le journal facilite la détection et l’analyse des incidents (connexions, accès refusés,
blocages automatiques, opérations administratives sensibles). Il ne constitue pas à lui
seul une preuve absolue de l’absence de fuite de données.

## Architecture

| Couche | Fichier | Rôle |
| --- | --- | --- |
| Domaine | `src/features/security-events/` | Catalogue des événements, assainissement des métadonnées, empreinte de source, règles d’anomalie, rétention, résumé 24 h, présentation |
| Persistance | `migrations/0035_security_events.sql`, `src/lib/persistence/sql/sql-security-event-store.ts`, `src/lib/persistence/memory-security-event-store.ts` | Table SQLite append-only, store mémoire pour `CAMPUS_STORE=memory` |
| Serveur | `web/lib/server/security-events.ts` | Contexte requête (requestId, route, méthode, empreinte), classification des refus d’accès, volume de lectures |
| API | `web/app/api/admin/security/activity/route.ts` | Lecture paginée, administrateur uniquement |
| UI | `web/app/components/security-activity-panel.tsx` | Résumé 24 h, filtres, tableau, détail |

Chaque événement est écrit en base **et** émis comme log structuré `security_event`
(niveau `info` / `warn` / `error` selon la sévérité), avec le même `requestId` que le log
`api_request`. Une panne d’écriture du journal ne bloque jamais la requête : l’erreur est
journalisée (`security_event_write_failed`) et le service continue.

## Structure d’un événement

`id`, `occurredAt` (première occurrence, UTC), `lastSeenAt` (dernière occurrence agrégée),
`eventType`, `category` (AUTH, MFA, RATE_LIMIT, AUTHZ, ADMIN, BACKUP, EXPORT, ANOMALY),
`severity` (INFO, WARNING, CRITICAL), `actorType` / `actorId`, `targetType` / `targetId`,
`route` (sans query string), `httpMethod`, `httpStatus`, `requestId`, `sourceFingerprint`,
`metadata` (liste blanche par type), `occurrenceCount`.

Les événements répétitifs identiques (échecs de connexion, refus d’accès, blocages) sont
agrégés sur 15 minutes : une ligne avec un compteur plutôt que des centaines de lignes.

## Ce qui n’est jamais enregistré

Mot de passe, hash, secret TOTP, code MFA, code de récupération, code d’accès apprenti,
`AUTH_SECRET`, `CAMPUS_MFA_ENCRYPTION_KEY`, cookie ou jeton de session, corps de requête,
publications, notes, titres ou contenus pédagogiques, contenu d’une sauvegarde, adresse IP brute.

Garanties techniques :

- métadonnées en **liste blanche** par type d’événement (`catalog.ts`) ; toute clé non déclarée est ignorée ;
- toute valeur qui ressemble à un secret (6 chiffres, `XXXX-XXXX`, jeton long, mots-clés) est refusée ;
- routes sans query string ; `x-request-id` client accepté seulement s’il respecte `^[A-Za-z0-9._:-]{1,64}$` ;
- l’acteur anonyme n’a jamais d’identifiant ; pour un apprenti, seul le préfixe de classe est conservé.

## Pseudonymisation de la source

`HMAC-SHA256(clé, "campus-agenda:security-source:v1:" + IP)`, tronqué à 16 caractères
hexadécimaux. L’IP brute n’est ni stockée ni renvoyée au navigateur ; l’écran affiche
`Source : 7F2A…91C4`. Clé : `CAMPUS_SECURITY_FINGERPRINT_KEY` si définie, sinon `AUTH_SECRET`.
Changer la clé change toutes les empreintes (les anciennes ne sont plus rapprochables).
Aucune géolocalisation.

## Règles de détection (fenêtre glissante)

| Alerte | Déclencheurs | Seuil compte | Seuil source |
| --- | --- | --- | --- |
| Échecs de connexion enseignant répétés | `TEACHER_LOGIN_FAILED`, `TEACHER_LOGIN_ACCOUNT_BLOCKED` | 5 / 15 min | 10 / 15 min |
| Codes apprentis incorrects répétés | `STUDENT_LOGIN_FAILED` | — | 30 / 15 min |
| Codes MFA incorrects répétés | `MFA_VERIFY_FAILED`, `MFA_SENSITIVE_ACTION_DENIED` | 3 / 15 min | 6 / 15 min |
| Accès refusés répétés | `ADMIN_ACCESS_DENIED` | 5 / 15 min | 10 / 15 min |
| Volume de lectures inhabituel | lectures API `GET` authentifiées | 600 / 5 min | — |

Les seuils « source » sont plus élevés car une école partage souvent une même IP (NAT).
Le volume de lectures est compté en mémoire, par compte, sur une seule instance.
Sévérités notables : code de récupération utilisé → WARNING ; rate limit MFA ou blocage
ciblé d’un compte existant → CRITICAL ; échec inattendu de restauration → CRITICAL.

## Rétention

180 jours (`SECURITY_EVENT_RETENTION_DAYS`, calculé sur `lastSeenAt`). La purge est opportuniste
et limitée à une fois toutes les 6 heures par processus (écriture d’un événement ou
consultation de l’écran). Aucune interface ne permet de modifier ou supprimer un événement ;
un trigger SQLite (`security_events_append_only`) refuse toute modification des colonnes
immuables.

## Sauvegarde et restauration

La table `security_events` est un journal **opérationnel hors sauvegarde** :

- elle n’est pas exportée dans la sauvegarde v4 (`CAMPUS_BACKUP_EXCLUDED_OPERATIONAL_TABLES`) ; le format de sauvegarde est inchangé ;
- une restauration ne la vide pas et ne la ramène pas en arrière ; une clé `security_events` glissée dans un fichier est ignorée ;
- la restauration elle-même est journalisée (`BACKUP_RESTORE_STARTED`, puis `SUCCEEDED` ou `FAILED`).

Conséquence : le journal vit sur le même serveur que l’application. Il ne protège pas contre
un attaquant ayant un accès complet au serveur ou à la base.

## API

`GET /api/admin/security/activity` — administrateur avec MFA validée (anonyme → 401,
enseignant → 403). Paramètres : `period` (`24h`, `7d`, `30d`), `severity` (`INFO`,
`WARNING`, `CRITICAL`), `page`, `pageSize` (25 par défaut, 100 maximum). Réponse
`Cache-Control: no-store`, jamais la table complète, jamais d’empreinte complète ni de clé
d’agrégation.

## Limites connues

- Stockage local au serveur applicatif, sans copie indépendante.
- Compteurs de volume de lectures et rate limiter en mémoire : remis à zéro au redémarrage, mono-instance.
- Notifications : WARNING et CRITICAL peuvent déclencher un e-mail
  (voir [SECURITY_EMAIL_ALERTS.md](./SECURITY_EMAIL_ALERTS.md)) ; certaines alertes significatives
  peuvent aussi déclencher un SMS (voir [SECURITY_SMS_ALERTS.md](./SECURITY_SMS_ALERTS.md)).
  Consulter l’écran reste nécessaire.
- Les règles sont des seuils simples, sans apprentissage ni corrélation avancée.

## Évolutions futures (non implémentées)

- Canal SMS plus restrictif ou configurable indépendamment de l’e-mail.
- Export sécurisé du journal.
- Stockage externe / centralisé et copie indépendante hors serveur applicatif.
- Intégration SIEM.
- Détection comportementale plus avancée.
- Chaînage cryptographique d’intégrité des événements.
- Tableau de bord sur 12 mois.
- Redis (ou équivalent) pour les compteurs si l’application passe en multi-instance.
