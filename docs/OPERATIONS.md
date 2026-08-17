# Exploitation — Campus Agenda

Guide opérationnel pour la phase de démonstration (store mémoire).

## Santé du service

Endpoint public :

```http
GET /api/health
```

Réponse attendue :

```json
{
  "ok": true,
  "service": "campus-agenda",
  "version": "0.11.0",
  "store": "memory",
  "uptimeSeconds": 42
}
```

Chaque réponse API inclut un en-tête `x-request-id` pour corréler les journaux.

## Observabilité

Les événements API sont journalisés en JSON sur la sortie standard, sans contenu scolaire :

- `requestId`, `route`, `method`, `status`, `durationMs`

Variables d'environnement :

| Variable | Rôle |
|---|---|
| `AUTH_SECRET` | Signature des cookies de session (obligatoire en production) |
| `APP_ENV` | Contexte d'exécution (`development`, `production`) |

## Sauvegardes (démonstration)

Réservées aux enseignants authentifiés.

### Export

```http
GET /api/admin/backup
Cookie: campus_session=…
```

Retourne un instantané JSON (`version`, `exportedAt`, `itemCount`, `items`).

### Restauration

```http
POST /api/admin/restore
Content-Type: application/json
Cookie: campus_session=…

{ "snapshot": { … } }
```

> Les sauvegardes ne doivent jamais être versionnées dans Git. Conserver les exports hors dépôt.

## Vérifications avant mise en service

1. `pnpm test` — tests unitaires, E2E API et build SSR.
2. `pnpm lint` — règles d'accessibilité JSX.
3. `GET /api/health` — statut `ok: true`.
4. Contrôler l'absence de secrets et de données réelles dans les journaux et exports.

## Limites actuelles

- Store **mémoire** : les données sont perdues au redémarrage du worker.
- La restauration remplace l'intégralité de l'agenda en mémoire.
- Les sauvegardes couvrent les éléments d'agenda uniquement (pas les comptes).

La migration vers une base D1/SQLite est prévue pour la version `1.0.0`.
