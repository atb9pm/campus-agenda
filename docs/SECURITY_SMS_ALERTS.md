# Alertes SMS de sécurité

Campus Agenda peut envoyer une alerte lorsqu’un événement de sécurité significatif est détecté.
Le SMS est **uniquement un canal d’alerte** : ce n’est pas un facteur d’authentification. La 2FA
administrateur reste exclusivement TOTP + codes de récupération ; aucun code MFA n’est jamais
envoyé par SMS.

Le système SMS améliore la rapidité de réaction mais ne garantit pas la détection de toutes les attaques ou fuites de données.

## Architecture

```
SecurityEvent ──► shouldSendSecuritySms(event) ──► cooldown / déduplication / plafonds ──► SecuritySmsProvider ──► SMS
   (journal)        (politique centrale)              (table security_notifications)        (Twilio, isolé)
```

- `src/features/security-events/recorder.ts` : après l’enregistrement d’un événement (et de chaque
  anomalie dérivée), appelle le hook `notify`, protégé (`safeNotify`) — une erreur ne remonte jamais.
- `src/features/security-notifications/policy.ts` : `shouldSendSecuritySms(event)`, seule fonction
  qui décide de l’éligibilité, du niveau, de la clé de déduplication et du cooldown.
- `src/features/security-notifications/notifier.ts` : réservation atomique (cooldown, plafonds),
  envoi, statut final, logs.
- `src/features/security-notifications/twilio-provider.ts` : seul code qui parle au fournisseur.
- `web/lib/server/security-sms.ts` : configuration serveur, envoi **en arrière-plan** (fire-and-forget) :
  aucune requête (connexion, MFA, sauvegarde, administration) n’attend le fournisseur.

Aucune logique SMS n’est dispersée dans les routes : les routes enregistrent des `SecurityEvent`
comme avant.

## Événements pouvant produire un SMS

### CRITICAL (éligibles)

Tout événement CRITICAL est éligible, sauf les types exclus ci-dessous. Dans le code actuel :

- `RATE_LIMIT_TRIGGERED` en sévérité CRITICAL : limitation sur la vérification MFA administrateur,
  ou limitation ciblant un compte enseignant existant ;
- `BACKUP_RESTORE_FAILED` : échec inattendu d’une restauration.

### WARNING (liste explicite)

Seuls ces WARNING peuvent produire un SMS (pas de règle « sévérité ≥ WARNING ») :

- `ANOMALY_REPEATED_LOGIN_FAILURES` — échecs de connexion enseignant répétés ;
- `ANOMALY_REPEATED_MFA_FAILURES` — échecs MFA répétés ;
- `ANOMALY_REPEATED_ACCESS_DENIED` — refus d’accès répétés ;
- `ANOMALY_HIGH_READ_VOLUME` — volume de lecture inhabituel ;
- `MFA_RECOVERY_CODE_USED` — utilisation d’un code de récupération ;
- `MFA_RESET` — réinitialisation de la 2FA (y compris par le script serveur) ;
- `MFA_RECONFIGURED` — reconfiguration de la 2FA ;
- `TEACHER_ADMIN_ROLE_GRANTED` — attribution du rôle administrateur ;
- `BACKUP_RESTORE_SUCCEEDED` — restauration complète des données.

### Jamais de SMS

- tout événement INFO (connexion réussie, déconnexion, lecture normale, sauvegarde normale…) ;
- les WARNING non listés : 401 / 403 isolé, mot de passe erroné, code MFA erroné, rate limit
  non critique… ;
- `STUDENT_LOGIN_FAILED`, `ANOMALY_REPEATED_STUDENT_LOGIN_FAILURES` (une classe se trompe souvent de code) ;
- `SESSION_REJECTED`, `BACKUP_DOWNLOADED`, `DATA_EXPORTED`, `TEACHER_LOGIN_SUCCEEDED`, `MFA_VERIFY_SUCCEEDED` ;
- les événements `SECURITY_SMS_*` (traçage du SMS de test) : aucune boucle de notification possible.

## Protection contre les abus

| Règle | Valeur |
| --- | --- |
| Cooldown par problème (même clé de déduplication) | 30 minutes |
| Plafond global | 3 SMS par heure |
| Plafond global | 10 SMS par 24 heures |
| SMS de test | 1 toutes les 10 minutes (compté dans les plafonds) |
| Délai maximal d’appel fournisseur | 5 secondes, une seule tentative |

- Clé de déduplication : type d’événement + compte visé (anomalies par compte), ou type + source
  pseudonymisée (anomalies par source), ou type + périmètre + acteur + source. Elle est hachée
  (SHA-256 tronqué) avant stockage et n’est jamais transmise au fournisseur.
- Les tentatives en cours (`PENDING`), réussies (`SENT`) et échouées (`FAILED`) comptent dans le
  cooldown et les plafonds : une panne du fournisseur ne provoque pas de rafale de nouvelles tentatives.
- Plafond atteint : l’événement de sécurité est enregistré normalement, la suppression est tracée
  (`SUPPRESSED_COOLDOWN`, `SUPPRESSED_RATE_LIMIT`, agrégée par heure avec un compteur
  d’occurrences), rien n’est bloqué.
- La décision et la réservation sont sérialisées : 100 événements CRITICAL simultanés produisent
  au plus 3 appels fournisseur dans l’heure.

## Persistance

Table `security_notifications` (migration `0036_security_notifications.sql`) :

- id, événement source, type, canal (`SMS`), nature (`ALERT` / `TEST`), niveau, statut, clé de
  déduplication hachée, dates, compteur d’occurrences, identifiant de message fournisseur,
  catégorie d’échec ;
- statuts : `PENDING`, `SENT`, `FAILED`, `SUPPRESSED_COOLDOWN`, `SUPPRESSED_RATE_LIMIT`, `DISABLED` ;
- **aucune colonne** pour le numéro de téléphone, le texte du SMS ou une donnée de l’événement ;
- triggers : colonnes d’identité non modifiables, statut final non modifiable ;
- rétention : 180 jours.

Cooldown et plafonds survivent à un redémarrage (lecture en base).

### Sauvegarde et restauration

`security_notifications` est exclue des sauvegardes (`CAMPUS_BACKUP_EXCLUDED_OPERATIONAL_TABLES`),
comme `security_events`. Une restauration ne la modifie pas : restaurer une ancienne sauvegarde
ne peut pas remettre les quotas à zéro.

## Configuration (variables d’environnement serveur)

| Variable | Rôle |
| --- | --- |
| `CAMPUS_SECURITY_SMS_ENABLED` | `true` pour activer (défaut : désactivé) |
| `CAMPUS_SECURITY_SMS_TO` | numéro destinataire, format E.164 (`+41…`) |
| `CAMPUS_SMS_PROVIDER` | `twilio` (défaut si vide) |
| `CAMPUS_SMS_TWILIO_ACCOUNT_SID` | Account SID Twilio (`AC…`) |
| `CAMPUS_SMS_TWILIO_AUTH_TOKEN` | Auth Token Twilio |
| `CAMPUS_SMS_TWILIO_FROM` | expéditeur : numéro E.164, identifiant alphanumérique (≤ 11) ou Messaging Service SID (`MG…`) |

- Les vraies valeurs se configurent **uniquement** sur le serveur. Jamais dans GitHub, jamais en
  base, jamais de préfixe `NEXT_PUBLIC_`. L’écran Administration n’édite pas cette configuration.

### Activation sur Infomaniak

Infomaniak n’a pas d’écran « Variables d’environnement » pour Node.js : les variables se placent
dans la **commande de lancement** du site, comme `AUTH_SECRET`
(voir [infomaniak-deploy.md](./infomaniak-deploy.md)).

1. Créer un compte Twilio ; relever l’Account SID, l’Auth Token et un expéditeur.
2. Manager Infomaniak → site Node.js → commande de lancement : ajouter les variables avant
   `npm run start:infomaniak` (valeurs factices ci-dessous) :

   ```bash
   cd web && AUTH_SECRET=… CAMPUS_MFA_ENCRYPTION_KEY=… CAMPUS_STORE=sqlite \
     CAMPUS_SECURITY_SMS_ENABLED=true CAMPUS_SECURITY_SMS_TO=+41… CAMPUS_SMS_PROVIDER=twilio \
     CAMPUS_SMS_TWILIO_ACCOUNT_SID=AC… CAMPUS_SMS_TWILIO_AUTH_TOKEN=… CAMPUS_SMS_TWILIO_FROM=CampusAg \
     npm run start:infomaniak
   ```

3. Enregistrer puis **Redémarrer**. Administration → Sécurité → Alertes SMS doit afficher « Actives »
   (sinon « Configuration incomplète » indique le nom des variables à corriger).
4. « Envoyer un SMS de test ».
- Les SMS ne partent qu’en production (`NODE_ENV=production`, hors `CI`) **et** avec
  `CAMPUS_SECURITY_SMS_ENABLED=true`. Local, tests, CI et aperçu restent désactivés.
- Configuration incomplète ou invalide : aucun crash ; l’écran indique « Configuration incomplète »
  avec le **nom** des variables à corriger (jamais leur valeur) ; aucun SMS n’est envoyé.
- Le numéro ne peut pas être modifié depuis l’interface.

## Protection du numéro et des secrets

- L’interface et l’API n’affichent que le numéro masqué (`+41 •• ••• •• 12`).
- Aucun log ne contient le numéro complet, le token, l’Account SID, ni le corps de réponse du
  fournisseur. Noms de logs : `security_sms_sent`, `security_sms_failed`,
  `security_sms_suppressed_cooldown`, `security_sms_suppressed_quota`, `security_sms_disabled`,
  `security_sms_config_invalid` (noms de variables uniquement).
- Le endpoint `/api/health` n’expose rien de la configuration SMS.

## Contenu du SMS

Seuls le destinataire, l’expéditeur et un texte fixe sont transmis au fournisseur :

- standard : « Campus Agenda : une activité de sécurité inhabituelle a été détectée. Consultez Administration > Sécurité. »
- critique : « Campus Agenda : alerte de sécurité critique détectée. Consultez immédiatement Administration > Sécurité. »
- test : « Campus Agenda : test des alertes de sécurité réussi. »

Jamais : IP, empreinte, identifiant ou nom d’enseignant / d’apprenti, classe, route, mot de passe,
code MFA, compteur, contenu pédagogique, cookie, jeton, requestId, contenu de sauvegarde.

## Fournisseur : Twilio

API REST Messages (`POST /2010-04-01/Accounts/{AccountSid}/Messages.json`, authentification Basic),
appelée avec `fetch` natif, sans SDK ni dépendance. Choisi pour sa documentation publique stable,
sa couverture des numéros suisses et sa prise en charge des expéditeurs alphanumériques. Le code
fournisseur est isolé derrière l’interface `SecuritySmsProvider` : un autre fournisseur (par
exemple suisse) peut être ajouté sans toucher à la politique.

## Comportement en cas d’échec

- délai de 5 s, une tentative, pas de file ni de nouvelle tentative ;
- erreur, refus, timeout ou exception : statut `FAILED` avec une catégorie (`timeout`, `network`,
  `auth`, `rejected`, `provider-rate-limited`, `provider-error`, `unexpected`), log
  `security_sms_failed` ;
- l’événement de sécurité reste enregistré ; connexion, MFA, sauvegarde, administration et
  navigation continuent normalement.

## Écran Administration → Sécurité → Alertes SMS

État (actives / non configurées / configuration incomplète / désactivées hors production),
destination masquée, alertes critiques, cooldown, limites, date du dernier SMS envoyé, et bouton
« Envoyer un SMS de test » (administrateur, POST, contrôle d’origine, confirmation, 1 test / 10 min,
jamais au chargement de la page).

## Limites

- Un seul destinataire ; pas d’accusé de réception de lecture.
- Les plafonds peuvent masquer des alertes en cas d’attaque prolongée : consulter l’écran
  « Activité de sécurité » reste nécessaire.
- La détection repose sur les seuils simples du journal de sécurité.
- Mono-instance : la sérialisation des réservations est en mémoire (les données, elles, sont en base).
- La délivrance dépend du fournisseur et du réseau mobile.
