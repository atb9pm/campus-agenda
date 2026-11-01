# Alertes e-mail de sécurité

Campus Agenda peut envoyer automatiquement une notification lorsqu'un événement **À surveiller**
(WARNING) ou **Critique** (CRITICAL) est détecté. L’e-mail est un **canal d’alerte** : ce n’est
pas un facteur d’authentification.

Cette alerte ne signifie pas nécessairement qu'une intrusion ou une fuite de données a eu lieu.

## Architecture

```
SecurityEvent ──► shouldSendSecurityEmail(event) ──► cooldown / déduplication ──► SecurityEmailTransport ──► SMTP Infomaniak
   (journal)        (politique par sévérité)           (table security_notifications, canal EMAIL)
```

- Le journal (`recordSecurityEvent`) n’est pas modifié : après l’enregistrement, le hook `notify`
  dispatche vers chaque canal (e-mail aujourd’hui, SMS déjà présent, d’autres canaux possibles plus tard).
- `src/features/security-notifications/email-policy.ts` : `shouldSendSecurityEmail(event)`, seule
  fonction qui décide de l’éligibilité e-mail à partir de `event.severity`.
- `email-message.ts` : objet et corps construits uniquement à partir du SecurityEvent déjà assaini.
- `smtp-transport.ts` : Nodemailer, port 587 + STARTTLS (`requireTLS`), timeout 5 s, une tentative.
- Envoi **en arrière-plan** : une panne SMTP ne bloque jamais la connexion, la MFA, une sauvegarde
  ou l’administration.

## Politique

| Sévérité (interface) | Journal | E-mail |
| --- | --- | --- |
| INFO (Information) | oui | non |
| WARNING (À surveiller) | oui | oui |
| CRITICAL (Critique) | oui | oui |

La source de vérité est `event.severity`. Aucune liste parallèle de types n’est maintenue pour
l’e-mail. Exemple : `RATE_LIMIT_TRIGGERED` / « Blocage automatique (trop de tentatives) » reste
WARNING et déclenche un e-mail.

Les événements `SECURITY_EMAIL_*` et `SECURITY_SMS_*` (traçage des tests) ne produisent jamais
d’e-mail : aucune boucle de notification.

Les connexions apprentis réussies ne sont pas journalisées : elles ne peuvent donc pas produire
d’e-mail. Une anomalie WARNING/CRITICAL sur les accès apprentis peut, elle, déclencher un e-mail.

## Anti-spam

| Règle | Valeur |
| --- | --- |
| Cooldown WARNING | 30 minutes |
| Cooldown CRITICAL | 15 minutes |
| Clé de déduplication | type + sévérité + compte + source (hachée SHA-256 avant stockage) |
| E-mail de test | 1 toutes les 10 minutes |

- Deux types distincts (ex. échecs de connexion répétés, puis code de récupération MFA) : deux e-mails.
- Un WARNING puis un CRITICAL : le CRITICAL n’est pas retenu par le cooldown WARNING.
- Le cooldown survit à un redémarrage (table `security_notifications`, hors sauvegarde).

## Contenu

Objet WARNING : `🟠 Campus Agenda – Activité de sécurité à surveiller`

Objet CRITICAL : `🔴 Campus Agenda – Alerte sécurité critique`

Le corps reprend uniquement : libellé, niveau, date (Europe/Zurich), initiales enseignant ou
« Non identifié » / « Anonyme », source pseudonymisée (`B4A1…069B`), route, statut HTTP,
occurrences si > 1, requestId. Jamais : mot de passe, code MFA, code apprentis, cookie, jeton,
secret serveur, IP brute, contenu pédagogique ou de sauvegarde.

Version texte brut toujours fournie. HTML facultatif, sans script, sans image distante, sans CSS externe.

## SMTP Infomaniak

| Variable | Rôle |
| --- | --- |
| `CAMPUS_SECURITY_EMAIL_ENABLED` | `true` pour activer (défaut : désactivé) |
| `CAMPUS_SECURITY_EMAIL_TO` | destinataire unique |
| `CAMPUS_SECURITY_EMAIL_FROM` | expéditeur contrôlé par le serveur |
| `CAMPUS_SMTP_HOST` | `mail.infomaniak.com` par défaut |
| `CAMPUS_SMTP_PORT` | `587` (STARTTLS) ou `465` (TLS implicite) |
| `CAMPUS_SMTP_USER` | adresse e-mail complète |
| `CAMPUS_SMTP_PASSWORD` | mot de passe d’appareil Infomaniak |

Les vraies valeurs se configurent dans la **commande de lancement** Infomaniak (pas d’écran
« Variables d’environnement » Node.js). Jamais dans GitHub, jamais en base, jamais de préfixe
`NEXT_PUBLIC_`. Local, tests et CI restent désactivés. Une configuration incomplète ne crash
pas : log `security_email_configuration_invalid` (noms de variables uniquement).

## Comportement en cas d’échec

L’événement de sécurité reste enregistré. Log `security_email_delivery_failed` (identifiants
d’événement et catégorie d’erreur, jamais le mot de passe SMTP ni le corps du message).
Succès : `security_email_sent` (eventId, eventType, severity, requestId si présent).

## Évolution future : SMS

Le moteur de notifications est déjà organisé par canal (`EMAIL`, `SMS`). Un canal SMS plus
restrictif (par exemple réservé aux CRITICAL) peut s’ajouter sans modifier le moteur de
détection des `SecurityEvent`. Cette documentation décrit l’e-mail ; le SMS n’est pas configuré
ici.

## Limites

- Un seul destinataire.
- Les cooldowns peuvent masquer des rappels pendant une attaque prolongée : consulter
  l’écran « Activité de sécurité » reste nécessaire.
- Mono-instance : la sérialisation des réservations e-mail est en mémoire (les données sont en base).
- La délivrance dépend du serveur SMTP Infomaniak.
